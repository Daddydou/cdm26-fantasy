'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { League, Participant, Standing } from '@/lib/database.types'
import { PHASE_LABELS } from '@/lib/pricing'

type RecentScore = { player_id: string; player_name: string; team: string; rating: number; match_date: string; participant_name: string }

export default function LeaguePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [me, setMe] = useState<Participant | null>(null)
  const [standings, setStandings] = useState<Standing[]>([])
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [recentScores, setRecentScores] = useState<RecentScore[]>([])
  const [squadPlayerIds, setSquadPlayerIds] = useState<Record<string, string[]>>({})
  const [selectedParticipant, setSelectedParticipant] = useState('all')

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

      const [{ data: st }, { data: allSquads }, { data: processedMatches }] = await Promise.all([
        supabase.from('fantasy_standings').select().eq('league_id', lg.id).order('total_points', { ascending: false }),
        supabase.from('fantasy_squad_detail').select('participant_id, team, player_id, player_name').eq('league_id', lg.id).eq('active', true),
        supabase.from('fantasy_matches').select('id, match_date, home_team, away_team').eq('processed', true).order('match_date', { ascending: false }),
      ])

      setStandings(st || [])

      const teamsByParticipant: Record<string, Set<string>> = {}
      for (const s of allSquads || []) {
        if (!teamsByParticipant[s.participant_id]) teamsByParticipant[s.participant_id] = new Set()
        teamsByParticipant[s.participant_id].add(s.team)
      }
      const counts: Record<string, number> = {}
      for (const [pid, teams] of Object.entries(teamsByParticipant)) {
        counts[pid] = (processedMatches || []).filter(m => teams.has(m.home_team) || teams.has(m.away_team)).length
      }
      setMatchCounts(counts)

      // Build lookup maps for recent results section
      const playerInfoMap: Record<string, { player_name: string; team: string }> = {}
      const squadByP: Record<string, string[]> = {}
      const playerToParticipants: Record<string, string[]> = {}
      const participantNameMap: Record<string, string> = {}
      const teamToPlayerIds: Record<string, string[]> = {}

      for (const s of allSquads || []) {
        const sq = s as { participant_id: string; team: string; player_id: string; player_name: string }
        if (sq.player_id) {
          playerInfoMap[sq.player_id] = { player_name: sq.player_name, team: sq.team }
          if (!playerToParticipants[sq.player_id]) playerToParticipants[sq.player_id] = []
          if (!playerToParticipants[sq.player_id].includes(sq.participant_id))
            playerToParticipants[sq.player_id].push(sq.participant_id)
          if (!squadByP[sq.participant_id]) squadByP[sq.participant_id] = []
          if (!squadByP[sq.participant_id].includes(sq.player_id))
            squadByP[sq.participant_id].push(sq.player_id)
          if (!teamToPlayerIds[sq.team]) teamToPlayerIds[sq.team] = []
          if (!teamToPlayerIds[sq.team].includes(sq.player_id)) teamToPlayerIds[sq.team].push(sq.player_id)
        }
      }
      for (const s of st || []) {
        participantNameMap[s.participant_id] = s.display_name
      }

      setSquadPlayerIds(squadByP)

      const allPlayerIds = Object.keys(playerInfoMap)
      if (allPlayerIds.length > 0) {
        // 1. Vraies notes depuis fantasy_scores, triées par date desc
        const { data: scores } = await supabase
          .from('fantasy_scores')
          .select('player_id, rating, match_date')
          .in('player_id', allPlayerIds)
          .not('rating', 'is', null)
          .order('match_date', { ascending: false })
          .order('rating', { ascending: false })
          .limit(100)

        const ownerNames = (pid: string) =>
          (playerToParticipants[pid] ?? []).map(id => participantNameMap[id] ?? '').filter(Boolean).join(', ')

        const realEntries: RecentScore[] = (scores ?? []).map(sc => ({
          player_id: sc.player_id,
          player_name: playerInfoMap[sc.player_id]?.player_name ?? '',
          team: playerInfoMap[sc.player_id]?.team ?? '',
          rating: sc.rating as number,
          match_date: sc.match_date ?? '',
          participant_name: ownerNames(sc.player_id),
        }))

        // 2. Set des joueurs déjà notés : player_id + YYYY-MM-DD (côté scores)
        //    On marque aussi le jour d'avant pour absorber le décalage UTC/heure locale
        const scoredSet = new Set<string>()
        for (const sc of scores ?? []) {
          if (!sc.match_date) continue
          const d = sc.match_date.split('T')[0]
          scoredSet.add(`${sc.player_id}_${d}`)
          const prev = new Date(new Date(d + 'T12:00:00Z').getTime() - 864e5).toISOString().split('T')[0]
          scoredSet.add(`${sc.player_id}_${prev}`)
        }

        // 3. Entrées à 0 : joueurs pickés dont l'équipe a joué mais sans note
        type PMatch = { id: string; match_date: string; home_team: string; away_team: string }
        const zeroEntries: RecentScore[] = []
        for (const match of (processedMatches || []) as PMatch[]) {
          const datePrefix = match.match_date?.split('T')[0] ?? ''
          for (const team of [match.home_team, match.away_team]) {
            for (const pid of teamToPlayerIds[team] ?? []) {
              if (!scoredSet.has(`${pid}_${datePrefix}`)) {
                zeroEntries.push({
                  player_id: pid,
                  player_name: playerInfoMap[pid]?.player_name ?? '',
                  team: playerInfoMap[pid]?.team ?? team,
                  rating: 0,
                  match_date: match.match_date,
                  participant_name: ownerNames(pid),
                })
              }
            }
          }
        }

        // 4. Fusion, déduplification par player_id + YYYY-MM-DD (les vraies notes en premier)
        const combined = [...realEntries, ...zeroEntries]
        combined.sort((a, b) => b.match_date.localeCompare(a.match_date))
        const seen = new Set<string>()
        const deduped = combined.filter(e => {
          const key = `${e.player_id}_${(e.match_date || '').split('T')[0]}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setRecentScores(deduped.slice(0, 200))
      }

      setLoading(false)
    }
    load()
  }, [code, router])

  if (loading) return <Loading />
  if (!league || !me) return null

  const phaseLabel = PHASE_LABELS[league.phase] || league.phase
  const marketIsOpen = league.market_open || league.draft_open

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto overflow-x-hidden">
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

      {/* Mini classement */}
      {standings.length > 0 && (
        <div className="card mb-6">
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
                <div className="text-right flex-shrink-0">
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-white">{Number(s.total_points).toFixed(1)}</span>
                    <span className="text-xs text-white/30">pts</span>
                  </div>
                  <p className="text-xs text-white/30">
                    {matchCounts[s.participant_id] ?? 0} match{(matchCounts[s.participant_id] ?? 0) > 1 ? 's' : ''}
                  </p>
                </div>
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

      {/* Derniers résultats */}
      {recentScores.length > 0 && (
        <div className="card mb-6">
          <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Derniers résultats</h2>
            <select
              value={selectedParticipant}
              onChange={e => setSelectedParticipant(e.target.value)}
              className="text-xs text-white border border-white/10 rounded px-2 py-1 focus:outline-none"
              style={{ backgroundColor: '#1e1e2e' }}
            >
              <option value="all" style={{ backgroundColor: '#1e1e2e', color: 'white' }}>Tous</option>
              {standings.map(s => (
                <option key={s.participant_id} value={s.participant_id} style={{ backgroundColor: '#1e1e2e', color: 'white' }}>{s.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            {(selectedParticipant === 'all'
              ? recentScores.slice(0, 10)
              : recentScores.filter(s => (squadPlayerIds[selectedParticipant] ?? []).includes(s.player_id)).slice(0, 10)
            ).map((s, i) => (
              <div key={`${s.player_id}-${s.match_date}-${i}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{s.player_name}</p>
                  <p className="text-xs text-white/40">{s.team} · <span className="text-brand-400/70">{s.participant_name}</span></p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${s.rating >= 7 ? 'text-green-400' : s.rating >= 6 ? 'text-orange-400' : 'text-red-400'}`}>
                    {s.rating.toFixed(1)} pts
                  </p>
                  <p className="text-xs text-white/40">
                    {new Date(s.match_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link
          href={`/league/${code}/squad`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">👥</div>
          <p className="text-sm font-medium text-white">Équipes</p>
          <p className="text-xs text-white/40 mt-0.5">Voir les équipes</p>
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
          <div className="text-2xl mb-1">📅</div>
          <p className="text-sm font-medium text-white">Par journée</p>
          <p className="text-xs text-white/40 mt-0.5">Points par journée</p>
        </Link>

        <Link
          href={`/league/${code}/history`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">📋</div>
          <p className="text-sm font-medium text-white">Transferts</p>
          <p className="text-xs text-white/40 mt-0.5">Historique des achats</p>
        </Link>

        <Link
          href={`/league/${code}/predictions`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">🔮</div>
          <p className="text-sm font-medium text-white">Prédictions</p>
          <p className="text-xs text-white/40 mt-0.5">Projection fin de tournoi</p>
        </Link>

        <Link
          href={`/league/${code}/stats`}
          className="card p-4 hover:bg-white/10 transition-all text-center"
        >
          <div className="text-2xl mb-1">📊</div>
          <p className="text-sm font-medium text-white">Stats</p>
          <p className="text-xs text-white/40 mt-0.5">Évolution des points</p>
        </Link>
      </div>

      {/* Actions compte */}
      <div className="flex justify-center gap-4 mb-6">
        <button
          onClick={() => { localStorage.removeItem('cdm26_league'); router.push('/') }}
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          ⇄ Changer de ligue
        </button>
        <button
          onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
          className="text-xs text-white/20 hover:text-red-400 transition-colors"
        >
          ↩ Quitter
        </button>
      </div>

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
