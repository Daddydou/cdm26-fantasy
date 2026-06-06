#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Calcul des prix avec stats individuelles 2025-2026
 * Usage : npx tsx scripts/compute-prices-with-stats.ts [phase]
 * 
 * Nécessite d'avoir lancé fetch-player-stats.ts avant
 * (fichier scripts/player_stats_2526.csv)
 */

import { createClient } from '@supabase/supabase-js'
import { computePriceWithStats, calibrateBudget } from '../lib/pricing'
import * as fs from 'fs'
import * as path from 'path'

const PHASE = (process.argv[2] || 'initial') as
  'initial' | 'post_poule' | 'post_8' | 'post_quart' | 'post_demi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const FALLBACK_ODDS: Record<string, number> = {
  "France": 3.5, "Angleterre": 6.0, "Espagne": 5.5, "Brésil": 5.0,
  "Argentine": 6.5, "Allemagne": 8.0, "Norvège": 12.0, "Portugal": 10.0,
  "Pays-Bas": 12.0, "Belgique": 20.0, "Uruguay": 25.0, "Mexique": 40.0,
  "Etats-Unis": 30.0, "Canada": 50.0, "Japon": 35.0, "Maroc": 20.0,
  "Sénégal": 40.0, "Colombie": 30.0, "Equateur": 60.0, "Danemark": 25.0,
  "Croatie": 30.0, "Autriche": 30.0, "Suisse": 35.0, "Pologne": 50.0,
  "Serbie": 50.0, "Turquie": 40.0, "Géorgie": 150.0, "Australie": 80.0,
  "Corée du Sud": 80.0, "Iran": 100.0, "Arabie Saoudite": 100.0,
  "Egypte": 80.0, "Côte d'Ivoire": 50.0, "Ghana": 80.0, "Ecosse": 60.0,
  "Tunisie": 100.0, "Algérie": 80.0, "Maroc": 20.0, "RD Congo": 150.0,
  "Bosnie": 100.0, "Cap-Vert": 200.0, "Irak": 200.0, "Haïti": 300.0,
  "Curaçao": 300.0, "Qatar": 150.0, "Ouzbékistan": 200.0, "Jordanie": 250.0,
  "Nouvelle-Zélande": 200.0, "Paraguay": 100.0, "Rép. Tchèque": 60.0,
}

async function main() {
  console.log(`\n🏆  Calcul des prix avec stats — Phase : ${PHASE}\n`)

  // Charger les stats depuis le CSV
  const statsPath = path.join(process.cwd(), 'scripts', 'player_stats_2526.csv')
  const statsMap = new Map<string, { goals: number; assists: number; rating: number; matches: number }>()

  if (fs.existsSync(statsPath)) {
    const lines = fs.readFileSync(statsPath, 'utf-8').split('\n').slice(1)
    for (const line of lines) {
      if (!line.trim()) continue
      const [id, , , , goals, assists, rating, matches] = line.split(',')
      statsMap.set(id, {
        goals: Number(goals) || 0,
        assists: Number(assists) || 0,
        rating: Number(rating) || 0,
        matches: Number(matches) || 0,
      })
    }
    console.log(`📊  ${statsMap.size} joueurs avec stats chargés`)
  } else {
    console.log('⚠️   Pas de fichier stats — utilisation de la formule basique')
    console.log('     Lance d\'abord : npx tsx scripts/fetch-player-stats.ts')
  }

  // Récupérer les joueurs
  const { data: players } = await supabase
    .from('fantasy_players')
    .select('id, name, team, transfermarkt_value_m')
    .eq('active', true)

  if (!players) { console.error('❌  Impossible de récupérer les joueurs'); process.exit(1) }

  const prices = []
  let withStats = 0
  let withoutStats = 0

  for (const player of players) {
    const odds = FALLBACK_ODDS[player.team] || 100
    const stats = statsMap.get(player.id)

    let price: number
    if (stats && stats.matches > 0) {
      price = computePriceWithStats(
        player.transfermarkt_value_m,
        odds,
        stats.goals,
        stats.assists,
        stats.matches,
        stats.rating
      )
      withStats++
    } else {
      // Fallback formule basique
      const teamScore = 1 / odds
      price = Math.round(player.transfermarkt_value_m * (1 + teamScore * 10) * 10) / 10
      withoutStats++
    }

    prices.push({ player_id: player.id, phase: PHASE, team_odds: odds, price })
  }

  // Upsert
  const { error } = await supabase
    .from('fantasy_prices')
    .upsert(prices, { onConflict: 'player_id,phase' })

  if (error) { console.error('❌', error.message); process.exit(1) }

  // Stats
  const priceValues = prices.map(p => p.price).sort((a, b) => a - b)
  const median = priceValues[Math.floor(priceValues.length / 2)]
  const avg = Math.round(priceValues.reduce((s, p) => s + p, 0) / priceValues.length * 10) / 10
  const budget = calibrateBudget(priceValues)

  console.log(`\n✅  ${prices.length} prix calculés (${withStats} avec stats, ${withoutStats} sans)`)
  console.log(`\n📈  Distribution :`)
  console.log(`   Min    : ${priceValues[0]}`)
  console.log(`   Médiane: ${median}`)
  console.log(`   Moyenne: ${avg}`)
  console.log(`   Max    : ${priceValues[priceValues.length-1]}`)
  console.log(`\n💰  Budget recommandé : ${budget} crédits`)
}

main().catch(console.error)
