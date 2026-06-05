'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant, SquadDetail } from '@/lib/database.types'
import { POSITION_LABELS, validateSquad } from '@/lib/pricing'

const POS_ORDER = { GK: 0, DEF: 1, MID: 2, ATT: 3 }
const POSITIONS = ['GK', 'DEF', 'MID', 'ATT'] as const

export default function SquadPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [squad, setSquad] = useState<SquadDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [selling, setSelling] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg) { router.push('/'); return }
      setLeague(lg)
      const { data: p } = await supabase.from('fantasy_participants').select().eq('league_id', lg.id).eq('user_id', user.id).single()
      if (!p) { router.push('/'); return }
      setMe(p)
      const { data: sq } = await supabase.from('fantasy_squad_detail').select().eq('participant_id', p.id).eq('active', true).order('position')
      setSquad(sq || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  async function sellPlayer(squadDetail: SquadDetail) {
    if (!me || !league || !league.market_open) return
    setSelling(squadDetail.squad_id)
    setError('')

    const phaseMap: Record<string, string> = {
      post_poule: 'post_poule', huitieme: 'post_poule',
      post_8: 'post_8', quart: 'post_8',
      post_quart: 'post_quart', demi: 'post_quart',
      post_demi: 'post_demi', finale: 'post_demi',
    }
    const pricePhase = phaseMap[league.phase] || 'initial'

    const { data: currentPrice } = await supabase
      .from('fantasy_prices').select('price').eq('player_id', squadDetail.player_id).eq('phase', pricePhase).single()
    const sellPrice = currentPrice?.price || squadDetail.bought_at_price

    // RPC atomique — vérifie la composition ET crédite le budget en transaction
    const { data, error: rpcError } = await supabase.rpc('fantasy_sell_player', {
      p_participant_id: me.id,
      p_squad_id:       squadDetail.squad_id,
      p_sell_price:     sellPrice,
      p_phase:          pricePhase,
    })

    if (rpcError || data?.error) {
      setError(data?.error || rpcError?.message || 'Erreur inconnue')
      setSelling(null)
      return
    }

    setMe(prev => prev ? { ...prev, budget_remaining: data.budget_remaining } : prev)
    setSquad(prev => prev.filter(s => s.squad_id !== squadDetail.squad_id))
    setSelling(null)
  }

  if (loading) return <Loading />

  const byPos = POSITIONS.reduce((acc, pos) => {
    acc[pos] = squad.filter(s => s.position === pos).sort((a, b) => b.total_rating - a.total_rating)
    return acc
  }, {} as Record<string, SquadDetail[]>)

  const totalPoints = squad.reduce((s, p) => s + Number(p.total_rating), 0)
  const validation = validateSquad(squad.map(s => ({ position: s.position })))

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Mon équipe</h1>
          <p className="text-xs text-white/40">{squad.length} joueurs · {me?.budget_remaining.toFixed(1)} crédits restants</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Points total" value={totalPoints.toFixed(1)} sub="pts" />
        <StatCard label="Joueurs" value={String(squad.length)} sub="/ min 18" ok={squad.length >= 18} />
        <StatCard label="Composition" value={validation.valid ? '✓' : '✗'} sub={validation.valid ? 'valide' : 'invalide'} ok={validation.valid} />
      </div>

      {!validation.valid && (
        <div className="card p-3 mb-4 border-yellow-500/20 bg-yellow-500/5">
          {validation.errors.map(e => <p key={e} className="text-xs text-yellow-400">· {e}</p>)}
        </div>
      )}
      {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>}

      {POSITIONS.map(pos => {
        const posPlayers = byPos[pos]
        if (posPlayers.length === 0) return null
        return (
          <div key={pos} className="mb-5">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">{POSITION_LABELS[pos]} ({posPlayers.length})</h2>
            <div className="space-y-2">
              {posPlayers.map(p => (
                <div key={p.squad_id} className="card p-3 flex items-center gap-3">
                  <Link href={`/league/${code}/player/${p.player_id}`} className="w-8 h-8 rounded-full bg-white/10 flex-shrink-0 overflow-hidden">
                    {p.photo_url ? <img src={p.photo_url} alt={p.player_name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm">👤</div>}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link href={`/league/${code}/player/${p.player_id}`} className="text-sm font-medium text-white hover:text-brand-400 truncate block">{p.player_name}</Link>
                    <p className="text-xs text-white/40">{p.team} · Acheté {p.bought_at_price} cr.</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-white">{Number(p.total_rating).toFixed(1)}</p>
                    <p className="text-xs text-white/30">{p.matches_played} match{Number(p.matches_played) > 1 ? 's' : ''}</p>
                  </div>
                  {league?.market_open && (
                    <button onClick={() => sellPlayer(p)} disabled={selling === p.squad_id} className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300">
                      {selling === p.squad_id ? '…' : 'Vendre'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {squad.length === 0 && (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">👥</p>
          <p>Aucun joueur dans ton équipe</p>
          {league?.draft_open && <button onClick={() => router.push(`/league/${code}/draft`)} className="btn-primary mt-4">Aller au draft →</button>}
        </div>
      )}
    </main>
  )
}

function StatCard({ label, value, sub, ok }: { label: string; value: string; sub: string; ok?: boolean }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xs text-white/40 mb-1">{label}</p>
      <p className={`text-xl font-bold ${ok === undefined ? 'text-white' : ok ? 'text-brand-400' : 'text-yellow-400'}`}>{value}</p>
      <p className="text-xs text-white/30">{sub}</p>
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
