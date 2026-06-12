/**
 * Bookmarklet Flashscore → Import notes CDM 2026 (Fantasy + CDM26)
 *
 * Usage :
 *   1. Ouvrir flashscore.fr/match/football/…/compos/ (match terminé, notes visibles)
 *   2. F12 → onglet Console
 *   3. Coller ce script → Entrée
 *   4. Vérifier la liste affichée en console AVANT d'envoyer
 *
 * Attribution home/away :
 *   Chaque joueur est dans un élément [class*="lf__participantNew"].
 *   La présence de "lf__isReversed" dans la classe indique l'équipe extérieure.
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

  // ── 2. Extraction des joueurs via lf__participantNew / lf__isReversed ─────────
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

  var participantEls = document.querySelectorAll('[class*="lf__participantNew"]');
  console.log('[FS] ' + participantEls.length + ' éléments lf__participantNew trouvés');

  for (var i = 0; i < participantEls.length; i++) {
    var el       = participantEls[i];
    var isAway   = el.className.indexOf('lf__isReversed') !== -1;
    var teamName = isAway ? away : home;

    // Note : TreeWalker sur les nœuds texte de l'élément
    var rating = null;
    var rawTxt = '';
    var walker = document.createTreeWalker(el, 4, null, false);
    var tNode;
    while ((tNode = walker.nextNode())) {
      var txt = (tNode.nodeValue || '').trim();
      if (RATING_RE.test(txt)) { rawTxt = txt; rating = parseFloat(txt); break; }
    }
    if (!rating) continue;

    // Nom : d'abord le seul lien dans l'élément, sinon [class*="name"]
    var name = null;
    var links = el.querySelectorAll('a');
    if (links.length >= 1) {
      for (var li = 0; li < links.length; li++) {
        var lt = (links[li].textContent || '').trim();
        if (isValidName(lt)) { name = lt; break; }
      }
    }
    if (!name) {
      var named = el.querySelectorAll('[class*="Name"], [class*="name"]');
      for (var ni = 0; ni < named.length; ni++) {
        var nt = (named[ni].textContent || '').trim();
        if (isValidName(nt) && named[ni].querySelectorAll('*').length < 4) { name = nt; break; }
      }
    }
    if (!name) continue;

    // Minutes jouées (remplaçants sortis)
    var subMin  = 90;
    var allDesc = el.querySelectorAll('*');
    for (var di = 0; di < allDesc.length; di++) {
      var mt = (allDesc[di].textContent || '').trim();
      if (MINUTE_RE.test(mt)) { subMin = 90 - parseInt(MINUTE_RE.exec(mt)[1], 10); break; }
    }

    var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenKeys[key]) continue;
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

  // ── 4. Test preflight OPTIONS sur CDM26 ──────────────────────────────────────
  fetch(API_CDM26, { method: 'OPTIONS' })
    .then(function (r) {
      console.log('[FS] CDM26 OPTIONS → ' + r.status +
                  '  ACAO: ' + r.headers.get('Access-Control-Allow-Origin'));
    })
    .catch(function (e) { console.warn('[FS] CDM26 OPTIONS échoué :', e.message); });

  // ── 5. Envoi vers les deux APIs en parallèle ──────────────────────────────────
  var cleanPlayers = players.map(function (p) {
    return { name: p.name, team: p.team, rating: p.rating, goals: 0, assists: 0, minutes: p.minutes };
  });

  var payload  = JSON.stringify({
    date: date,
    matches: [{ sofaId: 0, home: home, away: away, players: cleanPlayers }]
  });
  var postOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload };

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
  Promise.all([fetchJson(API_FANTASY, postOpts), fetchJson(API_CDM26, postOpts)])
    .then(function (results) {
      alert(home + ' vs ' + away + ' — ' + players.length + ' joueurs\n\n' +
            fmtResult('Fantasy', results[0]) + '\n\n' +
            fmtResult('CDM26',   results[1]));
      console.log('[FS] Fantasy :', results[0]);
      console.log('[FS] CDM26 :',   results[1]);
    });

}());
