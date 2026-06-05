#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

/**
 * Vérifie les photos SofaScore de chaque joueur et tente de corriger les IDs cassés.
 *
 * Pour chaque joueur avec un sofascore_id :
 *   1. Vérifie que https://img.sofascore.com/api/v1/player/{id}/image répond 200
 *   2. Si erreur → recherche le joueur par nom via l'API SofaScore
 *   3. Si trouvé → met à jour sofascore_id + photo_url dans Supabase
 *   4. Génère un rapport CSV
 *
 * Usage : npx tsx scripts/fix-photos.ts
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const DELAY_MS = 1000

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, image/*, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Referer': 'https://www.sofascore.com/',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function photoUrl(id: string) {
  return `https://img.sofascore.com/api/v1/player/${id}/image`
}

async function checkPhoto(sofascoreId: string): Promise<number> {
  try {
    const res = await fetch(photoUrl(sofascoreId), { method: 'HEAD', headers: HEADERS })
    return res.status
  } catch {
    return 0
  }
}

type SearchResult = { id: string; name: string } | null

async function searchOnSofaScore(playerName: string): Promise<SearchResult> {
  try {
    const url = `https://api.sofascore.com/api/v1/search/all?q=${encodeURIComponent(playerName)}`
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) return null

    const data = await res.json()
    const results: any[] = data.results ?? []

    const hit = results.find(r => r.type === 'player')
    if (!hit?.entity?.id) return null

    return { id: String(hit.entity.id), name: hit.entity.name ?? '' }
  } catch {
    return null
  }
}

type ReportRow = {
  nom: string
  ancien_id: string
  nouvel_id: string
  statut: 'ok' | 'fixé' | 'introuvable' | 'erreur_check'
}

async function main() {
  console.log('\n🔍  Vérification des photos SofaScore\n')

  const { data: players, error } = await supabase
    .from('fantasy_players')
    .select('id, name, sofascore_id, photo_url')
    .not('sofascore_id', 'is', null)
    .order('name')

  if (error || !players) { console.error('❌', error?.message); process.exit(1) }
  console.log(`👥  ${players.length} joueurs avec sofascore_id\n`)

  const report: ReportRow[] = []
  let countOk = 0, countFixed = 0, countNotFound = 0, countError = 0

  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    const oldId = String(p.sofascore_id)
    process.stdout.write(`[${i + 1}/${players.length}] ${p.name} (${oldId}) … `)

    const status = await checkPhoto(oldId)
    await sleep(DELAY_MS)

    if (status === 200) {
      console.log('✅ ok')
      report.push({ nom: p.name, ancien_id: oldId, nouvel_id: oldId, statut: 'ok' })
      countOk++
      continue
    }

    if (status === 0) {
      console.log(`⚠️  erreur réseau`)
      report.push({ nom: p.name, ancien_id: oldId, nouvel_id: '', statut: 'erreur_check' })
      countError++
      continue
    }

    // HTTP 403/404 → chercher par nom
    process.stdout.write(`${status} → recherche… `)
    const found = await searchOnSofaScore(p.name)
    await sleep(DELAY_MS)

    if (!found) {
      console.log('❌ introuvable')
      report.push({ nom: p.name, ancien_id: oldId, nouvel_id: '', statut: 'introuvable' })
      countNotFound++
      continue
    }

    const newId = found.id
    const newPhotoUrl = photoUrl(newId)

    const { error: updateError } = await supabase
      .from('fantasy_players')
      .update({ sofascore_id: newId, photo_url: newPhotoUrl })
      .eq('id', p.id)

    if (updateError) {
      console.log(`❌ update échoué : ${updateError.message}`)
      report.push({ nom: p.name, ancien_id: oldId, nouvel_id: newId, statut: 'erreur_check' })
      countError++
    } else {
      console.log(`🔧 fixé → ${newId} (${found.name})`)
      report.push({ nom: p.name, ancien_id: oldId, nouvel_id: newId, statut: 'fixé' })
      countFixed++
    }
  }

  // Rapport CSV
  const csvPath = join(process.cwd(), 'scripts', 'fix-photos-report.csv')
  const csvLines = [
    'nom,ancien_id,nouvel_id,statut',
    ...report.map(r =>
      [r.nom, r.ancien_id, r.nouvel_id, r.statut]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    ),
  ]
  writeFileSync(csvPath, csvLines.join('\n'), 'utf-8')

  console.log('\n─────────────────────────────────────')
  console.log(`✅  ok          : ${countOk}`)
  console.log(`🔧  fixés       : ${countFixed}`)
  console.log(`❌  introuvables: ${countNotFound}`)
  console.log(`⚠️   erreurs     : ${countError}`)
  console.log(`📄  Rapport     : scripts/fix-photos-report.csv`)
  console.log('─────────────────────────────────────\n')
}

main().catch(console.error)
