import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const API_KEY  = process.env.API_FOOTBALL_KEY!
const BASE_URL = 'https://v3.football.api-sports.io'
const HEADERS  = { 'x-apisports-key': API_KEY }

// Vercel cron security
export const maxDuration = 60

async function fetchMatchRatings(fixtureId: string) {
  const res = await fetch(
    `${BASE_URL}/fixtures/players?fixture=${fixtureId}`,
    { headers: HEADERS }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.response || null
}

export async function GET(request: Request) {
  // Vérification token Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Matchs terminés non processés (match_date < now)
    const now = new Date().toISOString()
    const { data: matches } = await supabase
      .from('fantasy_matches')
      .select()
      .eq('processed', false)
      .lt('match_date', now)
      .order('match_date', { ascending: true })
      .limit(10) // max 10 par cron pour rester dans les 100 req/jour

    if (!matches || matches.length === 0) {
      return NextResponse.json({ message: 'Aucun match à traiter', processed: 0 })
    }

    // Joueurs DB
    const { data: dbPlayers } = await supabase
      .from('fantasy_players')
      .select('id, name, sofascore_id')
      .not('sofascore_id', 'is', null)

    if (!dbPlayers) return NextResponse.json({ error: 'Impossible de récupérer les joueurs' }, { status: 500 })

    const byId   = new Map(dbPlayers.map(p => [p.sofascore_id, p]))
    const byName = new Map(dbPlayers.map(p => [
      p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      p
    ]))

    let processed = 0
    let totalRatings = 0

    for (const match of matches) {
      const response = await fetchMatchRatings(match.sofascore_match_id)
      if (!response || response.length === 0) continue

      const scoresToInsert = []

      for (const team of response) {
        for (const playerData of (team.players || [])) {
          const p = playerData.player
          const stats = playerData.statistics?.[0]
          const rating = parseFloat(stats?.games?.rating) || null
          if (!rating) continue

          let dbPlayer = byId.get(String(p.id))
          if (!dbPlayer) {
            const normName = p.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            dbPlayer = byName.get(normName)
          }
          if (!dbPlayer) continue

          scoresToInsert.push({
            player_id: dbPlayer.id,
            match_id: match.id,
            sofascore_match_id: match.sofascore_match_id,
            rating,
            minutes_played: stats?.games?.minutes || 0,
            match_date: match.match_date,
          })
        }
      }

      if (scoresToInsert.length > 0) {
        await supabase
          .from('fantasy_scores')
          .upsert(scoresToInsert, { onConflict: 'player_id,match_id' })
        totalRatings += scoresToInsert.length
      }

      await supabase
        .from('fantasy_matches')
        .update({ processed: true })
        .eq('id', match.id)

      processed++
      await new Promise(r => setTimeout(r, 1000))
    }

    return NextResponse.json({ message: 'OK', processed, totalRatings })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
