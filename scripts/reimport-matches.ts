#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * reimport-matches.ts
 * Supprime tous les matchs fantasy_matches et réimporte le calendrier
 * complet CDM 2026 depuis openfootball (données officielles, gratuites).
 *
 * Source : https://github.com/openfootball/worldcup.json
 * 104 matchs officiels : 72 phase de groupes + 32 élimination directe
 *
 * Usage :
 *   npx tsx scripts/reimport-matches.ts --dry-run   (audit sans écriture)
 *   npx tsx scripts/reimport-matches.ts             (applique)
 */

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const DRY_RUN = process.argv.includes("--dry-run")
const DATA_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"

// ── Mapping noms anglais → français canonique ──────────────────────────────
const TO_FR: Record<string, string> = {
  // Noms anglais openfootball → français canonique
  France: "France",
  Spain: "Espagne",
  Germany: "Allemagne",
  England: "Angleterre",
  Portugal: "Portugal",
  Brazil: "Brésil",
  Argentina: "Argentine",
  Netherlands: "Pays-Bas",
  Belgium: "Belgique",
  Norway: "Norvège",
  Croatia: "Croatie",
  Uruguay: "Uruguay",
  Switzerland: "Suisse",
  Austria: "Autriche",
  Turkey: "Turquie",
  Türkiye: "Turquie",
  Scotland: "Ecosse",
  Sweden: "Suède",
  "Czech Republic": "Rép. Tchèque",
  Czechia: "Rép. Tchèque",
  "Bosnia and Herzegovina": "Bosnie-Herzégovine",
  "Bosnia & Herzegovina": "Bosnie-Herzégovine",
  "South Korea": "Corée du Sud",
  "Korea Republic": "Corée du Sud",
  Japan: "Japon",
  Australia: "Australie",
  Iran: "Iran",
  "IR Iran": "Iran",
  Iraq: "Irak",
  "Saudi Arabia": "Arabie Saoudite",
  Qatar: "Qatar",
  Uzbekistan: "Ouzbékistan",
  Jordan: "Jordanie",
  Morocco: "Maroc",
  Tunisia: "Tunisie",
  Algeria: "Algérie",
  Egypt: "Egypte",
  Senegal: "Sénégal",
  Ghana: "Ghana",
  "Ivory Coast": "Côte d'Ivoire",
  "South Africa": "Afrique du Sud",
  "DR Congo": "RD Congo",
  "Cape Verde": "Cap-Vert",
  Cameroon: "Cameroun",
  Mexico: "Mexique",
  "United States": "Etats-Unis",
  USA: "Etats-Unis",
  Canada: "Canada",
  Panama: "Panama",
  Haiti: "Haïti",
  "Curaçao": "Curaçao",
  Curacao: "Curaçao",
  Colombia: "Colombie",
  Ecuador: "Equateur",
  Bolivia: "Bolivie",
  Paraguay: "Paraguay",
  Georgia: "Géorgie",
  "New Zealand": "Nouvelle-Zélande",
  Wales: "Pays de Galles",
}

function toFr(name: string): string {
  return TO_FR[name] ?? name
}

function inferPhase(round: string): string {
  const r = round.toLowerCase()
  if (r.includes("matchday") || r.includes("group")) return "poule"
  if (r.includes("32") || r.includes("of 32"))         return "huitieme"
  if (r.includes("16") || r.includes("of 16"))         return "huitieme"
  if (r.includes("quarter"))                            return "quart"
  if (r.includes("semi"))                               return "demi"
  if (r.includes("third") || r.includes("place"))      return "finale"
  if (r.includes("final"))                              return "finale"
  return "poule"
}

/** Génère un ID unique et stable à partir du match */
function makeId(index: number, date: string, home: string, away: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6)
  return `cdm2026-${String(index + 1).padStart(3, "0")}-${slug(home)}-${slug(away)}`
}

