#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Import matchs CDM 2026 depuis CSV
 * Usage : npx tsx scripts/import-matches-csv.ts scripts/matches_cdm2026.csv
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const CSV_PATH = process.argv[2] || path.join(__dirname, 'matches_cdm2026.csv')

async function main() {
  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const lines = content.trim().split('\n')
  const headers = lines[0].split(',')

  const rows = lines.slice(1).map(line => {
    const values = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim() || '')
    return obj
  })

  console.log(`📅  ${rows.length} matchs à importer`)

  const matches = rows.map(r => ({
    sofascore_match_id: r.fixture_id,
    phase: r.phase,
    round: r.round,
    home_team: r.home_team,
    away_team: r.away_team,
    match_date: r.match_date,
    processed: false,
  }))

  const { error } = await supabase
    .from('fantasy_matches')
    .upsert(matches, { onConflict: 'sofascore_match_id', ignoreDuplicates: true })

  if (error) {
    console.error('❌', error.message)
  } else {
    console.log(`✅  ${matches.length} matchs importés`)
  }
}

main().catch(console.error)
