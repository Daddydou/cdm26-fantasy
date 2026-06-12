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
  score: number
  win_pct: number
  player_count: number
  avg_note: number
  avg_tm_value: number
  avg_force_norm: number
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

  // ── Chargement parallèle ────────────────────────────────────────────────────
  const [
    { data: squads },
    { data: allPlayers },
    { data: allTeams },
    { data: standings },
  ] = await Promise.all([
    supabaseAdmin
      .from('fantasy_squad_detail')
      .select('participant_id, player_id, team, total_rating, matches_played')
      .eq('league_id', league.id)
      .eq('active', true),
    supabaseAdmin
      .from('fantasy_players')
      .select('id, transfermarkt_value_m, team'),
    supabaseAdmin
      .from('fantasy_teams')
      .select('name, odds_winner'),
    supabaseAdmin
      .from('fantasy_standings')
      .select('participant_id, display_name, total_points')
      .eq('league_id', league.id),
  ])

  // ── Index de lookup ─────────────────────────────────────────────────────────
  type PlayerMeta = { tm_value: number; team: string }
  const playerMeta = new Map<string, PlayerMeta>()
  for (const p of (allPlayers ?? [])) {
    playerMeta.set(p.id, { tm_value: p.transfermarkt_value_m ?? 0, team: p.team })
  }

  const teamOdds = new Map<string, number>()
  for (const t of (allTeams ?? [])) {
    if (t.odds_winner != null && t.odds_winner > 0) teamOdds.set(t.name, t.odds_winner)
  }

  // ── Normalisation globale ───────────────────────────────────────────────────
  type SquadEntry = { participant_id: string; player_id: string; team: string; total_rating: number; matches_played: number }
  const activeSquads = (squads ?? []) as SquadEntry[]

  // Max TM value parmi tous les joueurs actifs de la ligue
  let maxTmValue = 0
  for (const s of activeSquads) {
    const meta = playerMeta.get(s.player_id)
    if (meta && meta.tm_value > maxTmValue) maxTmValue = meta.tm_value
  }

  // Force par équipe : 1 / odds × 100 ; max_force pour normalisation
  const teamForce = new Map<string, number>()
  let maxForce = 0
  for (const [name, odds] of teamOdds) {
    const force = (1 / odds) * 100
    teamForce.set(name, force)
    if (force > maxForce) maxForce = force
  }

  // ── Score composite par joueur ──────────────────────────────────────────────
  type PlayerScore = {
    participant_id: string
    note_raw: number
    note_norm: number
    valeur_norm: number
    force_norm: number
    score: number
  }

  const playerScores: PlayerScore[] = activeSquads.map(s => {
    const avgRating  = s.matches_played > 0 ? s.total_rating / s.matches_played : 6.5
    const note_norm  = Math.max(0, ((avgRating - 5) / 5) * 10)

    const meta       = playerMeta.get(s.player_id)
    const tmVal      = meta?.tm_value ?? 0
    const valeur_norm = maxTmValue > 0 ? (tmVal / maxTmValue) * 10 : 0

    const teamName   = meta?.team ?? s.team
    const force      = teamForce.get(teamName) ?? 0
    const force_norm = maxForce > 0 ? (force / maxForce) * 10 : 0

    const score = note_norm * 0.4 + valeur_norm * 0.3 + force_norm * 0.3

    return { participant_id: s.participant_id, note_raw: avgRating, note_norm, valeur_norm, force_norm, score }
  })

  // ── Agrégation par participant ──────────────────────────────────────────────
  type Agg = { score: number; count: number; sumNote: number; sumForce: number }
  const aggByP  = new Map<string, Agg>()
  const tmByP   = new Map<string, number>()

  for (const s of activeSquads) {
    const meta = playerMeta.get(s.player_id)
    tmByP.set(s.participant_id, (tmByP.get(s.participant_id) ?? 0) + (meta?.tm_value ?? 0))
  }

  for (const ps of playerScores) {
    const cur = aggByP.get(ps.participant_id) ?? { score: 0, count: 0, sumNote: 0, sumForce: 0 }
    aggByP.set(ps.participant_id, {
      score:    cur.score    + ps.score,
      count:    cur.count    + 1,
      sumNote:  cur.sumNote  + ps.note_raw,
      sumForce: cur.sumForce + ps.force_norm,
    })
  }

  const totalScore = [...aggByP.values()].reduce((sum, a) => sum + a.score, 0)

  const predictions: ParticipantPrediction[] = (standings ?? []).map(st => {
    const agg = aggByP.get(st.participant_id)
    const score   = agg?.score ?? 0
    const count   = agg?.count ?? 0
    const win_pct = totalScore > 0 ? Math.round((score / totalScore) * 1000) / 10 : 0

    return {
      participant_id: st.participant_id,
      display_name:   st.display_name,
      score:          Math.round(score * 10) / 10,
      win_pct,
      player_count:   count,
      avg_note:       count > 0 ? Math.round((agg!.sumNote  / count) * 10) / 10 : 0,
      avg_tm_value:   count > 0 ? Math.round(((tmByP.get(st.participant_id) ?? 0) / count) * 10) / 10 : 0,
      avg_force_norm: count > 0 ? Math.round((agg!.sumForce / count) * 10) / 10 : 0,
    }
  })

  predictions.sort((a, b) => b.win_pct - a.win_pct)

  return NextResponse.json({ predictions })
}
