'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant, Standing } from '@/lib/database.types'
import { PHASE_LABELS } from '@/lib/pricing'

export default function LeaguePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase
        .from('fantasy_leagues')
        .select()
        .eq('code', code)
        .single()

      if (!lg) { router.push('/'); return }
      setLeague(lg)
      setIsAdmin(lg.admin_user_id === user.id)

      const { data: participant } = await supabase
        .from('fantasy_participants')
        .select()
        .eq('league_id', lg.id)
        .eq('user_id', user.id)
        .single()

      if (!participant) { router.push('/'); return }
      setMe(participant)

      const { data: st } = await supabase
        .from('fantasy_standings')
        .select()
        .eq('league_id', lg.id)
        .order('total_points', { ascending: false })

      setStandings(st || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />
  if (!league || !me) return null

  const phaseLabel = PHASE_LABELS[league.phase] || league.phase
  const marketIsOpen = league.market_open || league.draft_open

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-xl font-bold text-white">{league.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-white/40">Code : </span>
            <span className="text-xs font-mono font-bold text-brand-400">{league.code}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              league.draft_open || league.market_open
                ? 'bg-brand-500/20 text-brand-400'
                : 'bg-white/5 text-white/40'
            }`}>
              {phaseLabel}
            </span>
          </div>
        </div>
        {isAdmin && (
          <Link href={`/league/${code}/admin`} className="btn-ghost text-xs">
            ⚙ Admin
          </Link>
        )}
      </div>

      {/* Budget */}
      <div className="card p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-white/40">Ton budget restant</p>
            <p className="text-2xl font-bold text-white mt-0.5">
              {me.budget_remaining.toFixed(1)}
              <span className="text-sm text-white/40 font-normal ml-1">crédits</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/40">Budget initial</p>
            <p className="text-sm text-white/60">{league.budget_per_user}</p>
          </div>
        </div>
        <div className="mt-3 bg-white/5 rounded-full h-1.5">
          <div
            className="bg-brand-500 h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(100, (me.budget_remaining / league.budget_per_user) * 100)}%` }}
          />
        </div>
      </div>

      {/* CTA */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link
          href={`/league/${code}/squad`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">👥</div>
          <p className="text-sm font-medium text-white">Mon équipe</p>
          <p className="text-xs text-white/40 mt-0.5">Voir mes joueurs</p>
        </Link>

        {marketIsOpen ? (
          <Link
            href={`/league/${code}/draft`}
            className="card p-4 hover:bg-white/10 transition-all text-center border-brand-500/30 bg-brand-500/5"
          >
            <div className="text-2xl mb-1">{league.draft_open ? '🛒' : '🔄'}</div>
            <p className="text-sm font-medium text-brand-400">
              {league.draft_open ? 'Draft ouvert !' : 'Transferts ouverts !'}
            </p>
            <p className="text-xs text-white/40 mt-0.5">Acheter / vendre</p>
          </Link>
        ) : (
          <div className="card p-4 text-center opacity-40">
            <div className="text-2xl mb-1">🔒</div>
            <p className="text-sm font-medium text-white">Marché fermé</p>
            <p className="text-xs text-white/40 mt-0.5">Prochain transfert bientôt</p>
          </div>
        )}

        <Link
          href={`/league/${code}/standings`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">🏆</div>
          <p className="text-sm font-medium text-white">Classement</p>
          <p className="text-xs text-white/40 mt-0.5">{standings.length} participants</p>
        </Link>

        <Link
          href={`/league/${code}/daily`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">📈</div>
          <p className="text-sm font-medium text-white">Classement jour</p>
          <p className="text-xs text-white/40 mt-0.5">Points par journée</p>
        </Link>

        <Link
          href={`/league/${code}/history`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">📋</div>
          <p className="text-sm font-medium text-white">Transferts</p>
          <p className="text-xs text-white/40 mt-0.5">Historique achats/ventes</p>
        </Link>
      </div>

      {/* Mini classement */}
      {standings.length > 0 && (
        <div className="card">
          <div className="p-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-white">Classement actuel</h2>
          </div>
          <div>
            {standings.slice(0, 5).map((s, i) => (
              <div
                key={s.participant_id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${
                  s.participant_id === me.id ? 'bg-brand-500/5' : ''
                }`}
              >
                <span className={`w-6 text-center text-sm font-bold ${
                  i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
                }`}>
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-white truncate">
                  {s.display_name}
                  {s.participant_id === me.id && <span className="text-brand-400 ml-1">(toi)</span>}
                </span>
                <span className="text-sm font-bold text-white">{Number(s.total_points).toFixed(1)}</span>
                <span className="text-xs text-white/30">pts</span>
              </div>
            ))}
          </div>
          {standings.length > 5 && (
            <Link href={`/league/${code}/standings`} className="block text-center p-3 text-xs text-brand-400 hover:text-brand-300">
              Voir tout le classement →
            </Link>
          )}
        </div>
      )}
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
