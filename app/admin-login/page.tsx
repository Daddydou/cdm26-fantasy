'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const ADMIN_EMAIL = 'lolo.rms@gmail.com'

export default function AdminLoginPage() {
  const router = useRouter()
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function sendLink() {
    setLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: ADMIN_EMAIL,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <button onClick={() => router.push('/')} className="text-white/40 text-sm hover:text-white mb-4">
          ← Retour
        </button>
        <h1 className="text-lg font-bold text-white mb-4">Accès Admin</h1>
        {sent ? (
          <div className="text-center space-y-3">
            <div className="text-4xl">📬</div>
            <p className="text-sm text-white/70">
              Lien envoyé à<br />
              <span className="text-white font-medium">{ADMIN_EMAIL}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-white/40">Connexion réservée à l'administrateur.</p>
            <button onClick={sendLink} disabled={loading} className="btn-primary w-full py-3">
              {loading ? 'Envoi…' : `Envoyer le lien à ${ADMIN_EMAIL}`}
            </button>
            {error && <p className="text-red-400 text-xs">{error}</p>}
          </div>
        )}
      </div>
    </main>
  )
}
