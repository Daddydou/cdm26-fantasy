#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Scraper notes joueurs CDM 2026 via API-Football
 * Usage :
 *   npx tsx scripts/fetch-ratings.ts           → tous les matchs non processés
 *   npx tsx scripts/fetch-ratings.ts [match_id] → un match précis (ID API-Football)
 *
 * API-Football : /fixtures/players?fixture=ID&league=1&season=2026
 * Gratuit : 100 req/jour
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const API_KEY  = process.env.API_FOOTBALL_KEY!
const BASE_URL = 'https://v3.football.api-sports.io'
const HEADERS  = { 'x-apisports-key': API_KEY }
const DELAY_MS = 1200 // respecte 100 req/min

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function fetchMatchRatings(fixtureId: string) {
  const res = await fetch(
    `${BASE_URL}/fixtures/players?fixture=${fixtureId}`,
    { headers: HEADERS, signal: AbortSignal.timeout(15000) }
  )
  if (!res.ok) { console.error(`  HTTP ${res.status}`); return null }
  const data = await res.json()
  return data.response || null
}

async function processMatch(match: {
  id: string
  sofascore_match_id: string
  match_date: string
  home_team: string
  away_team: string
}) {
  console.log(`\n⚽  ${match.home_team} vs ${match.away_team}`)

  const response = await fetchMatchRatings(match.sofascore_match_id)
  if (!response || response.length === 0) {
    console.log('  ❌  Données non disponibles')
    return false
  }

  // Récupérer les joueurs DB avec leur nom pour matching
  const { data: dbPlayers } = await supabase
    .from('fantasy_players')
    .select('id, name, sofascore_id')

  if (!dbPlayers) return false

  // Index par sofascore_id ET par nom normalisé
  const byId   = new Map(dbPlayers.filter(p => p.sofascore_id).map(p => [p.sofascore_id, p]))
  const byName = new Map(dbPlayers.map(p => [p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), p]))

  const scoresToInsert = []
  let matched = 0

  for (const team of response) {
    for (const playerData of (team.players || [])) {
      const p = playerData.player
      const stats = playerData.statistics?.[0]
      if (!stats) continue

      const rating = parseFloat(stats.games?.rating) || null
      const minutes = stats.games?.minutes || 0
      if (!rating) continue

      // Cherche par ID API-Football d'abord, puis par nom
      let dbPlayer = byId.get(String(p.id))
      if (!dbPlayer) {
        const normName = p.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        dbPlayer = byName.get(normName)
      }
      if (!dbPlayer) continue

      scoresToInsert.push({
        player_id: dbPlayer.id,
        match_id: match.id,
        sofascore_match_id: match.sofascore_match_id,
        rating,
        minutes_played: minutes,
        match_date: match.match_date,
      })
      matched++
    }
  }

  if (scoresToInsert.length > 0) {
    const { error } = await supabase
      .from('fantasy_scores')
      .upsert(scoresToInsert, { onConflict: 'player_id,match_id' })
    if (error) { console.error('  ❌', error.message); return false }
  }

  await supabase.from('fantasy_matches').update({ processed: true }).eq('id', match.id)
  console.log(`  ✅  ${matched} joueurs matchés, ${scoresToInsert.length} notes enregistrées`)
  return true
}

async function main() {
  if (!API_KEY) { console.error('❌  API_FOOTBALL_KEY manquante'); process.exit(1) }

  const specificId = process.argv[2]

  if (specificId) {
    const { data: match } = await supabase
      .from('fantasy_matches')
      .select()
      .eq('sofascore_match_id', specificId)
      .single()
    if (!match) { console.error(`❌  Match ${specificId} non trouvé`); process.exit(1) }
    await processMatch(match)
  } else {
    const now = new Date().toISOString()
    const { data: matches } = await supabase
      .from('fantasy_matches')
      .select()
      .eq('processed', false)
      .lt('match_date', now)
      .order('match_date', { ascending: true })

    if (!matches || matches.length === 0) { console.log('✅  Aucun match à traiter'); return }
    console.log(`🔄  ${matches.length} matchs à traiter`)

    for (const match of matches) {
      await processMatch(match)
      await sleep(DELAY_MS)
    }
    console.log('\n✅  Batch terminé')
  }
}

main().catch(console.error)
