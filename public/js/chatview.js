/* Fenêtre de chat des parties en ligne (à deux : online.js, à plusieurs : multionline.js). Les messages arrivent dans
 * l'état diffusé par l'hôte (chat.js) ; on n'envoie que le texte, l'hôte ajoute nom et camp.
 * ChatView.create(opts) — opts : { send(text) -> bool, sideName(c) -> texte, sideDot(c) -> couleur CSS, onChange() }
 * Retourne { update(liste), open(), label() -> texte du bouton, unread() }. */
(function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function create(opts) {
    var list = [], lastId = null, unread = 0, listEl = null, input = null;

    // Réglages propres à cet appareil : chat masqué, noms ignorés (le cid d'un auteur n'est jamais transmis)
    function hidden() { return !!U.store.get('chat-hidden', false); }
    function ignored() { return U.store.get('chat-ignored', []) || []; }
    function key(n) { return String(n || '').toLowerCase(); }
    function isIgnored(m) { return !m.me && ignored().indexOf(key(m.n)) >= 0; }
    function shown() { return hidden() ? [] : list.filter(function (m) { return !isIgnored(m); }); }
    function setIgnored(arr) { U.store.set('chat-ignored', arr); }

    function isOpen() { return !!listEl && U.dialogOpen() && document.body.contains(listEl); }

    function render() {
      U.clear(listEl);
      var vis = shown();
      if (!vis.length) listEl.appendChild(U.el('p', 'hint center', 'Aucun message. Les messages sont visibles par les joueurs et les spectateurs de la partie.'));
      vis.forEach(function (m) {
        var row = U.el('div', 'chat-msg' + (m.me ? ' me' : ''));
        var who = U.el('div', 'chat-who');
        var dot = U.el('span', 'pdot');
        dot.style.background = m.c != null ? opts.sideDot(m.c) : 'transparent';
        dot.style.borderColor = '#888';
        who.appendChild(dot);
        who.appendChild(U.el('span', null, (m.me ? 'Moi' : m.n) + (m.c != null ? ' · ' + opts.sideName(m.c) : ' · spectateur')));
        if (m.at) who.appendChild(U.el('span', 'chat-time', hhmm(m.at)));
        row.appendChild(who);
        row.appendChild(U.el('div', 'chat-text', m.x));
        if (!m.me) {
          row.setAttribute('title', 'Toucher pour ignorer ' + m.n);
          U.on(row, 'click', function () { askIgnore(m); });
        }
        listEl.appendChild(row);
      });
      listEl.scrollTop = listEl.scrollHeight;
    }

    function askIgnore(m) {
      U.dialog({
        title: 'Ignorer ' + m.n + ' ?', text: 'Ses messages ne s’afficheront plus sur cet appareil (tu peux annuler dans les réglages du chat).',
        buttons: [
          { label: 'Annuler', fn: function () { api.open(true); } },
          { label: 'Ignorer', danger: true, fn: function () { var l = ignored(); l.push(key(m.n)); setIgnored(l); api.open(true); } }
        ]
      });
    }

    function settings() {
      var node = U.el('div', 'settings');
      node.appendChild(U.checkbox('Masquer le chat sur cet appareil', hidden(), function (v) {
        U.store.set('chat-hidden', v); unread = 0; if (opts.onChange) opts.onChange();
      }));
      var names = ignored();
      if (names.length) {
        node.appendChild(U.el('h3', null, 'Participants ignorés'));
        names.forEach(function (n) {
          var row = U.el('div', 'btnrow');
          row.appendChild(U.el('span', 'chat-ign', n));
          row.appendChild(U.button('Réactiver', 'btn', function () {
            setIgnored(ignored().filter(function (x) { return x !== n; })); settings();
          }));
          node.appendChild(row);
        });
      }
      U.dialog({ title: 'Réglages du chat', node: node, buttons: [
        { label: 'Règles du chat', fn: function () { Rules.dialog('chat', [{ label: 'Retour', primary: true, fn: settings }]); } },
        { label: 'Fermer', primary: true, fn: function () { if (!hidden()) api.open(true); } }
      ] });
    }

    function submit() {
      var text = input.value.replace(/^\s+|\s+$/g, '');
      if (!text) return;
      if (opts.send(text)) input.value = '';
      input.focus();
    }

    var api = {
      update: function (next) {
        next = next || [];
        var fresh = 0, top = null, i;
        for (i = 0; i < next.length; i++) {
          if (lastId !== null && next[i].id > lastId && !next[i].me && !isIgnored(next[i]) && !hidden()) { fresh++; top = next[i]; }
        }
        list = next;
        if (next.length) lastId = Math.max(lastId || 0, next[next.length - 1].id);
        else if (lastId === null) lastId = 0;
        if (isOpen()) { render(); return; }
        if (fresh) {
          unread += fresh;
          U.toast('Chat · ' + top.n + ' : ' + (top.x.length > 60 ? top.x.slice(0, 60) + '…' : top.x));
          if (opts.onChange) opts.onChange();
        }
      },
      open: function (skipRules) {
        if (hidden()) { settings(); return; }
        if (!skipRules && !U.store.get('chat-rules-seen', false)) {
          Rules.dialog('chat', [
            { label: 'Masquer le chat', fn: function () { U.store.set('chat-hidden', true); U.store.set('chat-rules-seen', true); if (opts.onChange) opts.onChange(); } },
            { label: 'J’ai compris', primary: true, fn: function () { U.store.set('chat-rules-seen', true); api.open(true); } }
          ]);
          return;
        }
        var node = U.el('div', 'chat');
        listEl = U.el('div', 'chat-list');
        node.appendChild(listEl);
        var row = U.el('div', 'chat-form');
        input = U.el('input', 'chat-input');
        input.type = 'text';
        input.maxLength = Chat.MAX_LEN;
        input.placeholder = 'Ton message…';
        input.setAttribute('autocomplete', 'off');
        U.on(input, 'keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); submit(); } });
        row.appendChild(input);
        row.appendChild(U.button('Envoyer', 'btn primary', submit));
        node.appendChild(row);
        unread = 0;
        U.dialog({ title: 'Chat', node: node, buttons: [{ label: 'Réglages', fn: settings }, { label: 'Fermer' }],
          onclose: function () { listEl = null; } });
        render();
        if (opts.onChange) opts.onChange();
      },
      unread: function () { return unread; },
      label: function () { return hidden() ? 'Chat off' : (unread ? 'Chat ' + unread : 'Chat'); }
    };
    return api;
  }

  window.ChatView = { create: create };
})();
