'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { League, Participant, Standing } from '@/lib/database.types'

export default function StandingsPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'pts' | 'vfm'>(
    searchParams.get('tab') === 'vfm' ? 'vfm' : 'pts'
  )
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)

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

      const { data: st } = await supabase.from('fantasy_standings').select()
        .eq('league_id', lg.id)
      setStandings(st || [])
      setLoading(false)
    }
    load()
  }, [code, router])

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
                {sorted.find(s => s.participant_id === me?.id)?.total_points?.toFixed(1)} pts
                {tab === 'vfm' && ` · VfM: ${sorted.find(s => s.participant_id === me?.id)?.value_for_money?.toFixed(2)}`}
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
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-3 px-4 py-2 border-b border-white/5 text-xs text-white/30 font-medium">
          <span>#</span>
          <span>Participant</span>
          <span className="text-right">{tab === 'pts' ? 'Points' : 'VfM'}</span>
          <span className="text-right">Budget</span>
        </div>
        {sorted.map((s, i) => {
          const isMe = s.participant_id === me?.id
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
          return (
            <div
              key={s.participant_id}
              className={`grid grid-cols-[2rem_1fr_auto_auto] gap-3 px-4 py-3.5 border-b border-white/5 last:border-0 items-center ${isMe ? 'bg-brand-500/5' : ''}`}
            >
              <span className="text-sm font-bold text-white/30">
                {medal || `${i + 1}`}
              </span>
              <span className={`text-sm font-medium truncate ${isMe ? 'text-brand-400' : 'text-white'}`}>
                {s.display_name}
                {isMe && <span className="text-white/30 ml-1 font-normal">(toi)</span>}
              </span>
              <span className="text-sm font-bold text-white text-right">
                {tab === 'pts'
                  ? `${Number(s.total_points).toFixed(1)}`
                  : `${Number(s.value_for_money).toFixed(2)}`
                }
              </span>
              <span className="text-xs text-white/30 text-right">
                {Number(s.budget_remaining).toFixed(0)} cr.
              </span>
            </div>
          )
        })}
      </div>

      {tab === 'vfm' && (
        <p className="mt-3 text-xs text-white/30 text-center">
          Value for Money = points totaux / crédits dépensés × 100
        </p>
      )}
    </main>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}

