'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Player, Participant, League, PricePhase } from '@/lib/database.types'
import { POSITION_LABELS, validateSquad } from '@/lib/pricing'

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
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const currentPricePhase = useCallback((phase: string): PricePhase => {
    const map: Record<string, PricePhase> = {
      draft: 'initial', poule: 'initial',
      post_poule: 'post_poule', huitieme: 'post_poule',
      post_8: 'post_8', quart: 'post_8',
      post_quart: 'post_quart', demi: 'post_quart',
      post_demi: 'post_demi', finale: 'post_demi',
    }
    return map[phase] || 'initial'
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg || (!lg.draft_open && !lg.market_open)) {
        router.push(`/league/${code}`); return
      }
      setLeague(lg)

      const { data: participant } = await supabase
        .from('fantasy_participants').select().eq('league_id', lg.id).eq('user_id', user.id).single()
      if (!participant) { router.push('/'); return }
      setMe(participant)

      const pricePhase = currentPricePhase(lg.phase)

      // Joueurs + prix
      const { data: playersData } = await supabase
        .from('fantasy_players')
        .select(`*, fantasy_prices(price, phase)`)
        .eq('active', true)
        .order('name')

      // Squad actuel du participant
      const { data: mySquad } = await supabase
        .from('fantasy_squads')
        .select('player_id')
        .eq('participant_id', participant.id)
        .eq('active', true)

      setMyPlayerIds(new Set((mySquad || []).map(s => s.player_id)))

      const enriched: PlayerWithPrice[] = (playersData || []).map((p: Player & { fantasy_prices?: { price: number; phase: string }[] }) => {
        const priceRow = p.fantasy_prices?.find((pr) => pr.phase === pricePhase)
        return { ...p, current_price: priceRow?.price || null }
      })

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
    if (me.budget_remaining < player.current_price) {
      setError('Budget insuffisant')
      return
    }
    if (myPlayerIds.has(player.id)) return

    setBuying(player.id)
    setError('')

    const pricePhase = currentPricePhase(league.phase)

    const { error: insertError } = await supabase.from('fantasy_squads').insert({
      league_id: league.id,
      participant_id: me.id,
      player_id: player.id,
      bought_at_price: player.current_price,
      bought_at_phase: pricePhase,
      active: true,
    })

    if (insertError) {
      setError(insertError.message)
      setBuying(null)
      return
    }

    // Déduire le budget
    const newBudget = me.budget_remaining - player.current_price
    await supabase.from('fantasy_participants').update({ budget_remaining: newBudget }).eq('id', me.id)

    setMe(prev => prev ? { ...prev, budget_remaining: newBudget } : prev)
    setMyPlayerIds(prev => new Set([...prev, player.id]))
    setSuccessMsg(`${player.name} acheté pour ${player.current_price} crédits !`)
    setTimeout(() => setSuccessMsg(''), 3000)
    setBuying(null)
  }

  if (loading) return <Loading />

  const myCount = myPlayerIds.size

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">
            {league?.draft_open ? '🛒 Draft' : '🔄 Transferts'}
          </h1>
          <p className="text-xs text-white/40">{myCount} joueurs · {me?.budget_remaining.toFixed(1)} crédits restants</p>
        </div>
      </div>

      {/* Validation squad */}
      {myCount > 0 && (
        <SquadValidation count={myCount} budget={me?.budget_remaining || 0} players={players.filter(p => myPlayerIds.has(p.id))} />
      )}

      {/* Messages */}
      {successMsg && (
        <div className="mb-3 p-3 bg-brand-500/10 border border-brand-500/20 rounded-lg text-brand-400 text-sm">{successMsg}</div>
      )}
      {error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* Filtres */}
      <div className="space-y-3 mb-4">
        <input
          className="input"
          placeholder="Rechercher un joueur ou une équipe…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['ALL', ...POSITIONS] as const).map(pos => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                posFilter === pos
                  ? 'bg-brand-500 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white'
              }`}
            >
              {pos === 'ALL' ? 'Tous' : POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </div>

      {/* Liste joueurs */}
      <div className="space-y-2">
        {filtered.map(player => {
          const owned = myPlayerIds.has(player.id)
          const canAfford = (me?.budget_remaining || 0) >= (player.current_price || 0)

          return (
            <div
              key={player.id}
              className={`card p-3 flex items-center gap-3 ${owned ? 'border-brand-500/30 bg-brand-500/5' : ''}`}
            >
              {/* Photo */}
              <div className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0 overflow-hidden">
                {player.photo_url
                  ? <img src={player.photo_url} alt={player.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-lg">👤</div>
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{player.name}</span>
                  <span className={`badge-${player.position}`}>{player.position}</span>
                </div>
                <p className="text-xs text-white/40 truncate">{player.team}</p>
              </div>

              {/* Prix + bouton */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className="text-sm font-bold text-white">
                    {player.current_price?.toFixed(1) ?? '—'}
                  </p>
                  <p className="text-xs text-white/30">crédits</p>
                </div>
                {owned ? (
                  <span className="text-brand-400 text-xs font-medium">✓ Acheté</span>
                ) : (
                  <button
                    onClick={() => buyPlayer(player)}
                    disabled={!canAfford || buying === player.id || !player.current_price}
                    className={`btn text-xs py-1.5 px-3 ${
                      canAfford && player.current_price ? 'btn-primary' : 'btn-ghost opacity-40'
                    }`}
                  >
                    {buying === player.id ? '…' : 'Acheter'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-white/30">Aucun joueur trouvé</div>
      )}
    </main>
  )
}

function SquadValidation({ count, budget, players }: { count: number; budget: number; players: PlayerWithPrice[] }) {
  const { valid, errors } = validateSquad(players)
  return (
    <div className={`card p-3 mb-4 ${valid ? 'border-brand-500/30 bg-brand-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span>{valid ? '✅' : '⚠️'}</span>
        <span className="text-xs font-medium text-white">{count} joueurs sélectionnés</span>
      </div>
      {!valid && errors.map(e => (
        <p key={e} className="text-xs text-yellow-400 ml-6">· {e}</p>
      ))}
      {valid && <p className="text-xs text-brand-400 ml-6">Composition valide !</p>}
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}

