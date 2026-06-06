'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const TEAM_MAP: Record<string, string> = {
  'Mexico': 'Mexique',
  'Brazil': 'Brésil',
  'France': 'France',
  'England': 'Angleterre',
  'Spain': 'Espagne',
  'Germany': 'Allemagne',
  'Portugal': 'Portugal',
  'Netherlands': 'Pays-Bas',
  'Argentina': 'Argentine',
  'Belgium': 'Belgique',
  'Croatia': 'Croatie',
  'Uruguay': 'Uruguay',
  'Switzerland': 'Suisse',
  'Norway': 'Norvège',
  'South Korea': 'Corée du Sud',
  'Poland': 'Pologne',
  'Austria': 'Autriche',
  'Turkey': 'Turquie',
  'Scotland': 'Ecosse',
  'Czech Republic': 'Rép. Tchèque',
  'Serbia': 'Serbie',
  'Ghana': 'Ghana',
  'Iran': 'Iran',
  'Qatar': 'Qatar',
  'Ecuador': 'Equateur',
  'Colombia': 'Colombie',
  'Canada': 'Canada',
  'USA': 'Etats-Unis',
  'Senegal': 'Sénégal',
  'Morocco': 'Maroc',
  'Ivory Coast': "Côte d'Ivoire",
  'Algeria': 'Algérie',
  'Egypt': 'Egypte',
  'Japan': 'Japon',
  'Australia': 'Australie',
  'South Africa': 'Afrique du Sud',
  'Georgia': 'Géorgie',
  'Bosnia': 'Bosnie',
  'DR Congo': 'RD Congo',
  'Tunisia': 'Tunisie',
  'Uzbekistan': 'Ouzbékistan',
  'Jordan': 'Jordanie',
  'New Zealand': 'Nouvelle-Zélande',
  'Iraq': 'Irak',
  'Haiti': 'Haïti',
  'Curacao': 'Curaçao',
  'Cape Verde': 'Cap-Vert',
  'Paraguay': 'Paraguay',
  'Saudi Arabia': 'Arabie Saoudite',
}

const CDM_TOURNAMENT_ID = 16

type SofaEvent = {
  id: number
  homeTeam: { name: string }
  awayTeam: { name: string }
  startTimestamp: number
  status: { type: string; description: string }
  tournament: { uniqueTournament: { id: number } }
  roundInfo?: { round: number; name?: string; slug?: string }
}

type MatchEntry = {
  event: SofaEvent
  status: 'idle' | 'loading' | 'done' | 'error'
  result?: { matched: number; unmatched: string[] }
  error?: string
}

function detectPhase(event: SofaEvent): { phase: string; round: string } {
  const slug = event.roundInfo?.slug || ''
  const name = event.roundInfo?.name || ''
  if (/final$/i.test(slug) && !/semi|quarter/i.test(slug)) return { phase: 'finale', round: 'Finale' }
  if (/semi/i.test(slug) || /semi/i.test(name)) return { phase: 'demi', round: 'Demi-finale' }
  if (/quarter/i.test(slug) || /quart/i.test(name)) return { phase: 'quart', round: 'Quart de finale' }
  if (/round-of-16/i.test(slug) || /huitième/i.test(name)) return { phase: 'huitieme', round: '8ème de finale' }
  const roundNum = event.roundInfo?.round
  return { phase: 'poule', round: roundNum ? `Journée ${roundNum}` : 'Phase de groupes' }
}

