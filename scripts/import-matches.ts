#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Import du calendrier CDM 2026 via API-Football
 * Usage : npx tsx scripts/import-matches.ts
 * league=1, season=2026 — gratuit 100 req/jour
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const API_KEY  = process.env.API_FOOTBALL_KEY!
const BASE_URL = 'https://v3.football.api-sports.io'
const LEAGUE   = 1
const SEASON   = 2026

const HEADERS  = { 'x-apisports-key': API_KEY }

function inferPhase(round: string): string {
  const r = round.toLowerCase()
  if (r.includes('group'))                               return 'poule'
  if (r.includes('round of 32') || r.includes('of 32')) return 'huitieme'
  if (r.includes('round of 16') || r.includes('of 16')) return 'huitieme'
  if (r.includes('quarter'))                             return 'quart'
  if (r.includes('semi'))                                return 'demi'
  if (r.includes('final') && !r.includes('semi') && !r.includes('third')) return 'finale'
  return 'poule'
}

async function main() {
  console.log('\n🌍  Import calendrier CDM 2026 via API-Football\n')
  if (!API_KEY) { console.error('❌  API_FOOTBALL_KEY manquante'); process.exit(1) }

  // Récupérer les rounds
  const roundsRes = await fetch(
    `${BASE_URL}/fixtures/rounds?league=${LEAGUE}&season=${SEASON}`,
    { headers: HEADERS }
  )
  const roundsData = await roundsRes.json()
  const rounds: string[] = roundsData.response || []
  console.log(`📋  ${rounds.length} rounds trouvés`)

  let total = 0

  for (const round of rounds) {
    process.stdout.write(`📅  ${round}... `)

    const res = await fetch(
      `${BASE_URL}/fixtures?league=${LEAGUE}&season=${SEASON}&round=${encodeURIComponent(round)}`,
      { headers: HEADERS }
    )
    const data = await res.json()
    const fixtures = data.response || []

    if (!fixtures.length) { console.log('vide'); continue }

    const rows = fixtures.map((f: {
      fixture: { id: number; date: string }
      teams: { home: { name: string }; away: { name: string } }
    }) => ({
      sofascore_match_id: String(f.fixture.id),
      phase: inferPhase(round),
      round,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      match_date: f.fixture.date,
      processed: false,
    }))

    const { error } = await supabase
      .from('fantasy_matches')
      .upsert(rows, { onConflict: 'sofascore_match_id', ignoreDuplicates: true })

    if (error) { console.log(`❌ ${error.message}`) }
    else { console.log(`✅ ${rows.length} matchs`); total += rows.length }

    await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\n✅  Total : ${total} matchs importés`)
}

main().catch(console.error)
