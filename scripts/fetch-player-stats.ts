#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Récupère les stats 2025-2026 de chaque joueur depuis SofaScore
 * et met à jour la colonne stats dans fantasy_players
 * 
 * Usage : npx tsx scripts/fetch-player-stats.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.sofascore.com/',
}
const DELAY_MS = 1500

async function fetchPlayerStats(sofascoreId: string): Promise<{
  goals: number
  assists: number
  rating: number
  matches: number
} | null> {
  try {
    // Stats de la saison courante (tournois majeurs)
    const res = await fetch(
      `https://api.sofascore.com/api/v1/player/${sofascoreId}/statistics/season`,
      { headers: HEADERS, signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return null
    const data = await res.json()

    // Chercher la meilleure saison 2024/2025 ou 2025/2026
    const seasons = data.seasons || []
    let best = { goals: 0, assists: 0, rating: 0, matches: 0 }

    for (const season of seasons) {
      const year = season.season?.year || ''
      if (!String(year).includes('2024') && !String(year).includes('2025')) continue

      const stats = season.statistics || {}
      const goals   = stats.goals || 0
      const assists  = stats.goalAssist || 0
      const rating   = stats.rating || 0
      const matches  = stats.appearances || stats.matchesStarted || 0

      // Garder la saison avec le plus de matchs
      if (matches > best.matches) {
        best = { goals, assists, rating: Math.round(rating * 100) / 100, matches }
      }
    }

    return best.matches > 0 ? best : null
  } catch {
    return null
  }
}

async function main() {
  console.log('\n📊  Récupération des stats 2025-2026\n')

  // Récupérer tous les joueurs avec sofascore_id
  const { data: players, error } = await supabase
    .from('fantasy_players')
    .select('id, name, sofascore_id, team')
    .not('sofascore_id', 'is', null)
    .order('name')

  if (error || !players) { console.error('❌', error?.message); process.exit(1) }
  console.log(`👥  ${players.length} joueurs à traiter\n`)

  const results: any[] = []
  let found = 0
  let notFound = 0

  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    process.stdout.write(`[${i+1}/${players.length}] ${player.name}... `)

    const stats = await fetchPlayerStats(player.sofascore_id!)

    if (stats && stats.matches > 0) {
      results.push({
        id: player.id,
        name: player.name,
        team: player.team,
        sofascore_id: player.sofascore_id,
        goals: stats.goals,
        assists: stats.assists,
        rating_2526: stats.rating,
        matches_2526: stats.matches,
      })
      console.log(`✅ ${stats.goals}G ${stats.assists}A ${stats.rating}⭐ (${stats.matches} matchs)`)
      found++
    } else {
      console.log('—')
      notFound++
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  // Sauvegarder en CSV
  const csvPath = path.join(process.cwd(), 'scripts', 'player_stats_2526.csv')
  const csv = [
    'id,name,team,sofascore_id,goals,assists,rating_2526,matches_2526',
    ...results.map(r => `${r.id},${r.name},${r.team},${r.sofascore_id},${r.goals},${r.assists},${r.rating_2526},${r.matches_2526}`)
  ].join('\n')

  fs.writeFileSync(csvPath, csv)
  console.log(`\n✅  ${found} joueurs avec stats, ${notFound} sans`)
  console.log(`📁  Fichier sauvegardé : scripts/player_stats_2526.csv`)
  console.log(`\n→  Lance ensuite : npx tsx scripts/compute-prices.ts initial`)
}

main().catch(console.error)
