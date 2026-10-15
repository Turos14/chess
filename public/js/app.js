/* Navigation entre écrans et démarrage. */
(function () {
  'use strict';
  var App = window.App = {};
  var live = false, current = 'home';
  var TRANS_MS = 180, transGen = 0, pendingTimer = null;

  // Fondu à la navigation entre écrans. Robuste aux clics rapprochés : chaque appel repart d'un état propre
  // (tout écran mis à son état final, aucune transition interrompue) avant de lancer la sienne — jamais deux
  // écrans visibles en même temps, jamais un écran bloqué à mi-fondu.
  App.show = function (name) {
    var list = document.getElementsByClassName('screen'), i, newEl = null;
    for (i = 0; i < list.length; i++) if (list[i].id === 'scr-' + name) newEl = list[i];
    current = name;
    window.scrollTo(0, 0);
    if (name === 'home') {
      var n = Rec.count();
      U.$('rec-count').textContent = n ? n : '';
    } else if (name === 'records') Rec.renderList();
    else if (name === 'online') Online.refresh();
    else if (name === 'elo') EloView.render();
    else if (name === 'puzzles') Puzzles.renderList();
    if (!newEl) return;

    clearTimeout(pendingTimer);
    transGen++;
    for (i = 0; i < list.length; i++) {
      var el = list[i];
      U.removeClass(el, 'fade');
      el.style.opacity = '';
      if (el !== newEl) U.removeClass(el, 'active');
    }
    if (U.hasClass(newEl, 'active')) return;   // déjà affiché : rien à animer

    var gen = transGen;
    U.addClass(newEl, 'active');
    newEl.style.opacity = '0';
    newEl.offsetHeight;             // force un reflow pour que la transition parte bien d'opacity 0
    U.addClass(newEl, 'fade');
    newEl.style.opacity = '1';
    pendingTimer = setTimeout(function () {
      if (gen !== transGen) return;
      U.removeClass(newEl, 'fade');
      newEl.style.opacity = '';
    }, TRANS_MS + 30);
  };

  // Une partie / la pendule est en cours : on protège contre la sortie accidentelle
  App.setLive = function (v) {
    live = v;
    if (v) { try { history.pushState({ live: 1 }, ''); } catch (e) { /* ignore */ } }
  };

  window.onbeforeunload = function (e) {
    if (!live) return undefined;
    var msg = 'Une partie est en cours. Quitter ?';
    if (e) e.returnValue = msg;
    return msg;
  };

  window.addEventListener('popstate', function () {
    if (!live) return;
    try { history.pushState({ live: 1 }, ''); } catch (e) { /* ignore */ }
    if (U.dialogOpen()) return;
    if (current === 'pendule') Pendule.quitConfirm();
    else if (current === 'game') GameView.quit();
  }, false);

  function ready() {
    var btns = document.querySelectorAll('[data-go]'), i;
    for (i = 0; i < btns.length; i++) {
      (function (b) { U.on(b, 'click', function () { App.show(b.getAttribute('data-go')); }); })(btns[i]);
    }
    GameView.init();
    Pendule.init();
    Local.init();
    AI.init();
    Online.init();
    Rec.initReplay();
    EloView.initScreen();
    Puzzles.initScreen();
    App.show('home');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, false);
  else ready();
})();
