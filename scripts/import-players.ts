#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })


/**
 * Import joueurs depuis CSV → Supabase
 * Usage : npx tsx scripts/import-players.ts [chemin/vers/players.csv]
 *
 * Variables d'environnement requises :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const CSV_PATH = process.argv[2] || path.join(__dirname, 'players_template.csv')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

interface CsvRow {
  name: string
  position: string
  team: string
  nationality: string
  transfermarkt_value_m: string
  sofascore_id: string
  photo_url: string
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])) as CsvRow
  })
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌  Fichier introuvable : ${CSV_PATH}`)
    process.exit(1)
  }

  const content = fs.readFileSync(CSV_PATH, 'utf-8')
  const rows = parseCsv(content)
  console.log(`📂  ${rows.length} joueurs trouvés dans le CSV`)

  const players = rows.map(r => ({
    name: r.name,
    position: r.position as 'GK' | 'DEF' | 'MID' | 'ATT',
    team: r.team,
    nationality: r.nationality,
    transfermarkt_value_m: parseFloat(r.transfermarkt_value_m) || 0,
    sofascore_id: r.sofascore_id || null,
    photo_url: r.photo_url || null,
    active: true,
  }))

  // Upsert par sofascore_id (ou name+team si pas de sofascore_id)
  let inserted = 0
  let updated = 0
  let errors = 0

  for (const player of players) {
    const { data, error } = await supabase
      .from('fantasy_players')
      .upsert(player, {
        onConflict: player.sofascore_id ? 'sofascore_id' : 'id',
        ignoreDuplicates: false,
      })
      .select()

    if (error) {
      console.error(`❌  ${player.name} : ${error.message}`)
      errors++
    } else {
      const wasInsert = !data || data.length > 0
      wasInsert ? inserted++ : updated++
      process.stdout.write('.')
    }
  }

  console.log(`\n\n✅  Import terminé`)
  console.log(`   Insérés  : ${inserted}`)
  console.log(`   Mis à jour : ${updated}`)
  console.log(`   Erreurs  : ${errors}`)
}

main().catch(console.error)
