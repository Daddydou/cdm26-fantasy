#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Importe les valeurs Transfermarkt et sofascore_id depuis players_cdm2026.csv
 * vers les joueurs déjà en base (matchés par name + équipe).
 * Usage : npx tsx scripts/import-tm-values.ts
 */

import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

const CSV_PATH = path.join(__dirname, "players_cdm2026.csv")

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// CSV team name → DB team name (fantasy_players.team)
const TEAM_MAP: Record<string, string> = {
  "Algérie":        "Algerie",
  "Curaçao":        "Curacao",
  "Côte d'Ivoire":  "Cote d Ivoire",
  "Haïti":          "Haiti",
  "Nouvelle-Zélande": "Nouvelle-Zelande",
  "Ouzbékistan":    "Ouzbekistan",
  "Equateur":       "Équateur",
  "Etats-Unis":     "États-Unis",
  "Rép. Tchèque":   "Rep. Tcheque",
}

function parseCsv(content: string) {
  const lines = content.trim().split("\n")
  const headers = lines[0].split(",").map(h => h.trim())
  return lines.slice(1).map(line => {
    // split sur la première virgule uniquement pour les champs simples
    const values = line.split(",")
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()]))
  })
}

async function main() {
  const content = fs.readFileSync(CSV_PATH, "utf-8")
  const rows = parseCsv(content)
  console.log(`📂  ${rows.length} joueurs dans le CSV\n`)

  let updated = 0
  let notFound = 0
  const missing: string[] = []

  for (const row of rows) {
    const csvTeam = row.team
    const dbTeam = TEAM_MAP[csvTeam] ?? csvTeam
    const tmValue = parseFloat(row.transfermarkt_value_m) || 0
    const sofascoreId = row.sofascore_id?.trim() || null
    const photoUrl = row.photo_url?.trim() || null

    if (!row.name) continue

    // 1. Mettre à jour TM value (+ photo) sans toucher sofascore_id
    const patch: Record<string, unknown> = { transfermarkt_value_m: tmValue }
    if (photoUrl) patch.photo_url = photoUrl

    const { data, error } = await supabase
      .from("fantasy_players")
      .update(patch)
      .eq("name", row.name)
      .eq("team", dbTeam)
      .select("id")

    if (error) {
      console.error(`❌  ${row.name} (${dbTeam}) : ${error.message}`)
      continue
    }
    if (!data || data.length === 0) {
      missing.push(`${row.name} [${dbTeam}]`)
      notFound++
      continue
    }

    updated++
    process.stdout.write(".")

    // 2. sofascore_id : vider le conflit éventuel sur un autre joueur, puis assigner
    if (sofascoreId) {
      await supabase
        .from("fantasy_players")
        .update({ sofascore_id: null })
        .eq("sofascore_id", sofascoreId)
        .neq("id", data[0].id)

      await supabase
        .from("fantasy_players")
        .update({ sofascore_id: sofascoreId })
        .eq("id", data[0].id)
    }
  }

  console.log(`\n
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Import TM terminé
   Mis à jour : ${updated}
   Non trouvés : ${notFound}${missing.length ? "\n\n⚠️  Joueurs non matchés :\n     - " + missing.join("\n     - ") : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

main().catch(console.error)
