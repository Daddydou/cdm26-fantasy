'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const STORAGE_KEY = 'cdm26_session'

export default function HomePage() {
  const router = useRouter()
  const [tab, setTab] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [leagueName, setLeagueName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function tryAutoLogin() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (!saved) { setChecking(false); return }

        const { leagueCode } = JSON.parse(saved)
        if (!leagueCode) { setChecking(false); return }

        const { supabase } = await import('@/lib/supabase')

        // Récupérer la session existante
        let { data: { user } } = await supabase.auth.getUser()

        // Si pas de session, re-signer anonymement
        if (!user) {
          const { data } = await supabase.auth.signInAnonymously()
          user = data.user

          // Vérifier que ce nouvel utilisateur a bien un participant dans la ligue
          if (user) {
            const { data: lg } = await supabase
              .from('fantasy_leagues').select('id').eq('code', leagueCode).single()
            if (lg) {
              const { data: participant } = await supabase
                .from('fantasy_participants').select('id')
                .eq('league_id', lg.id).eq('user_id', user.id).single()
              // Nouveau user anonyme n'a pas de participant → afficher l'accueil
              if (!participant) { setChecking(false); return }
            }
          }
        }

        if (!user) { setChecking(false); return }

        // Vérifier que le participant existe pour cet user
        const { data: lg } = await supabase
          .from('fantasy_leagues').select('id').eq('code', leagueCode).single()
        if (!lg) { localStorage.removeItem(STORAGE_KEY); setChecking(false); return }

        const { data: participant } = await supabase
          .from('fantasy_participants').select('id')
          .eq('league_id', lg.id).eq('user_id', user.id).single()
        if (!participant) { localStorage.removeItem(STORAGE_KEY); setChecking(false); return }

        // Tout OK → rediriger
        router.push(`/league/${leagueCode}`)
      } catch {
        setChecking(false)
      }
    }
    tryAutoLogin()
  }, [router])

  async function handleJoin() {
    if (!code.trim() || !displayName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously()
      if (authError) throw authError
      const userId = authData.user?.id
      if (!userId) throw new Error('Auth échouée')

      const { data: league, error: leagueError } = await supabase
        .from('fantasy_leagues').select().eq('code', code.toUpperCase().trim()).single()
      if (leagueError || !league) throw new Error('Code de ligue invalide')

      const { error: joinError } = await supabase
        .from('fantasy_participants').insert({
          league_id: league.id,
          user_id: userId,
          display_name: displayName.trim(),
          budget_remaining: league.budget_per_user,
        })
      if (joinError) {
        if (joinError.code === '23505') throw new Error('Ce pseudo est déjà pris dans cette ligue')
        throw joinError
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ leagueCode: league.code, userId }))
      router.push(`/league/${league.code}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!leagueName.trim() || !displayName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously()
      if (authError) throw authError
      const userId = authData.user?.id
      if (!userId) throw new Error('Auth échouée')

      const leagueCode = Math.random().toString(36).substring(2, 8).toUpperCase()
      const { data: league, error: createError } = await supabase
        .from('fantasy_leagues').insert({
          name: leagueName.trim(),
          code: leagueCode,
          admin_user_id: userId,
          phase: 'draft',
          budget_per_user: 2150,
          draft_open: false,
          market_open: false,
        }).select().single()
      if (createError || !league) throw createError || new Error('Création échouée')

      await supabase.from('fantasy_participants').insert({
        league_id: league.id,
        user_id: userId,
        display_name: displayName.trim(),
        budget_remaining: league.budget_per_user,
      })

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ leagueCode: league.code, userId }))
      router.push(`/league/${leagueCode}/admin`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (checking) return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-white/40 text-sm">Connexion en cours…</div>
    </main>
  )

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="text-center mb-10">
        <div className="text-5xl mb-3">🏆</div>
        <h1 className="text-4xl font-bold text-white mb-2">CDM26 Fantasy</h1>
        <p className="text-white/50 text-sm">Coupe du Monde 2026 · Draft · Transferts · Classement</p>
      </div>

      <div className="card w-full max-w-md p-6">
        <div className="flex gap-1 bg-white/5 rounded-lg p-1 mb-6">
          {(['join', 'create'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-brand-500 text-white' : 'text-white/50 hover:text-white'}`}>
              {t === 'join' ? 'Rejoindre une ligue' : 'Créer une ligue'}
            </button>
          ))}
        </div>

        {tab === 'join' ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Code de ligue</label>
              <input className="input uppercase tracking-widest text-center text-lg font-bold"
                placeholder="ABC123" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Ton pseudo</label>
              <input className="input" placeholder="Comment tu veux t'appeler ?"
                value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <button onClick={handleJoin} disabled={loading || !code || !displayName} className="btn-primary w-full py-3 text-base">
              {loading ? 'Connexion…' : 'Rejoindre →'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Nom de la ligue</label>
              <input className="input" placeholder="Les Experts CDM"
                value={leagueName} onChange={e => setLeagueName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Ton pseudo (admin)</label>
              <input className="input" placeholder="Comment tu veux t'appeler ?"
                value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <button onClick={handleCreate} disabled={loading || !leagueName || !displayName} className="btn-primary w-full py-3 text-base">
              {loading ? 'Création…' : 'Créer la ligue →'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
        )}
      </div>

      <p className="mt-6 text-white/20 text-xs">Ligue privée · 10 participants max</p>
    </main>
  )
}
