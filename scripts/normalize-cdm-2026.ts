#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * normalize-cdm-2026.ts
 * Normalise fantasy_players + fantasy_matches pour CDM 2026 :
 *   • 48 nations × 26 joueurs = 1248 joueurs
 *   • Noms d'équipes en français cohérents entre les deux tables
 *
 * Usage :
 *   npx tsx scripts/normalize-cdm-2026.ts --dry-run   (audit sans écriture)
 *   npx tsx scripts/normalize-cdm-2026.ts             (applique tout)
 *
 * Sources vérifiées : FIFA, ESPN, Al Jazeera (juin 2026)
 */

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const DRY_RUN = process.argv.includes("--dry-run")

// ===========================================================================
// Les 48 nations qualifiées CDM 2026 — noms canoniques français
// Source : FIFA officiel, ESPN, Al Jazeera (vérifié juin 2026)
// ===========================================================================
// UEFA (16) : Angleterre, France, Croatie, Norvège, Portugal, Allemagne,
//             Pays-Bas, Suisse, Ecosse, Espagne, Autriche, Belgique,
//             Bosnie-Herzégovine, Suède, Turquie, Rép. Tchèque
// CONMEBOL (6) : Argentine, Brésil, Colombie, Equateur, Paraguay, Uruguay
// CONCACAF (6) : Etats-Unis, Canada, Mexique, Panama, Haïti, Curaçao
// CAF (10) : Afrique du Sud, Algérie, Cap-Vert, Côte d'Ivoire, Egypte,
//            Ghana, Maroc, RD Congo, Sénégal, Tunisie
// AFC (9) : Arabie Saoudite, Australie, Corée du Sud, Irak, Iran, Japon,
//           Jordanie, Ouzbékistan, Qatar
// OFC (1) : Nouvelle-Zélande

const QUALIFIED_48 = new Set([
  // UEFA (16)
  "Angleterre", "France", "Croatie", "Norvège", "Portugal", "Allemagne",
  "Pays-Bas", "Suisse", "Ecosse", "Espagne", "Autriche", "Belgique",
  "Bosnie-Herzégovine", "Suède", "Turquie", "Rép. Tchèque",
  // CONMEBOL (6)
  "Argentine", "Brésil", "Colombie", "Equateur", "Paraguay", "Uruguay",
  // CONCACAF (6)
  "Etats-Unis", "Canada", "Mexique", "Panama", "Haïti", "Curaçao",
  // CAF (10)
  "Afrique du Sud", "Algérie", "Cap-Vert", "Côte d'Ivoire", "Egypte",
  "Ghana", "Maroc", "RD Congo", "Sénégal", "Tunisie",
  // AFC (9)
  "Arabie Saoudite", "Australie", "Corée du Sud", "Irak", "Iran", "Japon",
  "Jordanie", "Ouzbékistan", "Qatar",
  // OFC (1)
  "Nouvelle-Zélande",
])

