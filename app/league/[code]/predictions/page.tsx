'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Prediction = {
  participant_id: string
  display_name: string
  current_points: number
  estimated_future: number
  projected_total: number
  player_count: number
  total_remaining_matches: number
}

export default function PredictionsPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select('id').eq('code', code).single()
      if (!lg) { router.push('/'); return }

      const { data: p } = await supabase
        .from('fantasy_participants')
        .select('id')
        .eq('league_id', lg.id)
        .eq('user_id', user.id)
        .single()
      if (p) setMyId(p.id)

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/league/${code}/predictions`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })

      if (!res.ok) { setError('Erreur lors du chargement'); setLoading(false); return }
      const json = await res.json()
      setPredictions(json.predictions || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />

  const leader = predictions[0] ?? null
  const me = predictions.find(p => p.participant_id === myId) ?? null
  const myAvgRemaining = me && me.player_count > 0
    ? (me.total_remaining_matches / me.player_count).toFixed(1)
    : null

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Prédictions</h1>
          <p className="text-xs text-white/40">Projection de fin de tournoi</p>
        </div>
      </div>

      {myAvgRemaining && (
        <div className="card p-3 mb-4 border-brand-500/20 bg-brand-500/5">
          <p className="text-xs text-brand-400 text-center">
            Projection basée sur ~{myAvgRemaining} matchs restants par joueur
          </p>
        </div>
      )}

      {error && (
        <div className="card p-3 mb-4 border-red-500/20 bg-red-500/5">
          <p className="text-xs text-red-400 text-center">{error}</p>
        </div>
      )}

      {predictions.length === 0 && !error ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">🔮</p>
          <p>Aucune donnée disponible</p>
          <p className="text-xs mt-2">Revenez une fois les premières notes importées</p>
        </div>
      ) : (
        <div className="space-y-2">
          {predictions.map((p, i) => {
            const isLeader = i === 0
            const isMe = p.participant_id === myId
            const gap = leader ? p.projected_total - leader.projected_total : 0
            const avgRemaining = p.player_count > 0
              ? (p.total_remaining_matches / p.player_count).toFixed(1)
              : '0'

            return (
              <div key={p.participant_id} className={`card p-4 ${isMe ? 'border-brand-500/30 bg-brand-500/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-6 text-center text-sm font-bold flex-shrink-0 ${
                    i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
                  }`}>
                    {i + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{p.display_name}</span>
                      {isLeader && <span className="text-xs">🏆</span>}
                      {isMe && <span className="text-xs text-brand-400 font-medium">(toi)</span>}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">
                      {p.current_points.toFixed(1)} actuels
                      {' + '}
                      <span className="text-green-400">{p.estimated_future.toFixed(1)} estimés</span>
                      <span className="text-white/20"> · ~{avgRemaining} matchs/joueur</span>
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-white">{p.projected_total.toFixed(1)}</p>
                    {isLeader ? (
                      <p className="text-xs text-yellow-400">favori</p>
                    ) : (
                      <p className="text-xs text-red-400">{gap.toFixed(1)}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-center text-xs text-white/20 mt-6">
        * Note moyenne actuelle × matchs restants. Joueurs sans note : 6.5 par défaut.
      </p>
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
