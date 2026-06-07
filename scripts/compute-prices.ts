#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })


/**
 * Calcul et stockage des prix des joueurs
 * Usage : npx tsx scripts/compute-prices.ts [phase]
 *   phase: initial | post_poule | post_8 | post_quart | post_demi
 *
 * Récupère les cotes depuis The Odds API (gratuit, 500 req/mois)
 * ou depuis un fichier odds.json local en fallback.
 *
 * Variables d'environnement :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ODDS_API_KEY  (https://the-odds-api.com — gratuit)
 */

import { createClient } from '@supabase/supabase-js'
import { computePrice, calibrateBudget } from '../lib/pricing'

const PHASE = (process.argv[2] || 'initial') as
  'initial' | 'post_poule' | 'post_8' | 'post_quart' | 'post_demi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Cotes manuelles de secours (à mettre à jour avant la CDM)
// Format : { "France": 3.5, "Angleterre": 6.0, ... }
const FALLBACK_ODDS: Record<string, number> = {
  // Favoris
  "France": 3.5,
  "Angleterre": 6.0,
  "Espagne": 5.5,
  "Brésil": 5.0,
  "Argentine": 6.5,
  "Allemagne": 8.0,
  "Norvège": 12.0,
  "Portugal": 10.0,
  "Pays-Bas": 12.0,
  "Belgique": 20.0,
  "Uruguay": 25.0,
  "Suède": 50.0,
  "Mexique": 40.0,
  "États-Unis": 30.0,
  "Canada": 50.0,
  "Japon": 35.0,
  "Maroc": 20.0,
  "Sénégal": 40.0,
  "Colombie": 30.0,
  "Équateur": 60.0,
  "Croatie": 30.0,
  "Autriche": 30.0,
  "Suisse": 35.0,
  "Turquie": 40.0,
  "Australie": 80.0,
  "Corée du Sud": 80.0,
  "Iran": 100.0,
  "Arabie Saoudite": 100.0,
  // Équipes qualifiées CdM 2026 — noms exacts de la DB
  "Tunisie": 100.0,
  "Ghana": 100.0,
  "Algerie": 100.0,
  "Egypte": 150.0,
  "Cote d Ivoire": 80.0,
  "Afrique du Sud": 200.0,
  "RD Congo": 200.0,
  "Cap-Vert": 300.0,
  "Paraguay": 100.0,
  "Qatar": 200.0,
  "Panama": 300.0,
  "Haiti": 500.0,
  "Rep. Tcheque": 100.0,
  "Bosnie": 150.0,
  "Ecosse": 150.0,
  "Irak": 300.0,
  "Jordanie": 500.0,
  "Ouzbekistan": 500.0,
  "Curacao": 1000.0,
  "Nouvelle-Zelande": 500.0,
}

async function fetchOddsFromApi(): Promise<Record<string, number> | null> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_world_cup/odds/?apiKey=${apiKey}&regions=eu&markets=h2h&oddsFormat=decimal`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return null

    const data = await res.json()
    const teamOdds: Record<string, number> = {}

    // Cherche le marché "winner outright" — sinon on utilise les matchs disponibles
    // L'API The Odds API pour le winner tournament sera dans sport "soccer_world_cup_winner"
    console.log(`📡  The Odds API : ${data.length} événements récupérés`)
    return null // Remplacer par la logique selon la réponse réelle
  } catch {
    return null
  }
}

async function fetchWinnerOdds(): Promise<Record<string, number>> {
  console.log('📡  Tentative récupération cotes The Odds API...')
  const apiOdds = await fetchOddsFromApi()

  if (apiOdds) {
    console.log(`✅  ${Object.keys(apiOdds).length} équipes récupérées via API`)
    return apiOdds
  }

  console.log('⚠️   API indisponible — utilisation des cotes manuelles (FALLBACK_ODDS)')
  return FALLBACK_ODDS
}

async function main() {
  console.log(`\n🏆  Calcul des prix — Phase : ${PHASE}\n`)

  // 1. Récupérer les cotes
  const odds = await fetchWinnerOdds()

  // 2. Mettre à jour la table fantasy_teams
  const teamsToUpsert = Object.entries(odds).map(([name, oddsWinner]) => ({
    name,
    odds_winner: oddsWinner,
    team_score: Math.round((1 / oddsWinner) * 10000) / 10000,
    updated_at: new Date().toISOString(),
  }))

  const { error: teamsError } = await supabase
    .from('fantasy_teams')
    .upsert(teamsToUpsert, { onConflict: 'name' })

  if (teamsError) console.error('❌  Erreur upsert teams :', teamsError.message)
  else console.log(`✅  ${teamsToUpsert.length} équipes mises à jour`)

  // 3. Récupérer tous les joueurs actifs
  // Pagination par lots de 1000 (limite PostgREST)
  const players: { id: string; name: string; team: string; transfermarkt_value_m: number }[] = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('fantasy_players')
      .select('id, name, team, transfermarkt_value_m')
      .eq('active', true)
      .range(page * 1000, (page + 1) * 1000 - 1)
    if (error) {
      console.error('❌  Impossible de récupérer les joueurs :', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    players.push(...data)
    if (data.length < 1000) break
    page++
  }

  console.log(`\n📊  ${players.length} joueurs à pricer`)

  // 4. Calculer et stocker les prix
  const prices = []
  let noOdds = 0

  for (const player of players) {
    const teamOdds = odds[player.team]
    if (!teamOdds) {
      console.warn(`⚠️   Cote manquante pour l'équipe "${player.team}" (${player.name})`)
      noOdds++
    }

    const price = computePrice(
      player.transfermarkt_value_m,
      teamOdds || 100 // équipe très outsider par défaut
    )

    prices.push({
      player_id: player.id,
      phase: PHASE,
      team_odds: teamOdds || null,
      price,
    })
  }

  const { error: pricesError } = await supabase
    .from('fantasy_prices')
    .upsert(prices, { onConflict: 'player_id,phase' })

  if (pricesError) {
    console.error('❌  Erreur upsert prices :', pricesError.message)
    process.exit(1)
  }

  // 5. Calibrer le budget
  const priceValues = prices.map(p => p.price)
  const budget = calibrateBudget(priceValues)

  console.log(`\n✅  ${prices.length} prix calculés pour la phase "${PHASE}"`)
  if (noOdds > 0) console.log(`⚠️   ${noOdds} joueurs sans cote équipe`)

  // Stats
  priceValues.sort((a, b) => a - b)
  const min = priceValues[0]
  const max = priceValues[priceValues.length - 1]
  const median = priceValues[Math.floor(priceValues.length / 2)]
  const avg = Math.round(priceValues.reduce((s, p) => s + p, 0) / priceValues.length * 10) / 10

  console.log(`\n📈  Distribution des prix :`)
  console.log(`   Min    : ${min}`)
  console.log(`   Médiane: ${median}`)
  console.log(`   Moyenne: ${avg}`)
  console.log(`   Max    : ${max}`)
  console.log(`\n💰  Budget recommandé : ${budget} crédits`)
  console.log(`   (18 joueurs médians = ${Math.round(median * 18)} crédits ≈ 70% du budget)`)
  console.log(`\n→  Pour mettre à jour le budget dans toutes les ligues :`)
  console.log(`   UPDATE fantasy_leagues SET budget_per_user = ${budget};`)
}

main().catch(console.error)
