'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant, Standing } from '@/lib/database.types'
import { POSITION_LABELS } from '@/lib/pricing'

interface SquadPlayer {
  squad_id: string
  player_id: string
  player_name: string
  position: string
  team: string
  photo_url: string | null
  bought_at_price: number
  total_rating: number
  matches_played: number
}

const POS_ORDER: Record<string, number> = { GK: 0, DEF: 1, MID: 2, ATT: 3 }

export default function StandingsPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'pts' | 'vfm'>(searchParams.get('tab') === 'vfm' ? 'vfm' : 'pts')
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingSquad, setViewingSquad] = useState<string | null>(null)
  const [squadData, setSquadData] = useState<SquadPlayer[]>([])
  const [squadLoading, setSquadLoading] = useState(false)
  const [viewingName, setViewingName] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg) { router.push('/'); return }
      setLeague(lg)

      const { data: p } = await supabase.from('fantasy_participants').select()
        .eq('league_id', lg.id).eq('user_id', user.id).single()
      if (!p) { router.push('/'); return }
      setMe(p)

      const { data: st } = await supabase.from('fantasy_standings').select().eq('league_id', lg.id)
      setStandings(st || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  async function viewSquad(participantId: string, name: string) {
    if (viewingSquad === participantId) { setViewingSquad(null); return }
    setViewingSquad(participantId)
    setViewingName(name)
    setSquadLoading(true)

    const { data } = await supabase
      .from('fantasy_squad_detail')
      .select()
      .eq('participant_id', participantId)
      .eq('active', true)

    setSquadData((data || []).sort((a, b) =>
      (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9)
    ))
    setSquadLoading(false)
  }

  if (loading) return <Loading />

  const sorted = [...standings].sort((a, b) =>
    tab === 'pts'
      ? Number(b.total_points) - Number(a.total_points)
      : Number(b.value_for_money) - Number(a.value_for_money)
  )

  const myRank = sorted.findIndex(s => s.participant_id === me?.id) + 1

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Classement</h1>
          <p className="text-xs text-white/40">{league?.name}</p>
        </div>
      </div>

      {/* Ma position */}
      {myRank > 0 && (
        <div className="card p-4 mb-5 border-brand-500/20 bg-brand-500/5">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-brand-400">#{myRank}</span>
            <div>
              <p className="text-sm font-medium text-white">{me?.display_name}</p>
              <p className="text-xs text-white/40">
                {Number(sorted.find(s => s.participant_id === me?.id)?.total_points || 0).toFixed(1)} pts
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-lg p-1 mb-4">
        <button onClick={() => setTab('pts')} className={`flex-1 py-2 rounded-md text-xs font-medium transition-all ${tab === 'pts' ? 'bg-brand-500 text-white' : 'text-white/50'}`}>
          🏆 Points totaux
        </button>
        <button onClick={() => setTab('vfm')} className={`flex-1 py-2 rounded-md text-xs font-medium transition-all ${tab === 'vfm' ? 'bg-brand-500 text-white' : 'text-white/50'}`}>
          📈 Value for Money
        </button>
      </div>

      {/* Leaderboard */}
      <div className="card overflow-hidden mb-4">
        {sorted.map((s, i) => {
          const isMe = s.participant_id === me?.id
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
          const isViewing = viewingSquad === s.participant_id
          return (
            <div key={s.participant_id}>
              <div
                className={`flex items-center gap-3 px-4 py-3.5 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-all ${isMe ? 'bg-brand-500/5' : ''} ${isViewing ? 'bg-white/5' : ''}`}
                onClick={() => viewSquad(s.participant_id, s.display_name)}
              >
                <span className="text-sm font-bold text-white/30 w-6 text-center">
                  {medal || `${i + 1}`}
                </span>
                <span className={`flex-1 text-sm font-medium truncate ${isMe ? 'text-brand-400' : 'text-white'}`}>
                  {s.display_name}
                  {isMe && <span className="text-white/30 ml-1 font-normal">(toi)</span>}
                </span>
                <span className="text-sm font-bold text-white">
                  {tab === 'pts'
                    ? Number(s.total_points).toFixed(1)
                    : Number(s.value_for_money).toFixed(2)
                  }
                </span>
                <span className="text-xs text-white/30">{tab === 'pts' ? 'pts' : 'vfm'}</span>
                <span className="text-white/30 text-xs">{isViewing ? '▲' : '▼'}</span>
              </div>

              {/* Squad expandable */}
              {isViewing && (
                <div className="bg-white/3 border-b border-white/5 px-4 py-3">
                  <p className="text-xs text-white/40 mb-3 font-medium">Équipe de {viewingName}</p>
                  {squadLoading ? (
                    <p className="text-xs text-white/30">Chargement…</p>
                  ) : squadData.length === 0 ? (
                    <p className="text-xs text-white/30">Aucun joueur</p>
                  ) : (
                    <div className="space-y-1.5">
                      {['GK', 'DEF', 'MID', 'ATT'].map(pos => {
                        const posPlayers = squadData.filter(p => p.position === pos)
                        if (!posPlayers.length) return null
                        return (
                          <div key={pos}>
                            <p className="text-xs text-white/20 uppercase tracking-wider mb-1">{POSITION_LABELS[pos]}</p>
                            {posPlayers.map(p => (
                              <Link
                                key={p.squad_id}
                                href={`/league/${code}/player/${p.player_id}`}
                                className="flex items-center gap-2 py-1.5 hover:bg-white/5 rounded px-1 transition-all"
                              >
                                <div className="w-6 h-6 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                                  {p.photo_url
                                    ? <img src={p.photo_url} alt={p.player_name} className="w-full h-full object-cover" />
                                    : <div className="w-full h-full flex items-center justify-center text-xs">👤</div>
                                  }
                                </div>
                                <span className="flex-1 text-xs text-white truncate">{p.player_name}</span>
                                <span className="text-xs text-white/40">{p.team}</span>
                                <span className="text-xs font-bold text-white">{Number(p.total_rating).toFixed(1)}</span>
                              </Link>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {tab === 'vfm' && (
        <p className="text-xs text-white/30 text-center">
          Value for Money = points totaux / crédits dépensés × 100
        </p>
      )}
    </main>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
