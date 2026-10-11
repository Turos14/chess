Stockfish.js 10 — portage WebAssembly/asm.js du moteur d'échecs Stockfish pour le navigateur.
Source : https://github.com/nmrugg/stockfish.js (paquet npm "stockfish", version 10.0.2)
Moteur d'origine : https://stockfishchess.org — © T. Romstad, M. Costalba, J. Kiiski, G. Linscott et contributeurs.
Licence : GPL-3.0 (voir stockfish-LICENSE.txt).

Choix de version : la 10.0.2 est la dernière avant l'évaluation NNUE, qui nécessite un fichier de réseau de
plusieurs dizaines de Mo (les versions récentes de Stockfish.js dépassent 40-200 Mo). Cette version pèse environ
430 Ko (stockfish.js + stockfish.wasm) et reste très largement plus forte que n'importe quel joueur humain.

Utilisée par public/js/engine.js (chargée en Web Worker, protocole UCI via postMessage). Voir
public/js/engineStrength.js pour la calibration approximative Elo -> réglages du moteur (cette version n'a pas
les options UCI_LimitStrength / UCI_Elo des versions récentes).
