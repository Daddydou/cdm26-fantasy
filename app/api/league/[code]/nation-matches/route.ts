import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

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

  const { data: member } = await supabaseAdmin
    .from('fantasy_participants')
    .select('id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()
  if (!member) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  const { data: participants } = await supabaseAdmin
    .from('fantasy_participants')
    .select('id')
    .eq('league_id', league.id)

  const participantIds = (participants || []).map(p => p.id)
  if (participantIds.length === 0) return NextResponse.json({ nationMatches: {} })

  const [{ data: squads }, { data: matches }] = await Promise.all([
    supabaseAdmin
      .from('fantasy_squads')
      .select('participant_id, player_id, created_at')
      .in('participant_id', participantIds)
      .eq('active', true),
    supabaseAdmin
      .from('fantasy_matches')
      .select('home_team, away_team, match_date')
      .lt('match_date', new Date().toISOString()),
  ])

  if (!squads || squads.length === 0) return NextResponse.json({ nationMatches: {} })

  const playerIds = [...new Set(squads.map(s => s.player_id))]
  const { data: players } = await supabaseAdmin
    .from('fantasy_players')
    .select('id, team')
    .in('id', playerIds)

  const playerTeamMap: Record<string, string> = {}
  for (const p of (players || [])) playerTeamMap[p.id] = p.team

  const now = new Date()
  const nationMatches: Record<string, number> = {}

  for (const sq of squads) {
    const team = playerTeamMap[sq.player_id]
    if (!team) continue
    const purchasedAt = new Date(sq.created_at)
    for (const m of (matches || [])) {
      const matchAt = new Date(m.match_date)
      if (
        (m.home_team === team || m.away_team === team) &&
        matchAt >= purchasedAt &&
        matchAt < now
      ) {
        nationMatches[sq.participant_id] = (nationMatches[sq.participant_id] ?? 0) + 1
      }
    }
  }

  return NextResponse.json({ nationMatches })
}
