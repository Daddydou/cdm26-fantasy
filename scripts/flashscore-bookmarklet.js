/**
 * Bookmarklet Flashscore → Import notes CDM 2026 (Fantasy + CDM26)
 *
 * Usage :
 *   1. Ouvrir flashscore.fr/match/football/…/compos/ (match terminé, notes visibles)
 *   2. F12 → onglet Console
 *   3. Coller ce script → Entrée
 *   4. Vérifier la liste affichée en console AVANT d'envoyer
 *
 * Sources :
 *   - Titulaires  : lf__formation (home) / lf__formationAway (away) → lf__player
 *   - Remplaçants : lf__participantNew, lf__isReversed = away
 */
(function () {

  var API_FANTASY = 'https://cdm26-fantasy.vercel.app/api/admin/import-from-browser';
  var API_CDM26   = 'https://cdm26-iota.vercel.app/api/admin/import-ratings';

  // ── 1. Équipes depuis le header du match ─────────────────────────────────────
  function getTeam(side) {
    var sels = [
      '.duelParticipant__' + side + ' .participant__participantName',
      '.duelParticipant__' + side + ' .participant__overflow',
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) { var t = (el.textContent || '').trim(); if (t.length > 1) return t; }
    }
    return null;
  }

  var home = getTeam('home');
  var away = getTeam('away');
  if (!home || !away) {
    alert('Équipes non trouvées.\nOuvrez : flashscore.fr/match/football/…/compos/');
    return;
  }

  var today = new Date().toISOString().slice(0, 10);
  var date  = prompt('Date du match (YYYY-MM-DD) :', today);
  if (!date) return;

  console.log('[FS] ' + home + ' (dom.) vs ' + away + ' (ext.) — ' + date);

  // ── 2. Extraction ─────────────────────────────────────────────────────────────
  var RATING_RE = /^[3-9]\.[0-9]$|^10\.0$/;
  var MINUTE_RE = /^(\d{1,3})'$/;
  var players   = [];
  var seenKeys  = {};

  function isValidName(txt) {
    if (!txt || txt.length < 3 || txt.length > 50) return false;
    if (RATING_RE.test(txt)) return false;
    if (/^\d+$/.test(txt)) return false;
    if (/^\d+'?$/.test(txt)) return false;
    if (/^\d+:\d+$/.test(txt)) return false;
    return /[a-zA-Z]/.test(txt);
  }

  function processPlayerEl(el, teamName) {
    // Note
    var rating = null;
    var rawTxt = '';
    var walker = document.createTreeWalker(el, 4, null, false);
    var tNode;
    while ((tNode = walker.nextNode())) {
      var txt = (tNode.nodeValue || '').trim();
      if (RATING_RE.test(txt)) { rawTxt = txt; rating = parseFloat(txt); break; }
    }
    if (!rating) return;

    // Nom : premier lien valide, sinon [class*="name"]
    var name = null;
    var links = el.querySelectorAll('a');
    for (var li = 0; li < links.length; li++) {
      var lt = (links[li].textContent || '').trim();
      if (isValidName(lt)) { name = lt; break; }
    }
    if (!name) {
      var named = el.querySelectorAll('[class*="Name"], [class*="name"]');
      for (var ni = 0; ni < named.length; ni++) {
        var nt = (named[ni].textContent || '').trim();
        if (isValidName(nt) && named[ni].querySelectorAll('*').length < 4) { name = nt; break; }
      }
    }
    if (!name) return;

    // Minutes jouées (remplaçants sortis)
    var subMin  = 90;
    var allDesc = el.querySelectorAll('*');
    for (var di = 0; di < allDesc.length; di++) {
      var mt = (allDesc[di].textContent || '').trim();
      if (MINUTE_RE.test(mt)) { subMin = 90 - parseInt(MINUTE_RE.exec(mt)[1], 10); break; }
    }

    var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenKeys[key]) return;
    seenKeys[key] = true;

    players.push({
      name:    name,
      team:    teamName,
      rating:  rating,
      goals:   0,
      assists: 0,
      minutes: (subMin > 0 && subMin <= 90) ? subMin : 90,
    });
  }

  // ── 2a. Titulaires — lf__formation (home) / lf__formationAway (away) ──────────
  var homeFormation = document.querySelector('[class*="lf__formation--extended"]');
  var awayFormation = document.querySelector('[class*="lf__formationAway"]');

  if (homeFormation) {
    var homeStarters = homeFormation.querySelectorAll('[class*="lf__player"]');
    console.log('[FS] Titulaires home : ' + homeStarters.length + ' éléments lf__player');
    for (var hs = 0; hs < homeStarters.length; hs++) {
      processPlayerEl(homeStarters[hs], home);
    }
  } else {
    console.warn('[FS] Aucune formation home trouvée');
  }

  if (awayFormation) {
    var awayStarters = awayFormation.querySelectorAll('[class*="lf__player"]');
    console.log('[FS] Titulaires away : ' + awayStarters.length + ' éléments lf__player');
    for (var as = 0; as < awayStarters.length; as++) {
      processPlayerEl(awayStarters[as], away);
    }
  } else {
    console.warn('[FS] Aucune formation away trouvée');
  }

  // ── 2b. Remplaçants — lf__participantNew, lf__isReversed = away ───────────────
  var participantEls = document.querySelectorAll('[class*="lf__participantNew"]');
  console.log('[FS] Remplaçants : ' + participantEls.length + ' éléments lf__participantNew');
  for (var pi = 0; pi < participantEls.length; pi++) {
    var pel      = participantEls[pi];
    var pelTeam  = pel.className.indexOf('lf__isReversed') !== -1 ? away : home;
    processPlayerEl(pel, pelTeam);
  }

  // ── 3. Log complet pour vérification AVANT envoi ──────────────────────────────
  if (!players.length) {
    alert('Aucun joueur avec note trouvé.\n• Onglet "Compos" ouvert ?\n• Match terminé (notes visibles) ?');
    return;
  }

  var homeP = players.filter(function (p) { return p.team === home; });
  var awayP = players.filter(function (p) { return p.team === away; });

  console.log('\n[FS] ══════ ' + home + ' — ' + homeP.length + ' joueurs ══════');
  homeP.forEach(function (p) {
    console.log('  ' + p.name + ' ' + p.rating + "  (" + p.minutes + "')");
  });
  console.log('\n[FS] ══════ ' + away + ' — ' + awayP.length + ' joueurs ══════');
  awayP.forEach(function (p) {
    console.log('  ' + p.name + ' ' + p.rating + "  (" + p.minutes + "')");
  });
  console.log('\n[FS] Total: ' + players.length + ' joueurs');

  if (homeP.length === 0 || awayP.length === 0) {
    var msg = '⚠ Attribution suspecte : ' + homeP.length + ' × ' + home +
              ' / ' + awayP.length + ' × ' + away +
              '\n\nContinuer quand même ?';
    if (!confirm(msg)) return;
  }

  // ── 4. Envoi vers les deux APIs en parallèle ─────────────────────────────────
  var cleanPlayers = players.map(function (p) {
    return { name: p.name, team: p.team, rating: p.rating, goals: 0, assists: 0, minutes: p.minutes };
  });

  var payload  = JSON.stringify({
    date: date,
    matches: [{ sofaId: 0, home: home, away: away, players: cleanPlayers }]
  });
  // Fantasy : application/json (CORS autorisé)
  // CDM26   : text/plain pour éviter le preflight OPTIONS (simple request)
  var postFantasy = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload };
  var postCdm26   = { method: 'POST', headers: { 'Content-Type': 'text/plain' },       body: payload };

  function fetchJson(url, opts) {
    return fetch(url, opts)
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      })
      .catch(function (e) { return { ok: false, error: String(e) }; });
  }

  function fmtResult(label, r) {
    if (!r.ok) {
      return '❌ ' + label + ' : HTTP ' + (r.status || '?') + ' ' +
             ((r.data && r.data.error) || r.error || '');
    }
    if (r.data && r.data.error_type === 'sofascore_blocked') {
      return '⚠ ' + label + ' : SofaScore bloqué côté serveur';
    }
    var count = (r.data && (r.data.imported || r.data.matched)) || 0;
    var s = '✅ ' + label + ' : ' + count + ' notes importées';
    var nm = r.data && r.data.unmatched;
    if (nm && nm.length) {
      s += '\n  ⚠ Non matchés (' + nm.length + ') : ' + nm.slice(0, 5).join(', ');
    }
    return s;
  }

  console.log('[FS] Envoi en cours...');
  Promise.all([fetchJson(API_FANTASY, postFantasy), fetchJson(API_CDM26, postCdm26)])
    .then(function (results) {
      alert(home + ' vs ' + away + ' — ' + players.length + ' joueurs\n\n' +
            fmtResult('Fantasy', results[0]) + '\n\n' +
            fmtResult('CDM26',   results[1]));
      console.log('[FS] Fantasy :', results[0]);
      console.log('[FS] CDM26 :',   results[1]);
    });

}());
