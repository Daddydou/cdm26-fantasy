'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT'

interface ParticipantData {
  id: string
  display_name: string
  cumulative: {
    round: number
    ALL: number
    GK: number
    DEF: number
    MID: number
    ATT: number
  }[]
}

interface RoundInfo {
  round: number
  date: string
  label: string
}

interface ChartPoint {
  tour: number
  [name: string]: number
}

const POS_LABELS: Record<PosFilter, string> = {
  ALL: 'Tous',
  GK:  'Gardiens',
  DEF: 'Défenseurs',
  MID: 'Milieux',
  ATT: 'Attaquants',
}

const LINE_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444',
  '#8b5cf6', '#f97316', '#06b6d4', '#ec4899',
]

export default function StatsPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL')
  const [rounds, setRounds] = useState<RoundInfo[]>([])
  const [participants, setParticipants] = useState<ParticipantData[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [leagueName, setLeagueName] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const { data: lg } = await supabase
        .from('fantasy_leagues').select().eq('code', code).single()
      if (!lg) { router.push('/'); return }
      setLeagueName(lg.name)

      const { data: p } = await supabase
        .from('fantasy_participants').select()
        .eq('league_id', lg.id).eq('user_id', session.user.id).single()
      if (!p) { router.push('/'); return }
      setMyId(p.id)

      const res = await fetch(`/api/league/${code}/stats`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) { setError('Erreur lors du chargement des stats'); setLoading(false); return }

      const json = await res.json()
      setRounds(json.rounds || [])
      setParticipants(json.participants || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />

  // Construire les données du graphique
  const chartData: ChartPoint[] = rounds.map(r => {
    const point: ChartPoint = { tour: r.round }
    for (const p of participants) {
      const entry = p.cumulative.find(c => c.round === r.round)
      point[p.display_name] = entry ? entry[posFilter] : 0
    }
    return point
  })

  // Ajouter le point de départ à 0
  if (chartData.length > 0) {
    const zero: ChartPoint = { tour: 0 }
    for (const p of participants) zero[p.display_name] = 0
    chartData.unshift(zero)
  }

  const hasData = rounds.length > 0

  // Classement final (dernier tour)
  const lastRound = rounds[rounds.length - 1]?.round ?? 0
  const finalRanking = [...participants]
    .map(p => {
      const last = p.cumulative.find(c => c.round === lastRound)
      return { id: p.id, display_name: p.display_name, pts: last ? last[posFilter] : 0 }
    })
    .sort((a, b) => b.pts - a.pts)

  return (
    <main className="min-h-screen p-4 max-w-2xl mx-auto overflow-x-hidden">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Statistiques</h1>
          <p className="text-xs text-white/40">{leagueName}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* Filtre poste */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5" style={{ scrollbarWidth: 'none' }}>
        {(Object.keys(POS_LABELS) as PosFilter[]).map(pos => (
          <button
            key={pos}
            onClick={() => setPosFilter(pos)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              posFilter === pos
                ? 'bg-brand-500 text-white'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {POS_LABELS[pos]}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">📊</p>
          <p>Les statistiques apparaîtront après les premiers matchs</p>
        </div>
      ) : (
        <>
          {/* Graphique */}
          <div className="card p-4 mb-5">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Points cumulés — {POS_LABELS[posFilter]}
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="tour"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                  tickFormatter={v => v === 0 ? '' : `T${v}`}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                  tickFormatter={v => v.toFixed(0)}
                />
                <Tooltip content={<CustomTooltip myId={myId} participants={participants} posFilter={posFilter} rounds={rounds} />} />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{value}</span>
                  )}
                />
                {participants.map((p, i) => (
                  <Line
                    key={p.id}
                    type="monotone"
                    dataKey={p.display_name}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={p.id === myId ? 2.5 : 1.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    strokeOpacity={p.id === myId ? 1 : 0.7}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Classement final */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-white/5">
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                Classement actuel — {POS_LABELS[posFilter]}
              </h2>
            </div>
            {finalRanking.map((p, i) => {
              const isMe = p.id === myId
              const color = LINE_COLORS[participants.findIndex(x => x.id === p.id) % LINE_COLORS.length]
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${isMe ? 'bg-brand-500/5' : ''}`}
                >
                  <span className={`w-6 text-center text-sm font-bold ${
                    i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
                  }`}>{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className={`flex-1 text-sm truncate ${isMe ? 'text-brand-400' : 'text-white'}`}>
                    {p.display_name}
                    {isMe && <span className="text-white/30 ml-1 font-normal">(toi)</span>}
                  </span>
                  <span className="text-sm font-bold text-white">{p.pts.toFixed(1)}</span>
                  <span className="text-xs text-white/30">pts</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </main>
  )
}

function CustomTooltip({
  active, payload, label,
  myId, participants, posFilter, rounds,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: number
  myId: string | null
  participants: ParticipantData[]
  posFilter: PosFilter
  rounds: RoundInfo[]
}) {
  if (!active || !payload?.length || label === 0) return null

  const round = rounds.find(r => r.round === label)
  const date = round
    ? new Date(round.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : ''

  // Points de ce tour (non cumulés) par participant
  const prevRound = label ? label - 1 : 0
  const tourPoints = payload.map(entry => {
    const p = participants.find(x => x.display_name === entry.name)
    if (!p) return { ...entry, tourPts: 0 }
    const curr = p.cumulative.find(c => c.round === label)?.[posFilter] ?? 0
    const prev = prevRound > 0 ? (p.cumulative.find(c => c.round === prevRound)?.[posFilter] ?? 0) : 0
    return { ...entry, tourPts: Math.round((curr - prev) * 10) / 10 }
  }).sort((a, b) => b.value - a.value)

  return (
    <div className="bg-gray-900 border border-white/10 rounded-lg p-3 shadow-xl text-xs">
      <p className="text-white/50 mb-2 font-medium">Tour {label}{date ? ` · ${date}` : ''}</p>
      {tourPoints.map(entry => {
        const isMe = participants.find(x => x.display_name === entry.name)?.id === myId
        return (
          <div key={entry.name} className="flex items-center gap-2 mb-1 last:mb-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className={`flex-1 ${isMe ? 'font-semibold text-white' : 'text-white/70'}`}>{entry.name}</span>
            <span className="font-bold text-white ml-3">{entry.value.toFixed(1)}</span>
            <span className="text-white/30">(+{entry.tourPts.toFixed(1)})</span>
          </div>
        )
      })}
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
