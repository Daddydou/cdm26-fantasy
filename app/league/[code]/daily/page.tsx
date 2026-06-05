'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { League, Participant, DailyStanding } from '@/lib/database.types'

interface DayStanding {
  participant_id: string
  display_name: string
  match_day: string
  day_points: number
  matches_scored: number
}

interface DayGroup {
  date: string
  standings: DayStanding[]
}

export default function DailyPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [days, setDays] = useState<DayGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState<string | null>(null)

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

      const { data: rows } = await supabase
        .from('fantasy_daily_standings')
        .select()
        .eq('league_id', lg.id)
        .order('match_day', { ascending: false })

      // Grouper par jour
      const grouped: Record<string, DayStanding[]> = {}
      for (const row of ((rows || []) as unknown as DailyStanding[])) {
        const day = row.match_day
        if (!grouped[day]) grouped[day] = []
        grouped[day].push(row)
      }

      const dayGroups = Object.entries(grouped).map(([date, standings]) => ({
        date,
        standings: standings.sort((a, b) => b.day_points - a.day_points)
      }))

      setDays(dayGroups)
      if (dayGroups.length > 0) setActiveDay(dayGroups[0].date)
      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />

  const activeGroup = days.find(d => d.date === activeDay)

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Classement par journée</h1>
          <p className="text-xs text-white/40">{league?.name}</p>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">⏳</p>
          <p>Les classements journaliers apparaîtront après les premiers matchs</p>
        </div>
      ) : (
        <>
          {/* Sélecteur de journée */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {days.map(d => (
              <button
                key={d.date}
                onClick={() => setActiveDay(d.date)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeDay === d.date ? 'bg-brand-500 text-white' : 'bg-white/5 text-white/50 hover:text-white'
                }`}
              >
                {new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>

          {/* Classement du jour */}
          {activeGroup && (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-white/5">
                <h2 className="text-sm font-semibold text-white">
                  {new Date(activeGroup.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h2>
                <p className="text-xs text-white/40 mt-0.5">{activeGroup.standings[0]?.matches_scored || 0} match(s) scoré(s)</p>
              </div>
              {activeGroup.standings.map((s, i) => {
                const isMe = s.participant_id === me?.id
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
                return (
                  <div
                    key={s.participant_id}
                    className={`flex items-center gap-3 px-4 py-3.5 border-b border-white/5 last:border-0 ${isMe ? 'bg-brand-500/5' : ''}`}
                  >
                    <span className="text-sm font-bold text-white/30 w-6 text-center">
                      {medal || `${i + 1}`}
                    </span>
                    <span className={`flex-1 text-sm font-medium truncate ${isMe ? 'text-brand-400' : 'text-white'}`}>
                      {s.display_name}
                      {isMe && <span className="text-white/30 ml-1 font-normal">(toi)</span>}
                    </span>
                    <span className="text-sm font-bold text-white">{Number(s.day_points).toFixed(1)}</span>
                    <span className="text-xs text-white/30">pts</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </main>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
