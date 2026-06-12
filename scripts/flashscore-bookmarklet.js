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
 *   On cible les listes textuelles de compos (pas le terrain graphique dont les X
 *   reflètent les positions tactiques, pas les équipes).
 *   Priorité : lf__lineup--home/away → lf--1/lf--2 → lf-- DOM order → X-split
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

  // ── 2. Conteneurs home/away (listes textuelles uniquement) ───────────────────
  function findContainers() {
    // Priorité 1 : listes textuelles avec home/away explicite dans la classe
    var pairs = [
      ['[class*="lf__lineup--home"]',  '[class*="lf__lineup--away"]'],
      ['[class*="lineup--home"]',       '[class*="lineup--away"]'],
      ['[class*="lf--home"]',           '[class*="lf--away"]'],
      ['[class*="lf-side--home"]',      '[class*="lf-side--away"]'],
    ];
    for (var p = 0; p < pairs.length; p++) {
      var h = document.querySelector(pairs[p][0]);
      var a = document.querySelector(pairs[p][1]);
      if (h && a) {
        console.log('[FS] Conteneurs via ' + pairs[p][0].replace(/\[class\*="/g, '.').replace(/"\]/g, ''));
        return [h, a];
      }
    }

    // Priorité 2 : classes .lf--1 / .lf--2 (colonnes, hors terrain graphique si possible)
    var c1 = document.querySelector('.lf--1');
    var c2 = document.querySelector('.lf--2');
    if (c1 && c2) {
      console.log('[FS] Conteneurs via .lf--1/.lf--2');
      return [c1, c2];
    }

    // Priorité 3 : [class*="lf--"] — 2 premiers non imbriqués dans l'ordre DOM
    var all = Array.prototype.slice.call(document.querySelectorAll('[class*="lf--"]'));
    var top = [];
    for (var i = 0; i < all.length; i++) {
      var ok = true;
      for (var j = 0; j < top.length; j++) {
        if (top[j].contains(all[i]) || all[i].contains(top[j])) { ok = false; break; }
      }
      if (ok) { top.push(all[i]); if (top.length === 2) break; }
    }
    if (top.length === 2) {
      console.log('[FS] Conteneurs via [class*="lf--"] (ordre DOM)');
      return top;
    }

    console.warn('[FS] Aucun conteneur trouvé — fallback X-split');
    return null;
  }

  var containers = findContainers();

  // ── 3. Extraction des joueurs ────────────────────────────────────────────────
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

  // Ancêtre avec exactement 1 lien = ligne joueur (Flashscore lie toujours le nom)
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

  function extractPlayers(root, teamName) {
    var walker = document.createTreeWalker(root, 4, null, false);
    var tNode;
    while ((tNode = walker.nextNode())) {
      var rawTxt = (tNode.nodeValue || '').trim();
      if (!RATING_RE.test(rawTxt)) continue;

      var ratingEl = tNode.parentElement;
      if (!ratingEl) continue;

      var rRect = ratingEl.getBoundingClientRect();
      if (rRect.width === 0 && rRect.height === 0) continue;

      var found = findRowByOneLink(ratingEl);
      var name  = found ? found.name : findNameFallback(ratingEl);
      if (!name) continue;

      var subMin = 90;
      var row    = found ? found.row : ratingEl.parentElement;
      if (row) {
        var desc = row.querySelectorAll('*');
        for (var di = 0; di < desc.length; di++) {
          var mt = (desc[di].textContent || '').trim();
          if (MINUTE_RE.test(mt)) { subMin = 90 - parseInt(MINUTE_RE.exec(mt)[1], 10); break; }
        }
      }

      var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenKeys[key]) continue;
      seenKeys[key] = true;

      players.push({
        name:    name,
        team:    teamName,
        rating:  parseFloat(rawTxt),
        goals:   0,
        assists: 0,
        minutes: (subMin > 0 && subMin <= 90) ? subMin : 90,
      });
    }
  }

  if (containers) {
    extractPlayers(containers[0], home);
    extractPlayers(containers[1], away);
  } else {
    // Fallback : X-split depuis les headers .duelParticipant__home / __away
    var hdr1   = document.querySelector('.duelParticipant__home');
    var hdr2   = document.querySelector('.duelParticipant__away');
    var splitX = (hdr1 && hdr2)
      ? ((hdr1.getBoundingClientRect().left + hdr1.getBoundingClientRect().right +
          hdr2.getBoundingClientRect().left + hdr2.getBoundingClientRect().right) / 4)
      : (document.documentElement.clientWidth / 2);
    console.warn('[FS] Fallback X-split: ' + Math.round(splitX) + 'px');

    var walker2 = document.createTreeWalker(document.body, 4, null, false);
    var tNode2;
    while ((tNode2 = walker2.nextNode())) {
      var rawTxt2 = (tNode2.nodeValue || '').trim();
      if (!RATING_RE.test(rawTxt2)) continue;
      var ratingEl2 = tNode2.parentElement;
      if (!ratingEl2) continue;
      var rRect2 = ratingEl2.getBoundingClientRect();
      if (rRect2.width === 0 && rRect2.height === 0) continue;
      var found2 = findRowByOneLink(ratingEl2);
      var name2  = found2 ? found2.name : findNameFallback(ratingEl2);
      if (!name2) continue;
      var subMin2 = 90;
      var row2    = found2 ? found2.row : ratingEl2.parentElement;
      if (row2) {
        var desc2 = row2.querySelectorAll('*');
        for (var di2 = 0; di2 < desc2.length; di2++) {
          var mt2 = (desc2[di2].textContent || '').trim();
          if (MINUTE_RE.test(mt2)) { subMin2 = 90 - parseInt(MINUTE_RE.exec(mt2)[1], 10); break; }
        }
      }
      var elX2 = (rRect2.left + rRect2.right) / 2;
      var key2 = name2.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenKeys[key2]) continue;
      seenKeys[key2] = true;
      players.push({
        name:    name2,
        team:    elX2 < splitX ? home : away,
        rating:  parseFloat(rawTxt2),
        goals:   0,
        assists: 0,
        minutes: (subMin2 > 0 && subMin2 <= 90) ? subMin2 : 90,
      });
    }
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

  // ── 5. Test preflight OPTIONS sur CDM26 ──────────────────────────────────────
  fetch(API_CDM26, { method: 'OPTIONS' })
    .then(function (r) {
      console.log('[FS] CDM26 OPTIONS → ' + r.status +
                  '  ACAO: ' + r.headers.get('Access-Control-Allow-Origin'));
    })
    .catch(function (e) { console.warn('[FS] CDM26 OPTIONS échoué :', e.message); });

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
