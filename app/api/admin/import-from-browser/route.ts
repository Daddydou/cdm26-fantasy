import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGINS = new Set([
  'https://www.sofascore.com',
  'http://localhost:3000',
  'http://localhost:3001',
])

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Valeurs = noms exacts dans fantasy_players.team / fantasy_matches.home_team
const TEAM_MAP: Record<string, string> = {
  France: 'France', England: 'Angleterre', Spain: 'Espagne', Germany: 'Allemagne',
  Brazil: 'Brésil', Argentina: 'Argentine', Portugal: 'Portugal',
  Netherlands: 'Pays-Bas', Belgium: 'Belgique', Croatia: 'Croatie',
  Uruguay: 'Uruguay', Switzerland: 'Suisse', Norway: 'Norvège',
  'South Korea': 'Corée du Sud', Poland: 'Pologne', Austria: 'Autriche',
  Turkey: 'Turquie', Scotland: 'Ecosse', 'Czech Republic': 'Rep. Tcheque',
  Serbia: 'Serbie', Ghana: 'Ghana', Iran: 'Iran', Qatar: 'Qatar',
  Ecuador: 'Équateur', Colombia: 'Colombie', Canada: 'Canada',
  Mexico: 'Mexique', USA: 'États-Unis', 'United States': 'États-Unis',
  Senegal: 'Sénégal', Morocco: 'Maroc', 'Ivory Coast': 'Cote d Ivoire',
  Algeria: 'Algerie', Egypt: 'Egypte', Japan: 'Japon', Australia: 'Australie',
  'South Africa': 'Afrique du Sud', Georgia: 'Géorgie', Bosnia: 'Bosnie',
  'DR Congo': 'RD Congo', Tunisia: 'Tunisie', Uzbekistan: 'Ouzbekistan',
  Jordan: 'Jordanie', 'New Zealand': 'Nouvelle-Zelande', Iraq: 'Irak',
  Haiti: 'Haiti', Curacao: 'Curacao', 'Cape Verde': 'Cap-Vert',
  Paraguay: 'Paraguay', 'Saudi Arabia': 'Arabie Saoudite',
  Sweden: 'Suède', Panama: 'Panama',
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
    const last = norm.split(/\s+/).pop()!
    if (!byLastName.has(last)) byLastName.set(last, [])
    byLastName.get(last)!.push(p)
  }

  return function find(name: string, frTeam: string): DbPlayer | null {
    const norm = normalize(name)

    if (byExact.has(norm)) return byExact.get(norm)!

    const last = norm.split(/\s+/).pop()!
    const candidates = byLastName.get(last)
    if (candidates?.length === 1) return candidates[0]
    if (candidates && candidates.length > 1) {
      const sameTeam = candidates.find(p => normalize(p.team) === normalize(frTeam))
      return sameTeam ?? candidates[0]
    }

    const normParts = norm.split(/\s+/)
    for (const [dbNorm, player] of Array.from(byExact)) {
      const dbParts = dbNorm.split(/\s+/)
      if (normParts.every(part => dbNorm.includes(part))) return player
      if (dbParts.every(part => norm.includes(part))) return player
    }

    return null
  }
}

type MatchInput = {
  sofaId: number
  home: string
  away: string
  startTimestamp?: number | null
  players: Array<{
    name: string
    team: string
    rating: number | null
    goals: number
    assists: number
    minutes: number
  }>
}

type RequestBody = {
  date: string
  matches: MatchInput[]
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return new NextResponse(null, { status: 204, headers: cors(origin) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const c = cors(origin)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400, headers: c })
  }

  const { date, matches } = body
  if (!date || !Array.isArray(matches) || matches.length === 0) {
    return NextResponse.json({ error: 'Données manquantes' }, { status: 400, headers: c })
  }

  const [{ data: dbPlayers, error: playersError }, { data: dbMatches }] = await Promise.all([
    supabaseAdmin.from('fantasy_players').select('id, name, team'),
    supabaseAdmin.from('fantasy_matches').select(),
  ])

  if (playersError || !dbPlayers) {
    return NextResponse.json({ error: 'Impossible de charger les joueurs' }, { status: 500, headers: c })
  }

  // Index des matches en base pour lookup O(1)
  type DbMatch = { id: string; sofascore_match_id: string; home_team: string; away_team: string; [k: string]: unknown }
  const matchById  = new Map<string, DbMatch>()
  const matchByTeams = new Map<string, DbMatch>()
  for (const m of (dbMatches ?? []) as DbMatch[]) {
    matchById.set(m.sofascore_match_id, m)
    const key = `${normalize(m.home_team)}|${normalize(m.away_team)}`
    matchByTeams.set(key, m)
  }

  const findPlayer = buildMatcher(dbPlayers as DbPlayer[])
  const now = new Date().toISOString()
  let imported = 0
  const unmatched: string[] = []

  for (const m of matches) {
    const sofascoreMatchId = String(m.sofaId)
    const frHome = TEAM_MAP[m.home] ?? m.home
    const frAway = TEAM_MAP[m.away] ?? m.away
    const matchDate = m.startTimestamp
      ? new Date(m.startTimestamp * 1000).toISOString()
      : date

    // 1. Par sofascore_match_id exact
    let match: DbMatch | null = matchById.get(sofascoreMatchId) ?? null
    let foundByTeams = false

    if (!match) {
      // 2. Par home_team + away_team (normalisé — ignore accents et casse)
      const teamsKey = `${normalize(frHome)}|${normalize(frAway)}`
      match = matchByTeams.get(teamsKey) ?? null
      if (match) foundByTeams = true
    }

    if (!match) {
      // 3. Créer le match avec l'ID numérique SofaScore
      const { data: newMatch, error: createErr } = await supabaseAdmin
        .from('fantasy_matches')
        .insert({
          sofascore_match_id: sofascoreMatchId,
          home_team: frHome,
          away_team: frAway,
          match_date: matchDate,
          phase: 'poule',
          round: 'Phase de groupes',
          processed: false,
        })
        .select()
        .single()

      if (createErr || !newMatch) continue
      match = newMatch as DbMatch
    } else if (foundByTeams) {
      // Cas 2 : mettre à jour sofascore_match_id pour les prochains imports
      await supabaseAdmin
        .from('fantasy_matches')
        .update({ sofascore_match_id: sofascoreMatchId })
        .eq('id', match.id)
      matchById.set(sofascoreMatchId, { ...match, sofascore_match_id: sofascoreMatchId })
    }

    const scores: Array<{
      player_id: string
      match_id: string
      sofascore_match_id: string
      rating: number
      minutes_played: number
      match_date: string
      fetched_at: string
    }> = []

    for (const p of m.players) {
      if (p.rating == null) continue
      const frTeam = TEAM_MAP[p.team] ?? p.team
      const player = findPlayer(p.name, frTeam)
      if (!player) {
        unmatched.push(`${p.name} (${p.team})`)
        continue
      }
      scores.push({
        player_id: player.id,
        match_id: match.id,
        sofascore_match_id: sofascoreMatchId,
        rating: p.rating,
        minutes_played: p.minutes,
        match_date: matchDate,
        fetched_at: now,
      })
    }

    if (scores.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from('fantasy_scores')
        .upsert(scores, { onConflict: 'player_id,match_id' })
      if (!upsertErr) imported += scores.length
    }

    await supabaseAdmin
      .from('fantasy_matches')
      .update({ processed: true })
      .eq('id', match.id)
  }

  return NextResponse.json({ imported, unmatched }, { headers: c })
}
