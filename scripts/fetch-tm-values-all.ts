#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Récupère les valeurs Transfermarkt depuis SofaScore pour TOUS les joueurs.
 *   - Avec sofascore_id : GET /api/v1/player/{id}  (pas de recherche)
 *   - Sans sofascore_id  : GET /api/v1/search/all?q={name}  puis détail
 * Ne met à jour que si la valeur retournée est > 0.
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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.sofascore.com/",
}
const DELAY_MS     = 1200  // délai entre requêtes pour éviter le rate-limit
const SEARCH_DELAY = 1800  // plus long pour les recherches (2 appels)

const fromIndex = (() => {
  const idx = process.argv.indexOf("--from")
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 0 : 0
})()

// ---------- Helpers ----------

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Valeur de marché en M€ depuis la réponse /player/{id} */
function extractMarketValue(data: unknown): number {
  const d = data as Record<string, unknown>
  const player = d?.player as Record<string, unknown> | undefined
  if (!player) return 0
  const raw = (player.proposedMarketValueRaw as Record<string, unknown> | undefined)?.value
    ?? player.proposedMarketValue
  const eur = typeof raw === "number" ? raw : 0
  return eur > 0 ? Math.round((eur / 1_000_000) * 10) / 10 : 0
}

/** Récupère la valeur TM via l'ID SofaScore */
async function fetchByid(sofascoreId: string): Promise<{ value: number; found: boolean }> {
  const data = await fetchJson(`https://api.sofascore.com/api/v1/player/${sofascoreId}`)
  const value = extractMarketValue(data)
  return { value, found: data !== null }
}

/** Recherche par nom et retourne { sofascoreId, value } du meilleur résultat */
async function fetchBySearch(name: string): Promise<{ sofascoreId: string | null; value: number }> {
  const q = encodeURIComponent(name)
  const data = await fetchJson(`https://api.sofascore.com/api/v1/search/all?q=${q}&page=0`) as Record<string, unknown> | null
  if (!data) return { sofascoreId: null, value: 0 }

  const results = (data.results as unknown[]) ?? []
  const playerResults = results
    .filter((r: unknown) => (r as Record<string, unknown>).type === "player")
    .map((r: unknown) => (r as Record<string, unknown>).entity as Record<string, unknown>)

  if (playerResults.length === 0) return { sofascoreId: null, value: 0 }

  // Prendre le premier résultat (généralement le plus pertinent)
  const best = playerResults[0]
  const sofascoreId = String(best.id)

  // Récupérer le détail pour avoir la market value
  await new Promise(r => setTimeout(r, 600))
  const detail = await fetchJson(`https://api.sofascore.com/api/v1/player/${sofascoreId}`)
  const value = extractMarketValue(detail)

  return { sofascoreId, value }
}

// ---------- Main ----------

async function main() {
  console.log("\n💶  Récupération des valeurs TM depuis SofaScore\n")
  if (fromIndex > 0) console.log(`⏩  Reprise à partir du joueur #${fromIndex}\n`)

  // Charger tous les joueurs (pagination)
  const allPlayers: { id: string; name: string; team: string; sofascore_id: string | null; transfermarkt_value_m: number }[] = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from("fantasy_players")
      .select("id, name, team, sofascore_id, transfermarkt_value_m")
      .eq("active", true)
      .order("team", { ascending: true })
      .order("name", { ascending: true })
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) { console.error("❌", error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allPlayers.push(...data)
    if (data.length < 1000) break
    page++
  }

  const players = allPlayers.slice(fromIndex)
  console.log(`👥  ${allPlayers.length} joueurs au total, traitement de ${players.length} (à partir de #${fromIndex})\n`)

  let updated    = 0
  let skipped    = 0  // valeur SofaScore = 0 ou joueur introuvable
  let newIds     = 0  // sofascore_id trouvé via recherche et sauvegardé
  let errors     = 0

  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    const globalIdx = fromIndex + i
    process.stdout.write(`[${globalIdx + 1}/${allPlayers.length}] ${player.team} — ${player.name} ... `)

    let tmValue    = 0
    let newSsId: string | null = null

    if (player.sofascore_id) {
      // Chemin rapide : ID connu
      const { value, found } = await fetchByid(player.sofascore_id)
      if (!found) {
        console.log("❓ (ID introuvable)")
        skipped++
        await new Promise(r => setTimeout(r, DELAY_MS))
        continue
      }
      tmValue = value
      await new Promise(r => setTimeout(r, DELAY_MS))
    } else {
      // Recherche par nom
      const { sofascoreId, value } = await fetchBySearch(player.name)
      tmValue = value
      newSsId = sofascoreId
      await new Promise(r => setTimeout(r, SEARCH_DELAY))
    }

    if (tmValue <= 0) {
      console.log("— (valeur 0, conservée)")
      skipped++
      continue
    }

    // Mise à jour en base
    const patch: Record<string, unknown> = { transfermarkt_value_m: tmValue }
    if (newSsId) patch.sofascore_id = newSsId

    const { error: updateError } = await supabase
      .from("fantasy_players")
      .update(patch)
      .eq("id", player.id)

    if (updateError) {
      console.log(`❌ ${updateError.message}`)
      errors++
    } else {
      const prev = player.transfermarkt_value_m
      const tag  = newSsId ? ` [+ID ${newSsId}]` : ""
      const diff = prev > 0 ? ` (était ${prev}M)` : ""
      console.log(`✅ ${tmValue}M€${diff}${tag}`)
      updated++
      if (newSsId) newIds++
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Fetch TM terminé
   Mis à jour    : ${updated}
   Nouveaux IDs  : ${newIds}
   Inchangés     : ${skipped}
   Erreurs       : ${errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

main().catch(console.error)
