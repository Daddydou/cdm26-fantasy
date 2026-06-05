'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant, Standing } from '@/lib/database.types'
import { PHASE_LABELS } from '@/lib/pricing'

const STORAGE_KEY = 'cdm26_session'

export default function LeaguePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminMode, setAdminMode] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg) { router.push('/'); return }
      setLeague(lg)

      const admin = lg.admin_user_id === user.id
      setIsAdmin(admin)

      const { data: participant } = await supabase.from('fantasy_participants').select()
        .eq('league_id', lg.id).eq('user_id', user.id).single()
      if (!participant) { router.push('/'); return }
      setMe(participant)

      // Sauvegarder/rafraîchir la session
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ leagueCode: lg.code, userId: user.id }))

      const { data: st } = await supabase.from('fantasy_standings').select()
        .eq('league_id', lg.id).order('total_points', { ascending: false })
      setStandings(st || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  async function logout() {
    localStorage.removeItem(STORAGE_KEY)
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <Loading />
  if (!league || !me) return null

  const phaseLabel = PHASE_LABELS[league.phase] || league.phase
  const marketIsOpen = league.market_open || league.draft_open

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pt-2">
        <div>
          <h1 className="text-xl font-bold text-white">{league.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-white/40">Code : </span>
            <span className="text-xs font-mono font-bold text-brand-400">{league.code}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${marketIsOpen ? 'bg-brand-500/20 text-brand-400' : 'bg-white/5 text-white/40'}`}>
              {phaseLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setAdminMode(!adminMode)}
              className={`btn text-xs py-1.5 px-3 ${adminMode ? 'bg-brand-500 text-white' : 'btn-ghost'}`}
            >
              {adminMode ? '🎮 Jouer' : '⚙ Admin'}
            </button>
          )}
          <button onClick={logout} className="text-white/20 hover:text-white/50 text-xs">
            Quitter
          </button>
        </div>
      </div>

      {/* Mode Admin */}
      {adminMode && isAdmin ? (
        <AdminPanel league={league} setLeague={setLeague} />
      ) : (
        <>
          {/* Budget */}
          <div className="card p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-white/40">Budget restant</p>
                <p className="text-2xl font-bold text-white mt-0.5">
                  {me.budget_remaining.toFixed(1)}
                  <span className="text-sm text-white/40 font-normal ml-1">crédits</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/40">Initial</p>
                <p className="text-sm text-white/60">{league.budget_per_user}</p>
              </div>
            </div>
            <div className="mt-3 bg-white/5 rounded-full h-1.5">
              <div className="bg-brand-500 h-1.5 rounded-full transition-all"
                style={{ width: `${Math.min(100, (me.budget_remaining / league.budget_per_user) * 100)}%` }} />
            </div>
          </div>

          {/* CTA Grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Link href={`/league/${code}/squad`} className="card p-4 hover:bg-white/10 transition-all text-center">
              <div className="text-2xl mb-1">👥</div>
              <p className="text-sm font-medium text-white">Mon équipe</p>
              <p className="text-xs text-white/40 mt-0.5">Voir mes joueurs</p>
            </Link>

            {marketIsOpen ? (
              <Link href={`/league/${code}/draft`} className="card p-4 hover:bg-white/10 transition-all text-center border-brand-500/30 bg-brand-500/5">
                <div className="text-2xl mb-1">{league.draft_open ? '🛒' : '🔄'}</div>
                <p className="text-sm font-medium text-brand-400">{league.draft_open ? 'Draft ouvert !' : 'Transferts ouverts !'}</p>
                <p className="text-xs text-white/40 mt-0.5">Acheter / vendre</p>
              </Link>
            ) : (
              <div className="card p-4 text-center opacity-40">
                <div className="text-2xl mb-1">🔒</div>
                <p className="text-sm font-medium text-white">Marché fermé</p>
                <p className="text-xs text-white/40 mt-0.5">Bientôt disponible</p>
              </div>
            )}

            <Link href={`/league/${code}/standings`} className="card p-4 hover:bg-white/10 transition-all text-center">
              <div className="text-2xl mb-1">🏆</div>
              <p className="text-sm font-medium text-white">Classement</p>
              <p className="text-xs text-white/40 mt-0.5">{standings.length} participants</p>
            </Link>

            <Link href={`/league/${code}/daily`} className="card p-4 hover:bg-white/10 transition-all text-center">
              <div className="text-2xl mb-1">📅</div>
              <p className="text-sm font-medium text-white">Par journée</p>
              <p className="text-xs text-white/40 mt-0.5">Points du jour</p>
            </Link>

            <Link href={`/league/${code}/history`} className="card p-4 hover:bg-white/10 transition-all text-center">
              <div className="text-2xl mb-1">📋</div>
              <p className="text-sm font-medium text-white">Transferts</p>
              <p className="text-xs text-white/40 mt-0.5">Historique</p>
            </Link>

            <Link href={`/league/${code}/standings?tab=vfm`} className="card p-4 hover:bg-white/10 transition-all text-center">
              <div className="text-2xl mb-1">📈</div>
              <p className="text-sm font-medium text-white">Value for Money</p>
              <p className="text-xs text-white/40 mt-0.5">Meilleur nez ?</p>
            </Link>
          </div>

          {/* Mini classement */}
          {standings.length > 0 && (
            <div className="card">
              <div className="p-4 border-b border-white/5">
                <h2 className="text-sm font-semibold text-white">Classement actuel</h2>
              </div>
              {standings.slice(0, 5).map((s, i) => (
                <div key={s.participant_id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${s.participant_id === me.id ? 'bg-brand-500/5' : ''}`}>
                  <span className={`w-6 text-center text-sm font-bold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>{i + 1}</span>
                  <span className="flex-1 text-sm text-white truncate">
                    {s.display_name}
                    {s.participant_id === me.id && <span className="text-brand-400 ml-1">(toi)</span>}
                  </span>
                  <span className="text-sm font-bold text-white">{Number(s.total_points).toFixed(1)}</span>
                  <span className="text-xs text-white/30">pts</span>
                </div>
              ))}
              {standings.length > 5 && (
                <Link href={`/league/${code}/standings`} className="block text-center p-3 text-xs text-brand-400 hover:text-brand-300">
                  Voir tout →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </main>
  )
}

function AdminPanel({ league, setLeague }: { league: League; setLeague: (l: League) => void }) {
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [budgetVal, setBudgetVal] = useState(String(league.budget_per_user))

  const PHASE_SEQUENCE = ['draft','poule','post_poule','huitieme','post_8','quart','post_quart','demi','post_demi','finale','termine'] as const
  const phaseIdx = PHASE_SEQUENCE.indexOf(league.phase as typeof PHASE_SEQUENCE[number])
  const nextPhase = phaseIdx < PHASE_SEQUENCE.length - 1 ? PHASE_SEQUENCE[phaseIdx + 1] : null

  async function update(patch: Partial<League>) {
    setSaving(true)
    const { error } = await supabase.from('fantasy_leagues').update(patch).eq('id', league.id)
    if (!error) { setLeague({ ...league, ...patch }); setMsg('Sauvegardé ✓'); setTimeout(() => setMsg(''), 2000) }
    setSaving(false)
  }

  async function advancePhase() {
    if (!nextPhase) return
    const isMarket = ['post_poule','post_8','post_quart','post_demi'].includes(nextPhase)
    await update({ phase: nextPhase, draft_open: nextPhase === 'draft', market_open: isMarket })
  }

  async function updateBudget() {
    setSaving(true)
    await supabase.rpc('fantasy_update_league_budget', { p_league_id: league.id, p_budget: Number(budgetVal) })
    setLeague({ ...league, budget_per_user: Number(budgetVal) })
    setMsg('Budget mis à jour ✓')
    setTimeout(() => setMsg(''), 2000)
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {msg && <div className="p-3 bg-brand-500/10 border border-brand-500/20 rounded-lg text-brand-400 text-sm">{msg}</div>}

      {/* Phase */}
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Phase du tournoi</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-white/40 mb-1">Phase actuelle</p>
            <p className="font-semibold text-white">{PHASE_LABELS[league.phase] || league.phase}</p>
          </div>
          {nextPhase && (
            <button onClick={advancePhase} disabled={saving} className="btn-primary text-sm">
              → {PHASE_LABELS[nextPhase] || nextPhase}
            </button>
          )}
        </div>
      </div>

      {/* Toggles */}
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Draft &amp; Marché</h2>
        <Toggle label="Draft ouvert" sub="Achats de joueurs autorisés" value={league.draft_open} onChange={v => update({ draft_open: v })} />
        <Toggle label="Marché des transferts" sub="Achat et revente autorisés" value={league.market_open} onChange={v => update({ market_open: v })} />
      </div>

      {/* Budget */}
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Budget par participant</h2>
        <div className="flex gap-2">
          <input type="number" className="input flex-1" value={budgetVal} onChange={e => setBudgetVal(e.target.value)} step={50} />
          <button onClick={updateBudget} disabled={saving} className="btn-primary">
            {saving ? '…' : 'Sauv.'}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Code d'invitation</h2>
        <div className="flex gap-2">
          <div className="input flex-1 font-mono text-center tracking-widest font-bold">{league.code}</div>
          <button onClick={() => navigator.clipboard.writeText(`https://cdm26-fantasy.vercel.app`).then(() => setMsg('Lien copié !'))} className="btn-ghost text-xs">
            Copier lien
          </button>
        </div>
      </div>

      {/* Scripts */}
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Scripts à lancer</h2>
        <div className="space-y-2">
          {[
            { cmd: 'npx tsx scripts/compute-prices.ts post_poule', desc: 'Recalculer prix après poule' },
            { cmd: 'npx tsx scripts/fetch-ratings.ts', desc: 'Scraper les notes du jour' },
            { cmd: `npx tsx scripts/notify-whatsapp.ts ${league.code}`, desc: 'Envoyer classement WhatsApp' },
          ].map(s => (
            <div key={s.cmd} className="bg-white/5 rounded-lg p-3">
              <code className="text-xs text-brand-400 block mb-1">{s.cmd}</code>
              <p className="text-xs text-white/30">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, sub, value, onChange }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <p className="text-sm text-white">{label}</p>
        <p className="text-xs text-white/30">{sub}</p>
      </div>
      <button onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full transition-all relative ${value ? 'bg-brand-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${value ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Connexion…</div></main>
}
