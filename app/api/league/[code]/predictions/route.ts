import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export type ParticipantPrediction = {
  participant_id: string
  display_name: string
  current_points: number
  estimated_future: number
  projected_total: number
  player_count: number
  total_remaining_matches: number
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: { user } } = await anonClient.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data: league } = await supabaseAdmin
    .from('fantasy_leagues')
    .select('id')
    .eq('code', code)
    .single()
  if (!league) return NextResponse.json({ error: 'Ligue introuvable' }, { status: 404 })

  const { data: participant } = await supabaseAdmin
    .from('fantasy_participants')
    .select('id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()
  if (!participant) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const [
    { data: squads },
    { data: futureMatches },
    { data: standings },
  ] = await Promise.all([
    supabaseAdmin
      .from('fantasy_squad_detail')
      .select('participant_id, player_id, team, total_rating, matches_played')
      .eq('league_id', league.id)
      .eq('active', true),
    supabaseAdmin
      .from('fantasy_matches')
      .select('home_team, away_team')
      .eq('processed', false),
    supabaseAdmin
      .from('fantasy_standings')
      .select('participant_id, display_name, total_points')
      .eq('league_id', league.id),
  ])

  // Nombre de matchs restants par équipe
  const remainingByTeam = new Map<string, number>()
  for (const m of (futureMatches ?? [])) {
    remainingByTeam.set(m.home_team, (remainingByTeam.get(m.home_team) ?? 0) + 1)
    remainingByTeam.set(m.away_team, (remainingByTeam.get(m.away_team) ?? 0) + 1)
  }

  // Regrouper les joueurs par participant
  type SquadEntry = { participant_id: string; team: string; total_rating: number; matches_played: number }
  const squadsByParticipant = new Map<string, SquadEntry[]>()
  for (const s of (squads ?? []) as SquadEntry[]) {
    if (!squadsByParticipant.has(s.participant_id)) squadsByParticipant.set(s.participant_id, [])
    squadsByParticipant.get(s.participant_id)!.push(s)
  }

  const predictions: ParticipantPrediction[] = (standings ?? []).map(st => {
    const players = squadsByParticipant.get(st.participant_id) ?? []
    let estimatedFuture       = 0
    let totalRemainingMatches = 0

    for (const p of players) {
      const avgRating = p.matches_played > 0 ? p.total_rating / p.matches_played : 6.5
      const remaining = remainingByTeam.get(p.team) ?? 0
      estimatedFuture       += avgRating * remaining
      totalRemainingMatches += remaining
    }

    return {
      participant_id:         st.participant_id,
      display_name:           st.display_name,
      current_points:         st.total_points,
      estimated_future:       Math.round(estimatedFuture * 10) / 10,
      projected_total:        Math.round((st.total_points + estimatedFuture) * 10) / 10,
      player_count:           players.length,
      total_remaining_matches: totalRemainingMatches,
    }
  })

  predictions.sort((a, b) => b.projected_total - a.projected_total)

  return NextResponse.json({ predictions })
}
