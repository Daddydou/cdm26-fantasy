import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

type PositionKey = 'GK' | 'DEF' | 'MID' | 'ATT'

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
    .from('fantasy_leagues').select('id').eq('code', code).single()
  if (!league) return NextResponse.json({ error: 'Ligue introuvable' }, { status: 404 })

  const { data: memberCheck } = await supabaseAdmin
    .from('fantasy_participants').select('id')
    .eq('league_id', league.id).eq('user_id', user.id).single()
  if (!memberCheck) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  // Participants via standings (bypasse RLS)
  const { data: standings } = await supabaseAdmin
    .from('fantasy_standings')
    .select('participant_id, display_name')
    .eq('league_id', league.id)

  const participants = (standings || []).map(s => ({
    id: s.participant_id as string,
    display_name: s.display_name as string,
  }))

  if (participants.length === 0) return NextResponse.json({ rounds: [], participants: [] })

  // Tous les squads de la ligue (actifs + vendus), avec service role pour bypasser RLS
  const { data: squads } = await supabaseAdmin
    .from('fantasy_squads')
    .select('participant_id, player_id, created_at, sold_at')
    .eq('league_id', league.id)

  const allPlayerIds = Array.from(new Set((squads || []).map(s => s.player_id as string)))
  if (allPlayerIds.length === 0) return NextResponse.json({ rounds: [], participants })

  // Postes des joueurs
  const { data: players } = await supabaseAdmin
    .from('fantasy_players').select('id, position').in('id', allPlayerIds)

  const positionById = new Map<string, PositionKey>(
    (players || []).map(p => [p.id as string, p.position as PositionKey])
  )

  // Notes de tous ces joueurs
  const { data: scores } = await supabaseAdmin
    .from('fantasy_scores')
    .select('player_id, match_date, rating')
    .in('player_id', allPlayerIds)
    .not('rating', 'is', null)
    .order('match_date')

  if (!scores || scores.length === 0) return NextResponse.json({ rounds: [], participants })

  // Tours = dates de match uniques triées
  const uniqueDates = Array.from(
    new Set(
      scores
        .map(s => (s.match_date as string)?.substring(0, 10))
        .filter(Boolean) as string[]
    )
  ).sort()

  const rounds = uniqueDates.map((date, i) => ({
    round: i + 1,
    date,
    label: `Tour ${i + 1}`,
  }))

  // Index squads par participant
  const squadsByParticipant = new Map<string, { player_id: string; created_at: string; sold_at: string | null }[]>()
  for (const p of participants) squadsByParticipant.set(p.id, [])
  for (const sq of squads || []) {
    const arr = squadsByParticipant.get(sq.participant_id as string)
    if (arr) arr.push({ player_id: sq.player_id, created_at: sq.created_at, sold_at: sq.sold_at })
  }

  // Pour chaque participant → accumulation par tour et poste
  const result = participants.map(p => {
    const pSquads = squadsByParticipant.get(p.id) || []

    // Points par (round, position)
    const roundPoints = new Map<number, Record<PositionKey, number>>()
    for (const r of rounds) roundPoints.set(r.round, { GK: 0, DEF: 0, MID: 0, ATT: 0 })

    for (const score of scores) {
      const matchDate = (score.match_date as string)?.substring(0, 10)
      if (!matchDate || score.rating === null) continue

      const round = rounds.find(r => r.date === matchDate)
      if (!round) continue

      const position = positionById.get(score.player_id as string)
      if (!position) continue

      // Ce participant avait-il ce joueur ce jour-là ?
      const owned = pSquads.some(sq => {
        if (sq.player_id !== score.player_id) return false
        const boughtDate = sq.created_at?.substring(0, 10) ?? ''
        const soldDate = sq.sold_at ? sq.sold_at.substring(0, 10) : null
        return boughtDate <= matchDate && (soldDate === null || soldDate >= matchDate)
      })

      if (owned) {
        roundPoints.get(round.round)![position] += score.rating as number
      }
    }

    // Cumul
    let cumGK = 0, cumDEF = 0, cumMID = 0, cumATT = 0
    const cumulative = rounds.map(r => {
      const pts = roundPoints.get(r.round) ?? { GK: 0, DEF: 0, MID: 0, ATT: 0 }
      cumGK  += pts.GK
      cumDEF += pts.DEF
      cumMID += pts.MID
      cumATT += pts.ATT
      return {
        round: r.round,
        GK:  Math.round(cumGK  * 10) / 10,
        DEF: Math.round(cumDEF * 10) / 10,
        MID: Math.round(cumMID * 10) / 10,
        ATT: Math.round(cumATT * 10) / 10,
        ALL: Math.round((cumGK + cumDEF + cumMID + cumATT) * 10) / 10,
      }
    })

    return { id: p.id, display_name: p.display_name, cumulative }
  })

  return NextResponse.json({ rounds, participants: result })
}
