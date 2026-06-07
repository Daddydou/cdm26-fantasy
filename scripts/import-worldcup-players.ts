#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Importe les 1248 joueurs officiels CdM 2026 depuis GitHub.
 * Usage : npx tsx scripts/import-worldcup-players.ts [--dry-run]
 *
 * Variables d'environnement requises :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"

const DATA_URL =
  "https://raw.githubusercontent.com/Daddydou/cdm26/main/app/scripts/data/worldcup-squads-official-2026.json"

const DRY_RUN = process.argv.includes("--dry-run")

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Mapping JSON key → nom exact dans fantasy_teams (uniquement si différent)
const NAME_MAP: Record<string, string> = {
  // Noms avec accents/caractères différents de la DB
  "République Tchèque": "Rep. Tcheque",
  "Bosnie-Herzégovine": "Bosnie",
  "Écosse": "Ecosse",
  "Haïti": "Haiti",
  "Côte d'Ivoire": "Cote d Ivoire",
  "Curaçao": "Curacao",
  "Égypte": "Egypte",
  "Nouvelle-Zélande": "Nouvelle-Zelande",
  "Algérie": "Algerie",
  "Ouzbékistan": "Ouzbekistan",
}

// Position FWD → ATT pour respecter le check constraint de la DB
function mapPosition(pos: string): "GK" | "DEF" | "MID" | "ATT" {
  if (pos === "FWD") return "ATT"
  if (["GK", "DEF", "MID", "ATT"].includes(pos)) return pos as "GK" | "DEF" | "MID" | "ATT"
  return "ATT"
}

interface JsonPlayer {
  name: string
  position: string
}

async function main() {
  console.log(`🌍  Fetch données depuis GitHub…`)
  const res = await fetch(DATA_URL)
  if (!res.ok) {
    console.error(`❌  HTTP ${res.status} : impossible de charger ${DATA_URL}`)
    process.exit(1)
  }
  const squads: Record<string, JsonPlayer[]> = await res.json()
  const jsonNations = Object.keys(squads)
  console.log(`📋  ${jsonNations.length} nations dans le JSON, ${jsonNations.reduce((n, k) => n + squads[k].length, 0)} joueurs au total`)

  // Charger toutes les équipes de la DB
  const { data: dbTeams, error: teamsError } = await supabase
    .from("fantasy_teams")
    .select("id, name")
  if (teamsError) {
    console.error(`❌  Erreur lecture fantasy_teams : ${teamsError.message}`)
    process.exit(1)
  }
  const dbTeamMap = new Map<string, string>() // name → name (pour lookup insensible à la casse)
  for (const t of dbTeams ?? []) {
    dbTeamMap.set(t.name.toLowerCase(), t.name)
  }

  if (DRY_RUN) console.log(`\n⚠️  MODE DRY-RUN — aucune écriture en base\n`)

  let nationsOk = 0
  let nationsNotFound: string[] = []
  let playersInserted = 0

  for (const jsonKey of jsonNations) {
    const players = squads[jsonKey]

    // Résolution du nom : exact → mapping → insensible à la casse
    const mapped = NAME_MAP[jsonKey] ?? jsonKey
    const dbName =
      dbTeamMap.get(mapped.toLowerCase()) ??
      dbTeamMap.get(jsonKey.toLowerCase())

    if (!dbName) {
      nationsNotFound.push(jsonKey)
      continue
    }

    if (!DRY_RUN) {
      // Récupérer les IDs des joueurs existants de cette équipe
      const { data: existingPlayers } = await supabase
        .from("fantasy_players")
        .select("id")
        .eq("team", dbName)

      const existingIds = (existingPlayers ?? []).map((p) => p.id)

      if (existingIds.length > 0) {
        // Cascade : supprimer squads, scores et prix liés avant les joueurs
        for (const table of ["fantasy_squads", "fantasy_scores", "fantasy_prices"] as const) {
          const { error } = await supabase.from(table).delete().in("player_id", existingIds)
          if (error) console.warn(`  ⚠️  DELETE ${table} (${dbName}) : ${error.message}`)
        }
      }

      // Supprimer les joueurs existants de cette équipe
      const { error: delError } = await supabase
        .from("fantasy_players")
        .delete()
        .eq("team", dbName)
      if (delError) {
        console.error(`❌  DELETE fantasy_players ${dbName} : ${delError.message}`)
        continue
      }

      // Insérer les 26 joueurs
      const rows = players.map((p) => ({
        name: p.name,
        position: mapPosition(p.position),
        team: dbName,
        nationality: dbName,
        transfermarkt_value_m: 0,
        active: true,
      }))

      const { error: insError } = await supabase.from("fantasy_players").insert(rows)
      if (insError) {
        console.error(`❌  INSERT ${dbName} : ${insError.message}`)
        continue
      }
    }

    nationsOk++
    playersInserted += players.length
    process.stdout.write(`✓ ${dbName} (${players.length})\n`)
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Import terminé${DRY_RUN ? " (dry-run)" : ""}
   Nations traitées  : ${nationsOk}
   Joueurs insérés   : ${playersInserted}
   Nations non trouvées (${nationsNotFound.length}) :${
    nationsNotFound.length
      ? "\n     - " + nationsNotFound.join("\n     - ")
      : " aucune"
  }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
