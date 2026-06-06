'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const CDM_ID = 16
const SOFA   = 'https://api.sofascore.com/api/v1'

const TEAM_MAP: Record<string, string> = {
  France: 'France', England: 'Angleterre', Spain: 'Espagne', Germany: 'Allemagne',
  Brazil: 'Brésil', Argentina: 'Argentine', Portugal: 'Portugal',
  Netherlands: 'Pays-Bas', Belgium: 'Belgique', Croatia: 'Croatie',
  Uruguay: 'Uruguay', Switzerland: 'Suisse', Norway: 'Norvège',
  'South Korea': 'Corée du Sud', Poland: 'Pologne', Austria: 'Autriche',
  Turkey: 'Turquie', Scotland: 'Ecosse', 'Czech Republic': 'Rép. Tchèque',
  Serbia: 'Serbie', Ghana: 'Ghana', Iran: 'Iran', Qatar: 'Qatar',
  Ecuador: 'Equateur', Colombia: 'Colombie', Canada: 'Canada',
  Mexico: 'Mexique', USA: 'Etats-Unis', Senegal: 'Sénégal',
  Morocco: 'Maroc', 'Ivory Coast': "Côte d'Ivoire", Algeria: 'Algérie',
  Egypt: 'Egypte', Japan: 'Japon', Australia: 'Australie',
  'South Africa': 'Afrique du Sud', Georgia: 'Géorgie', Bosnia: 'Bosnie',
  'DR Congo': 'RD Congo', Tunisia: 'Tunisie', Uzbekistan: 'Ouzbékistan',
  Jordan: 'Jordanie', 'New Zealand': 'Nouvelle-Zélande', Iraq: 'Irak',
  Haiti: 'Haïti', Curacao: 'Curaçao', 'Cape Verde': 'Cap-Vert',
  Paraguay: 'Paraguay', 'Saudi Arabia': 'Arabie Saoudite',
}

type LogEntry = { msg: string; type: 'info' | 'ok' | 'warn' | 'err' | 'dim' | 'sep' }

type MatchPayload = {
  sofaId: number
  home: string
  away: string
  startTimestamp: number | null
  players: Array<{
    name: string
    team: string
    rating: number
    goals: number
    assists: number
    minutes: number
  }>
}

