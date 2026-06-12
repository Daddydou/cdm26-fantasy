/**
 * Bookmarklet Flashscore → Import notes CDM 2026 (Fantasy + CDM26)
 *
 * Usage :
 *   1. Ouvrir flashscore.fr/match/football/…/compos/ (match terminé, notes visibles)
 *   2. F12 → onglet Console
 *   3. Coller ce script → Entrée
 *   4. Vérifier la liste affichée en console AVANT d'envoyer
 *
 * Stratégie d'attribution home/away :
 *   - Les noms des équipes sont lus depuis .duelParticipant__home/away (fiables)
 *   - Le split X est calculé depuis la position de ces deux éléments header
 *   - Pour chaque note trouvée, on compare son X au split → gauche = dom., droite = ext.
 *   - Les noms de joueurs sont trouvés via le pattern "ancêtre avec 1 seul <a>"
 *     (Flashscore lie TOUJOURS les noms de joueurs, jamais les notes ni positions)
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

  // ── 2. Split X depuis les headers .duelParticipant__home / __away ─────────────
  // Ces éléments sont TOUJOURS home=gauche / away=droite sur Flashscore.
  // Le split horizontal sépare fiablement les deux colonnes de compos.
  var homeHdr = document.querySelector('.duelParticipant__home');
  var awayHdr = document.querySelector('.duelParticipant__away');
  var splitX;
  if (homeHdr && awayHdr) {
    var hR = homeHdr.getBoundingClientRect();
    var aR = awayHdr.getBoundingClientRect();
    splitX = ((hR.left + hR.right) / 2 + (aR.left + aR.right) / 2) / 2;
    console.log('[FS] Headers trouvés — home X: ' + Math.round((hR.left + hR.right) / 2) +
                '  away X: ' + Math.round((aR.left + aR.right) / 2) +
                '  split: ' + Math.round(splitX));
  } else {
    splitX = document.documentElement.clientWidth / 2;
    console.warn('[FS] .duelParticipant non trouvés — split par défaut: ' + Math.round(splitX));
  }

  // ── 3. Extraction de tous les joueurs notés ───────────────────────────────────
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

  // Remonte depuis ratingEl jusqu'à trouver un ancêtre ayant exactement 1 lien <a>.
  // Flashscore lie TOUJOURS et UNIQUEMENT le nom du joueur dans la ligne joueur.
  // → ancêtre à 1 lien = la "ligne joueur" de ce joueur précis.
  function findRowByOneLink(ratingEl) {
    var el = ratingEl ? ratingEl.parentElement : null;
    for (var up = 0; up < 8 && el && el !== document.body; up++) {
      var links = el.querySelectorAll('a');
      if (links.length === 1) {
        var t = (links[0].textContent || '').trim();
        if (isValidName(t)) return { row: el, name: t };
      }
      el = el.parentElement;
    }
    return null;
  }

  // Plan B : cherche un élément "[class*=Name]" peu profond
  function findNameFallback(ratingEl) {
    var el = ratingEl ? ratingEl.parentElement : null;
    for (var up = 0; up < 6 && el && el !== document.body; up++) {
      var named = el.querySelectorAll('[class*="Name"], [class*="name"]');
      for (var i = 0; i < named.length; i++) {
        var t = (named[i].textContent || '').trim();
        if (isValidName(t) && named[i].querySelectorAll('*').length < 4) return t;
      }
      el = el.parentElement;
    }
    return null;
  }

  // TreeWalker sur TOUS les nœuds texte → cherche les patterns X.X (notes)
  var walker = document.createTreeWalker(
    document.body,
    4,      // NodeFilter.SHOW_TEXT
    null,
    false
  );

  var tNode;
  while ((tNode = walker.nextNode())) {
    var rawTxt = (tNode.nodeValue || '').trim();
    if (!RATING_RE.test(rawTxt)) continue;

    var ratingEl = tNode.parentElement;
    if (!ratingEl) continue;

    // Ignorer les éléments invisibles
    var rRect = ratingEl.getBoundingClientRect();
    if (rRect.width === 0 && rRect.height === 0) continue;

    // Trouver la ligne joueur via le pattern "1 seul lien dans l'ancêtre"
    var found = findRowByOneLink(ratingEl);
    var name  = found ? found.name : findNameFallback(ratingEl);
    if (!name) continue;

    // Minutes jouées (remplaçants)
    var subMin = 90;
    var row    = found ? found.row : ratingEl.parentElement;
    if (row) {
      var desc = row.querySelectorAll('*');
      for (var di = 0; di < desc.length; di++) {
        var mt = (desc[di].textContent || '').trim();
        if (MINUTE_RE.test(mt)) {
          subMin = 90 - parseInt(MINUTE_RE.exec(mt)[1], 10);
          break;
        }
      }
    }

    // Attribution de l'équipe : position X de l'élément note vs split X
    var elX  = (rRect.left + rRect.right) / 2;
    var team = elX < splitX ? home : away;

    // Déduplication
    var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenKeys[key]) continue;
    seenKeys[key] = true;

    players.push({
      name:    name,
      team:    team,
      rating:  parseFloat(rawTxt),
      goals:   0,
      assists: 0,
      minutes: (subMin > 0 && subMin <= 90) ? subMin : 90,
      _x:      Math.round(elX)
    });
  }

  // ── 4. Log complet pour vérification AVANT envoi ──────────────────────────────
  if (!players.length) {
    alert('Aucun joueur avec note trouvé.\n• Onglet "Compos" ouvert ?\n• Match terminé (notes visibles) ?');
    return;
  }

  var homeP = players.filter(function (p) { return p.team === home; });
  var awayP = players.filter(function (p) { return p.team === away; });

  console.log('\n[FS] ══════ ' + home + ' — ' + homeP.length + ' joueurs ══════');
  homeP.forEach(function (p) {
    console.log('  ' + p.name + ' ' + p.rating + '  (' + p.minutes + "')" + '  x=' + p._x);
  });
  console.log('\n[FS] ══════ ' + away + ' — ' + awayP.length + ' joueurs ══════');
  awayP.forEach(function (p) {
    console.log('  ' + p.name + ' ' + p.rating + '  (' + p.minutes + "')" + '  x=' + p._x);
  });
  console.log('\n[FS] Total: ' + players.length + ' joueurs | splitX=' + Math.round(splitX) + 'px');

  // Avertissement si déséquilibre suspect
  if (homeP.length === 0 || awayP.length === 0) {
    var msg = '⚠ Attribution suspecte : ' + homeP.length + ' × ' + home +
              ' / ' + awayP.length + ' × ' + away +
              '\n\nVérifiez la console (colonne x= vs split ' + Math.round(splitX) + 'px).' +
              '\n\nContinuer quand même ?';
    if (!confirm(msg)) return;
  }

  // ── 5. Test preflight OPTIONS sur CDM26 (debug CORS) ─────────────────────────
  fetch(API_CDM26, { method: 'OPTIONS' })
    .then(function (r) {
      console.log('[FS] CDM26 OPTIONS preflight → ' + r.status +
                  '  ACAO: ' + r.headers.get('Access-Control-Allow-Origin'));
    })
    .catch(function (e) {
      console.warn('[FS] CDM26 OPTIONS échoué :', e.message);
    });

  // ── 6. Envoi vers les deux APIs en parallèle ──────────────────────────────────
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
