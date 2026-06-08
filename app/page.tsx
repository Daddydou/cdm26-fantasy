'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const LEAGUE_CODE  = process.env.NEXT_PUBLIC_LEAGUE_CODE ?? 'I8FDQU'
const APP_PASSWORD = 'CDM2026'
const ADMIN_EMAIL  = 'lolo.rms@gmail.com'
const ADMIN_PASS   = 'CDM2026fantasy2026'
const SESSION_KEY  = 'cdm26_session'

export default function HomePage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [checking, setChecking]     = useState(true)

  useEffect(() => {
    async function tryAutoLogin() {
      try {
        // 1. Session Supabase valide
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          if (session.user.email === ADMIN_EMAIL) {
            router.push(`/league/${LEAGUE_CODE}`)
            return
          }
          // Utilisateur anonyme — retrouver la ligue via le participant
          const { data: p } = await supabase
            .from('fantasy_participants')
            .select('fantasy_leagues(code)')
            .eq('user_id', session.user.id)
            .limit(1)
            .single()
          const code = (p?.fantasy_leagues as any)?.code
          if (code) { router.push(`/league/${code}`); return }
          setChecking(false)
          return
        }

        // 2. Pas de session — tenter une reconnexion via localStorage
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) { setChecking(false); return }

        const stored = JSON.parse(raw)
        if (!stored.authenticated) { setChecking(false); return }

        if (stored.isAdmin) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: ADMIN_EMAIL,
            password: ADMIN_PASS,
          })
          if (!signInErr) { router.push(`/league/${LEAGUE_CODE}`); return }
        } else if (stored.displayName) {
          const { data: anon } = await supabase.auth.signInAnonymously()
          if (anon.user) {
            const { data } = await supabase.rpc('fantasy_rejoin_league', {
              p_display_name: stored.displayName,
              p_league_code:  LEAGUE_CODE,
            })
            if (!data?.error) {
              localStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored, userId: anon.user.id }))
              router.push(`/league/${LEAGUE_CODE}`)
              return
            }
          }
          setIdentifier(stored.displayName)
        }
        setChecking(false)
      } catch {
        setChecking(false)
      }
    }
    tryAutoLogin()
  }, [router])

  async function handleSubmit() {
    const id = identifier.trim()
    if (!id || !password) return
    if (password !== APP_PASSWORD) { setError('Mot de passe incorrect'); return }
    setLoading(true)
    setError('')
    try {
      if (id === ADMIN_EMAIL) {
        // Connexion admin
        let { error: signInErr } = await supabase.auth.signInWithPassword({
          email: ADMIN_EMAIL,
          password: ADMIN_PASS,
        })
        if (signInErr) {
          // Premier accès — créer le compte puis se connecter
          const { error: signUpErr } = await supabase.auth.signUp({
            email: ADMIN_EMAIL,
            password: ADMIN_PASS,
          })
          if (signUpErr) throw signUpErr
          const { error: retryErr } = await supabase.auth.signInWithPassword({
            email: ADMIN_EMAIL,
            password: ADMIN_PASS,
          })
          if (retryErr) throw retryErr
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          authenticated: true,
          isAdmin:       true,
          leagueCode:    LEAGUE_CODE,
        }))
        router.push(`/league/${LEAGUE_CODE}`)
      } else {
        // Connexion joueur anonyme
        const { data: anon, error: anonErr } = await supabase.auth.signInAnonymously()
        if (anonErr || !anon.user) throw new Error('Connexion anonyme échouée')

        const { data, error: rpcErr } = await supabase.rpc('fantasy_rejoin_league', {
          p_display_name: id,
          p_league_code:  LEAGUE_CODE,
        })
        if (rpcErr) throw rpcErr
        if (data?.error) throw new Error(data.error)

        localStorage.setItem(SESSION_KEY, JSON.stringify({
          authenticated: true,
          isAdmin:       false,
          userId:        anon.user.id,
          displayName:   id,
          leagueCode:    LEAGUE_CODE,
        }))
        router.push(`/league/${LEAGUE_CODE}`)
      }
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
        <div>
          <label className="text-xs text-white/50 mb-1.5 block">Ton identifiant</label>
          <input
            className="input"
            placeholder="Pseudo ou email"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
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
          disabled={loading || !identifier.trim() || !password}
          className="btn-primary w-full py-3 text-base"
        >
          {loading ? 'Connexion…' : 'Accéder au jeu →'}
        </button>
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
        )}
      </div>

      <p className="mt-6 text-white/20 text-xs">Ligue privée · 10 participants max</p>
    </main>
  )
}