export default function ImportSofascorePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [result, setResult] = useState<{ imported: number; unmatched: string[] } | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg || lg.admin_user_id !== user.id) { router.push(`/league/${code}`); return }
      setChecking(false)
    }
    checkAdmin()
  }, [code, router])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  function add(msg: string, type: LogEntry['type'] = 'info') {
    setLog(prev => [...prev, { msg, type }])
  }
  function sep() { setLog(prev => [...prev, { msg: '', type: 'sep' }]) }

  async function run() {
    setLog([])
    setResult(null)
    setRunning(true)

    try {
      // ── 1. Matchs du jour ────────────────────────────────────────────────
      add(`Récupération des matchs CDM du ${date}…`)

      const evRes = await fetch(`${SOFA}/sport/football/scheduled-events/${date}`)
      if (!evRes.ok) throw new Error(`SofaScore events : HTTP ${evRes.status}`)
      const evData = await evRes.json()

      type SofaEvent = {
        id: number
        homeTeam: { name: string }
        awayTeam: { name: string }
        startTimestamp?: number
        status: { description: string }
        tournament: { uniqueTournament: { id: number } }
      }

      const cdmEvents: SofaEvent[] = (evData.events || []).filter(
        (e: SofaEvent) => e.tournament?.uniqueTournament?.id === CDM_ID
      )

      if (cdmEvents.length === 0) {
        add('Aucun match CDM trouvé pour cette date.', 'warn')
        setRunning(false)
        return
      }

      add(`${cdmEvents.length} match(s) CDM trouvé(s)`, 'ok')
      sep()

      // ── 2. Lineups par match ─────────────────────────────────────────────
      const matches: MatchPayload[] = []
      let totalPlayers = 0

      for (let i = 0; i < cdmEvents.length; i++) {
        const ev = cdmEvents[i]
        const home = ev.homeTeam.name
        const away = ev.awayTeam.name

        add(`⚽ ${TEAM_MAP[home] || home} vs ${TEAM_MAP[away] || away} (id ${ev.id}) · ${ev.status.description}`)

        let linData: Record<string, unknown>
        try {
          const linRes = await fetch(`${SOFA}/event/${ev.id}/lineups`)
          if (!linRes.ok) throw new Error(`HTTP ${linRes.status}`)
          linData = await linRes.json()
        } catch (e) {
          add(`  ⚠ Lineups indisponibles : ${(e as Error).message}`, 'warn')
          continue
        }

        type SofaPlayer = {
          player: { name: string }
          statistics?: {
            rating?: number | string
            goals?: number
            goalAssist?: number
            minutesPlayed?: number
          }
        }

        const players: MatchPayload['players'] = []

        for (const side of ['homeTeam', 'awayTeam'] as const) {
          const sideData = linData[side] as { players?: SofaPlayer[] } | undefined
          const sidePlayers = sideData?.players || []
          const teamName = ev[side].name

          for (const p of sidePlayers) {
            const rawRating = p.statistics?.rating
            if (rawRating == null) continue
            const rating = typeof rawRating === 'string' ? parseFloat(rawRating) : rawRating
            if (!rating) continue
            players.push({
              name: p.player.name,
              team: teamName,
              rating,
              goals: p.statistics?.goals || 0,
              assists: p.statistics?.goalAssist || 0,
              minutes: p.statistics?.minutesPlayed || 0,
            })
          }
        }

        add(`  → ${players.length} joueurs avec note`, 'dim')
        totalPlayers += players.length
        matches.push({ sofaId: ev.id, home, away, startTimestamp: ev.startTimestamp || null, players })

        if (i < cdmEvents.length - 1) await new Promise(r => setTimeout(r, 300))
      }

      if (matches.length === 0) {
        add('Aucune donnée lineup disponible pour cette date.', 'err')
        setRunning(false)
        return
      }

      sep()
      add(`Envoi vers l'API… (${matches.length} match(s), ${totalPlayers} joueurs)`)

      // ── 3. POST import-from-browser ──────────────────────────────────────
      const res = await fetch('/api/admin/import-from-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, matches }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `API ${res.status}`)

      sep()
      add(`✓ Import terminé — ${data.imported} note(s) enregistrée(s)`, 'ok')
      if (data.unmatched?.length > 0) add(`${data.unmatched.length} joueur(s) non matchés`, 'warn')

      setResult({ imported: data.imported, unmatched: data.unmatched || [] })

    } catch (e) {
      add(`Erreur : ${(e as Error).message}`, 'err')
    }

    setRunning(false)
  }

  if (checking) return <Loading />

  const colors: Record<LogEntry['type'], string> = {
    info: 'text-white/70', ok: 'text-green-400', warn: 'text-yellow-400',
    err: 'text-red-400', dim: 'text-white/30', sep: '',
  }

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}/admin`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Import notes SofaScore</h1>
          <p className="text-xs text-white/40">Coupe du Monde 2026</p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-white/40 block mb-1.5">Date des matchs</label>
            <input
              type="date"
              className="input w-full"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={running}
            />
          </div>
          <button onClick={run} disabled={running || !date} className="btn-primary disabled:opacity-50">
            {running ? 'En cours…' : 'Récupérer'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="card p-4 mb-4 font-mono text-xs max-h-72 overflow-y-auto space-y-0.5">
          {log.map((e, i) =>
            e.type === 'sep'
              ? <hr key={i} className="border-white/10 my-1" />
              : <div key={i} className={colors[e.type]}>{e.msg}</div>
          )}
          <div ref={logEndRef} />
        </div>
      )}

      {result && (
        <div className="card p-4">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Résultat</h2>
          <div className="flex gap-6 mb-3">
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-white">{result.imported}</p>
              <p className="text-xs text-white/40 mt-0.5">importées</p>
            </div>
            <div className="text-center flex-1">
              <p className={`text-2xl font-bold ${result.unmatched.length > 0 ? 'text-yellow-400' : 'text-white'}`}>
                {result.unmatched.length}
              </p>
              <p className="text-xs text-white/40 mt-0.5">non matchés</p>
            </div>
          </div>
          {result.unmatched.length > 0 && (
            <div className="border-t border-white/5 pt-3 space-y-0.5">
              <p className="text-xs text-yellow-400 mb-1">Joueurs non matchés :</p>
              {result.unmatched.map(n => (
                <p key={n} className="text-xs text-white/30">· {n}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
