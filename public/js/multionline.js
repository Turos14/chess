/* Échecs à plusieurs en ligne : créer / rejoindre une partie avec un code, jouer ou regarder.
 * Réseau : net.js (même mécanisme que la partie en ligne à deux, bascule d'hôte comprise) avec son propre préfixe de
 * salle ; l'hôte fait tourner MultiRoom (multiroom.js). Écran de partie : multi.js (contrôleur ci-dessous). */
(function () {
  'use strict';
  var PREFIX = 'echecs-multi-v1-';
  var active = null;

  function $(id) { return U.$(id); }
  function setError(msg) { $('mo-error').textContent = msg || ''; }
  function myName() { return $('mo-name').value.replace(/^\s+|\s+$/g, ''); }
  function myCid() {
    var c = U.store.get('cid', null);
    if (!c) { c = Net.newId(); U.store.set('cid', c); }
    return c;
  }
  function busy(on) { ['mo-create', 'mo-join', 'mo-watch'].forEach(function (id) { $(id).disabled = on; }); }

  function buildForm() {
    var box = $('mu-online');
    box.innerHTML = '<h3>En ligne (chacun sur son appareil)</h3>' +
      '<div id="mo-status" class="hint"></div><div id="mo-resume"></div>' +
      '<input id="mo-name" class="txt" maxlength="20" placeholder="Ton nom" autocomplete="off">' +
      '<button id="mo-create" class="btn big" style="margin-top:8px">Créer la partie en ligne</button>' +
      '<input id="mo-code" class="txt code" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" style="margin-top:12px">' +
      '<div class="btnrow"><button id="mo-watch" class="btn big">Spectateur</button><button id="mo-join" class="btn primary big">Rejoindre</button></div>' +
      '<div id="mo-error" class="error"></div>';
    $('mo-name').value = U.store.get('online-name', '');
    U.on($('mo-code'), 'input', function () {
      var v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v !== this.value) this.value = v;
    });
    U.on($('mo-create'), 'click', create);
    U.on($('mo-join'), 'click', function () { join('player'); });
    U.on($('mo-watch'), 'click', function () { join('spectator'); });
  }

  function refreshSetup() {
    if (!$('mo-status')) return;
    $('mo-status').textContent = Net.supported()
      ? 'La variante et les équipes choisies ci-dessus servent à la partie créée. Elle commence quand tous les joueurs ont rejoint.'
      : 'Ce navigateur ne gère pas WebRTC : le jeu en ligne est indisponible.';
    refreshResume();
  }

  function refreshResume() {
    var box = $('mo-resume'), s = U.store.get('multi-session', null);
    U.clear(box);
    if (!s) return;
    var wrap = U.el('div', 'resume');
    wrap.appendChild(U.el('div', null, 'Partie en cours : ' + s.code + (s.role === 'spectator' ? ' (spectateur)' : '')));
    var row = U.el('div', 'btnrow');
    row.appendChild(U.button('Oublier', 'btn', function () { U.store.remove('multi-session'); refreshResume(); }));
    row.appendChild(U.button('Reprendre', 'btn primary', function () { begin(s, 'resume'); }));
    wrap.appendChild(row);
    box.appendChild(wrap);
  }

  function begin(sess, mode) {
    if (!Net.supported()) { setError('Ce navigateur ne gère pas WebRTC.'); return; }
    setError(''); busy(true);
    Net.loadLib(function (err) {
      if (err) { busy(false); setError(err.message); return; }
      start(sess, mode);
    });
  }

  function create() {
    U.store.set('online-name', myName());
    var cfg = Multi.config();
    begin({ code: Net.newCode(), name: myName() || 'Joueur', role: 'player', color: null, variant: cfg.variant, teams: cfg.teams }, 'create');
  }

  function join(role) {
    U.store.set('online-name', myName());
    var code = $('mo-code').value;
    if (code.length < 4) { setError('Entre le code de la partie.'); return; }
    begin({ code: code, name: myName() || (role === 'player' ? 'Joueur' : 'Spectateur'), role: role, color: null }, 'join');
  }

  function showCode(code) {
    var node = U.el('div');
    node.appendChild(U.el('div', 'bigcode', code));
    node.appendChild(U.el('p', 'hint center', 'Donne ce code aux autres joueurs : ils le saisissent dans « Échecs à plusieurs » → « Rejoindre ». La partie commence quand tout le monde est là.'));
    var buttons = [
      { label: 'Copier', keep: true, fn: function () { U.copy(code, function (ok) { U.toast(ok ? 'Code copié' : 'Copie impossible'); }); } },
      { label: 'Fermer', primary: true }
    ];
    if (navigator.share) buttons.splice(1, 0, { label: 'Partager', keep: true, fn: function () {
      try { navigator.share({ title: 'Échecs à plusieurs', text: 'Rejoins ma partie d’échecs à plusieurs avec le code ' + code }); } catch (e) { /* ignore */ }
    } });
    U.dialog({ title: 'Code de la partie', node: node, buttons: buttons });
  }

  /* ---------- Session de jeu ---------- */
  function start(sess, mode) {
    if (active) active.stop();
    var cid = myCid(), session = null, st = null, ctrl = null;
    var opened = false, alive = true, connErr = null, mySeat = null, curEpoch = -1, lastV = -1;

    function full() { return !!st && st.players.every(function (p) { return !!p; }); }
    function missing() { return st ? st.players.filter(function (p) { return !p; }).length : 0; }
    function send(msg) {
      if (session && session.send(msg)) return true;
      U.toast('Connexion perdue');
      return false;
    }
    function seatName(i) { return (st && st.players[i]) || Multi.colorName(st.variant, i); }

    function sameActions(g, list) {
      var h = g.history, i;
      if (list.length < h.length) return false;
      for (i = 0; i < h.length; i++) {
        var a = h[i], b = list[i];
        if ((a.resign != null) !== (b.resign != null)) return false;
        if (a.resign != null ? a.resign !== b.resign : (a.from !== b.from || a.to !== b.to)) return false;
      }
      return true;
    }

    function makeCtrl(s) {
      var g = new MultiChess.Game(s.variant, { teams: s.teams });
      return {
        mode: 'online', game: g, names: [], view: { mode: 'fixed', color: s.you != null ? s.you : 0 },
        canMove: function (color) {
          return alive && mySeat !== null && color === mySeat && ctrl.game.turn === mySeat && full() && !ctrl.game.over && !connErr;
        },
        myColors: function () { return mySeat !== null ? [mySeat] : []; },
        attemptMove: function (from, to, promo) {
          var game = ctrl.game;
          if (!ctrl.canMove(game.turn)) return;
          var rec = game.move(from, to, promo);
          if (!rec) return;
          U.fx('move');
          if (!send({ t: 'move', from: from, to: to, promo: rec.promo })) rebuild();
        },
        note: function (i) { return st && st.players[i] && !st.connected[i] && ctrl.game.alive[i] && !ctrl.game.over ? 'déconnecté' : ''; },
        head: function () {
          var h = 'Code ' + (session ? session.code : sess.code);
          if (mySeat === null) h = 'Spectateur · ' + h;
          if (connErr) return h + ' · reconnexion…';
          if (st && !full()) h += ' · en attente de ' + missing() + ' joueur' + (missing() > 1 ? 's' : '');
          if (st && st.spectators) h += ' · ' + st.spectators + ' spectateur' + (st.spectators > 1 ? 's' : '');
          if (session && session.isHost()) h += ' · hôte';
          return h;
        },
        menuItems: function () {
          var items = [{ label: 'Code de la partie', fn: function () { showCode(session.code); } }], game = ctrl.game, i;
          if (mySeat !== null && game.alive[mySeat] && !game.over && full()) {
            items.push({ label: 'Abandonner', danger: true, fn: function () {
              U.confirm('Abandonner ?', 'Tu quittes la partie : tes pièces disparaissent.', 'Abandonner', 'Annuler', function () { send({ t: 'resign' }); }, null, true);
            } });
          }
          for (i = 0; i < game.n; i++) {
            if (ctrl.note(i) && i !== mySeat && mySeat !== null) {
              (function (k) {
                items.push({ label: 'Retirer ' + seatName(k) + ' (déconnecté)', fn: function () {
                  U.confirm('Retirer ce joueur ?', seatName(k) + ' est déconnecté : il est éliminé et ses pièces disparaissent.', 'Retirer', 'Annuler',
                    function () { send({ t: 'kick', seat: k }); }, null, true);
                } });
              })(i);
            }
          }
          return items;
        },
        quit: function () {
          var over = ctrl.game.over, spectator = mySeat === null;
          stop();
          if (spectator || over) U.store.remove('multi-session');
          Multi.close();
          App.show('multi-setup');
          refreshResume();
        }
      };
    }

    function rebuild() {
      if (!st || !ctrl) return;
      var g = MultiChess.replay(st.variant, { teams: st.teams }, st.actions);
      if (g) ctrl.game = g;
      Multi.refresh();
    }

    function apply(s) {
      if (!alive) return;
      if (s.epoch < curEpoch || (s.epoch === curEpoch && s.v < lastV)) return;
      curEpoch = s.epoch; lastV = s.v;
      mySeat = s.you;
      connErr = null;
      if (!ctrl) ctrl = makeCtrl(s);
      var g = ctrl.game, before = g.alive.slice(), oldN = g.history.length, i;
      if (!sameActions(g, s.actions)) {
        var rg = MultiChess.replay(s.variant, { teams: s.teams }, s.actions);
        if (rg) ctrl.game = g = rg;
      } else {
        for (i = g.history.length; i < s.actions.length; i++) {
          var a = s.actions[i];
          if (a.resign != null) g.resign(a.resign); else g.move(a.from, a.to, a.promo);
        }
      }
      if (st && g.history.length > oldN) {
        var la = g.history[g.history.length - 1];
        if (la && la.from != null && la.color !== mySeat) U.fx('move');
        for (i = 0; i < g.n; i++) {
          if (before[i] && !g.alive[i] && !g.over) U.toast(seatName(i) + ' est éliminé (' + ({ mate: 'mat', stalemate: 'pat', resign: 'abandon', king: 'roi pris' }[g.out[i]] || '') + ')');
        }
      }
      st = s;
      for (i = 0; i < g.n; i++) ctrl.names[i] = s.players[i] || 'En attente…';
      U.store.set('multi-session', { code: session.code, cid: cid, name: sess.name, role: mySeat !== null ? 'player' : 'spectator', color: mySeat,
        variant: s.variant, teams: s.teams, lastState: s });
      if (!opened) {
        opened = true;
        busy(false);
        Multi.open(ctrl);
        if (mode === 'create') showCode(session.code);
      } else Multi.refresh();
    }

    function failed(reason) {
      if (!opened) { stop(); busy(false); setError(reason); return; }
      U.dialog({
        title: 'Connexion perdue', text: reason,
        buttons: [
          { label: 'Quitter', fn: function () { ctrl.quit(); } },
          { label: 'Réessayer', primary: true, fn: function () { connErr = 'retry'; session.retries = 0; session.lost = false; session.open('resume'); } }
        ]
      });
    }

    function stop() {
      alive = false;
      if (session) session.leave();
      active = null;
    }

    session = new Net.Session({
      code: sess.code, cid: cid, name: sess.name, role: sess.role, color: sess.color, prefix: PREFIX,
      mode: mode, lastState: sess.lastState || null,
      makeRoom: function (p) { return new MultiRoom({ code: p.code, variant: sess.variant, teams: sess.teams, send: p.send, restore: p.restore }); },
      on: {
        state: apply,
        error: function (msg) { U.toast(msg); rebuild(); },
        reject: function (msg) { if (!opened) failed(msg); else U.toast(msg); },
        status: function (e) {
          if (!alive) return;
          if (e.kind === 'reconnecting') { connErr = e.reason || 'reconnexion'; if (opened) Multi.refresh(); }
          else if (e.kind === 'failed') failed(e.reason);
          else if (e.kind === 'online' && opened) { connErr = null; Multi.refresh(); }
        }
      }
    });
    active = { stop: stop };
    session.open(mode);
  }

  window.MultiOnline = {
    init: function () { buildForm(); refreshSetup(); },
    refreshSetup: refreshSetup
  };
})();