// ===========================================================================
// Mapping universel : variante de nom → nom canonique français
// ===========================================================================
const TO_CANONICAL: Record<string, string> = {
  // ── Noms anglais ──────────────────────────────────────────────────────────
  France: "France", Spain: "Espagne", Germany: "Allemagne",
  England: "Angleterre", Portugal: "Portugal", Brazil: "Brésil",
  Argentina: "Argentine", Netherlands: "Pays-Bas", Belgium: "Belgique",
  Norway: "Norvège", Croatia: "Croatie", Uruguay: "Uruguay",
  Switzerland: "Suisse", Austria: "Autriche", Turkey: "Turquie",
  Türkiye: "Turquie", Scotland: "Ecosse", Sweden: "Suède",
  "Czech Republic": "Rép. Tchèque", Czechia: "Rép. Tchèque",
  "Bosnia and Herzegovina": "Bosnie-Herzégovine",
  "Bosnia & Herzegovina": "Bosnie-Herzégovine",
  "South Korea": "Corée du Sud", "Korea Republic": "Corée du Sud",
  Japan: "Japon", Australia: "Australie",
  Iran: "Iran", "IR Iran": "Iran",
  Iraq: "Irak", "Saudi Arabia": "Arabie Saoudite", Qatar: "Qatar",
  Uzbekistan: "Ouzbékistan", Jordan: "Jordanie", Morocco: "Maroc",
  Tunisia: "Tunisie", Algeria: "Algérie", Egypt: "Egypte",
  Senegal: "Sénégal", Ghana: "Ghana",
  "Ivory Coast": "Côte d'Ivoire", "South Africa": "Afrique du Sud",
  "DR Congo": "RD Congo", "Congo DR": "RD Congo",
  "Cape Verde": "Cap-Vert", "Cape Verde Islands": "Cap-Vert",
  Cameroon: "Cameroun", Mexico: "Mexique",
  "United States": "Etats-Unis", USA: "Etats-Unis",
  Canada: "Canada", Panama: "Panama", Haiti: "Haïti",
  "Curaçao": "Curaçao", Curacao: "Curaçao",
  Colombia: "Colombie", Ecuador: "Equateur",
  Bolivia: "Bolivie", Paraguay: "Paraguay",
  Georgia: "Géorgie", "New Zealand": "Nouvelle-Zélande",
  Wales: "Pays de Galles",

  // ── Noms français canoniques (idempotent) ─────────────────────────────────
  Espagne: "Espagne", Allemagne: "Allemagne", Angleterre: "Angleterre",
  "Brésil": "Brésil", Argentine: "Argentine", "Pays-Bas": "Pays-Bas",
  Belgique: "Belgique", "Norvège": "Norvège", Croatie: "Croatie",
  Suisse: "Suisse", Autriche: "Autriche", Turquie: "Turquie",
  Ecosse: "Ecosse", Suède: "Suède", Pologne: "Pologne", Serbie: "Serbie",
  "Rép. Tchèque": "Rép. Tchèque", Danemark: "Danemark",
  "Bosnie-Herzégovine": "Bosnie-Herzégovine",
  "Corée du Sud": "Corée du Sud", Japon: "Japon", Australie: "Australie",
  "Arabie Saoudite": "Arabie Saoudite", "Ouzbékistan": "Ouzbékistan",
  Jordanie: "Jordanie", Maroc: "Maroc", Tunisie: "Tunisie",
  "Algérie": "Algérie", Egypte: "Egypte", "Sénégal": "Sénégal",
  Ghana: "Ghana", "Côte d'Ivoire": "Côte d'Ivoire",
  "Afrique du Sud": "Afrique du Sud", "RD Congo": "RD Congo",
  "Cap-Vert": "Cap-Vert", Cameroun: "Cameroun", Mexique: "Mexique",
  "Etats-Unis": "Etats-Unis", Panama: "Panama", "Haïti": "Haïti",
  "Curaçao": "Curaçao", Colombie: "Colombie", Equateur: "Equateur",
  Bolivie: "Bolivie", Paraguay: "Paraguay", "Géorgie": "Géorgie",
  "Nouvelle-Zélande": "Nouvelle-Zélande", "Pays de Galles": "Pays de Galles",

  // ── Anciennes variantes DB (sans accents / abréviations) ─────────────────
  "Rep. Tcheque": "Rép. Tchèque",
  Bosnie: "Bosnie-Herzégovine",
  "Coree du Sud": "Corée du Sud",
  Ouzbekistan: "Ouzbékistan",
  Algerie: "Algérie",
  "Cote d Ivoire": "Côte d'Ivoire",
  "Cote d'Ivoire": "Côte d'Ivoire",
  "Nouvelle-Zelande": "Nouvelle-Zélande",
  Georgie: "Géorgie",
  Bresil: "Brésil",
  Norvege: "Norvège",
  Haiti: "Haïti",
  Curacao: "Curaçao",
  Irak: "Irak",

  // ── Variantes JSON avec accents ───────────────────────────────────────────
  "République Tchèque": "Rép. Tchèque",
  "Écosse": "Ecosse",
  "Égypte": "Egypte",
  "États-Unis": "Etats-Unis",
  "Équateur": "Equateur",
}

