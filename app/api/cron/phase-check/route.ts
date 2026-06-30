import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Ligue gérée automatiquement
const LEAGUE_CODE = 'I8FDQU'

// Séquence officielle des phases (colonne phase de fantasy_leagues)
const PHASE_SEQUENCE = [
  'draft', 'poule', 'apres_poule', 'seizieme', 'apres_seizieme',
  'huitieme', 'apres_huitieme', 'quart', 'apres_quart',
  'demi', 'apres_demi', 'finale', 'termine',
] as const
type Phase = typeof PHASE_SEQUENCE[number]

// Phases de jeu (matchs en cours, marché fermé). Pour ces tours, la valeur
// correspond exactement à la colonne fantasy_matches.phase (mapping identité).
const GAME_PHASES = new Set<Phase>([
  'poule', 'seizieme', 'huitieme', 'quart', 'demi', 'finale',
])
// Phases de marché ouvert (transferts)
const MARKET_PHASES = new Set<Phase>([
  'apres_poule', 'apres_seizieme', 'apres_huitieme', 'apres_quart', 'apres_demi',
])

export const maxDuration = 30

export async function GET(request: Request) {
  // Sécurité : header secret partagé avec Vercel Cron (CRON_SECRET)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: league, error: lgErr } = await supabase
      .from('fantasy_leagues')
      .select('id, code, phase, market_open')
      .eq('code', LEAGUE_CODE)
      .single()

    if (lgErr || !league) {
      return NextResponse.json({ error: `Ligue ${LEAGUE_CODE} introuvable` }, { status: 404 })
    }

    const current = league.phase as Phase
    const idx = PHASE_SEQUENCE.indexOf(current)
    if (idx === -1 || idx >= PHASE_SEQUENCE.length - 1) {
      const msg = `[phase-check] phase ${current} : fin de séquence, aucune transition`
      console.log(msg)
      return NextResponse.json({ message: msg, phase: current, advanced: false })
    }
    const next = PHASE_SEQUENCE[idx + 1]

    // --- Cas 1 : phase de jeu terminée → ouvrir le marché ---
    // Avance vers apres_X (ou termine après la finale) dès que TOUS les matchs
    // du tour courant sont processed.
    if (GAME_PHASES.has(current)) {
      const { data: phaseMatches, error: mErr } = await supabase
        .from('fantasy_matches')
        .select('id, processed')
        .eq('phase', current)

      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

      const total = phaseMatches?.length ?? 0
      const remaining = (phaseMatches ?? []).filter(m => !m.processed).length

      if (total === 0) {
        const msg = `[phase-check] phase ${current} : aucun match en base, transition différée`
        console.log(msg)
        return NextResponse.json({ message: msg, phase: current, advanced: false })
      }
      if (remaining > 0) {
        const msg = `[phase-check] phase ${current} : ${remaining}/${total} matchs non traités, on attend`
        console.log(msg)
        return NextResponse.json({ message: msg, phase: current, advanced: false })
      }

      // Tous les matchs traités → on avance.
      // Le marché s'ouvre si la phase suivante est une phase de transfert ;
      // après la finale (next = termine) il reste fermé.
      const openMarket = MARKET_PHASES.has(next)
      const { error: upErr } = await supabase
        .from('fantasy_leagues')
        .update({ phase: next, market_open: openMarket, draft_open: false })
        .eq('id', league.id)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

      const msg = `[phase-check] ${current} → ${next} : ${total} matchs traités, market_open=${openMarket}`
      console.log(msg)
      return NextResponse.json({ message: msg, from: current, to: next, market_open: openMarket, advanced: true })
    }

    // --- Cas 2 : marché ouvert → début du tour suivant → fermer le marché ---
    // La phase de jeu suivante (next) a la même valeur dans fantasy_matches.phase.
    if (MARKET_PHASES.has(current)) {
      const { data: firstMatch, error: fmErr } = await supabase
        .from('fantasy_matches')
        .select('id, match_date')
        .eq('phase', next)
        .order('match_date', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (fmErr) return NextResponse.json({ error: fmErr.message }, { status: 500 })

      if (!firstMatch?.match_date) {
        const msg = `[phase-check] phase ${current} : aucun match programmé pour ${next}, on attend`
        console.log(msg)
        return NextResponse.json({ message: msg, phase: current, advanced: false })
      }

      // Comparaison en timestamps : match_date peut être stocké au format
      // ISO ("...T18:00:00.000Z") ou Postgres ("... 18:00:00+00").
      const kickoff = new Date(firstMatch.match_date).getTime()
      if (kickoff > Date.now()) {
        const msg = `[phase-check] phase ${current} : ${next} démarre le ${firstMatch.match_date}, marché maintenu ouvert`
        console.log(msg)
        return NextResponse.json({ message: msg, phase: current, advanced: false })
      }

      const { error: upErr } = await supabase
        .from('fantasy_leagues')
        .update({ phase: next, market_open: false, draft_open: false })
        .eq('id', league.id)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

      const msg = `[phase-check] ${current} → ${next} : 1er match a démarré (${firstMatch.match_date}), marché fermé`
      console.log(msg)
      return NextResponse.json({ message: msg, from: current, to: next, market_open: false, advanced: true })
    }

    // draft, termine, ou autre : pas de transition automatique
    const msg = `[phase-check] phase ${current} : pas de transition automatique gérée`
    console.log(msg)
    return NextResponse.json({ message: msg, phase: current, advanced: false })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
