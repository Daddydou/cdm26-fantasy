'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant } from '@/lib/database.types'
import { PHASE_LABELS } from '@/lib/pricing'

const PHASE_SEQUENCE = [
  'draft', 'poule', 'post_poule', 'huitieme', 'post_8',
  'quart', 'post_quart', 'demi', 'post_demi', 'finale', 'termine'
] as const

export default function AdminPage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg || lg.admin_user_id !== user.id) { router.push(`/league/${code}`); return }
      setLeague(lg)

      const { data: ps } = await supabase.from('fantasy_participants').select()
        .eq('league_id', lg.id).order('joined_at')
      setParticipants(ps || [])
      setLoading(false)
    }
    load()
  }, [code, router])

  async function update(patch: Partial<League>) {
    if (!league) return
    setSaving(true)
    const { error } = await supabase.from('fantasy_leagues').update(patch).eq('id', league.id)
    if (!error) {
      setLeague(prev => prev ? { ...prev, ...patch } : prev)
      setMsg('Sauvegardé ✓')
      setTimeout(() => setMsg(''), 2000)
    }
    setSaving(false)
  }

  async function updateBudget(budget: number) {
    if (!league) return
    setSaving(true)
    // RPC atomique : met à jour la ligue ET recalcule le budget_remaining de tous les participants
    await supabase.rpc('fantasy_update_league_budget', {
      p_league_id: league.id,
      p_budget: budget,
    })
    setLeague(prev => prev ? { ...prev, budget_per_user: budget } : prev)
    setMsg('Budget mis à jour ✓')
    setTimeout(() => setMsg(''), 2000)
    setSaving(false)
  }

  async function advancePhase() {
    if (!league) return
    const idx = PHASE_SEQUENCE.indexOf(league.phase as typeof PHASE_SEQUENCE[number])
    if (idx === -1 || idx >= PHASE_SEQUENCE.length - 1) return
    const next = PHASE_SEQUENCE[idx + 1]

    // Phases de transfert : ouvrir le marché automatiquement
    const isMarketPhase = ['post_poule', 'post_8', 'post_quart', 'post_demi'].includes(next)
    const isDraftPhase = next === 'draft'

    await update({
      phase: next,
      draft_open: isDraftPhase ? true : false,
      market_open: isMarketPhase ? true : false,
    })
  }

  if (loading) return <Loading />
  if (!league) return null

  const phaseIdx = PHASE_SEQUENCE.indexOf(league.phase as typeof PHASE_SEQUENCE[number])
  const nextPhase = phaseIdx < PHASE_SEQUENCE.length - 1 ? PHASE_SEQUENCE[phaseIdx + 1] : null
  const copyLink = typeof window !== 'undefined'
    ? `${window.location.origin}?code=${league.code}`
    : ''

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">⚙ Administration</h1>
          <p className="text-xs text-white/40">{league.name}</p>
        </div>
      </div>

      {msg && <div className="mb-4 p-3 bg-brand-500/10 border border-brand-500/20 rounded-lg text-brand-400 text-sm">{msg}</div>}

      {/* Phase */}
      <Section title="Phase du tournoi">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <p className="text-xs text-white/40 mb-1">Phase actuelle</p>
            <p className="text-base font-semibold text-white">{PHASE_LABELS[league.phase] || league.phase}</p>
          </div>
          {nextPhase && (
            <button onClick={advancePhase} disabled={saving} className="btn-primary text-sm">
              → {PHASE_LABELS[nextPhase] || nextPhase}
            </button>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-1">
          {PHASE_SEQUENCE.map((ph, i) => (
            <div key={ph} className={`flex items-center gap-2 text-xs ${
              i < phaseIdx ? 'text-white/20' :
              i === phaseIdx ? 'text-brand-400 font-medium' :
              'text-white/40'
            }`}>
              <span>{i < phaseIdx ? '✓' : i === phaseIdx ? '▶' : '·'}</span>
              <span>{PHASE_LABELS[ph]}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Draft & Marché */}
      <Section title="Draft & Marché">
        <Toggle
          label="Draft ouvert"
          sub="Les participants peuvent acheter des joueurs"
          value={league.draft_open}
          onChange={v => update({ draft_open: v })}
        />
        <Toggle
          label="Marché des transferts ouvert"
          sub="Achat et revente de joueurs autorisés"
          value={league.market_open}
          onChange={v => update({ market_open: v })}
        />
      </Section>

      {/* Budget */}
      <Section title="Budget par participant">
        <BudgetEditor value={league.budget_per_user} onSave={updateBudget} saving={saving} />
        <p className="text-xs text-white/30 mt-2">
          Lance <code className="text-brand-400">npx tsx scripts/compute-prices.ts</code> pour calibrer automatiquement
        </p>
      </Section>

      {/* Invitation */}
      <Section title="Lien d'invitation">
        <div className="flex gap-2">
          <div className="flex-1 input font-mono text-xs">{league.code}</div>
          <button
            onClick={() => { navigator.clipboard.writeText(copyLink); setMsg('Lien copié !') }}
            className="btn-ghost text-xs"
          >
            Copier le lien
          </button>
        </div>
        <p className="text-xs text-white/30 mt-2">
          {participants.length}/10 participants
        </p>
      </Section>

      {/* Participants */}
      <Section title={`Participants (${participants.length})`}>
        <div className="space-y-2">
          {participants.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
              <div>
                <p className="text-sm text-white">{p.display_name}</p>
                <p className="text-xs text-white/30">Budget restant : {p.budget_remaining.toFixed(1)} cr.</p>
              </div>
              {league.admin_user_id === p.user_id && (
                <span className="text-xs text-brand-400 font-medium">Admin</span>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Import SofaScore */}
      <Section title="Import des notes">
        <Link
          href={`/league/${code}/admin/import-sofascore`}
          className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-all"
        >
          <div>
            <p className="text-sm text-white font-medium">Import notes SofaScore</p>
            <p className="text-xs text-white/30 mt-0.5">Importer les notes joueurs après chaque match CDM</p>
          </div>
          <span className="text-white/40 text-lg">→</span>
        </Link>
      </Section>

      {/* Scripts */}
      <Section title="Scripts à lancer (terminal)">
        <div className="space-y-2">
          {[
            { cmd: 'npx tsx scripts/import-players.ts players.csv', desc: 'Importer les joueurs depuis CSV' },
            { cmd: 'npx tsx scripts/compute-prices.ts initial', desc: 'Calculer les prix initiaux' },
            { cmd: 'npx tsx scripts/import-matches.ts', desc: 'Importer le calendrier CDM' },
            { cmd: 'npx tsx scripts/fetch-ratings.ts', desc: 'Scraper les notes SofaScore' },
            { cmd: 'npx tsx scripts/compute-prices.ts post_poule', desc: 'Recalculer prix après poule' },
          ].map(s => (
            <div key={s.cmd} className="bg-white/5 rounded-lg p-3">
              <code className="text-xs text-brand-400 block mb-1">{s.cmd}</code>
              <p className="text-xs text-white/30">{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 mb-4">
      <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">{title}</h2>
      {children}
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
      <button
        onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full transition-all relative ${value ? 'bg-brand-500' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${value ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

function BudgetEditor({ value, onSave, saving }: { value: number; onSave: (v: number) => void; saving: boolean }) {
  const [v, setV] = useState(String(value))
  return (
    <div className="flex gap-2">
      <input
        type="number"
        className="input flex-1"
        value={v}
        onChange={e => setV(e.target.value)}
        step={50}
      />
      <button onClick={() => onSave(Number(v))} disabled={saving} className="btn-primary">
        {saving ? '…' : 'Sauv.'}
      </button>
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