/** Convertit "2026-06-11" + "13:00 UTC-6" en ISO timestamp UTC */
function toUtcIso(date: string, time?: string): string {
  if (!time) return `${date}T00:00:00Z`
  // Parse "HH:MM UTC±N"
  const m = time.match(/^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/)
  if (!m) return `${date}T00:00:00Z`
  const [, hh, mm, tz] = m
  const offsetH = parseInt(tz, 10)
  const dt = new Date(`${date}T${hh}:${mm}:00Z`)
  dt.setHours(dt.getHours() - offsetH)
  return dt.toISOString()
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📥  Reimport calendrier CDM 2026 — ${DRY_RUN ? "DRY-RUN" : "MODE LIVE"}`)
  console.log("    Source : openfootball/worldcup.json\n")

  // 1. Télécharger les données openfootball
  console.log("📡  Téléchargement du calendrier CDM 2026…")
  const res = await fetch(DATA_URL)
  if (!res.ok) { console.error(`❌  HTTP ${res.status}`); process.exit(1) }

  const data: {
    name: string
    matches: Array<{
      round: string
      date: string
      time?: string
      team1: string
      team2: string
      group?: string
    }>
  } = await res.json()

  const rawMatches = data.matches ?? []
  console.log(`   ${rawMatches.length} matchs téléchargés\n`)

  // 2. Transformer en lignes DB
  const rows = rawMatches.map((m, i) => {
    const homeFr   = toFr(m.team1)
    const awayFr   = toFr(m.team2)
    const phase    = inferPhase(m.round)
    const matchDate = toUtcIso(m.date, m.time)
    const round    = m.group ? `${m.group} - ${m.round}` : m.round

    return {
      sofascore_match_id: makeId(i, m.date, m.team1, m.team2),
      phase,
      round,
      home_team: homeFr,
      away_team: awayFr,
      match_date: matchDate,
      processed: false,
    }
  })

  // 3. Analyser les équipes non mappées (hors placeholders knockout "W74", "1A", etc.)
  const isTbd = (t: string) => /^[WL]?\d|^[12][A-Z]|^\d[A-Z]/.test(t)
  const unknownTeams = new Set<string>()
  for (const m of rawMatches) {
    if (!TO_FR[m.team1] && !isTbd(m.team1)) unknownTeams.add(m.team1)
    if (!TO_FR[m.team2] && !isTbd(m.team2)) unknownTeams.add(m.team2)
  }

  // 4. Résumé par phase
  const phaseCounts = new Map<string, number>()
  for (const r of rows) phaseCounts.set(r.phase, (phaseCounts.get(r.phase) ?? 0) + 1)

  console.log("📋  Aperçu :")
  console.log(`   Total matchs : ${rows.length}`)
  for (const [p, n] of [...phaseCounts.entries()].sort()) {
    console.log(`   ${p.padEnd(14)} ${n}`)
  }

  if (unknownTeams.size > 0) {
    console.log(`\n⚠️  Équipes sans traduction (${unknownTeams.size}) :`)
    for (const t of unknownTeams) console.log(`   "${t}"`)
  }

  if (DRY_RUN) {
    console.log("\n   Exemples (premiers matchs) :")
    for (const r of rows.slice(0, 6)) {
      console.log(`   [${r.phase}] ${r.home_team} vs ${r.away_team} | ${r.match_date}`)
    }
    console.log("\n⚠️  DRY-RUN terminé — aucune écriture effectuée\n")
    return
  }

  // 5. Supprimer les scores existants (cascade)
  console.log("\n🗑️  Suppression des scores existants…")
  const { count: scoresCount } = await supabase.from("fantasy_scores").select("id", { count: "exact", head: true })
  if ((scoresCount ?? 0) > 0) {
    const { error } = await supabase.from("fantasy_scores").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    if (error) console.warn(`   ⚠️  ${error.message}`)
    else console.log(`   ✅  ${scoresCount} scores supprimés`)
  } else {
    console.log("   ✅  Aucun score à supprimer")
  }

  // 6. Supprimer tous les matchs existants
  console.log("🗑️  Suppression de tous les matchs existants…")
  const { count: matchCount } = await supabase.from("fantasy_matches").select("id", { count: "exact", head: true })
  const { error: matchDelErr } = await supabase
    .from("fantasy_matches")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (matchDelErr) {
    console.error(`   ❌  ${matchDelErr.message}`)
    process.exit(1)
  }
  console.log(`   ✅  ${matchCount} matchs supprimés`)

  // 7. Insérer les nouveaux matchs
  console.log(`\n📥  Insertion de ${rows.length} matchs…`)
  const BATCH = 50
  let inserted = 0

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase.from("fantasy_matches").insert(batch)
    if (error) {
      console.error(`\n   ❌  Batch [${i}..${i + BATCH}] : ${error.message}`)
    } else {
      inserted += batch.length
      process.stdout.write(`   ✅  ${inserted}/${rows.length} insérés\r`)
    }
  }
  console.log(`\n   ✅  ${inserted}/${rows.length} matchs insérés`)

  // 8. Rapport final
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("📊  RAPPORT FINAL\n")

  const { data: finalMatches } = await supabase
    .from("fantasy_matches")
    .select("home_team, away_team, phase")

  // Récupérer les équipes joueurs (paginé)
  const playerPages: { team: string }[] = []
  let pg = 0
  while (true) {
    const { data } = await supabase.from("fantasy_players").select("team").range(pg * 1000, (pg + 1) * 1000 - 1)
    if (!data || data.length === 0) break
    playerPages.push(...data)
    if (data.length < 1000) break
    pg++
  }

  const playerTeams = new Set(playerPages.map(p => p.team))
  const matchTeams  = new Set<string>()
  const finalPhase  = new Map<string, number>()

  for (const m of finalMatches ?? []) {
    matchTeams.add(m.home_team)
    matchTeams.add(m.away_team)
    finalPhase.set(m.phase, (finalPhase.get(m.phase) ?? 0) + 1)
  }

  console.log(`Matchs en base    : ${(finalMatches ?? []).length}`)
  console.log(`Équipes joueurs   : ${playerTeams.size}`)
  console.log("\nPar phase :")
  for (const [ph, ct] of [...finalPhase.entries()].sort()) {
    console.log(`   ${ph.padEnd(14)} ${ct}`)
  }

  // Les placeholders de knockout (W74, 1A, 3B/C/...) sont normaux → les ignorer
  const matchTeamsNoPlayers = [...matchTeams].filter(t => t && !playerTeams.has(t) && !/^[WL]?\d|^[12][A-Z]|^\d[A-Z]|^3[A-Z]/.test(t))
  const playerTeamsNoMatch  = [...playerTeams].filter(t => !matchTeams.has(t))

  if (matchTeamsNoPlayers.length > 0) {
    console.log(`\n⚠️  Équipes dans matchs sans joueurs (${matchTeamsNoPlayers.length}) :`)
    matchTeamsNoPlayers.forEach(t => console.log(`   - "${t}"`))
  } else {
    console.log("\n✅  Toutes les équipes dans les matchs ont des joueurs")
  }

  if (playerTeamsNoMatch.length > 0) {
    console.log(`\n⚠️  Équipes qualifiées sans match (${playerTeamsNoMatch.length}) :`)
    playerTeamsNoMatch.forEach(t => console.log(`   - "${t}"`))
  } else {
    console.log("✅  Toutes les équipes qualifiées ont au moins un match")
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
}

main().catch(e => { console.error(e); process.exit(1) })
