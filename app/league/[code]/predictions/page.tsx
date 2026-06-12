'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Prediction = {
  participant_id: string
  display_name: string
  score: number
  win_pct: number
  player_count: number
  avg_note: number
  avg_tm_value: number
  avg_force_norm: number
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

  const maxPct  = predictions[0]?.win_pct ?? 0

  const rankColor = (i: number) =>
    i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
  const barColor = (i: number) =>
    i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-300' : i === 2 ? 'bg-amber-600' : 'bg-white/20'

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Prédictions</h1>
          <p className="text-xs text-white/40">Score composite : notes · valeur · cote équipe</p>
        </div>
      </div>

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
            const isMe = p.participant_id === myId

            return (
              <div key={p.participant_id} className={`card p-4 ${isMe ? 'border-brand-500/30 bg-brand-500/5' : ''}`}>
                {/* Ligne principale */}
                <div className="flex items-center gap-3 mb-2">
                  <span className={`w-6 text-center text-sm font-bold flex-shrink-0 ${rankColor(i)}`}>
                    {i + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{p.display_name}</span>
                      {isMe && <span className="text-xs text-brand-400 font-medium">(toi)</span>}
                    </div>
                    <p className="text-xs text-white/30 mt-0.5">
                      Note moy : <span className="text-white/60">{p.avg_note.toFixed(1)}</span>
                      {' · '}
                      Valeur moy : <span className="text-white/60">{p.avg_tm_value.toFixed(1)}M</span>
                      {' · '}
                      Force : <span className="text-white/60">{p.avg_force_norm.toFixed(1)}/10</span>
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0 min-w-[64px]">
                    <p className={`text-xl font-bold ${i === 0 ? 'text-yellow-400' : 'text-white'}`}>
                      {p.win_pct.toFixed(1)}%
                    </p>
                    <p className="text-xs text-white/30">{p.player_count} joueurs</p>
                  </div>
                </div>

                {/* Barre de progression */}
                <div className="ml-9 bg-white/5 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${barColor(i)}`}
                    style={{ width: `${maxPct > 0 ? (p.win_pct / maxPct) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-center text-xs text-white/20 mt-6">
        Score = note (40%) + valeur TM (30%) + cote équipe (30%). Note par défaut si 0 match : 6.5.
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
