'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const ADMIN_EMAIL = 'lolo.rms@gmail.com'
const STORAGE_KEY = 'cdm26_league'
const PENDING_KEY = 'cdm26_pending'

export default function HomePage() {
  const router = useRouter()
  const [step, setStep] = useState<'home' | 'email' | 'check_email' | 'join_name'>('home')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [leagueName, setLeagueName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [isCreate, setIsCreate] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    async function tryAutoLogin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setChecking(false); return }

        setLoggedIn(true)

        // Session valide — trouver sa ligue
        const savedCode = localStorage.getItem(STORAGE_KEY)
        if (savedCode) {
          const { data: lg } = await supabase
            .from('fantasy_leagues').select('id').eq('code', savedCode).single()
          if (lg) {
            const { data: p } = await supabase
              .from('fantasy_participants').select('id')
              .eq('league_id', lg.id).eq('user_id', user.id).single()
            if (p) { router.push(`/league/${savedCode}`); return }
          }
        }

        // Session valide mais pas de ligue → chercher sa ligue
        const { data: p } = await supabase
          .from('fantasy_participants').select('league_id, fantasy_leagues(code)')
          .eq('user_id', user.id).limit(1).single()

        if (p) {
          const leagueCode = (p.fantasy_leagues as any)?.code
          if (leagueCode) {
            localStorage.setItem(STORAGE_KEY, leagueCode)
            router.push(`/league/${leagueCode}`)
            return
          }
        }

        // Connecté mais pas encore dans une ligue — restaurer l'intention si retour magic link
        const pending = sessionStorage.getItem(PENDING_KEY)
        if (pending) {
          try {
            const { isCreate: ic, code: c } = JSON.parse(pending)
            sessionStorage.removeItem(PENDING_KEY)
            setIsCreate(ic)
            if (c) setCode(c)
            setStep('join_name')
            setChecking(false)
            return
          } catch {}
        }

        setChecking(false)
      } catch {
        setChecking(false)
      }
    }
    tryAutoLogin()
  }, [router])

  async function sendMagicLink() {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ isCreate, code }))
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }
      })
      if (error) throw error
      setStep('check_email')
    } catch (e) {
      sessionStorage.removeItem(PENDING_KEY)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!displayName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non connecté')

      const { data: league, error: lgErr } = await supabase
        .from('fantasy_leagues').select().eq('code', code.toUpperCase().trim()).single()
      if (lgErr || !league) throw new Error('Code de ligue invalide')

      const { error: joinError } = await supabase
        .from('fantasy_participants').insert({
          league_id: league.id,
          user_id: user.id,
          display_name: displayName.trim(),
          budget_remaining: league.budget_per_user,
        })
      if (joinError) {
        if (joinError.code === '23505') throw new Error('Tu es déjà dans cette ligue')
        throw joinError
      }

      localStorage.setItem(STORAGE_KEY, league.code)
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non connecté')

      const leagueCode = Math.random().toString(36).substring(2, 8).toUpperCase()
      const { data: league, error: createError } = await supabase
        .from('fantasy_leagues').insert({
          name: leagueName.trim(),
          code: leagueCode,
          admin_user_id: user.id,
          phase: 'draft',
          budget_per_user: 2150,
          draft_open: false,
          market_open: false,
        }).select().single()
      if (createError || !league) throw createError || new Error('Création échouée')

      await supabase.from('fantasy_participants').insert({
        league_id: league.id,
        user_id: user.id,
        display_name: displayName.trim(),
        budget_remaining: league.budget_per_user,
      })

      localStorage.setItem(STORAGE_KEY, leagueCode)
      router.push(`/league/${leagueCode}`)
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

        {/* Étape 1 : home */}
        {step === 'home' && (
          <div className="space-y-3">
            <button onClick={() => { setIsCreate(false); setStep(loggedIn ? 'join_name' : 'email') }}
              className="btn-primary w-full py-3 text-base">
              Rejoindre une ligue →
            </button>
            <button onClick={() => { setIsCreate(true); setStep(loggedIn ? 'join_name' : 'email') }}
              className="btn-ghost w-full py-3 text-base">
              Créer une ligue
            </button>
          </div>
        )}

        {/* Étape 2 : email */}
        {step === 'email' && (
          <div className="space-y-4">
            <button onClick={() => setStep('home')} className="text-white/40 text-sm hover:text-white">← Retour</button>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Ton adresse email</label>
              <input className="input" type="email" placeholder="toi@email.com"
                value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMagicLink()} />
            </div>
            {!isCreate && (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Code de ligue</label>
                <input className="input uppercase tracking-widest text-center text-lg font-bold"
                  placeholder="ABC123" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
              </div>
            )}
            <button onClick={sendMagicLink} disabled={loading || !email}
              className="btn-primary w-full py-3 text-base">
              {loading ? 'Envoi…' : 'Recevoir le lien de connexion →'}
            </button>
            <p className="text-xs text-white/30 text-center">Un lien magique sera envoyé à ton email — pas de mot de passe !</p>
          </div>
        )}

        {/* Étape 3 : vérifier email */}
        {step === 'check_email' && (
          <div className="text-center space-y-4">
            <div className="text-5xl">📬</div>
            <h2 className="text-lg font-semibold text-white">Vérifie tes emails !</h2>
            <p className="text-sm text-white/50">
              On a envoyé un lien de connexion à<br />
              <span className="text-white font-medium">{email}</span>
            </p>
            <p className="text-xs text-white/30">Clique sur le lien dans l'email pour accéder à l'app.</p>
            <button onClick={() => setStep('email')} className="btn-ghost text-sm w-full">
              ← Changer d'email
            </button>
          </div>
        )}

        {/* Étape 4 : pseudo (après callback) */}
        {step === 'join_name' && (
          <div className="space-y-4">
            {!isCreate ? (
              <>
                <h2 className="text-sm font-semibold text-white mb-2">Presque ! Rejoins ta ligue</h2>
                <input className="input uppercase tracking-widest text-center text-lg font-bold"
                  placeholder="Code de ligue" value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
                <input className="input" placeholder="Ton pseudo dans la ligue"
                  value={displayName} onChange={e => setDisplayName(e.target.value)} />
                <button onClick={handleJoin} disabled={loading || !displayName || !code}
                  className="btn-primary w-full py-3">
                  {loading ? 'Connexion…' : 'Rejoindre →'}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-white mb-2">Crée ta ligue</h2>
                <input className="input" placeholder="Nom de la ligue"
                  value={leagueName} onChange={e => setLeagueName(e.target.value)} />
                <input className="input" placeholder="Ton pseudo (admin)"
                  value={displayName} onChange={e => setDisplayName(e.target.value)} />
                <button onClick={handleCreate} disabled={loading || !leagueName || !displayName}
                  className="btn-primary w-full py-3">
                  {loading ? 'Création…' : 'Créer la ligue →'}
                </button>
              </>
            )}
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
