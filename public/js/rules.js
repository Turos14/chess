/* Règles du jeu et de l'appli : textes (docs/regles-appli-echecs.pdf) et affichage. ES5.
 * Rules.mount(el) remplit l'écran « Règles » (sections repliables) ; Rules.dialog(id) montre une section dans une
 * fenêtre (menu d'une partie en cours : l'écran de partie reste en dessous, pendule comprise) ;
 * Rules.sectionFor(ctrl) donne la section de la variante jouée. Contenu d'une section : liste de blocs
 * ['h', titre] | ['p', texte] | ['ul', [textes]] | ['table', [[pièce, déplacement], …]]. */
(function () {
  'use strict';
  var R = window.Rules = {};

  var SECTIONS = [
    { id: 'classic', title: 'Échecs classiques', blocks: [
      ['p', 'Deux joueurs, les Blancs et les Noirs, jouent chacun leur tour ; les Blancs commencent. Le but est de mettre le roi adverse échec et mat : il est attaqué et aucun coup ne peut le sauver.'],
      ['h', 'Déplacement des pièces'],
      ['table', [
        ['Roi', 'D’une case dans toutes les directions. Jamais sur une case attaquée.'],
        ['Dame', 'D’autant de cases que voulu, en ligne droite ou en diagonale, sans sauter de pièce.'],
        ['Tour', 'D’autant de cases que voulu, horizontalement ou verticalement.'],
        ['Fou', 'D’autant de cases que voulu en diagonale ; il reste toujours sur sa couleur de case.'],
        ['Cavalier', 'En « L » : deux cases dans une direction puis une sur le côté. Seul à pouvoir sauter les autres pièces.'],
        ['Pion', 'Avance d’une case (deux depuis sa case de départ si elles sont libres), prend en diagonale vers l’avant, ne recule jamais.']
      ]],
      ['p', 'On prend une pièce adverse en arrivant sur sa case. On ne prend jamais une pièce de son camp.'],
      ['h', 'Coups spéciaux'],
      ['ul', [
        'Roque : le roi va de deux cases vers une tour, qui passe de l’autre côté du roi. Interdit si le roi ou cette tour a déjà bougé, si une pièce est entre eux, si le roi est en échec ou traverse ou atteint une case attaquée. Dans l’appli : touche le roi puis sa case d’arrivée.',
        'Prise en passant : quand un pion adverse avance de deux cases et arrive à côté d’un de tes pions, tu peux le prendre comme s’il n’avait avancé que d’une case, mais uniquement au coup suivant.',
        'Promotion : un pion qui atteint la dernière rangée devient dame, tour, fou ou cavalier, au choix.'
      ]],
      ['h', 'Échec'],
      ['p', 'Un roi attaqué est en échec : il faut parer tout de suite (bouger le roi, prendre la pièce qui attaque ou s’interposer). Un coup qui met ou laisse son propre roi en échec est interdit : l’appli ne le propose pas.']
    ] },
    { id: 'end', title: 'Fins de partie et nulles', blocks: [
      ['table', [
        ['Échec et mat', 'Le joueur au trait est en échec et n’a aucun coup légal : il perd.'],
        ['Pat', 'Le joueur au trait n’est pas en échec mais n’a aucun coup légal : nulle.'],
        ['Matériel insuffisant', 'Plus assez de pièces pour mater (roi contre roi, roi + fou ou cavalier contre roi…) : nulle automatique.'],
        ['Triple répétition', 'La même position (même trait, mêmes droits de roque et de prise en passant) se répète trois fois : nulle automatique.'],
        ['50 coups', '50 coups de chaque camp sans prise ni coup de pion : nulle automatique.'],
        ['Accord mutuel', 'Un joueur propose la nulle, l’autre accepte. Proposer alors que l’adversaire a déjà proposé vaut acceptation.'],
        ['Abandon', 'Menu → « Abandonner » : l’autre joueur gagne.'],
        ['Temps écoulé', 'La pendule d’un joueur atteint zéro : l’autre gagne.']
      ]],
      ['p', 'Différences avec les règles officielles (FIDE) : l’appli déclare la nulle toute seule à la triple répétition et aux 50 coups (en tournoi il faut la réclamer), et le temps écoulé donne toujours la victoire à l’adversaire, même s’il n’a plus de quoi mater.']
    ] },
    { id: 'clock', title: 'Pendule', blocks: [
      ['ul', [
        'Chaque joueur a un temps de base et, éventuellement, un incrément : quelques secondes ajoutées après chacun de ses coups.',
        'Seule la pendule du joueur au trait tourne. En ligne, elle démarre après le premier coup des Blancs.',
        'Alerte sonore et vibrations sous 10 secondes.',
        'En partie locale, la pause arrête les deux pendules. En ligne, il n’y a pas de pause ; si l’hôte se déconnecte, la pendule est figée le temps de la bascule vers un autre appareil.',
        'L’écran « Pendule » seul sert pour une partie sur un vrai échiquier : il ne contrôle pas les coups.'
      ]]
    ] },
    { id: '960', title: 'Fischer 960 (version de l’appli)', blocks: [
      ['ul', [
        'Les pièces de la première rangée sont placées au hasard : fous sur des cases de couleurs différentes, roi entre les deux tours. Les pions restent à leur place habituelle.',
        'Particularité de l’appli : le placement est tiré séparément pour chaque camp (Blancs et Noirs n’ont pas forcément la même disposition) et le roque est interdit pendant toute la partie.',
        'Toutes les autres règles (prise en passant, promotion, nulles, pendule) sont celles des échecs classiques.'
      ]],
      ['p', 'Dans le Fischer 960 officiel, les deux camps ont la même disposition en miroir et le roque existe.']
    ] },
    { id: 'yalta', title: 'Échecs à 3 (Yalta)', blocks: [
      ['ul', [
        'Trois joueurs, Blancs, Noirs et Rouges, sur un échiquier hexagonal de 96 cases ; chacun a 4 rangées de 8 colonnes et les pièces habituelles. On joue à tour de rôle dans l’ordre des couleurs.',
        'Le centre est formé de 6 cases qui se touchent par un seul coin : une diagonale qui traverse le centre peut continuer de deux façons.',
        'Pas de roque ni de prise en passant. Un pion est promu en atteignant la dernière rangée d’un autre camp.',
        'Un joueur sans coup légal à son tour est éliminé (qu’il soit mat ou pat) et ses pièces disparaissent.',
        'Un roi laissé en prise peut être capturé : son camp est alors éliminé.',
        'Le dernier joueur en jeu gagne. S’il ne reste que des rois, la partie est nulle.',
        'Pas de pendule, d’Elo ni d’enregistrement pour ces parties.'
      ]]
    ] },
    { id: 'cross4', title: 'Échecs à 4', blocks: [
      ['ul', [
        'Quatre joueurs, Rouges, Bleus, Jaunes et Verts, sur un échiquier en croix de 14 × 14 cases (coins de 3 × 3 retirés). On joue à tour de rôle dans cet ordre.',
        'Mêmes règles qu’à 3 : pas de roque ni de prise en passant, élimination du joueur sans coup légal (ses pièces disparaissent), roi en prise capturable, nulle s’il ne reste que des rois.',
        'Promotion sur la 8e rangée en comptant depuis son camp, soit au milieu de l’échiquier.',
        'Option équipes 2 contre 2 : les camps opposés sont alliés (Rouges + Jaunes contre Bleus + Verts) et ne peuvent pas prendre les pièces de leur allié. La première équipe qui perd un joueur a perdu.',
        'Sans équipes : chacun pour soi, le dernier en jeu gagne.',
        'Pas de pendule, d’Elo ni d’enregistrement pour ces parties.'
      ]]
    ] },
    { id: 'online', title: 'Parties en ligne', blocks: [
      ['ul', [
        'Le créateur reçoit un code de 5 caractères à donner à son adversaire. Les appareils sont reliés directement (pair-à-pair) : aucun serveur ne voit les coups ni les messages.',
        'Le créateur choisit sa couleur (Blancs, Noirs ou au hasard). Une partie complète refuse un nouveau joueur, qui peut la regarder en spectateur avec le même code.',
        'Hôte : l’appareil du créateur arbitre la partie (règles, pendule). S’il part, un autre participant prend le relais automatiquement et chacun garde sa place.',
        'Reprise : un joueur qui quitte peut revenir avec « Reprendre » sur l’écran « Partie en ligne ». La partie n’existe que tant qu’au moins un participant reste connecté.',
        'Nulle : une proposition à la fois, annulée dès qu’un coup est joué.',
        'Échecs à plusieurs en ligne : la partie commence quand tous les sièges sont pris. Un joueur déconnecté peut être retiré par les autres (il est éliminé), sinon la partie resterait bloquée à son tour.'
      ]]
    ] },
    { id: 'chat', title: 'Chat des parties en ligne', blocks: [
      ['p', 'Les messages sont visibles par tous les participants de la partie, joueurs et spectateurs : il n’y a pas de message privé. Ils passent de pair à pair, ne sont pas modérés et ne sont pas conservés après la partie (50 derniers messages, 200 caractères maximum chacun, 5 messages par 10 secondes par personne).'],
      ['h', 'Règles de conduite'],
      ['ul', [
        'Reste courtois : pas d’insultes, de moqueries, de propos haineux ni de harcèlement.',
        'Ne partage aucune information personnelle (adresse, téléphone, mots de passe…), ni la tienne ni celle des autres.',
        'Spectateurs : ne conseillez pas les joueurs pendant la partie ; les commentaires sont bienvenus une fois qu’elle est finie.',
        'Pas de spam ni de liens douteux.'
      ]],
      ['h', 'Te protéger'],
      ['ul', [
        'Masquer le chat : dans la fenêtre de chat, « Réglages » cache tous les messages sur cet appareil.',
        'Ignorer quelqu’un : touche son message, puis « Ignorer ». Ses messages ne s’affichent plus sur cet appareil (par nom).'
      ]]
    ] },
    { id: 'elo', title: 'Classement Elo', blocks: [
      ['ul', [
        'Calculé sur chaque appareil, pour les noms de joueurs suivis. Note de départ 1200 (une autre note peut être déclarée à la première partie).',
        'Comptent : les parties locales et en ligne terminées entre deux noms différents. Les échecs à plusieurs et les parties contre l’IA ne comptent jamais.',
        'Facteur K : 40 pour moins de 20 parties, 30 de 20 à 39, 20 ensuite. Battre un joueur mieux classé rapporte plus de points.'
      ]]
    ] },
    { id: 'ai', title: 'Parties contre Hulotte', blocks: [
      ['ul', [
        'Tu choisis ta couleur, le niveau visé (en Elo, approximatif) et une pendule éventuelle. Le niveau est modifiable en cours de partie.',
        'L’IA réfléchit 1 à 2 secondes par coup. Sous 1300 environ, elle joue volontairement des coups imparfaits pour rester battable.',
        'Ces parties ne modifient jamais le classement Elo.',
        'L’analyse des parties enregistrées (meilleur coup, imprécision, erreur, gaffe, précision) est une indication, pas une règle.'
      ]]
    ] },
    { id: 'puzzles', title: 'Problèmes', blocks: [
      ['ul', [
        'Trouve la suite de coups demandée (souvent un mat en quelques coups) ; le premier mauvais coup est signalé. Les problèmes résolus sont retenus sur l’appareil.',
        'Chacun peut proposer, modifier ou demander la suppression d’un problème. La position et la solution sont revérifiées automatiquement, puis validées à la main avant publication pour tous.',
        'Pas de contenu offensant dans le titre ou la description ; la solution doit être unique et correcte ; cite l’auteur ou la source si le problème vient d’ailleurs.'
      ]]
    ] }
  ];

  function byId(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    return null;
  }

  function body(sec) {
    var box = U.el('div', 'rules-body');
    sec.blocks.forEach(function (b) {
      if (b[0] === 'h') box.appendChild(U.el('h4', null, b[1]));
      else if (b[0] === 'p') box.appendChild(U.el('p', null, b[1]));
      else if (b[0] === 'ul') {
        var ul = U.el('ul');
        b[1].forEach(function (t) { ul.appendChild(U.el('li', null, t)); });
        box.appendChild(ul);
      } else if (b[0] === 'table') {
        var dl = U.el('dl');
        b[1].forEach(function (r) { dl.appendChild(U.el('dt', null, r[0])); dl.appendChild(U.el('dd', null, r[1])); });
        box.appendChild(dl);
      }
    });
    return box;
  }

  // Écran « Règles » : un bouton par section, qui déplie son texte (une seule section ouverte à la fois)
  R.mount = function (host, openId) {
    U.clear(host);
    var openBody = null, openHead = null;
    SECTIONS.forEach(function (sec) {
      var head = U.button(sec.title, 'btn rules-head');
      var wrap = U.el('div', 'rules-sec');
      wrap.appendChild(head);
      function toggle(show) {
        if (openBody) { openBody.parentNode.removeChild(openBody); U.removeClass(openHead, 'open'); }
        var same = openHead === head;
        openBody = null; openHead = null;
        if (show === false || same) return;
        openBody = body(sec);
        wrap.appendChild(openBody);
        U.addClass(head, 'open');
        openHead = head;
        if (head.scrollIntoView) head.scrollIntoView();
      }
      U.on(head, 'click', function () { toggle(); });
      host.appendChild(wrap);
      if (sec.id === openId) toggle(true);
    });
  };

  R.dialog = function (id, buttons) {
    var sec = byId(id) || SECTIONS[0];
    var node = U.el('div', 'rules-dlg');
    node.appendChild(body(sec));
    U.dialog({ title: sec.title, node: node, buttons: buttons || [{ label: 'Fermer', primary: true }] });
  };

  // Section à ouvrir depuis le menu d'une partie
  R.sectionFor = function (ctrl) {
    var g = ctrl && ctrl.game;
    if (g && g.variant) return g.variant === 'yalta' ? 'yalta' : 'cross4';
    if (g && g.startFen && g.startFen !== Chess.START) return '960';
    return 'classic';
  };

  R.sections = SECTIONS;
})();
