#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })


/**
 * Import du calendrier CDM 2026 depuis SofaScore
 * Usage : npx tsx scripts/import-matches.ts
 *
 * CDM 2026 : 11 juin – 19 juillet 2026
 * SofaScore tournament ID CDM 2026 : à confirmer (était 2 pour CDM 2022)
 *
 * Variables :
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

// CDM 2026 SofaScore : tournament=16 (FIFA World Cup), season à confirmer
// Endpoint pour récupérer les rounds : /unique-tournament/16/season/{seasonId}/events/round/1
// À mettre à jour une fois la season ID connue sur SofaScore
const TOURNAMENT_ID = 16   // FIFA World Cup sur SofaScore
const SEASON_ID    = 61644 // ⚠️  À CONFIRMER — valeur CDM 2026

function inferPhase(round: string): string {
  if (round.includes('Group') || round.toLowerCase().includes('poule')) return 'poule'
  if (round.includes('Round of 16') || round.includes('8')) return 'huitieme'
  if (round.includes('Quarter')) return 'quart'
  if (round.includes('Semi')) return 'demi'
  if (round.includes('Final') && !round.includes('Semi') && !round.includes('Third')) return 'finale'
  return 'poule'
}

async function fetchRound(roundNum: number) {
  try {
    const res = await fetch(
      `${SOFASCORE_BASE}/unique-tournament/${TOURNAMENT_ID}/season/${SEASON_ID}/events/round/${roundNum}`,
      { headers: HEADERS, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.events || []
  } catch {
    return null
  }
}

async function main() {
  console.log(`🌍  Import calendrier CDM 2026\n`)
  console.log(`⚠️   Tournament ID: ${TOURNAMENT_ID}, Season ID: ${SEASON_ID}`)
  console.log(`    Vérifier sur https://api.sofascore.com/api/v1/unique-tournament/${TOURNAMENT_ID}/seasons\n`)

  let totalInserted = 0
  let totalSkipped = 0

  // CDM 2026 : phase de poule = rounds 1-3, puis élimination directe
  for (let round = 1; round <= 8; round++) {
    console.log(`📅  Round ${round}...`)
    const events = await fetchRound(round)

    if (!events || events.length === 0) {
      console.log(`   Aucun match (fin des rounds ou erreur)`)
      if (round > 3) break
      continue
    }

    const matchesToInsert = events.map((ev: {
      id: number
      roundInfo?: { name?: string }
      startTimestamp: number
      homeTeam: { name: string }
      awayTeam: { name: string }
    }) => ({
      sofascore_match_id: String(ev.id),
      phase: inferPhase(ev.roundInfo?.name || `Round ${round}`),
      round: ev.roundInfo?.name || `Round ${round}`,
      home_team: ev.homeTeam.name,
      away_team: ev.awayTeam.name,
      match_date: new Date(ev.startTimestamp * 1000).toISOString(),
      processed: false,
    }))

    const { error } = await supabase
      .from('fantasy_matches')
      .upsert(matchesToInsert, { onConflict: 'sofascore_match_id', ignoreDuplicates: true })

    if (error) {
      console.error(`   ❌  Erreur : ${error.message}`)
    } else {
      console.log(`   ✅  ${matchesToInsert.length} matchs insérés`)
      totalInserted += matchesToInsert.length
    }

    await new Promise(r => setTimeout(r, 1500))
  }

  console.log(`\n✅  Import terminé : ${totalInserted} matchs, ${totalSkipped} ignorés`)
}

main().catch(console.error)
