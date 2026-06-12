import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  // Vérifier l'auth via Bearer token
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: { user } } = await anonClient.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // Récupérer la ligue
  const { data: league } = await supabaseAdmin
    .from('fantasy_leagues')
    .select('id')
    .eq('code', code)
    .single()
  if (!league) return NextResponse.json({ error: 'Ligue introuvable' }, { status: 404 })

  // Vérifier que l'utilisateur est participant
  const { data: participant } = await supabaseAdmin
    .from('fantasy_participants')
    .select('id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()
  if (!participant) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

  // Charger tous les transferts (service role bypasse le RLS)
  const { data: squads, error } = await supabaseAdmin
    .from('fantasy_squads')
    .select(`
      id, participant_id, bought_at_price, bought_at_phase,
      sold_at_price, sold_at_phase, sold_at, active, created_at,
      fantasy_players(id, name, position, team, photo_url)
    `)
    .eq('league_id', league.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ transfers: squads })
}
