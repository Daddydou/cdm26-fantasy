'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const LEAGUE_CODE = 'I8FDQU'
const PASSWORD    = 'CDM2026'
const SESSION_KEY = 'cdm26_session'

export default function HomePage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [checking, setChecking]       = useState(true)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    async function tryAutoLogin() {
      try {
        // 1. Session Supabase valide (anon persisté ou admin magic link)
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const { data: p } = await supabase
            .from('fantasy_participants')
            .select('fantasy_leagues(code)')
            .eq('user_id', session.user.id)
            .limit(1)
            .single()
          const code = (p?.fantasy_leagues as any)?.code
          if (code) { router.push(`/league/${code}`); return }
          // Session sans ligue (cas rare) → afficher le formulaire
          setChecking(false)
          return
        }

        // 2. Pas de session — tenter une reconnexion anonyme si localStorage connu
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          try {
            const stored = JSON.parse(raw)
            if (stored.authenticated && stored.displayName) {
              const { data: anon } = await supabase.auth.signInAnonymously()
              if (anon.user) {
                const { data } = await supabase.rpc('fantasy_rejoin_league', {
                  p_display_name: stored.displayName,
                  p_league_code:  LEAGUE_CODE,
                })
                if (!data?.error) {
                  localStorage.setItem(SESSION_KEY, JSON.stringify({
                    ...stored,
                    userId: anon.user.id,
                  }))
                  router.push(`/league/${LEAGUE_CODE}`)
                  return
                }
              }
              // Échec inattendu → pre-remplir et afficher le formulaire
              setDisplayName(stored.displayName)
              setReconnecting(true)
            }
          } catch {}
        }
        setChecking(false)
      } catch {
        setChecking(false)
      }
    }
    tryAutoLogin()
  }, [router])

  async function handleSubmit() {
    const name = displayName.trim()
    if (!name || !password) return
    if (password !== PASSWORD) { setError('Mot de passe incorrect'); return }
    setLoading(true)
    setError('')
    try {
      const { data: anon, error: anonErr } = await supabase.auth.signInAnonymously()
      if (anonErr || !anon.user) throw new Error('Connexion anonyme échouée')

      const { data, error: rpcErr } = await supabase.rpc('fantasy_rejoin_league', {
        p_display_name: name,
        p_league_code:  LEAGUE_CODE,
      })
      if (rpcErr) throw rpcErr
      if (data?.error) throw new Error(data.error)

      localStorage.setItem(SESSION_KEY, JSON.stringify({
        authenticated: true,
        userId:        anon.user.id,
        displayName:   name,
        leagueCode:    LEAGUE_CODE,
      }))
      router.push(`/league/${LEAGUE_CODE}`)
    } catch (e) {
      setError((e as Error).message)
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

      <div className="card w-full max-w-md p-6 space-y-4">
        {reconnecting && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-300 text-xs">
            Reconnexion nécessaire — entre ton mot de passe pour continuer
          </div>
        )}
        <div>
          <label className="text-xs text-white/50 mb-1.5 block">Ton pseudo</label>
          <input
            className="input"
            placeholder="MonPseudo"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoComplete="username"
          />
        </div>
        <div>
          <label className="text-xs text-white/50 mb-1.5 block">Mot de passe</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoComplete="current-password"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading || !displayName.trim() || !password}
          className="btn-primary w-full py-3 text-base"
        >
          {loading ? 'Connexion…' : 'Accéder au jeu →'}
        </button>
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
        )}
      </div>

      <p className="mt-6 text-white/20 text-xs">Ligue privée · 10 participants max</p>
      <a href="/admin-login" className="mt-2 text-white/10 text-xs hover:text-white/30 transition-colors">Admin</a>
    </main>
  )
}
