#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Récupère les valeurs Transfermarkt pour TOUS les joueurs via l'API TM publique.
 *   https://transfermarkt-api.fly.dev/players/search/{name}?page_number=1
 * Ne met à jour la valeur en base que si l'API retourne > 0.
 *
 * Usage : npx tsx scripts/fetch-tm-values-all.ts [--from <index>]
 *   --from 300   reprend à partir du joueur 300 (utile si interrompu)
 */

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const TM_API    = "https://transfermarkt-api.fly.dev"
const DELAY_MS  = 600   // délai entre requêtes

const fromIndex = (() => {
  const idx = process.argv.indexOf("--from")
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 0 : 0
})()

// ---------- Helpers ----------

/** Normalise un nom : minuscules, sans accents, sans ponctuation */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

interface TmResult {
  id: string
  name: string
  marketValue: number | null
  nationalities?: string[]
  club?: { name: string }
}

/**
 * Cherche un joueur par nom sur TM et retourne sa valeur de marché en M€.
 * Prend le premier résultat dont le nom normalisé correspond.
 */
async function fetchTmValue(playerName: string): Promise<{ value: number; tmName: string | null }> {
  const q   = encodeURIComponent(playerName)
  const url = `${TM_API}/players/search/${q}?page_number=1`

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { value: 0, tmName: null }

    const data = await res.json() as { results?: TmResult[] }
    const results = data.results ?? []
    if (results.length === 0) return { value: 0, tmName: null }

    const normTarget = normalize(playerName)

    // 1. Chercher un match exact normalisé
    let match = results.find(r => normalize(r.name) === normTarget)

    // 2. Sinon : match partiel (l'un contient l'autre — gère les prénoms composés)
    if (!match) {
      match = results.find(r => {
        const n = normalize(r.name)
        return n.includes(normTarget) || normTarget.includes(n)
      })
    }

    // 3. Sinon : premier résultat si le nom commence pareil (fallback souple)
    if (!match) {
      const words = normTarget.split(" ")
      const lastName = words[words.length - 1]
      match = results.find(r => normalize(r.name).includes(lastName))
    }

    if (!match) return { value: 0, tmName: null }

    const eur = match.marketValue ?? 0
    const valueM = eur > 0 ? Math.round((eur / 1_000_000) * 10) / 10 : 0
    return { value: valueM, tmName: match.name }
  } catch {
    return { value: 0, tmName: null }
  }
}

// ---------- Main ----------

async function main() {
  console.log("\n💶  Récupération des valeurs Transfermarkt\n")
  if (fromIndex > 0) console.log(`⏩  Reprise à partir du joueur #${fromIndex}\n`)

  // Charger tous les joueurs (pagination car limite Supabase à 1000 lignes)
  const allPlayers: {
    id: string; name: string; team: string
    transfermarkt_value_m: number
  }[] = []

  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from("fantasy_players")
      .select("id, name, team, transfermarkt_value_m")
      .eq("active", true)
      .order("team")
      .order("name")
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) { console.error("❌", error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allPlayers.push(...data)
    if (data.length < 1000) break
    page++
  }

  const players = allPlayers.slice(fromIndex)
  console.log(`👥  ${allPlayers.length} joueurs au total — traitement de ${players.length}\n`)

  let updated = 0
  let skipped = 0
  let errors  = 0

  for (let i = 0; i < players.length; i++) {
    const player    = players[i]
    const globalIdx = fromIndex + i
    process.stdout.write(`[${globalIdx + 1}/${allPlayers.length}] ${player.team} — ${player.name} ... `)

    const { value, tmName } = await fetchTmValue(player.name)
    await new Promise(r => setTimeout(r, DELAY_MS))

    if (value <= 0) {
      console.log("— (non trouvé ou valeur 0)")
      skipped++
      continue
    }

    const { error: updateError } = await supabase
      .from("fantasy_players")
      .update({ transfermarkt_value_m: value })
      .eq("id", player.id)

    if (updateError) {
      console.log(`❌ ${updateError.message}`)
      errors++
    } else {
      const prev = player.transfermarkt_value_m
      const diff = prev > 0 && prev !== value ? ` (était ${prev}M)` : ""
      const name = tmName && normalize(tmName) !== normalize(player.name) ? ` [TM: ${tmName}]` : ""
      console.log(`✅ ${value}M€${diff}${name}`)
      updated++
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Fetch TM terminé
   Mis à jour : ${updated}
   Non trouvés / 0 : ${skipped}
   Erreurs    : ${errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

main().catch(console.error)
