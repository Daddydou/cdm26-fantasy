'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const SCRIPT_FLASHSCORE = `(function () {
  var API_FANTASY = 'https://cdm26-fantasy.vercel.app/api/admin/import-from-browser';
  var API_CDM26   = 'https://cdm26-iota.vercel.app/api/admin/import-ratings';

  function getTeam(side) {
    var sels = ['.duelParticipant__' + side + ' .participant__participantName', '.duelParticipant__' + side + ' .participant__overflow'];
    for (var i = 0; i < sels.length; i++) { var el = document.querySelector(sels[i]); if (el) { var t = (el.textContent || '').trim(); if (t.length > 1) return t; } }
    return null;
  }

  var home = getTeam('home'); var away = getTeam('away');
  if (!home || !away) { alert('Équipes non trouvées.\\nOuvrez : flashscore.fr/match/football/…/compos/'); return; }

  var today = new Date().toISOString().slice(0, 10);
  var date  = prompt('Date du match (YYYY-MM-DD) :', today);
  if (!date) return;
  console.log('[FS] ' + home + ' (dom.) vs ' + away + ' (ext.) — ' + date);

  var RATING_RE = /^[3-9]\\.[0-9]$|^10\\.0$/;
  var MINUTE_RE = /^(\\d{1,3})'$/;
  var players = []; var seenKeys = {};

  function isValidName(txt) {
    if (!txt || txt.length < 3 || txt.length > 50) return false;
    if (RATING_RE.test(txt)) return false;
    if (/^\\d+$/.test(txt)) return false; if (/^\\d+'?$/.test(txt)) return false;
    if (/^\\d+:\\d+$/.test(txt)) return false;
    return /[a-zA-Z]/.test(txt);
  }

  function processPlayerEl(el, teamName) {
    var rating = null; var rawTxt = '';
    var walker = document.createTreeWalker(el, 4, null, false); var tNode;
    while ((tNode = walker.nextNode())) { var txt = (tNode.nodeValue || '').trim(); if (RATING_RE.test(txt)) { rawTxt = txt; rating = parseFloat(txt); break; } }
    if (!rating) return;
    var name = null;
    var links = el.querySelectorAll('a');
    for (var li = 0; li < links.length; li++) { var lt = (links[li].textContent || '').trim(); if (isValidName(lt)) { name = lt; break; } }
    if (!name) { var named = el.querySelectorAll('[class*="Name"], [class*="name"]'); for (var ni = 0; ni < named.length; ni++) { var nt = (named[ni].textContent || '').trim(); if (isValidName(nt) && named[ni].querySelectorAll('*').length < 4) { name = nt; break; } } }
    if (!name) return;
    name = name.replace(/^\\d+/, '').trim(); if (!name) return;
    var subMin = 90; var allDesc = el.querySelectorAll('*');
    for (var di = 0; di < allDesc.length; di++) { var mt = (allDesc[di].textContent || '').trim(); if (MINUTE_RE.test(mt)) { subMin = 90 - parseInt(MINUTE_RE.exec(mt)[1], 10); break; } }
    var key = name.toLowerCase().replace(/\\s+/g, ' ').trim(); if (seenKeys[key]) return; seenKeys[key] = true;
    players.push({ name: name, team: teamName, rating: rating, goals: 0, assists: 0, minutes: (subMin > 0 && subMin <= 90) ? subMin : 90 });
  }

  var homeFormation = document.querySelector('[class*="lf__formation--extended"]');
  var awayFormation = document.querySelector('[class*="lf__formationAway"]');

  if (homeFormation) { var hs = homeFormation.querySelectorAll('[class*="lf__player"]'); console.log('[FS] Titulaires home : ' + hs.length); for (var hi = 0; hi < hs.length; hi++) processPlayerEl(hs[hi], home); } else { console.warn('[FS] Pas de formation home'); }
  if (awayFormation) { var as = awayFormation.querySelectorAll('[class*="lf__player"]'); console.log('[FS] Titulaires away : ' + as.length); for (var ai = 0; ai < as.length; ai++) processPlayerEl(as[ai], away); } else { console.warn('[FS] Pas de formation away'); }

  var participantEls = document.querySelectorAll('[class*="lf__participantNew"]');
  console.log('[FS] Remplaçants : ' + participantEls.length);
  for (var pi = 0; pi < participantEls.length; pi++) { var pel = participantEls[pi]; processPlayerEl(pel, pel.className.indexOf('lf__isReversed') !== -1 ? away : home); }

  if (!players.length) { alert('Aucun joueur avec note trouvé.\\n• Onglet "Compos" ouvert ?\\n• Match terminé ?'); return; }

  var homeP = players.filter(function (p) { return p.team === home; });
  var awayP = players.filter(function (p) { return p.team === away; });
  console.log('\\n[FS] ══ ' + home + ' — ' + homeP.length + ' joueurs ══');
  homeP.forEach(function (p) { console.log('  ' + p.name + ' ' + p.rating + " (" + p.minutes + "')"); });
  console.log('\\n[FS] ══ ' + away + ' — ' + awayP.length + ' joueurs ══');
  awayP.forEach(function (p) { console.log('  ' + p.name + ' ' + p.rating + " (" + p.minutes + "')"); });
  console.log('\\n[FS] Total: ' + players.length + ' joueurs');

  if (homeP.length === 0 || awayP.length === 0) {
    if (!confirm('⚠ Attribution suspecte : ' + homeP.length + ' × ' + home + ' / ' + awayP.length + ' × ' + away + '.\\nContinuer ?')) return;
  }

  var cleanPlayers = players.map(function (p) { return { name: p.name, team: p.team, rating: p.rating, goals: 0, assists: 0, minutes: p.minutes }; });
  var payload      = JSON.stringify({ date: date, matches: [{ sofaId: 0, home: home, away: away, players: cleanPlayers }] });
  var payloadCdm26 = JSON.stringify({ adminKey: 'CDM2026admin', date: date, matches: [{ sofaId: 0, home: home, away: away, players: cleanPlayers }] });
  var postFantasy  = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload };
  var postCdm26    = { method: 'POST', headers: { 'Content-Type': 'text/plain' },       body: payloadCdm26 };

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); }).catch(function (e) { return { ok: false, error: String(e) }; });
  }
  function fmtResult(label, r) {
    if (!r.ok) return '❌ ' + label + ' : HTTP ' + (r.status || '?') + ' ' + ((r.data && r.data.error) || r.error || '');
    if (r.data && r.data.error_type === 'sofascore_blocked') return '⚠ ' + label + ' : SofaScore bloqué côté serveur';
    var count = (r.data && (r.data.imported || r.data.matched)) || 0;
    var s = '✅ ' + label + ' : ' + count + ' notes importées';
    var nm = r.data && r.data.unmatched;
    if (nm && nm.length) s += '\\n  ⚠ Non matchés (' + nm.length + ') : ' + nm.slice(0, 5).join(', ');
    return s;
  }

  console.log('[FS] Envoi en cours...');
  Promise.all([fetchJson(API_FANTASY, postFantasy), fetchJson(API_CDM26, postCdm26)]).then(function (results) {
    alert(home + ' vs ' + away + ' — ' + players.length + ' joueurs\\n\\n' + fmtResult('Fantasy', results[0]) + '\\n\\n' + fmtResult('CDM26', results[1]));
    console.log('[FS] Fantasy :', results[0]); console.log('[FS] CDM26 :',   results[1]);
  });
}());`

const SCRIPT = `(async () => {
  const API    = 'https://cdm26-fantasy.vercel.app/api/admin/import-from-browser';
  // Dev local : const API = 'http://localhost:3000/api/admin/import-from-browser';
  const CDM_ID = 16;

  const today = new Date().toISOString().slice(0, 10);
  const date  = prompt('Date des matchs (YYYY-MM-DD) :', today);
  if (!date) return;
  console.log('[CDM] Matchs du ' + date + '...');

  const evRes = await fetch(
    'https://api.sofascore.com/api/v1/sport/football/scheduled-events/' + date
  );
  if (!evRes.ok) { alert('Erreur events HTTP ' + evRes.status); return; }
  const evData = await evRes.json();

  const cdmEvents = (evData.events || []).filter(
    function(e) {
      return e.tournament && e.tournament.uniqueTournament &&
             e.tournament.uniqueTournament.id === CDM_ID;
    }
  );
  if (!cdmEvents.length) { alert('Aucun match CDM le ' + date); return; }
  console.log('[CDM] ' + cdmEvents.length + ' match(s)');

  const matches = []; let total = 0;
  for (let i = 0; i < cdmEvents.length; i++) {
    const ev   = cdmEvents[i];
    const home = (ev.homeTeam && ev.homeTeam.name) || '?';
    const away = (ev.awayTeam && ev.awayTeam.name) || '?';
    console.log('  ' + home + ' vs ' + away);

    const linRes = await fetch(
      'https://api.sofascore.com/api/v1/event/' + ev.id + '/lineups'
    );
    if (!linRes.ok) { console.warn('  Lineups HTTP ' + linRes.status); continue; }
    const lin = await linRes.json();

    const players = [];
    for (let s = 0; s < 2; s++) {
      const side     = s === 0 ? 'home' : 'away';
      const teamName = s === 0 ? home   : away;
      const list = (lin[side + 'Team'] && lin[side + 'Team'].players)
                || (lin[side]          && lin[side].players) || [];
      for (let j = 0; j < list.length; j++) {
        const p = list[j];
        const r = p.statistics && p.statistics.rating;
        if (!r) continue;
        players.push({
          name:    (p.player && p.player.name) || '?', team: teamName,
          rating:  parseFloat(r),
          goals:   (p.statistics && p.statistics.goals)         || 0,
          assists: (p.statistics && p.statistics.goalAssist)    || 0,
          minutes: (p.statistics && p.statistics.minutesPlayed) || 0,
        });
      }
    }
    console.log('  -> ' + players.length + ' notes');
    total += players.length;
    matches.push({ sofaId: ev.id, home: home, away: away,
                   startTimestamp: ev.startTimestamp || null, players: players });
    if (i < cdmEvents.length - 1)
      await new Promise(function(r) { setTimeout(r, 300); });
  }

  if (!matches.length) { alert('Aucune lineup disponible.'); return; }
  console.log('[CDM] Envoi ' + matches.length + ' matchs, ' + total + ' joueurs...');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: date, matches: matches }),
  });
  const result = await res.json();
  if (!res.ok) { alert('Erreur API ' + res.status + ' : ' + (result && result.error)); return; }

  const nm = (result.unmatched && result.unmatched.length)
    ? '\\n\\n Non matches (' + result.unmatched.length + ') :\\n' + result.unmatched.join('\\n')
    : '';
  alert('Import OK ! ' + result.imported + ' notes importees' + nm);
  console.log('[CDM] Done :', result);
})();`

type RecentMatch = {
  id: string
  home_team: string
  away_team: string
  match_date: string
  scoreCount: number
}

export default function ImportSofascorePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copiedFS, setCopiedFS] = useState(false)
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: lg } = await supabase.from('fantasy_leagues').select().eq('code', code).single()
      if (!lg || lg.admin_user_id !== user.id) { router.push(`/league/${code}`); return }
      setChecking(false)

      // Charger les derniers imports
      const { data: matches } = await supabase
        .from('fantasy_matches')
        .select('id, home_team, away_team, match_date')
        .eq('processed', true)
        .order('match_date', { ascending: false })
        .limit(12)

      if (matches && matches.length > 0) {
        const ids = matches.map(m => m.id)
        const { data: scores } = await supabase
          .from('fantasy_scores')
          .select('match_id')
          .in('match_id', ids)

        const countMap: Record<string, number> = {}
        for (const s of (scores || [])) {
          countMap[s.match_id] = (countMap[s.match_id] || 0) + 1
        }

        setRecentMatches(matches.map(m => ({ ...m, scoreCount: countMap[m.id] || 0 })))
      }
      setLoadingRecent(false)
    }
    init()
  }, [code, router])

  async function copyScript() {
    await navigator.clipboard.writeText(SCRIPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyScriptFS() {
    await navigator.clipboard.writeText(SCRIPT_FLASHSCORE)
    setCopiedFS(true)
    setTimeout(() => setCopiedFS(false), 2000)
  }

  if (checking) return <Loading />

  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(`/league/${code}/admin`)} className="text-white/40 hover:text-white">←</button>
        <div>
          <h1 className="text-lg font-bold text-white">Import notes SofaScore</h1>
          <p className="text-xs text-white/40">Coupe du Monde 2026</p>
        </div>
      </div>

      {/* Instructions */}
      <div className="card p-4 mb-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Comment importer les notes</h2>
        <div className="space-y-4">
          <Step n={1} text="Ouvre sofascore.com dans Chrome" />
          <Step n={2} text="Appuie sur F12 → onglet Console" />

          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white mb-2">Copie le script et colle-le dans la console</p>
              <div className="relative">
                <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-white/50 font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
                  {SCRIPT.slice(0, 120)}…
                </pre>
                <button
                  onClick={copyScript}
                  className={`mt-2 w-full py-2 rounded-lg text-xs font-medium transition-all border ${
                    copied
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {copied ? '✓ Copié !' : '📋 Copier le script'}
                </button>
              </div>
            </div>
          </div>

          <Step n={4} text="Appuie sur Entrée pour lancer le script" />
          <Step n={5} text='Entre la date quand demandé (ex : 2026-06-11)' />
        </div>
      </div>

      {/* Instructions Flashscore */}
      <div className="card p-4 mb-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">Source alternative : Flashscore</h2>
        <p className="text-xs text-white/30 mb-4">Importe depuis la page Compos d&apos;un match Flashscore (Fantasy + CDM26 en parallèle)</p>
        <div className="space-y-4">
          <Step n={1} text="Ouvre le match sur flashscore.fr → onglet « Compos »" />
          <Step n={2} text="Appuie sur F12 → onglet Console" />

          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white mb-2">Copie le script Flashscore et colle-le dans la console</p>
              <div className="relative">
                <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-white/50 font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
                  {SCRIPT_FLASHSCORE.slice(0, 120)}…
                </pre>
                <button
                  onClick={copyScriptFS}
                  className={`mt-2 w-full py-2 rounded-lg text-xs font-medium transition-all border ${
                    copiedFS
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {copiedFS ? '✓ Copié !' : '📋 Copier le script Flashscore'}
                </button>
              </div>
            </div>
          </div>

          <Step n={4} text="Appuie sur Entrée — le script envoie vers Fantasy ET CDM26" />
          <Step n={5} text="Entre la date quand demandé puis confirme l'alerte de résultat" />
        </div>
      </div>

      {/* Derniers imports */}
      <div className="card">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Derniers imports</h2>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            ↻ Rafraîchir
          </button>
        </div>
        {loadingRecent ? (
          <div className="p-4 text-center text-xs text-white/30">Chargement…</div>
        ) : recentMatches.length === 0 ? (
          <div className="p-4 text-center text-xs text-white/30">Aucun import pour l&apos;instant</div>
        ) : (
          <div>
            {recentMatches.map(m => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{m.home_team} vs {m.away_team}</p>
                  <p className="text-xs text-white/30">
                    {new Date(m.match_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span className="text-xs text-brand-400 font-medium flex-shrink-0">
                  {m.scoreCount} notes
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <p className="text-sm text-white pt-0.5">{text}</p>
    </div>
  )
}

function Loading() {
  return <main className="min-h-screen flex items-center justify-center"><div className="text-white/40 text-sm">Chargement…</div></main>
}
