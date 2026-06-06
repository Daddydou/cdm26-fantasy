import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

type RatingEntry = {
  playerName: string
  teamName: string
  rating: number
  goals: number
  assists: number
  minutesPlayed: number
}

type RequestBody = {
  sofascoreEventId: number
  homeTeam: string
  awayTeam: string
  matchDate: string
  phase?: string
  round?: string
  ratings: RatingEntry[]
}

function normalize(s: string) {
  // eslint-disable-next-line no-misleading-character-class
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

type DbPlayer = { id: string; name: string; team: string }

function buildMatcher(players: DbPlayer[]) {
  const byExact = new Map<string, DbPlayer>()
  const byLastName = new Map<string, DbPlayer[]>()

  for (const p of players) {
    const norm = normalize(p.name)
    byExact.set(norm, p)
    const parts = norm.split(/\s+/)
    const last = parts[parts.length - 1]
    if (!byLastName.has(last)) byLastName.set(last, [])
    byLastName.get(last)!.push(p)
  }

  return function find(name: string, teamName: string): DbPlayer | null {
    const norm = normalize(name)

    // 1. Exact match
    if (byExact.has(norm)) return byExact.get(norm)!

    // 2. Last name - prefer same team when ambiguous
    const lastName = norm.split(/\s+/).pop()!
    const lastCandidates = byLastName.get(lastName)
    if (lastCandidates?.length === 1) return lastCandidates[0]
    if (lastCandidates && lastCandidates.length > 1) {
      const byTeam = lastCandidates.find(p => normalize(p.team) === normalize(teamName))
      return byTeam ?? lastCandidates[0]
    }

    // 3. Partial: every word of the shorter name appears in the longer
    const normParts = norm.split(/\s+/)
    for (const [dbNorm, player] of Array.from(byExact)) {
      const dbParts = dbNorm.split(/\s+/)
      if (normParts.every((part: string) => dbNorm.includes(part))) return player
      if (dbParts.every((part: string) => norm.includes(part))) return player
    }

    return null
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const {
    sofascoreEventId,
    homeTeam,
    awayTeam,
    matchDate,
    phase = 'poule',
    round = 'Phase de groupes',
    ratings,
  } = body

  if (!sofascoreEventId || !Array.isArray(ratings) || ratings.length === 0) {
    return NextResponse.json({ error: 'Donnees manquantes' }, { status: 400 })
  }

  const sofascoreMatchId = String(sofascoreEventId)

  // Find or create the match
  const { data: existingMatch } = await supabaseAdmin
    .from('fantasy_matches')
    .select()
    .eq('sofascore_match_id', sofascoreMatchId)
    .maybeSingle()

  let match = existingMatch
  if (!match) {
    const { data: newMatch, error: createError } = await supabaseAdmin
      .from('fantasy_matches')
      .insert({
        sofascore_match_id: sofascoreMatchId,
        home_team: homeTeam,
        away_team: awayTeam,
        match_date: matchDate,
        phase,
        round,
        processed: false,
      })
      .select()
      .single()
    if (createError || !newMatch) {
      return NextResponse.json(
        { error: createError?.message ?? 'Impossible de creer le match' },
        { status: 500 }
      )
    }
    match = newMatch
  }

  // Load all players for in-memory matching
  const { data: dbPlayers, error: playersError } = await supabaseAdmin
    .from('fantasy_players')
    .select('id, name, team')

  if (playersError || !dbPlayers) {
    return NextResponse.json({ error: 'Impossible de charger les joueurs' }, { status: 500 })
  }

  const findPlayer = buildMatcher(dbPlayers as DbPlayer[])
  const now = new Date().toISOString()
  const scoresToUpsert: Array<{
    player_id: string
    match_id: string
    sofascore_match_id: string
    rating: number
    minutes_played: number
    match_date: string
    fetched_at: string
  }> = []
  const unmatched: string[] = []

  for (const r of ratings) {
    const player = findPlayer(r.playerName, r.teamName)
    if (!player) {
      unmatched.push(r.playerName)
      continue
    }
    scoresToUpsert.push({
      player_id: player.id,
      match_id: match.id,
      sofascore_match_id: sofascoreMatchId,
      rating: r.rating,
      minutes_played: r.minutesPlayed,
      match_date: matchDate,
      fetched_at: now,
    })
  }

  if (scoresToUpsert.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from('fantasy_scores')
      .upsert(scoresToUpsert, { onConflict: 'player_id,match_id' })
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }
  }

  await supabaseAdmin
    .from('fantasy_matches')
    .update({ processed: true })
    .eq('id', match.id)

  return NextResponse.json({ matched: scoresToUpsert.length, unmatched })
}
