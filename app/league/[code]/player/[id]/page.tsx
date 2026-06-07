'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { POSITION_LABELS } from '@/lib/pricing'

interface PlayerDetail {
  id: string
  name: string
  position: string
  team: string
  photo_url: string | null
  transfermarkt_value_m: number
  current_price: number | null
  total_rating: number
  matches_played: number
  scores: { match_date: string; rating: number; minutes_played: number; opponent: string }[]
  owners_count: number
  bought_at_price: number | null
}

export default function PlayerPage() {
  const { code, id } = useParams<{ code: string; id: string }>()
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [myPrice, setMyPrice] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      // Joueur de base
      const { data: pl } = await supabase
        .from('fantasy_players')
        .select()
        .eq('id', id)
        .single()
      if (!pl) { router.back(); return }

      // Prix courant
      const { data: price } = await supabase
        .from('fantasy_prices')
        .select('price')
        .eq('player_id', id)
        .order('computed_at', { ascending: false })
        .limit(1)
        .single()

      // Notes par match
      const { data: scores } = await supabase
        .from('fantasy_scores')
        .select('rating, minutes_played, match_date, sofascore_match_id')
        .eq('player_id', id)
        .order('match_date', { ascending: true })

      // Nombre de propriétaires dans la ligue
      const { data: league } = await supabase
        .from('fantasy_leagues')
        .select('id')
        .eq('code', code)
        .single()

      let ownersCount = 0
      let boughtAt = null

      if (league) {
        const { count } = await supabase
          .from('fantasy_squads')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', league.id)
          .eq('player_id', id)
          .eq('active', true)
        ownersCount = count || 0

        // Prix d'achat de l'utilisateur courant
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: participant } = await supabase
            .from('fantasy_participants')
            .select('id')
            .eq('league_id', league.id)
            .eq('user_id', user.id)
            .single()

          if (participant) {
            const { data: mySquad } = await supabase
              .from('fantasy_squads')
              .select('bought_at_price')
              .eq('participant_id', participant.id)
              .eq('player_id', id)
              .eq('active', true)
              .single()
            boughtAt = mySquad?.bought_at_price || null
          }
        }
      }

      // Enrichir les scores avec l'adversaire (simplifié)
      const enrichedScores = (scores || []).map(s => ({
        match_date: s.match_date || '',
        rating: s.rating || 0,
        minutes_played: s.minutes_played || 0,
        opponent: '—',
      }))

      const totalRating = enrichedScores.reduce((sum, s) => sum + s.rating, 0)

      setPlayer({
        ...pl,
        current_price: price?.price || null,
        total_rating: totalRating,
        matches_played: enrichedScores.length,
        scores: enrichedScores,
        owners_count: ownersCount,
        bought_at_price: boughtAt,
      })
      setMyPrice(boughtAt)
      setLoading(false)
    }
    load()
  }, [code, id, router])

  if (loading) return <Loading />
  if (!player) return null

  const avgRating = player.matches_played > 0
    ? (player.total_rating / player.matches_played).toFixed(2)
    : '—'

  const pnl = myPrice && player.current_price
    ? player.current_price - myPrice
    : null

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="text-white/40 hover:text-white">←</button>
        <h1 className="text-lg font-bold text-white">Fiche joueur</h1>
      </div>

      {/* Hero */}
      <div className="card p-5 mb-4 flex gap-4 items-center">
        <div className="w-16 h-16 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
          {player.photo_url
            ? <img src={player.photo_url} alt={player.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-2xl">👤</div>
          }
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white">{player.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`badge-${player.position}`}>{player.position}</span>
            <span className="text-sm text-white/50">{player.team}</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="Points totaux" value={player.total_rating.toFixed(1)} sub="pts cumulés" color="brand" />
        <StatCard label="Note moyenne" value={avgRating} sub={`sur ${player.matches_played} match${player.matches_played > 1 ? 's' : ''}`} />
        <StatCard label="Prix actuel" value={player.current_price?.toFixed(1) ?? '—'} sub="crédits" />
        <StatCard
          label={myPrice ? "P&L" : "Prix d'achat"}
          value={myPrice ? (pnl !== null ? (pnl >= 0 ? `+${pnl.toFixed(1)}` : pnl.toFixed(1)) : '—') : '—'}
          sub={myPrice ? `acheté ${myPrice} cr.` : 'pas dans ton équipe'}
          color={pnl !== null ? (pnl >= 0 ? 'green' : 'red') : undefined}
        />
        <StatCard label="Valeur TM" value={`${player.transfermarkt_value_m}M€`} sub="Transfermarkt" />
        <StatCard label="Popularité" value={`${player.owners_count}`} sub="participant(s) l'ont" />
      </div>

      {/* Notes par match */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">Notes par match</h3>
        </div>
        {player.scores.length === 0 ? (
          <div className="p-6 text-center text-white/30 text-sm">Aucun match joué pour l'instant</div>
        ) : (
          <div>
            {player.scores.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="flex-1">
                  <p className="text-xs text-white/40">
                    {new Date(s.match_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </p>
                  <p className="text-xs text-white/30">{s.minutes_played} min</p>
                </div>
                <RatingBar rating={s.rating} />
                <span className="text-sm font-bold text-white w-10 text-right">{s.rating.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  const valueColor = color === 'brand' ? 'text-brand-400'
    : color === 'green' ? 'text-green-400'
    : color === 'red' ? 'text-red-400'
    : 'text-white'
  return (
    <div className="card p-3">
      <p className="text-xs text-white/40 mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-white/30 mt-0.5">{sub}</p>
    </div>
  )
}

function RatingBar({ rating }: { rating: number }) {
  const pct = Math.min(100, (rating / 10) * 100)
  const color = rating >= 7.5 ? 'bg-green-500' : rating >= 6 ? 'bg-brand-500' : rating >= 5 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex-1 bg-white/5 rounded-full h-1.5 max-w-24">
      <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
