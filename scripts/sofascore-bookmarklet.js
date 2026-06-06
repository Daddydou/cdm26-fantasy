/**
 * Bookmarklet SofaScore — Import notes CDM 2026
 * Usage : ouvrir sofascore.com dans Chrome → F12 → Console → coller ce script → Entrée
 *
 * Pour switcher en dev local, remplacer la première ligne par :
 *   const API = 'http://localhost:3000/api/admin/import-from-browser';
 */
(async () => {
  const API    = 'https://cdm26-fantasy.vercel.app/api/admin/import-from-browser';
  const CDM_ID = 16;

  // ── Date ──────────────────────────────────────────────────────────���──────
  const today = new Date().toISOString().slice(0, 10);
  const date  = prompt('Date des matchs (YYYY-MM-DD) :', today);
  if (!date) return;
  console.log('🔍 CDM – matchs du ' + date + '…');

  // ── 1. Matchs du jour ────────────────────────────────────────────────────
  const evRes = await fetch(
    'https://api.sofascore.com/api/v1/sport/football/scheduled-events/' + date
  );
  if (!evRes.ok) { alert('Erreur SofaScore events : HTTP ' + evRes.status); return; }
  const evData = await evRes.json();

  const cdmEvents = (evData.events || []).filter(
    function(e) { return e.tournament && e.tournament.uniqueTournament && e.tournament.uniqueTournament.id === CDM_ID; }
  );
  if (!cdmEvents.length) { alert('Aucun match CDM le ' + date + '.'); return; }
  console.log('✓ ' + cdmEvents.length + ' match(s) CDM trouvé(s)');

  // ── 2. Lineups par match ─────────────────────────────────────────────────
  const matches      = [];
  let   totalPlayers = 0;

  for (let i = 0; i < cdmEvents.length; i++) {
    const ev   = cdmEvents[i];
    const home = (ev.homeTeam && ev.homeTeam.name) || '?';
    const away = (ev.awayTeam && ev.awayTeam.name) || '?';
    console.log('  ⚽ ' + home + ' vs ' + away + ' (' + ev.id + ')');

    const linRes = await fetch(
      'https://api.sofascore.com/api/v1/event/' + ev.id + '/lineups'
    );
    if (!linRes.ok) { console.warn('  ⚠ Lineups HTTP ' + linRes.status); continue; }
    const lin = await linRes.json();

    const players = [];

    for (let s = 0; s < 2; s++) {
      const side     = s === 0 ? 'home' : 'away';
      const teamName = s === 0 ? home   : away;
      const list     = (lin[side + 'Team'] && lin[side + 'Team'].players)
                    || (lin[side]          && lin[side].players)
                    || [];
      for (let j = 0; j < list.length; j++) {
        const p = list[j];
        const r = p.statistics && p.statistics.rating;
        if (!r) continue;
        players.push({
          name:    (p.player && p.player.name) || '?',
          team:    teamName,
          rating:  parseFloat(r),
          goals:   (p.statistics && p.statistics.goals)         || 0,
          assists: (p.statistics && p.statistics.goalAssist)    || 0,
          minutes: (p.statistics && p.statistics.minutesPlayed) || 0,
        });
      }
    }

    console.log('    → ' + players.length + ' joueurs notés');
    totalPlayers += players.length;
    matches.push({
      sofaId:         ev.id,
      home:           home,
      away:           away,
      startTimestamp: ev.startTimestamp || null,
      players:        players,
    });

    if (i < cdmEvents.length - 1)
      await new Promise(function(r) { setTimeout(r, 300); });
  }

  if (!matches.length) { alert('Aucune lineup disponible pour cette date.'); return; }
  console.log('📤 Envoi : ' + matches.length + ' match(s), ' + totalPlayers + ' joueurs…');

  // ── 3. POST vers l'API ───────────────────────────────────────────────────
  const res = await fetch(API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ date: date, matches: matches }),
  });
  const result = await res.json();
  if (!res.ok) { alert('Erreur API ' + res.status + ' : ' + (result && result.error)); return; }

  const nonMatchedStr = (result.unmatched && result.unmatched.length)
    ? '\n\n⚠️ Non matchés (' + result.unmatched.length + ') :\n' + result.unmatched.join('\n')
    : '';
  alert('✅ Import terminé !\n\n' + result.imported + ' notes importées' + nonMatchedStr);
  console.log('✅ Résultat :', result);
})();