export default function ImportSofascorePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: lg } = await supabase
        .from('fantasy_leagues')
        .select()
        .eq('code', code)
        .single()
      if (!lg || lg.admin_user_id !== user.id) { router.push(`/league/${code}`); return }
      setAuthorized(true)
      setLoading(false)
    }
    checkAdmin()
  }, [code, router])

  async function fetchMatches() {
    setFetching(true)
    setFetchError('')
    setMatches([])
    try {
      const res = await fetch(
        `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`
      )
      if (!res.ok) throw new Error(`SofaScore HTTP ${res.status}`)
      const data = await res.json()
      const cdmEvents: SofaEvent[] = (data.events || []).filter(
        (e: SofaEvent) => e.tournament?.uniqueTournament?.id === CDM_TOURNAMENT_ID
      )
      setMatches(cdmEvents.map(event => ({ event, status: 'idle' })))
    } catch (e) {
      setFetchError((e as Error).message)
    }
    setFetching(false)
  }

  async function importMatch(idx: number) {
    const entry = matches[idx]
    const { event } = entry

    setMatches(prev => prev.map((m, i) => i === idx ? { ...m, status: 'loading' } : m))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session expirée')

      // Fetch lineups from SofaScore (browser-side, bypasses Cloudflare)
      const lineupsRes = await fetch(
        `https://api.sofascore.com/api/v1/event/${event.id}/lineups`
      )
      if (!lineupsRes.ok) throw new Error(`Lineups HTTP ${lineupsRes.status}`)
      const lineupsData = await lineupsRes.json()

      const ratings: Array<{
        playerName: string
        teamName: string
        rating: number
        goals: number
        assists: number
        minutesPlayed: number
      }> = []

      for (const side of ['homeTeam', 'awayTeam'] as const) {
        const teamData = lineupsData[side]
        if (!teamData?.players) continue
        const teamNameEn = event[side].name
        const teamNameFr = TEAM_MAP[teamNameEn] || teamNameEn
        for (const p of teamData.players) {
          const rating = p.statistics?.rating
          if (!rating) continue
          ratings.push({
            playerName: p.player.name,
            teamName: teamNameFr,
            rating: parseFloat(rating),
            goals: p.statistics.goals || 0,
            assists: p.statistics.goalAssist || 0,
            minutesPlayed: p.statistics.minutesPlayed || 0,
          })
        }
      }

      if (ratings.length === 0) throw new Error('Aucune note disponible pour ce match')

      const { phase, round } = detectPhase(event)
      const homeTeamFr = TEAM_MAP[event.homeTeam.name] || event.homeTeam.name
      const awayTeamFr = TEAM_MAP[event.awayTeam.name] || event.awayTeam.name

      const resp = await fetch('/api/admin/save-ratings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          sofascoreEventId: event.id,
          homeTeam: homeTeamFr,
          awayTeam: awayTeamFr,
          matchDate: new Date(event.startTimestamp * 1000).toISOString(),
          phase,
          round,
          ratings,
        }),
      })

      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || 'Erreur serveur')

      setMatches(prev => prev.map((m, i) => i === idx ? { ...m, status: 'done', result } : m))
    } catch (e) {
      setMatches(prev => prev.map((m, i) => i === idx ? { ...m, status: 'error', error: (e as Error).message } : m))
    }
  }

  if (loading) return <Loading />
  if (!authorized) return null

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}/admin`)} className="text-white/40 hover:text-white">
          ←
        </button>
        <div>
          <h1 className="text-lg font-bold text-white">Import notes SofaScore</h1>
          <p className="text-xs text-white/40">Coupe du Monde 2026</p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Date des matchs</h2>
        <div className="flex gap-2">
          <input
            type="date"
            className="input flex-1"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <button onClick={fetchMatches} disabled={fetching} className="btn-primary">
            {fetching ? '…' : 'Charger'}
          </button>
        </div>
        {fetchError && (
          <p className="text-xs text-red-400 mt-2">{fetchError}</p>
        )}
      </div>

      {matches.length === 0 && !fetching && !fetchError && (
        <div className="text-center py-10 text-white/30 text-sm">
          Choisissez une date et cliquez sur Charger
        </div>
      )}

      {matches.length > 0 && (
        <div className="card mb-4">
          <div className="p-4 border-b border-white/5">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              {matches.length} match{matches.length > 1 ? 's' : ''} CDM — {date}
            </h2>
          </div>
          {matches.map((entry, idx) => {
            const { event, status, result, error } = entry
            const homeTeamFr = TEAM_MAP[event.homeTeam.name] || event.homeTeam.name
            const awayTeamFr = TEAM_MAP[event.awayTeam.name] || event.awayTeam.name
            const time = new Date(event.startTimestamp * 1000).toLocaleTimeString('fr-FR', {
              hour: '2-digit', minute: '2-digit',
            })
            return (
              <div
                key={event.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate font-medium">
                    {homeTeamFr} <span className="text-white/40">vs</span> {awayTeamFr}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {time} · {event.status.description}
                  </p>
                  {status === 'done' && result && (
                    <p className="text-xs text-brand-400 mt-1">
                      ✓ {result.matched} joueurs importés
                      {result.unmatched.length > 0 && (
                        <span className="text-white/40"> · {result.unmatched.length} non trouvés</span>
                      )}
                    </p>
                  )}
                  {status === 'error' && (
                    <p className="text-xs text-red-400 mt-1">{error}</p>
                  )}
                  {status === 'done' && result && result.unmatched.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-white/30 cursor-pointer hover:text-white/50">
                        Voir les non trouvés
                      </summary>
                      <p className="text-xs text-white/30 mt-1 break-words">
                        {result.unmatched.join(', ')}
                      </p>
                    </details>
                  )}
                </div>
                <button
                  onClick={() => importMatch(idx)}
                  disabled={status === 'loading' || status === 'done'}
                  className={`ml-2 text-xs shrink-0 whitespace-nowrap ${
                    status === 'done'
                      ? 'text-brand-400 font-medium'
                      : status === 'error'
                      ? 'btn-ghost'
                      : 'btn-ghost'
                  }`}
                >
                  {status === 'loading' ? '…' : status === 'done' ? '✓ Importé' : 'Importer les notes'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {matches.length === 0 && !fetching && fetchError === '' && (
        <></>
      )}
    </main>
  )
}

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-white/40 text-sm">Chargement…</div>
    </main>
  )
}
