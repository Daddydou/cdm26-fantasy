'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match } from '@/lib/database.types'

type PlayerScore = {
  player_id: string
  player_name: string
  position: string
  team: string
  rating: number
  minutes_played: number
}

type MatchWithScores = Match & { scores: PlayerScore[] }

export default function MatchesPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [matches, setMatches] = useState<MatchWithScores[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const [{ data: processedMatches }, { data: allPlayers }] = await Promise.all([
        supabase.from('fantasy_matches').select().eq('processed', true).order('match_date', { ascending: false }),
        supabase.from('fantasy_players').select('id, name, position, team'),
      ])

      if (!processedMatches?.length) { setLoading(false); return }

      const { data: scores } = await supabase
        .from('fantasy_scores')
        .select('player_id, match_id, rating, minutes_played')
        .in('match_id', processedMatches.map(m => m.id))

      const playerMap = new Map((allPlayers || []).map(p => [p.id, p]))

      const result: MatchWithScores[] = processedMatches.map(m => {
        const matchScores: PlayerScore[] = (scores || [])
          .filter(s => s.match_id === m.id && s.rating != null)
          .map(s => {
            const p = playerMap.get(s.player_id)
            return {
              player_id: s.player_id,
              player_name: p?.name ?? '?',
              position: p?.position ?? '?',
              team: p?.team ?? '?',
              rating: s.rating!,
              minutes_played: s.minutes_played,
            }
          })
        return { ...m, scores: matchScores }
      })

      setMatches(result)
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) return <Loading />

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Matchs importés</h1>
          <p className="text-xs text-white/40">
            {matches.length} match{matches.length > 1 ? 's' : ''} terminé{matches.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {matches.length === 0 && (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">⚽</p>
          <p>Aucun match importé pour l'instant</p>
        </div>
      )}

      <div className="space-y-4">
        {matches.map(m => {
          const homeScores = m.scores
            .filter(s => s.team === m.home_team)
            .sort((a, b) => b.rating - a.rating)
          const awayScores = m.scores
            .filter(s => s.team === m.away_team)
            .sort((a, b) => b.rating - a.rating)
          const date = new Date(m.match_date).toLocaleDateString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
          })

          return (
            <div key={m.id} className="card overflow-hidden">
              <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                  {m.home_team} — {m.away_team}
                </span>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-xs text-white/40">{date}</p>
                  {m.round && <p className="text-[10px] text-white/25">{m.round}</p>}
                </div>
              </div>

              <TeamSection label={m.home_team} scores={homeScores} />
              <div className="h-px bg-white/5" />
              <TeamSection label={m.away_team} scores={awayScores} />
            </div>
          )
        })}
      </div>
    </main>
  )
}

function TeamSection({ label, scores }: { label: string; scores: PlayerScore[] }) {
  return (
    <div className="p-3">
      <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">{label}</p>
      {scores.length === 0 && (
        <p className="text-xs text-white/20 italic">Aucun joueur noté</p>
      )}
      <div className="space-y-1">
        {scores.map(s => (
          <div key={s.player_id} className="flex items-center gap-2">
            <span className="text-[10px] text-white/30 w-7 flex-shrink-0">{s.position}</span>
            <span className="text-xs text-white flex-1 truncate">{s.player_name}</span>
            <span className="text-[10px] text-white/25 w-8 text-right flex-shrink-0">{s.minutes_played}'</span>
            <span className={`text-xs font-bold w-8 text-right flex-shrink-0 ${
              s.rating >= 8 ? 'text-green-400' : s.rating >= 6 ? 'text-white' : 'text-red-400'
            }`}>
              {s.rating.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-white/40 text-sm">Chargement…</div>
    </main>
  )
}
