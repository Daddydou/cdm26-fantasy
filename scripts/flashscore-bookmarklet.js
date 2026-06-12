/**
 * Bookmarklet Flashscore → Import notes CDM 2026 (Fantasy + CDM26)
 *
 * Usage :
 *   1. Ouvrir flashscore.fr/match/football/…/compos/
 *   2. F12 → onglet Console
 *   3. Coller ce script → Entrée
 */
(function () {

  var API_FANTASY = 'https://cdm26-fantasy.vercel.app/api/admin/import-from-browser';
  var API_CDM26   = 'https://cdm26-iota.vercel.app/api/admin/import-ratings';

  // ── 1. Équipes ─────────────────────────────────────────────────────────────
  function getTeamName(side) {
    var sels = [
      '.duelParticipant__' + side + ' .participant__participantName',
      '.duelParticipant__' + side + ' .participant__overflow',
      '.duelParticipant__' + side + ' a[href]'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var t = (el.textContent || '').trim();
        if (t.length > 1) return t;
      }
    }
    return '';
  }

  var home = getTeamName('home');
  var away = getTeamName('away');
  if (!home || !away) {
    alert('Équipes introuvables.\nOuvrez : flashscore.fr/match/football/…/compos/');
    return;
  }

  var today = new Date().toISOString().slice(0, 10);
  var date  = prompt('Date du match (YYYY-MM-DD) :', today);
  if (!date) return;

  console.log('[FS] ' + home + ' vs ' + away + ' — ' + date);

  // ── 2. Extraction joueurs + notes ──────────────────────────────────────────
  var players  = [];
  var seen     = {};
  var ratingRe = /^([3-9]\.[0-9]|10\.0)$/;
  var minuteRe = /^(\d{1,3})'$/;

  function addPlayer(name, team, ratingStr, minutes) {
    name = (name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2 || seen[name]) return;
    var r = parseFloat(ratingStr);
    if (isNaN(r) || r < 3 || r > 10) return;
    seen[name] = true;
    players.push({
      name: name, team: team, rating: r, goals: 0, assists: 0,
      minutes: (minutes > 0 && minutes <= 120) ? minutes : 90
    });
  }

  function parseSubMinutes(txt) {
    var m = minuteRe.exec(txt);
    return m ? (90 - parseInt(m[1], 10)) : 90;
  }

  // Stratégie 1 : conteneurs .lf--1 (home) et .lf--2 (away)
  function scanSide(containerSel, teamName) {
    var container = document.querySelector(containerSel);
    if (!container) return false;
    var playerEls = container.querySelectorAll(
      '[class*="lf__player"], [class*="lineup__player"], [class*="wl__player"]'
    );
    if (!playerEls.length) return false;

    playerEls.forEach(function (playerEl) {
      var nameEl = playerEl.querySelector(
        '[class*="playerName"], [class*="player__name"], [class*="wl__name"]'
      );
      var name       = nameEl ? nameEl.textContent.trim() : null;
      var ratingStr  = null;
      var subMinutes = 90;

      var desc = playerEl.querySelectorAll('*');
      for (var i = 0; i < desc.length; i++) {
        var txt = (desc[i].textContent || '').trim();
        if (ratingRe.test(txt)) ratingStr  = txt;
        if (minuteRe.test(txt)) subMinutes = parseSubMinutes(txt);
      }

      if (name && ratingStr) addPlayer(name, teamName, ratingStr, subMinutes);
    });
    return players.length > 0;
  }

  scanSide('.lf--1', home);
  scanSide('.lf--2', away);

  // Stratégie 2 : TreeWalker générique si stratégie 1 a échoué
  if (!players.length) {
    var midX   = document.documentElement.scrollWidth / 2;
    var walker = document.createTreeWalker(document.body, 1 /* SHOW_ELEMENT */, null, false);
    var el;
    while ((el = walker.nextNode())) {
      if (el.querySelectorAll('*').length > 4) continue;
      var directText = '';
      var cn = el.childNodes;
      for (var ci = 0; ci < cn.length; ci++) {
        if (cn[ci].nodeType === 3) directText += cn[ci].textContent;
      }
      directText = directText.trim();
      if (!ratingRe.test(directText)) continue;

      var ratingStr = directText;
      var name      = null;
      var ancestor  = el.parentElement;
      for (var up = 0; up < 7 && ancestor; up++) {
        var nameEl2 = ancestor.querySelector('[class*="name"], [class*="Name"]');
        if (nameEl2) {
          var cand = (nameEl2.textContent || '').trim();
          if (cand.length > 2 && !ratingRe.test(cand)) { name = cand; break; }
        }
        ancestor = ancestor.parentElement;
      }
      if (!name) continue;

      var rect    = el.getBoundingClientRect();
      var centerX = (rect.left + rect.right) / 2;
      addPlayer(name, centerX < midX ? home : away, ratingStr, 90);
    }
  }

  if (!players.length) {
    alert('Aucun joueur avec note trouvé.\n• Onglet "Compos" ouvert ?\n• Notes visibles sur la page ?');
    return;
  }
  console.log('[FS] ' + players.length + ' joueurs trouvés :');
  players.forEach(function (p) {
    console.log('  ' + p.name + ' (' + p.team + ') → ' + p.rating);
  });

  // ── 3. Envoi parallèle vers les deux APIs ──────────────────────────────────
  var body     = JSON.stringify({
    date: date,
    matches: [{ sofaId: 0, home: home, away: away, players: players }]
  });
  var postOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body };

  function fetchJson(url, opts) {
    return fetch(url, opts)
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      })
      .catch(function (e) { return { ok: false, error: String(e) }; });
  }

  function fmtResult(label, r) {
    if (r.ok) {
      var s = '✅ ' + label + ' : ' + (r.data.imported || 0) + ' notes';
      if (r.data.unmatched && r.data.unmatched.length)
        s += '\n  ⚠ Non matchés (' + r.data.unmatched.length + ') : ' +
             r.data.unmatched.slice(0, 5).join(', ');
      return s;
    }
    return '❌ ' + label + ' : HTTP ' + (r.status || '?') + ' ' +
           ((r.data && r.data.error) || r.error || '');
  }

  Promise.all([fetchJson(API_FANTASY, postOpts), fetchJson(API_CDM26, postOpts)])
    .then(function (results) {
      alert(home + ' vs ' + away + ' — ' + players.length + ' joueurs\n\n' +
            fmtResult('Fantasy', results[0]) + '\n\n' +
            fmtResult('CDM26',   results[1]));
      console.log('[FS] Fantasy :', results[0]);
      console.log('[FS] CDM26 :',   results[1]);
    });

}());
