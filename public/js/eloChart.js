/* Courbe Elo d'un joueur : mini graphique en ligne (SVG), avec repère et infobulle au doigt/à la souris.
 * Un seul repère (une seule couleur, pas de légende nécessaire) ; l'historique textuel qui l'accompagne
 * sert de vue tabulaire (chaque valeur du graphique y est aussi lisible sans survol). ES5, sans dépendance. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag), k;
    for (k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  // Choisit un pas "rond" pour les graduations (1, 2, 5 ou 10 × une puissance de 10)
  function niceStep(range) {
    var raw = range / 4, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / mag, step;
    if (f < 1.5) step = 1; else if (f < 3) step = 2; else if (f < 7) step = 5; else step = 10;
    return step * mag;
  }

  // container : élément DOM à remplir ; points : [{date, rating, opponent?, delta?, score?, synthetic?}]
  // triés du plus ancien au plus récent (au moins 2 éléments : un point de départ + une partie).
  function EloChart(container, points) {
    this.container = container;
    this.points = points;
    this.build();
  }

  EloChart.prototype.build = function () {
    var pts = this.points;
    var W = 320, H = 168, padL = 34, padR = 14, padT = 14, padB = 10;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var ratings = pts.map(function (p) { return p.rating; });
    var min = Math.min.apply(null, ratings), max = Math.max.apply(null, ratings);
    if (min === max) { min -= 50; max += 50; }
    var step = niceStep(max - min);
    var gMin = Math.floor(min / step) * step, gMax = Math.ceil(max / step) * step;
    if (gMax === gMin) gMax = gMin + step;

    function xAt(i) { return pts.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (pts.length - 1); }
    function yAt(r) { return padT + plotH - ((r - gMin) / (gMax - gMin)) * plotH; }

    var wrap = U.el('div', 'elo-chart');
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'elo-chart-svg' });

    var g = gMin;
    while (g <= gMax + 0.001) {
      var y = yAt(g);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, 'class': 'elo-grid' }));
      var t = svgEl('text', { x: padL - 6, y: y + 3, 'class': 'elo-axis', 'text-anchor': 'end' });
      t.textContent = Math.round(g);
      svg.appendChild(t);
      g += step;
    }

    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(p.rating).toFixed(1); }).join(' ');
    svg.appendChild(svgEl('path', { d: d, 'class': 'elo-line' }));

    svg.appendChild(svgEl('circle', { cx: xAt(0), cy: yAt(pts[0].rating), r: 4, 'class': 'elo-dot elo-dot-start' }));
    var lastI = pts.length - 1, lastX = xAt(lastI), lastY = yAt(pts[lastI].rating);
    svg.appendChild(svgEl('circle', { cx: lastX, cy: lastY, r: 5, 'class': 'elo-dot elo-dot-end' }));
    var nearRight = lastX > W - padR - 26;
    var lbl = svgEl('text', { x: lastX + (nearRight ? -8 : 8), y: Math.max(padT + 8, lastY - 8), 'class': 'elo-endlabel', 'text-anchor': nearRight ? 'end' : 'start' });
    lbl.textContent = String(pts[lastI].rating);
    svg.appendChild(lbl);

    var cross = svgEl('line', { x1: 0, x2: 0, y1: padT, y2: padT + plotH, 'class': 'elo-cross' });
    cross.style.opacity = 0;
    svg.appendChild(cross);
    var hoverDot = svgEl('circle', { r: 5, 'class': 'elo-dot elo-dot-hover' });
    hoverDot.style.opacity = 0;
    svg.appendChild(hoverDot);
    var hit = svgEl('rect', { x: 0, y: 0, width: W, height: H, 'class': 'elo-hit', fill: 'transparent' });
    svg.appendChild(hit);

    wrap.appendChild(svg);
    var tip = U.el('div', 'elo-chart-tip');
    tip.style.display = 'none';
    wrap.appendChild(tip);

    function scoreLabel(s) { return s === 1 ? 'Victoire' : (s === 0 ? 'Défaite' : 'Nulle'); }
    function showAt(i) {
      var p = pts[i];
      cross.setAttribute('x1', xAt(i)); cross.setAttribute('x2', xAt(i));
      cross.style.opacity = 1;
      hoverDot.setAttribute('cx', xAt(i)); hoverDot.setAttribute('cy', yAt(p.rating));
      hoverDot.style.opacity = 1;
      U.clear(tip);
      tip.appendChild(U.el('div', 'elo-tip-val', String(p.rating)));
      var sub = p.synthetic ? 'Avant cette période' : U.fmtDate(p.date) + ' · vs ' + p.opponent + ' — ' + scoreLabel(p.score) + ' (' + (p.delta >= 0 ? '+' : '') + p.delta + ')';
      tip.appendChild(U.el('div', 'elo-tip-sub', sub));
      tip.style.display = 'block';
      tip.style.left = Math.min(Math.max((xAt(i) / W) * 100, 16), 84) + '%';
    }
    function nearest(clientX) {
      var r = svg.getBoundingClientRect();
      var x = ((clientX - r.left) / (r.width || 1)) * W;
      var i = pts.length === 1 ? 0 : Math.round(((x - padL) / plotW) * (pts.length - 1));
      return Math.max(0, Math.min(pts.length - 1, i));
    }
    U.on(hit, 'mousemove', function (e) { showAt(nearest(e.clientX)); });
    U.on(hit, 'touchstart', function (e) { if (e.touches[0]) showAt(nearest(e.touches[0].clientX)); });
    U.on(hit, 'touchmove', function (e) { if (e.touches[0]) showAt(nearest(e.touches[0].clientX)); });

    U.clear(this.container);
    this.container.appendChild(wrap);
    showAt(lastI);   // valeur actuelle affichée par défaut
  };

  window.EloChart = EloChart;
})();
