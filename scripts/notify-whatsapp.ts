#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

/**
 * Notification WhatsApp après chaque journée via CallMeBot (gratuit)
 * 
 * Setup CallMeBot (une seule fois par numéro) :
 * 1. Ajouter +34 644 44 19 72 dans ses contacts WhatsApp
 * 2. Envoyer ce message : "I allow callmebot to send me messages"
 * 3. Tu reçois une API key par WhatsApp
 * 
 * Variables .env.local :
 *   WHATSAPP_NUMBERS=33612345678,33698765432   (sans +, séparés par virgule)
 *   WHATSAPP_API_KEYS=apikey1,apikey2           (une clé par numéro, même ordre)
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 * 
 * Usage :
 *   npx tsx scripts/notify-whatsapp.ts [league_code]
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const LEAGUE_CODE = process.argv[2]
const NUMBERS = (process.env.WHATSAPP_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean)
const API_KEYS = (process.env.WHATSAPP_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://cdm26-fantasy.vercel.app'

async function sendWhatsApp(phone: string, apiKey: string, message: string) {
  const encoded = encodeURIComponent(message)
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`
  const res = await fetch(url)
  return res.ok
}

async function main() {
  if (!LEAGUE_CODE) { console.error('❌  Usage : npx tsx scripts/notify-whatsapp.ts [league_code]'); process.exit(1) }
  if (NUMBERS.length === 0) { console.error('❌  WHATSAPP_NUMBERS manquant dans .env.local'); process.exit(1) }
  if (NUMBERS.length !== API_KEYS.length) { console.error('❌  WHATSAPP_NUMBERS et WHATSAPP_API_KEYS doivent avoir le même nombre d\'entrées'); process.exit(1) }

  // Récupérer la ligue
  const { data: league } = await supabase
    .from('fantasy_leagues')
    .select()
    .eq('code', LEAGUE_CODE)
    .single()
  if (!league) { console.error(`❌  Ligue ${LEAGUE_CODE} introuvable`); process.exit(1) }

  // Classement actuel
  const { data: standings } = await supabase
    .from('fantasy_standings')
    .select()
    .eq('league_id', league.id)
    .order('total_points', { ascending: false })

  if (!standings || standings.length === 0) { console.log('Aucun classement à envoyer'); return }

  // Classement d'hier
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const { data: dailyRows } = await supabase
    .from('fantasy_daily_standings')
    .select()
    .eq('league_id', league.id)
    .eq('match_day', yesterdayStr)
    .order('day_points', { ascending: false })

  // Construire le message
  const medals = ['🥇', '🥈', '🥉']
  let msg = `🏆 *CDM26 Fantasy — ${league.name}*\n`
  msg += `📊 Classement général\n\n`

  standings.forEach((s, i) => {
    const medal = medals[i] || `${i + 1}.`
    msg += `${medal} ${s.display_name} — ${Number(s.total_points).toFixed(1)} pts\n`
  })

  if (dailyRows && dailyRows.length > 0) {
    msg += `\n⚡ Meilleur joueur d'hier :\n`
    msg += `👑 ${dailyRows[0].display_name} — ${Number(dailyRows[0].day_points).toFixed(1)} pts\n`
  }

  msg += `\n🔗 ${APP_URL}`

  console.log('\n📱 Message à envoyer :')
  console.log('─'.repeat(40))
  console.log(msg)
  console.log('─'.repeat(40))

  // Envoyer à tous les numéros
  let sent = 0
  for (let i = 0; i < NUMBERS.length; i++) {
    process.stdout.write(`  Envoi à ${NUMBERS[i]}... `)
    const ok = await sendWhatsApp(NUMBERS[i], API_KEYS[i], msg)
    console.log(ok ? '✅' : '❌')
    if (ok) sent++
    await new Promise(r => setTimeout(r, 1000)) // éviter le spam
  }

  console.log(`\n✅  ${sent}/${NUMBERS.length} messages envoyés`)
}

main().catch(console.error)
