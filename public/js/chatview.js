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

    function isOpen() { return !!listEl && U.dialogOpen() && document.body.contains(listEl); }

    function render() {
      U.clear(listEl);
      if (!list.length) listEl.appendChild(U.el('p', 'hint center', 'Aucun message. Les messages sont visibles par les joueurs et les spectateurs de la partie.'));
      list.forEach(function (m) {
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
        listEl.appendChild(row);
      });
      listEl.scrollTop = listEl.scrollHeight;
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
          if (lastId !== null && next[i].id > lastId && !next[i].me) { fresh++; top = next[i]; }
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
      open: function () {
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
        U.dialog({ title: 'Chat', node: node, buttons: [{ label: 'Fermer', primary: false }],
          onclose: function () { listEl = null; } });
        render();
        if (opts.onChange) opts.onChange();
      },
      unread: function () { return unread; },
      label: function () { return unread ? 'Chat ' + unread : 'Chat'; }
    };
    return api;
  }

  window.ChatView = { create: create };
})();
