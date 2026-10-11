/* Rendu de l'échiquier (positionnement en % : fonctionne sur tous les navigateurs, sans grid/flex). */
(function () {
  'use strict';
  var FILES = 'abcdefgh';

  function Board(container) {
    var self = this, s;
    this.el = container;
    U.addClass(container, 'board');
    this.sq = []; this.pc = []; this.cf = []; this.cr = [];
    for (s = 0; s < 64; s++) {
      var e = U.el('div', 'sq');
      e.setAttribute('data-i', s);
      var pc = U.el('div', 'pc');
      var cf = U.el('i', 'co cf'), cr = U.el('i', 'co cr');
      e.appendChild(pc); e.appendChild(cf); e.appendChild(cr);
      container.appendChild(e);
      this.sq.push(e); this.pc.push(pc); this.cf.push(cf); this.cr.push(cr);
    }
    this.onSquare = null;
    U.on(container, 'click', function (ev) {
      var n = ev.target;
      while (n && n !== container) {
        var i = n.getAttribute && n.getAttribute('data-i');
        if (i !== null && i !== undefined && i !== '') {
          if (self.onSquare) self.onSquare(parseInt(i, 10));
          return;
        }
        n = n.parentNode;
      }
    });
  }

  Board.prototype.setSize = function (px) {
    px = Math.max(40, Math.floor(px / 8) * 8);   // multiple de 8 : pas de sous-pixels entre les cases
    this.el.style.width = px + 'px';
    this.el.style.height = px + 'px';
    this.el.style.fontSize = Math.round(px / 8 * 0.8) + 'px';
    this.size = px;
    return px;
  };

  // st : {board, orient:'w'|'b', last:{from,to}|null, sel, targets:[{to,cap}], check, coords, faceTop}
  Board.prototype.render = function (st) {
    var s, tgt = {}, i;
    var flip = st.orient === 'b';
    for (i = 0; st.targets && i < st.targets.length; i++) tgt[st.targets[i].to] = st.targets[i].cap ? 2 : 1;
    for (s = 0; s < 64; s++) {
      var r = s >> 3, f = s & 7;
      var dr = flip ? 7 - r : r, dc = flip ? 7 - f : f;
      var e = this.sq[s];
      e.style.left = (dc * 12.5) + '%';
      e.style.top = (dr * 12.5) + '%';
      var cls = 'sq ' + (((r + f) & 1) ? 'dark' : 'light');
      if (st.last && (st.last.from === s || st.last.to === s)) cls += ' last';
      if (st.sel === s) cls += ' sel';
      if (tgt[s]) cls += tgt[s] === 2 ? ' cap' : ' tgt';
      if (st.check === s) cls += ' chk';
      e.className = cls;
      var p = st.board[s];
      this.pc[s].className = p ? 'pc pc-' + p + (st.faceTop && st.faceTop === p.charAt(0) ? ' up' : '') : 'pc';
      this.cf[s].textContent = st.coords && dr === 7 ? FILES.charAt(f) : '';
      this.cr[s].textContent = st.coords && dc === 0 ? (8 - r) : '';
    }
  };

  window.Board = Board;
})();
