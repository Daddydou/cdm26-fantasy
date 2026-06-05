#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })


/**
 * Scraper SofaScore — notes joueurs CDM26
 * Usage : npx tsx scripts/fetch-ratings.ts [sofascore_match_id]
 *   Sans argument : traite tous les matchs non-processés
 *
 * L'API SofaScore n'est pas officielle mais stable.
 * Endpoint : https://api.sofascore.com/api/v1/event/{id}/lineups
 *
 * Variables d'environnement :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const SOFASCORE_BASE = 'https://api.sofascore.com/api/v1'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.sofascore.com/',
}
const DELAY_MS = 2000 // respecte le rate-limit SofaScore

interface SofaPlayer {
  player: {
    id: number
    name: string
  }
  statistics?: {
    rating?: number
    minutesPlayed?: number
  }
}

interface SofaLineup {
  home: { players: SofaPlayer[] }
  away: { players: SofaPlayer[] }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchMatchLineup(sofascoreMatchId: string): Promise<SofaLineup | null> {
  try {
    const res = await fetch(
      `${SOFASCORE_BASE}/event/${sofascoreMatchId}/lineups`,
      { headers: HEADERS, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) {
      console.error(`  HTTP ${res.status} pour match ${sofascoreMatchId}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.error(`  Erreur fetch match ${sofascoreMatchId} :`, (e as Error).message)
    return null
  }
}

async function processMatch(match: {
  id: string
  sofascore_match_id: string
  match_date: string
  home_team: string
  away_team: string
}) {
  console.log(`\n⚽  ${match.home_team} vs ${match.away_team} (${match.sofascore_match_id})`)

  const lineup = await fetchMatchLineup(match.sofascore_match_id)
  if (!lineup) {
    console.log('  ❌  Lineup non disponible')
    return false
  }

  const allPlayers: SofaPlayer[] = [
    ...(lineup.home?.players || []),
    ...(lineup.away?.players || []),
  ]

  console.log(`  👥  ${allPlayers.length} joueurs trouvés`)

  // Récupérer les sofascore_id des joueurs de notre DB
  const { data: dbPlayers } = await supabase
    .from('fantasy_players')
    .select('id, sofascore_id, name')
    .not('sofascore_id', 'is', null)

  if (!dbPlayers) return false

  const dbMap = new Map(dbPlayers.map(p => [p.sofascore_id, p]))

  let matched = 0
  const scoresToInsert = []

  for (const sp of allPlayers) {
    const sofaId = String(sp.player.id)
    const dbPlayer = dbMap.get(sofaId)

    if (!dbPlayer) continue
    if (!sp.statistics?.rating) continue

    scoresToInsert.push({
      player_id: dbPlayer.id,
      match_id: match.id,
      sofascore_match_id: match.sofascore_match_id,
      rating: sp.statistics.rating,
      minutes_played: sp.statistics.minutesPlayed || 0,
      match_date: match.match_date,
    })
    matched++
  }

  if (scoresToInsert.length > 0) {
    const { error } = await supabase
      .from('fantasy_scores')
      .upsert(scoresToInsert, { onConflict: 'player_id,match_id' })

    if (error) {
      console.error('  ❌  Erreur insert scores :', error.message)
      return false
    }
  }

  // Marquer le match comme processé
  await supabase
    .from('fantasy_matches')
    .update({ processed: true })
    .eq('id', match.id)

  console.log(`  ✅  ${matched} joueurs matchés, ${scoresToInsert.length} notes enregistrées`)
  return true
}

async function main() {
  const specificId = process.argv[2]

  if (specificId) {
    // Mode single match
    const { data: match } = await supabase
      .from('fantasy_matches')
      .select()
      .eq('sofascore_match_id', specificId)
      .single()

    if (!match) {
      console.error(`❌  Match ${specificId} non trouvé en base`)
      process.exit(1)
    }

    await processMatch(match)
  } else {
    // Mode batch — tous les matchs non processés
    const { data: matches } = await supabase
      .from('fantasy_matches')
      .select()
      .eq('processed', false)
      .order('match_date', { ascending: true })

    if (!matches || matches.length === 0) {
      console.log('✅  Aucun match à traiter')
      return
    }

    console.log(`🔄  ${matches.length} matchs à traiter`)

    for (const match of matches) {
      await processMatch(match)
      await sleep(DELAY_MS)
    }

    console.log('\n✅  Batch terminé')
  }
}

main().catch(console.error)
