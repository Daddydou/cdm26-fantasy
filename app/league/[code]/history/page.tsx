'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant } from '@/lib/database.types'

interface Transfer {
  id: string
  player_name: string
  player_id: string
  position: string
  team: string
  photo_url: string | null
  participant_name: string
  participant_id: string
  bought_at_price: number
  bought_at_phase: string
  sold_at_price: number | null
  sold_at_phase: string | null
  sold_at: string | null
  created_at: string
  active: boolean
}

interface SquadRow {
  id: string
  bought_at_price: number
  bought_at_phase: string
  sold_at_price: number | null
  sold_at_phase: string | null
  sold_at: string | null
  active: boolean
  created_at: string
  fantasy_players: { id: string; name: string; position: string; team: string; photo_url: string | null } | null
  fantasy_participants: { id: string; display_name: string } | null
}

const PHASE_LABELS: Record<string, string> = {
  initial: 'Draft', post_poule: 'Après poule',
  post_8: 'Après 8es', post_quart: 'Après 1/4', post_demi: 'Après demies',
}

export default function HistoryPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [participantFilter, setParticipantFilter] = useState<string>('all')
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [sort, setSort] = useState<string>('newest')

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

      const { data: allParticipants } = await supabase.from('fantasy_participants').select()
        .eq('league_id', lg.id).order('display_name')
      setParticipants(allParticipants || [])

      const { data: squads } = await supabase
        .from('fantasy_squads')
        .select(`
          id, bought_at_price, bought_at_phase,
          sold_at_price, sold_at_phase, sold_at, active, created_at,
          fantasy_players(id, name, position, team, photo_url),
          fantasy_participants(id, display_name)
        `)
        .eq('league_id', lg.id)
        .order('created_at', { ascending: false })

      const mapped: Transfer[] = ((squads || []) as unknown as SquadRow[]).map(s => ({
        id: s.id,
        player_name: s.fantasy_players?.name || '?',
        player_id: s.fantasy_players?.id || '',
        position: s.fantasy_players?.position || '',
        team: s.fantasy_players?.team || '',
        photo_url: s.fantasy_players?.photo_url || null,
        participant_name: s.fantasy_participants?.display_name || '?',
        participant_id: s.fantasy_participants?.id || '',
        bought_at_price: s.bought_at_price,
        bought_at_phase: s.bought_at_phase,
        sold_at_price: s.sold_at_price,
        sold_at_phase: s.sold_at_phase,
        sold_at: s.sold_at,
        created_at: s.created_at,
        active: s.active,
      }))

      setTransfers(mapped)
      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />

  const marketIsOpen = !!(league?.draft_open || league?.market_open)

  const teams = [...new Set(transfers.map(t => t.team))].sort()

  let filtered = [...transfers]
  if (marketIsOpen) {
    filtered = filtered.filter(t => t.participant_id === me?.id)
  } else if (participantFilter !== 'all') {
    filtered = filtered.filter(t => t.participant_id === participantFilter)
  }
  if (teamFilter !== 'all') filtered = filtered.filter(t => t.team === teamFilter)
  if (sort === 'oldest') filtered.sort((a, b) => a.created_at.localeCompare(b.created_at))
  else if (sort === 'price_desc') filtered.sort((a, b) => b.bought_at_price - a.bought_at_price)
  else if (sort === 'price_asc') filtered.sort((a, b) => a.bought_at_price - b.bought_at_price)
  else if (sort === 'pnl_desc') {
    filtered = filtered.filter(t => t.sold_at_price !== null)
    filtered.sort((a, b) => (b.sold_at_price! - b.bought_at_price) - (a.sold_at_price! - a.bought_at_price))
  }

  const totalBuys = transfers.length
  const totalSells = transfers.filter(t => !t.active && t.sold_at_price).length
  const totalVolume = transfers.reduce((s, t) => s + t.bought_at_price, 0)

  const selectClass = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white appearance-none focus:outline-none focus:border-brand-500/50'

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Historique des transferts</h1>
          <p className="text-xs text-white/40">{league?.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card p-3 text-center"><p className="text-xl font-bold text-white">{totalBuys}</p><p className="text-xs text-white/40">achats</p></div>
        <div className="card p-3 text-center"><p className="text-xl font-bold text-white">{totalSells}</p><p className="text-xs text-white/40">ventes</p></div>
        <div className="card p-3 text-center"><p className="text-xl font-bold text-white">{Math.round(totalVolume)}</p><p className="text-xs text-white/40">volume cr.</p></div>
      </div>

      {marketIsOpen && (
        <p className="text-xs text-white/30 mb-3">
          🔒 Les transferts des autres participants sont masqués pendant le draft / les transferts
        </p>
      )}

      <div className="space-y-2 mb-2">
        {!marketIsOpen && (
          <select value={participantFilter} onChange={e => setParticipantFilter(e.target.value)} className={selectClass}>
            <option value="all">Tous les participants</option>
            {me && <option value={me.id}>Moi ({me.display_name})</option>}
            {participants.filter(p => p.id !== me?.id).map(p => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
        )}
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className={selectClass}>
          <option value="all">Toutes les équipes</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} className={selectClass}>
          <option value="newest">Plus récent</option>
          <option value="oldest">Plus ancien</option>
          <option value="price_desc">Prix d&apos;achat ↓</option>
          <option value="price_asc">Prix d&apos;achat ↑</option>
          <option value="pnl_desc">Meilleur P&amp;L</option>
        </select>
      </div>
      <p className="text-xs text-white/30 mb-4">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-white/30">Aucun transfert</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => {
            const isMe = t.participant_id === me?.id
            const pnl = t.sold_at_price ? t.sold_at_price - t.bought_at_price : null
            return (
              <div key={t.id} className={`card p-3 ${isMe ? 'border-brand-500/20' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0 overflow-hidden">
                    {t.photo_url ? <img src={t.photo_url} alt={t.player_name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm">👤</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/league/${code}/player/${t.player_id}`} className="text-sm font-medium text-white hover:text-brand-400 truncate block">{t.player_name}</Link>
                    <p className="text-xs text-white/40">{t.team} · <span className={isMe ? 'text-brand-400' : 'text-white/40'}>{t.participant_name}</span></p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-xs text-green-400">+{t.bought_at_price}</span>
                      {t.sold_at_price && (<><span className="text-xs text-white/20">→</span><span className="text-xs text-red-400">-{t.sold_at_price}</span></>)}
                    </div>
                    {pnl !== null && <p className={`text-xs font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}</p>}
                    <p className="text-xs text-white/20">{PHASE_LABELS[t.bought_at_phase] || t.bought_at_phase}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/5">
                  <p className="text-xs text-white/20">{new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.active ? 'bg-brand-500/20 text-brand-400' : 'bg-white/5 text-white/30'}`}>
                    {t.active ? 'En équipe' : `Vendu ${t.sold_at_price} cr.`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
