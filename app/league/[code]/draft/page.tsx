'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Player, Participant, League, PricePhase } from '@/lib/database.types'
import { POSITION_LABELS } from '@/lib/pricing'
import { getPhaseLimits } from '@/lib/phase-limits'

type PlayerWithPrice = Player & { current_price: number | null }
const POSITIONS = ['GK', 'DEF', 'MID', 'ATT'] as const

export default function DraftPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [players, setPlayers] = useState<PlayerWithPrice[]>([])
  const [myPlayerIds, setMyPlayerIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState<string>('ALL')
  const [mySquadMap, setMySquadMap] = useState<Map<string, { squad_id: string; bought_at_price: number }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const [selling, setSelling] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const currentPricePhase = useCallback((phase: string): PricePhase => {
    const map: Record<string, PricePhase> = {
      draft: 'initial', poule: 'initial',
      apres_poule: 'post_poule', seizieme: 'post_poule', apres_seizieme: 'post_poule',
      huitieme: 'post_8', apres_huitieme: 'post_8',
      quart: 'post_quart', apres_quart: 'post_quart',
      demi: 'post_demi', apres_demi: 'post_demi', finale: 'post_demi',
    }
    return map[phase] || 'initial'
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg || (!lg.draft_open && !lg.market_open)) { router.push(`/league/${code}`); return }
      setLeague(lg)

      const { data: participant } = await supabase
        .from('fantasy_participants').select().eq('league_id', lg.id).eq('user_id', user.id).single()
      if (!participant) { router.push('/'); return }
      setMe(participant)

      const pricePhase = currentPricePhase(lg.phase)

      const { data: playersData } = await supabase
        .from('fantasy_players')
        .select(`*, fantasy_prices(price, phase)`)
        .eq('active', true)
        .order('name')

      const { data: mySquad } = await supabase
        .from('fantasy_squads')
        .select('id, player_id, bought_at_price')
        .eq('participant_id', participant.id)
        .eq('active', true)

      setMyPlayerIds(new Set((mySquad || []).map(s => s.player_id)))
      setMySquadMap(new Map((mySquad || []).map(s => [s.player_id, { squad_id: s.id, bought_at_price: s.bought_at_price }])))

      const enriched: PlayerWithPrice[] = (playersData || []).map((p: Player & { fantasy_prices?: { price: number; phase: string }[] }) => {
        const priceRow = p.fantasy_prices?.find((pr) => pr.phase === pricePhase)
          ?? p.fantasy_prices?.find((pr) => pr.phase === 'initial')
        return { ...p, current_price: priceRow?.price ?? null }
      })
      enriched.sort((a, b) => (b.current_price ?? -1) - (a.current_price ?? -1))
      setPlayers(enriched)
      setLoading(false)
    }
    load()
  }, [code, router, currentPricePhase])

  const filtered = players.filter(p => {
    const matchPos = posFilter === 'ALL' || p.position === posFilter
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase())
    return matchPos && matchSearch
  })

  async function buyPlayer(player: PlayerWithPrice) {
    if (!me || !league || !player.current_price) return
    if (myPlayerIds.has(player.id)) return
    setBuying(player.id)
    setError('')

    const pricePhase = currentPricePhase(league.phase)

    // RPC atomique — pas de race condition
    const { data, error: rpcError } = await supabase.rpc('fantasy_buy_player', {
      p_league_id:      league.id,
      p_participant_id: me.id,
      p_player_id:      player.id,
      p_price:          player.current_price,
      p_phase:          pricePhase,
    })

    if (rpcError || data?.error) {
      setError(data?.error || rpcError?.message || 'Erreur inconnue')
      setBuying(null)
      return
    }

    setMe(prev => prev ? { ...prev, budget_remaining: data.budget_remaining } : prev)
    setMyPlayerIds(prev => new Set([...prev, player.id]))
    setMySquadMap(prev => new Map([...prev, [player.id, { squad_id: data.squad_id, bought_at_price: player.current_price! }]]))
    setSuccessMsg(`${player.name} acheté pour ${player.current_price} crédits !`)
    setTimeout(() => setSuccessMsg(''), 3000)
    setBuying(null)
  }

  async function sellPlayer(player: PlayerWithPrice) {
    if (!me || !league || !league.draft_open) return
    let entry = mySquadMap.get(player.id)
    if (!entry) return
    setSelling(player.id)
    setError('')

    // Si squad_id manquant (achat dans la même session sans retour RPC), on le cherche
    if (!entry.squad_id) {
      const { data: sq } = await supabase
        .from('fantasy_squads').select('id').eq('participant_id', me.id).eq('player_id', player.id).eq('active', true).single()
      if (!sq) { setSelling(null); return }
      entry = { ...entry, squad_id: sq.id }
    }

    const pricePhase = currentPricePhase(league.phase)

    const { data, error: rpcError } = await supabase.rpc('fantasy_sell_player', {
      p_participant_id: me.id,
      p_squad_id:       entry.squad_id,
      p_sell_price:     entry.bought_at_price,
      p_phase:          pricePhase,
    })

    if (rpcError || data?.error) {
      setError(data?.error || rpcError?.message || 'Erreur inconnue')
      setSelling(null)
      return
    }

    setMe(prev => prev ? { ...prev, budget_remaining: data.budget_remaining } : prev)
    setMyPlayerIds(prev => { const s = new Set(prev); s.delete(player.id); return s })
    setMySquadMap(prev => { const m = new Map(prev); m.delete(player.id); return m })
    setSelling(null)
  }

  if (loading) return <Loading />

  const limits = getPhaseLimits(league?.phase ?? 'draft')
  const myCount = myPlayerIds.size
  const mySquadPlayers = players.filter(p => myPlayerIds.has(p.id))
  const myPosCounts = { GK: 0, DEF: 0, MID: 0, ATT: 0 }
  for (const p of mySquadPlayers) {
    if (p.position in myPosCounts) myPosCounts[p.position as keyof typeof myPosCounts]++
  }
  const squadFull = myCount >= limits.total

  // Dépassements de limites (uniquement pendant les transferts)
  const overLimitWarnings: string[] = []
  if (league?.market_open) {
    if (myCount > limits.total)
      overLimitWarnings.push(`${myCount - limits.total} joueur(s) de trop au total (max ${limits.total})`)
    if (myPosCounts.GK  > limits.GK)
      overLimitWarnings.push(`${myPosCounts.GK  - limits.GK}  GK  de trop (max ${limits.GK})`)
    if (myPosCounts.DEF > limits.DEF)
      overLimitWarnings.push(`${myPosCounts.DEF - limits.DEF} DEF de trop (max ${limits.DEF})`)
    if (myPosCounts.MID > limits.MID)
      overLimitWarnings.push(`${myPosCounts.MID - limits.MID} MID de trop (max ${limits.MID})`)
    if (myPosCounts.ATT > limits.ATT)
      overLimitWarnings.push(`${myPosCounts.ATT - limits.ATT} ATT de trop (max ${limits.ATT})`)
  }
  const isOverLimit = overLimitWarnings.length > 0

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto overflow-x-hidden">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">
            {league?.draft_open ? '🛒 Draft' : '🔄 Transferts'}
          </h1>
          <p className="text-xs text-white/40">{myCount} joueurs · {me?.budget_remaining.toFixed(1)} crédits restants</p>
        </div>
      </div>

      {myCount > 0 && (
        <SquadValidation count={myCount} posCounts={myPosCounts} limits={limits} squadFull={squadFull} />
      )}

      {isOverLimit && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm font-medium mb-1">Trop de joueurs pour cette phase !</p>
          {overLimitWarnings.map(w => (
            <p key={w} className="text-red-400/80 text-xs">⚠ {w}</p>
          ))}
          <p className="text-red-400/60 text-xs mt-1">Vends des joueurs avant d&apos;acheter.</p>
        </div>
      )}

      {successMsg && <div className="mb-3 p-3 bg-brand-500/10 border border-brand-500/20 rounded-lg text-brand-400 text-sm">{successMsg}</div>}
      {error && <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>}

      <div className="space-y-3 mb-4">
        <input className="input" placeholder="Rechercher un joueur ou une équipe…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {(['ALL', ...POSITIONS] as const).map(pos => (
            <button key={pos} onClick={() => setPosFilter(pos)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${posFilter === pos ? 'bg-brand-500 text-white' : 'bg-white/5 text-white/50 hover:text-white'}`}>
              {pos === 'ALL' ? 'Tous' : POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(player => {
          const owned = myPlayerIds.has(player.id)
          const canAfford = (me?.budget_remaining || 0) >= (player.current_price || 0)
          const posMax = limits[player.position as keyof typeof limits] as number
          const posAtMax = myPosCounts[player.position as keyof typeof myPosCounts] >= posMax
          const canBuy = canAfford && !squadFull && !posAtMax && !isOverLimit && !!player.current_price
          return (
            <div key={player.id} className={`card p-3 flex items-center gap-3 ${owned ? 'border-brand-500/30 bg-brand-500/5' : ''}`}>
              <div className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0 overflow-hidden">
                {player.photo_url ? <img src={player.photo_url} alt={player.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg">👤</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{player.name}</span>
                  <span className={`badge-${player.position}`}>{player.position}</span>
                </div>
                <p className="text-xs text-white/40 truncate">{player.team}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className="text-sm font-bold text-white">{player.current_price?.toFixed(1) ?? '—'}</p>
                  <p className="text-xs text-white/30">crédits</p>
                </div>
                {owned ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-brand-400 text-xs font-medium">✓</span>
                    {league?.draft_open && (
                      <button onClick={() => sellPlayer(player)} disabled={selling === player.id}
                        className="text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/50 rounded px-1.5 py-0.5 transition-all disabled:opacity-40">
                        {selling === player.id ? 'Retrait…' : 'Retirer'}
                      </button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => buyPlayer(player)} disabled={!canBuy || buying === player.id}
                    className={`btn text-xs py-1.5 px-3 ${canBuy ? 'btn-primary' : 'btn-ghost opacity-40'}`}>
                    {buying === player.id ? '…' : 'Acheter'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && <div className="text-center py-12 text-white/30">Aucun joueur trouvé</div>}
    </main>
  )
}

function SquadValidation({ count, posCounts, limits, squadFull }: {
  count: number
  posCounts: Record<string, number>
  limits: { total: number; GK: number; DEF: number; MID: number; ATT: number }
  squadFull: boolean
}) {
  const posRows = [
    { pos: 'GK',  label: 'GK',  max: limits.GK },
    { pos: 'DEF', label: 'DEF', max: limits.DEF },
    { pos: 'MID', label: 'MID', max: limits.MID },
    { pos: 'ATT', label: 'ATT', max: limits.ATT },
  ]
  return (
    <div className={`card p-3 mb-4 ${squadFull ? 'border-brand-500/30 bg-brand-500/5' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white">{count}/{limits.total} joueurs</span>
        {squadFull && <span className="text-xs text-brand-400 font-medium">Équipe complète</span>}
      </div>
      <div className="flex gap-3">
        {posRows.map(({ pos, label, max }) => {
          const n = posCounts[pos] ?? 0
          const over = n > max
          const full = n >= max
          return (
            <span key={pos} className={`text-xs font-mono ${over ? 'text-red-400' : full ? 'text-brand-400' : 'text-white/50'}`}>
              {n}/{max} {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
