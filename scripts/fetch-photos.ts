#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Récupère les photos des joueurs depuis SofaScore (URLs publiques)
 * et met à jour fantasy_players.photo_url
 * 
 * SofaScore sert les photos via :
 * https://api.sofascore.com/api/v1/player/{sofascore_id}/image
 * → redirige vers https://img.sofascore.com/api/v1/player/{id}/image
 * 
 * On stocke l'URL directement — pas besoin de télécharger les images.
 * 
 * Usage : npx tsx scripts/fetch-photos.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const DELAY_MS = 200

async function main() {
  console.log('\n📸  Récupération des photos joueurs\n')

  // Récupérer tous les joueurs avec un sofascore_id
  const { data: players, error } = await supabase
    .from('fantasy_players')
    .select('id, name, sofascore_id, photo_url')
    .not('sofascore_id', 'is', null)

  if (error || !players) { console.error('❌', error?.message); process.exit(1) }

  const toUpdate = players.filter(p => p.sofascore_id)
  console.log(`👥  ${toUpdate.length} joueurs avec sofascore_id`)

  let updated = 0
  let skipped = 0

  for (const player of toUpdate) {
    // URL publique SofaScore — pas besoin de vérifier, on fait confiance à l'ID
    const photoUrl = `https://img.sofascore.com/api/v1/player/${player.sofascore_id}/image`

    // Ne mettre à jour que si pas encore de photo
    if (player.photo_url && player.photo_url.includes('sofascore')) {
      skipped++
      continue
    }

    const { error: updateError } = await supabase
      .from('fantasy_players')
      .update({ photo_url: photoUrl })
      .eq('id', player.id)

    if (updateError) {
      console.error(`❌  ${player.name} : ${updateError.message}`)
    } else {
      updated++
      if (updated % 50 === 0) console.log(`  ${updated}/${toUpdate.length} mis à jour...`)
    }

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\n✅  ${updated} photos mises à jour, ${skipped} déjà renseignées`)
  console.log(`   Les photos s'afficheront automatiquement dans l'app`)
}

main().catch(console.error)