// ===========================================================================
async function main() {
  console.log(`\n🌍  Normalisation CDM 2026 — ${DRY_RUN ? "DRY-RUN (lecture seule)" : "MODE LIVE"}`)
  console.log(`    48 nations qualifiées × 26 joueurs = 1248\n`)

  // ── 1. Lire l'état actuel de fantasy_players ──────────────────────────────
  console.log("🔍  Lecture fantasy_players…")
  const allPlayers: { id: string; team: string }[] = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from("fantasy_players")
      .select("id, team")
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) { console.error("❌", error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allPlayers.push(...data)
    if (data.length < 1000) break
    page++
  }

  const dbTeamCounts = new Map<string, number>()
  for (const p of allPlayers) {
    dbTeamCounts.set(p.team, (dbTeamCounts.get(p.team) ?? 0) + 1)
  }
  console.log(`   ${dbTeamCounts.size} équipes, ${allPlayers.length} joueurs\n`)

  // ── 2. Lire l'état actuel de fantasy_matches ──────────────────────────────
  console.log("🔍  Lecture fantasy_matches…")
  const { data: allMatches, error: mErr } = await supabase
    .from("fantasy_matches")
    .select("id, home_team, away_team")
  if (mErr) { console.error("❌", mErr.message); process.exit(1) }
  const matchTeamSet = new Set<string>()
  for (const m of allMatches ?? []) {
    matchTeamSet.add(m.home_team)
    matchTeamSet.add(m.away_team)
  }
  console.log(`   ${(allMatches ?? []).length} matchs, ${matchTeamSet.size} équipes distinctes\n`)

  // ── 3. Analyser les équipes en base ───────────────────────────────────────
  const toRename = new Map<string, string>()  // dbName → canonicalName
  const toDelete: string[] = []               // dbName (non qualifiés)
  const missingFromDb: string[] = []          // canonical (qualifiés mais absents)

  const presentCanonicals = new Set<string>()

  for (const [team] of dbTeamCounts) {
    const canonical = TO_CANONICAL[team] ?? team
    if (QUALIFIED_48.has(canonical)) {
      presentCanonicals.add(canonical)
      if (canonical !== team) toRename.set(team, canonical)
    } else {
      toDelete.push(team)
    }
  }

  for (const nation of QUALIFIED_48) {
    if (!presentCanonicals.has(nation)) missingFromDb.push(nation)
  }

  // ── 4. Analyser fantasy_matches ───────────────────────────────────────────
  const matchesToFix = new Map<string, string>() // old → canonical (pour toutes les lignes)
  for (const t of matchTeamSet) {
    const canonical = TO_CANONICAL[t] ?? t
    if (canonical !== t) matchesToFix.set(t, canonical)
  }

  // ── 5. Rapport d'analyse ──────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("📋  ANALYSE\n")

  if (toRename.size > 0) {
    console.log(`📝  Renommages fantasy_players (${toRename.size}) :`)
    for (const [from, to] of toRename) {
      console.log(`   "${from}" → "${to}" (${dbTeamCounts.get(from)} joueurs)`)
    }
    console.log()
  }

  if (toDelete.length > 0) {
    console.log(`🗑️  Équipes non qualifiées à supprimer (${toDelete.length}) :`)
    for (const t of toDelete) {
      console.log(`   "${t}" (${dbTeamCounts.get(t)} joueurs)`)
    }
    console.log()
  }

  if (missingFromDb.length > 0) {
    console.log(`❌  Équipes qualifiées manquantes en base (${missingFromDb.length}) :`)
    for (const t of missingFromDb) console.log(`   "${t}"`)
    console.log()
  }

  if (matchesToFix.size > 0) {
    console.log(`🔗  Corrections fantasy_matches (${matchesToFix.size} noms) :`)
    for (const [from, to] of matchesToFix) {
      console.log(`   "${from}" → "${to}"`)
    }
    console.log()
  }

  if (DRY_RUN) {
    const summary = []
    if (toRename.size > 0) summary.push(`${toRename.size} renommage(s)`)
    if (toDelete.length > 0) summary.push(`${toDelete.length} suppression(s)`)
    if (missingFromDb.length > 0) summary.push(`${missingFromDb.length} équipe(s) manquante(s)`)
    if (matchesToFix.size > 0) summary.push(`${matchesToFix.size} correction(s) matches`)
    console.log(`⚠️  DRY-RUN — résumé : ${summary.length === 0 ? "aucune action requise ✅" : summary.join(", ")}`)
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    return
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODE LIVE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 6. Renommer les équipes dans fantasy_players ──────────────────────────
  if (toRename.size > 0) {
    console.log("📝  Renommage dans fantasy_players…")
    for (const [oldName, canonical] of toRename) {
      const { error } = await supabase
        .from("fantasy_players")
        .update({ team: canonical, nationality: canonical })
        .eq("team", oldName)
      if (error) {
        console.error(`   ❌  "${oldName}" → "${canonical}" : ${error.message}`)
      } else {
        console.log(`   ✅  "${oldName}" → "${canonical}" (${dbTeamCounts.get(oldName)} joueurs)`)
      }
    }
    console.log()
  }

  // ── 7. Supprimer les équipes non qualifiées ───────────────────────────────
  if (toDelete.length > 0) {
    console.log("🗑️  Suppression des équipes non qualifiées…")
    for (const team of toDelete) {
      const ids = allPlayers.filter(p => p.team === team).map(p => p.id)
      for (const tbl of ["fantasy_squads", "fantasy_scores", "fantasy_prices"] as const) {
        const { error } = await supabase.from(tbl).delete().in("player_id", ids)
        if (error) console.warn(`   ⚠️  DELETE ${tbl} (${team}) : ${error.message}`)
      }
      const { error } = await supabase.from("fantasy_players").delete().eq("team", team)
      if (error) {
        console.error(`   ❌  DELETE "${team}" : ${error.message}`)
      } else {
        console.log(`   ✅  Supprimé "${team}" (${ids.length} joueurs)`)
      }
    }
    console.log()
  }

  // ── 8. Harmoniser fantasy_matches ─────────────────────────────────────────
  if (matchesToFix.size > 0) {
    console.log("🔗  Correction des noms dans fantasy_matches…")
    let fixed = 0
    for (const match of allMatches ?? []) {
      const newHome = TO_CANONICAL[match.home_team] ?? match.home_team
      const newAway = TO_CANONICAL[match.away_team] ?? match.away_team
      if (newHome === match.home_team && newAway === match.away_team) continue

      const { error } = await supabase
        .from("fantasy_matches")
        .update({ home_team: newHome, away_team: newAway })
        .eq("id", match.id)

      if (error) {
        console.error(`   ❌  Match ${match.id} : ${error.message}`)
      } else {
        const changes: string[] = []
        if (newHome !== match.home_team) changes.push(`home "${match.home_team}" → "${newHome}"`)
        if (newAway !== match.away_team) changes.push(`away "${match.away_team}" → "${newAway}"`)
        console.log(`   ✅  ${changes.join(" | ")}`)
        fixed++
      }
    }
    if (fixed === 0) console.log("   Aucune correction nécessaire")
    console.log()
  }

  // ── 9. Rapport final ──────────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("📊  RAPPORT FINAL\n")

  // Pagination obligatoire (Supabase limite à 1000 lignes par défaut)
  const finalPlayersAll: { team: string }[] = []
  let fp = 0
  while (true) {
    const { data } = await supabase
      .from("fantasy_players").select("team")
      .range(fp * 1000, (fp + 1) * 1000 - 1)
    if (!data || data.length === 0) break
    finalPlayersAll.push(...data)
    if (data.length < 1000) break
    fp++
  }

  const { data: finalMatches } = await supabase
    .from("fantasy_matches").select("home_team, away_team")

  const finalCounts = new Map<string, number>()
  for (const p of finalPlayersAll) {
    finalCounts.set(p.team, (finalCounts.get(p.team) ?? 0) + 1)
  }

  const finalMatchTeams = new Set<string>()
  for (const m of finalMatches ?? []) {
    finalMatchTeams.add(m.home_team)
    finalMatchTeams.add(m.away_team)
  }

  console.log(`Équipes en base   : ${finalCounts.size}`)
  console.log(`Joueurs total     : ${finalPlayersAll.length}`)
  console.log(`Cible             : ${QUALIFIED_48.size} équipes × 26 joueurs = ${QUALIFIED_48.size * 26}\n`)

  let allGood = true

  console.log("Joueurs par équipe :")
  for (const [team, count] of [...finalCounts.entries()].sort()) {
    const qualified = QUALIFIED_48.has(team)
    const ok = qualified && count === 26
    if (!ok) allGood = false
    const icon = ok ? "✅" : (count !== 26 ? "⚠️ " : "❌")
    console.log(`   ${icon} ${team.padEnd(26)} ${count}${!qualified ? "  ← NON QUALIFIÉ" : ""}`)
  }

  const stillMissing = [...QUALIFIED_48].filter(n => !finalCounts.has(n))
  if (stillMissing.length > 0) {
    console.log(`\n❌  Équipes qualifiées toujours manquantes (${stillMissing.length}) :`)
    stillMissing.forEach(t => console.log(`   - ${t}`))
    allGood = false
  }

  const teamsWithoutMatch   = [...finalCounts.keys()].filter(t => !finalMatchTeams.has(t))
  const matchTeamsNoPlayers = [...finalMatchTeams].filter(t => !finalCounts.has(t))

  if (teamsWithoutMatch.length > 0) {
    console.log(`\n⚠️  Équipes sans aucun match (${teamsWithoutMatch.length}) :`)
    teamsWithoutMatch.forEach(t => console.log(`   - ${t}`))
  }
  if (matchTeamsNoPlayers.length > 0) {
    console.log(`\n⚠️  Équipes dans les matchs sans joueurs (${matchTeamsNoPlayers.length}) :`)
    matchTeamsNoPlayers.forEach(t => console.log(`   - ${t}`))
  }

  const matchAlignOk = teamsWithoutMatch.length === 0 && matchTeamsNoPlayers.length === 0

  console.log(`\n${allGood && matchAlignOk
    ? "✅  Tout est cohérent — 48 nations × 26 joueurs = 1248"
    : "⚠️  Des points signalés ci-dessus nécessitent attention"
  }`)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
}

main().catch(e => { console.error(e); process.exit(1) })
