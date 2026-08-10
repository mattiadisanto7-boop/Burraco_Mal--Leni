const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const CUSTOM_AUDIO_KEYS = new Set([
  'vabbe-solo-un-gioco',
  'ti-faccio-un-regalo',
  'scompagnato',
  'mo-tu-hai-le-botte',
  'paride-smettila',
  'mo-devi-essere-seviziato',
  'che-cose-questa-novita',
  'aiaaa-paride',
  'stai-facendo-il-gioco-degli-stupidi',
  'hai-finito-di-vivere',
  'parideee'
]);
const TABLE_BACKGROUNDS = new Set(['beige', 'blue']);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.6.0' }));

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  for (let copy = 1; copy <= 2; copy++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ id: `${copy}-${suit}-${rank}`, rank, suit, joker: false });
      }
    }
    for (let j = 1; j <= 2; j++) {
      deck.push({ id: `${copy}-joker-${j}`, rank: 'JOKER', suit: 'joker', joker: true });
    }
  }
  return shuffle(deck);
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshPlayer({ name, token, socketId }) {
  return {
    id: crypto.randomUUID(),
    token: token || crypto.randomUUID(),
    name: normalizeName(name),
    socketId,
    connected: true,
    hand: [],
    melds: [],
    potTaken: false,
    matchScore: 0,
    stats: { draws: 0, discardPickups: 0, cardsPickedFromDiscard: 0, melds: 0, cardsMelded: 0, cleanBurracos: 0, semiBurracos: 0, dirtyBurracos: 0, pots: 0, closes: 0, handsWon: 0, bestHand: null }
  };
}

function startHand(room, firstHand = false) {
  const deck = createDeck();
  room.players.forEach(p => {
    p.hand = [];
    p.melds = [];
    p.potTaken = false;
  });

  for (let i = 0; i < 11; i++) {
    room.players[0].hand.push(deck.pop());
    room.players[1].hand.push(deck.pop());
  }

  room.pots = [[], []];
  for (let i = 0; i < 11; i++) room.pots[0].push(deck.pop());
  for (let i = 0; i < 11; i++) room.pots[1].push(deck.pop());

  room.discardPile = [deck.pop()];
  room.deck = deck;
  room.turnPlayerId = room.players[crypto.randomInt(2)].id;
  room.turnStage = 'draw';
  room.started = true;
  room.status = 'playing';
  room.handNumber = (room.handNumber || 0) + 1;
  room.handResult = null;
  room.winner = null;
  setEvent(room, firstHand ? 'start' : 'new-hand', null,
    `Mano ${room.handNumber}: comincia ${playerById(room, room.turnPlayerId)?.name}.`, ['start']);
}

function startGame(room) {
  room.matchId = room.matchId || crypto.randomUUID();
  room.matchStartedAt = room.matchStartedAt || Date.now();
  room.targetScore = 1005;
  room.handNumber = 0;
  room.players.forEach(p => { p.matchScore = 0; });
  startHand(room, true);
}

function setEvent(room, type, player, message, sounds = [type], extra = {}) {
  room.eventSeq = (room.eventSeq || 0) + 1;
  room.lastAction = message;
  room.lastEvent = {
    seq: room.eventSeq,
    type,
    playerId: player?.id || null,
    playerName: player?.name || null,
    sounds,
    ...extra
  };
}

function publicCard(card) {
  return card ? { ...card } : null;
}

function publicMeld(meld) {
  return {
    id: meld.id,
    type: meld.type,
    cards: meld.cards.map(publicCard),
    burraco: meld.burraco,
    clean: meld.clean,
    burracoType: meld.burracoType || (meld.clean ? 'clean' : meld.burraco ? 'dirty' : null)
  };
}

function stateFor(room, player) {
  const opponent = room.players.find(p => p.id !== player.id);
  return {
    roomCode: room.code,
    tableBg: room.tableBg || 'beige',
    status: room.status,
    started: room.started,
    winner: room.winner,
    matchId: room.matchId,
    targetScore: room.targetScore || 1005,
    handNumber: room.handNumber || 1,
    handResult: room.handResult || null,
    matchStartedAt: room.matchStartedAt || null,
    you: {
      id: player.id,
      name: player.name,
      hand: player.hand.map(publicCard),
      melds: player.melds.map(publicMeld),
      potTaken: player.potTaken,
      burracoCount: player.melds.filter(m => m.burraco).length,
      matchScore: player.matchScore || 0,
      stats: { ...player.stats }
    },
    opponent: opponent ? {
      id: opponent.id,
      name: opponent.name,
      cardCount: opponent.hand.length,
      connected: opponent.connected,
      melds: opponent.melds.map(publicMeld),
      potTaken: opponent.potTaken,
      burracoCount: opponent.melds.filter(m => m.burraco).length,
      matchScore: opponent.matchScore || 0,
      stats: { ...opponent.stats }
    } : null,
    deckCount: room.deck.length,
    discardPile: room.discardPile.map(publicCard),
    pots: room.pots.map(p => ({ cardCount: p.length })),
    isYourTurn: room.turnPlayerId === player.id,
    turnStage: room.turnStage,
    turnPlayerName: playerById(room, room.turnPlayerId)?.name || null,
    lastAction: room.lastAction,
    lastEvent: room.lastEvent
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit('game-state', stateFor(room, player));
  }
}

function roomAndPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.find(p => p.id === socket.data.playerId);
  return { room, player };
}

function playerById(room, id) {
  return room.players.find(p => p.id === id);
}

function normalizeName(name) {
  const cleaned = String(name || '').trim().slice(0, 20);
  return cleaned || 'Giocatore';
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function symbolFor(suit) {
  return ({ hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '🃏' })[suit] || '';
}

function cardLabel(card) {
  return card.joker ? '🃏' : `${card.rank}${symbolFor(card.suit)}`;
}

function cardsFromHand(player, cardIds) {
  if (!Array.isArray(cardIds)) return { error: 'Selezione non valida.' };
  const unique = [...new Set(cardIds)];
  if (unique.length !== cardIds.length) return { error: 'La stessa carta è stata selezionata più volte.' };
  const cards = unique.map(id => player.hand.find(c => c.id === id));
  if (cards.some(c => !c)) return { error: 'Una delle carte selezionate non è più nella tua mano.' };
  return { cards };
}

function removeCards(player, cards) {
  const ids = new Set(cards.map(c => c.id));
  player.hand = player.hand.filter(c => !ids.has(c.id));
}

function rankValue(rank, aceHigh = false) {
  if (rank === 'A') return aceHigh ? 14 : 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank);
}

function validateGroup(cards) {
  if (cards.length < 3) return null;
  const nonJokers = cards.filter(c => !c.joker);
  const fixedNonTwos = nonJokers.filter(c => c.rank !== '2');
  const target = fixedNonTwos[0]?.rank || (nonJokers.length ? '2' : null);
  if (!target) return null;

  const wild = [];
  const natural = [];
  for (const card of cards) {
    if (card.joker || (card.rank === '2' && target !== '2')) wild.push(card);
    else natural.push(card);
  }
  if (wild.length > 1) return null;
  if (!natural.length || natural.some(c => c.rank !== target)) return null;

  return {
    type: 'group',
    cards: [...natural, ...wild],
    wildIds: new Set(wild.map(c => c.id))
  };
}

function validateRun(cards) {
  if (cards.length < 3) return null;
  const twos = cards.filter(c => !c.joker && c.rank === '2');
  const naturalTwoOptions = [...twos.map(c => c.id), null];

  for (const naturalTwoId of naturalTwoOptions) {
    const wild = cards.filter(c => c.joker || (c.rank === '2' && c.id !== naturalTwoId));
    if (wild.length > 1) continue;
    const natural = cards.filter(c => !wild.some(w => w.id === c.id));
    if (!natural.length) continue;

    const suit = natural[0].suit;
    if (natural.some(c => c.suit !== suit || c.joker)) continue;

    for (const aceHigh of [false, true]) {
      const values = natural.map(c => rankValue(c.rank, aceHigh));
      if (new Set(values).size !== values.length) continue;
      const minStart = aceHigh ? 2 : 1;
      const maxEnd = 14;
      const length = cards.length;

      for (let start = minStart; start + length - 1 <= maxEnd; start++) {
        const positions = Array.from({ length }, (_, i) => start + i);
        if (values.some(v => !positions.includes(v))) continue;
        if (positions.filter(v => !values.includes(v)).length !== wild.length) continue;

        const naturalByValue = new Map(natural.map(c => [rankValue(c.rank, aceHigh), c]));
        const remainingWild = [...wild];
        const ordered = positions.map(v => naturalByValue.get(v) || remainingWild.shift());
        return {
          type: 'run',
          cards: ordered,
          wildIds: new Set(wild.map(c => c.id))
        };
      }
    }
  }
  return null;
}

function validateMeld(cards, preferredType = null) {
  if (!Array.isArray(cards) || cards.length < 3) return { ok: false, error: 'Servono almeno 3 carte.' };

  let result = null;
  if (preferredType === 'group') result = validateGroup(cards);
  else if (preferredType === 'run') result = validateRun(cards);
  else result = validateGroup(cards) || validateRun(cards);

  if (!result) {
    return { ok: false, error: 'Combinazione non valida: usa carte dello stesso valore oppure una scala dello stesso seme.' };
  }

  const burraco = result.cards.length >= 7;
  const clean = burraco && result.wildIds.size === 0;
  return { ok: true, ...result, burraco, clean };
}

function playerHasBurraco(player) {
  return player.melds.some(m => m.burraco);
}

function availablePot(room) {
  return room.pots.findIndex(p => p.length > 0);
}

function givePotIfNeeded(room, player) {
  if (player.hand.length || player.potTaken) return false;
  const potIndex = availablePot(room);
  if (potIndex === -1) return false;
  player.hand.push(...room.pots[potIndex]);
  room.pots[potIndex] = [];
  player.potTaken = true;
  player.stats.pots++;
  return true;
}

function cardPoints(card) {
  if (!card) return 0;
  if (card.joker) return 30;
  if (card.rank === '2') return 20;
  if (card.rank === 'A') return 15;
  if (['K','Q','J','10','9','8'].includes(card.rank)) return 10;
  return 5;
}

function burracoTypeFor(validation) {
  if (!validation.burraco) return null;
  const wildCount = validation.wildIds?.size || 0;
  if (wildCount === 0) return 'clean';
  if (validation.type === 'group' && validation.cards.length >= 8) return 'semi';
  if (validation.type === 'run' && validation.cards.length >= 8) {
    const wildIds = validation.wildIds || new Set();
    if (wildIds.has(validation.cards[0]?.id) || wildIds.has(validation.cards.at(-1)?.id)) return 'semi';
  }
  return 'dirty';
}

function burracoBonus(meld) {
  const type = meld.burracoType || (meld.clean ? 'clean' : 'dirty');
  return type === 'clean' ? 200 : type === 'semi' ? 150 : 100;
}

function scorePlayerHand(room, player, closed) {
  const tableCards = player.melds.flatMap(m => m.cards);
  const tablePoints = tableCards.reduce((sum, c) => sum + cardPoints(c), 0);
  const burracoPoints = player.melds.filter(m => m.burraco).reduce((sum, m) => sum + burracoBonus(m), 0);
  const handPenalty = player.hand.reduce((sum, c) => sum + cardPoints(c), 0);
  const bothMissedPot = room.players.every(p => !p.potTaken);
  const potPenalty = !player.potTaken && !bothMissedPot ? 100 : 0;
  const closeBonus = closed ? 100 : 0;
  const total = tablePoints + burracoPoints + closeBonus - handPenalty - potPenalty;
  return { tablePoints, burracoPoints, closeBonus, handPenalty, potPenalty, total };
}

function finishHand(room, closingPlayer) {
  if (room.status !== 'playing') return;
  const scores = room.players.map(p => ({
    playerId: p.id,
    playerName: p.name,
    breakdown: scorePlayerHand(room, p, p.id === closingPlayer?.id)
  }));
  for (const entry of scores) {
    const p = playerById(room, entry.playerId);
    p.matchScore += entry.breakdown.total;
    p.stats.bestHand = p.stats.bestHand == null ? entry.breakdown.total : Math.max(p.stats.bestHand, entry.breakdown.total);
  }
  if (closingPlayer) closingPlayer.stats.closes++;
  const best = Math.max(...scores.map(s => s.breakdown.total));
  const handWinners = scores.filter(s => s.breakdown.total === best);
  if (handWinners.length === 1) playerById(room, handWinners[0].playerId).stats.handsWon++;

  room.handResult = {
    handNumber: room.handNumber,
    closedBy: closingPlayer ? { id: closingPlayer.id, name: closingPlayer.name } : null,
    scores,
    totals: room.players.map(p => ({ playerId: p.id, playerName: p.name, score: p.matchScore }))
  };

  const topScore = Math.max(...room.players.map(p => p.matchScore));
  const leaders = room.players.filter(p => p.matchScore === topScore);
  if (topScore >= (room.targetScore || 1005) && leaders.length === 1) {
    const winner = leaders[0];
    room.status = 'match-finished';
    room.winner = { id: winner.id, name: winner.name };
    room.turnPlayerId = null;
    room.turnStage = 'finished';
    room.matchEndedAt = Date.now();
    setEvent(room, 'end', winner, `${winner.name} vince la partita a ${winner.matchScore} punti!`, ['end'], { reason: 'score' });
  } else {
    room.status = 'hand-ended';
    room.turnPlayerId = null;
    room.turnStage = 'between-hands';
    setEvent(room, 'hand-end', closingPlayer, `Mano ${room.handNumber} terminata. Guarda il riepilogo e premi “Mano successiva” quando vuoi continuare.`, ['end']);
  }
}

function ensureCanAct(room, player, ack) {
  if (!room || !player) { ack({ ok: false, error: 'Partita non trovata.' }); return false; }
  if (!room.started || room.status !== 'playing') { ack({ ok: false, error: 'La partita non è in corso.' }); return false; }
  if (room.turnPlayerId !== player.id) { ack({ ok: false, error: 'Non è il tuo turno.' }); return false; }
  return true;
}

io.on('connection', socket => {
  socket.on('create-room', ({ name, token, tableBg }, ack = () => {}) => {
    const code = makeRoomCode();
    const player = freshPlayer({ name, token, socketId: socket.id });
    const room = {
      code,
      tableBg: TABLE_BACKGROUNDS.has(tableBg) ? tableBg : 'beige',
      players: [player],
      deck: [],
      pots: [[], []],
      discardPile: [],
      turnPlayerId: null,
      turnStage: 'draw',
      started: false,
      status: 'waiting',
      winner: null,
      matchId: crypto.randomUUID(),
      matchStartedAt: Date.now(),
      targetScore: 1005,
      handNumber: 0,
      handResult: null,
      eventSeq: 0,
      lastEvent: null,
      lastAction: `${player.name} ha creato la stanza.`
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    ack({ ok: true, code, token: player.token });
    emitRoom(room);
  });

  socket.on('join-room', ({ code, name, token }, ack = () => {}) => {
    code = normalizeCode(code);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });

    let player = token ? room.players.find(p => p.token === token) : null;
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      player.name = normalizeName(name || player.name);
    } else {
      if (room.players.length >= 2) return ack({ ok: false, error: 'La stanza è già piena.' });
      player = freshPlayer({ name, token, socketId: socket.id });
      room.players.push(player);
      room.lastAction = `${player.name} è entrato nella stanza.`;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    if (room.players.length === 2 && !room.started) startGame(room);
    else if (room.started) setEvent(room, 'join', player, `${player.name} si è riconnesso.`, ['join']);

    ack({ ok: true, code, token: player.token });
    emitRoom(room);
  });

  socket.on('start-next-hand', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Partita non trovata.' });
    if (room.status !== 'hand-ended') return ack({ ok: false, error: 'La prossima mano non può ancora iniziare.' });
    if (room.players.length !== 2) return ack({ ok: false, error: 'Manca l’altro giocatore.' });

    startHand(room, false);
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('draw-deck', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage !== 'draw') return ack({ ok: false, error: 'Hai già pescato.' });
    if (!room.deck.length) return ack({ ok: false, error: 'Il tallone è terminato.' });

    const card = room.deck.pop();
    player.hand.push(card);
    player.stats.draws++;
    room.turnStage = 'play';
    setEvent(room, 'draw', player, `${player.name} ha pescato dal tallone.`, ['draw']);
    ack({ ok: true, cardId: card.id });
    emitRoom(room);
  });

  socket.on('take-discard', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage !== 'draw') return ack({ ok: false, error: 'Hai già pescato.' });
    if (!room.discardPile.length) return ack({ ok: false, error: 'Il monte scarti è vuoto.' });

    const count = room.discardPile.length;
    player.hand.push(...room.discardPile);
    player.stats.discardPickups++;
    player.stats.cardsPickedFromDiscard += count;
    room.discardPile = [];
    room.turnStage = 'play';
    setEvent(room, 'take-discard', player, `${player.name} ha raccolto tutti gli scarti (${count} carte).`, ['take-discard']);
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('play-meld', ({ cardIds }, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage === 'draw') return ack({ ok: false, error: 'Prima devi pescare.' });

    const picked = cardsFromHand(player, cardIds);
    if (picked.error) return ack({ ok: false, error: picked.error });
    const validation = validateMeld(picked.cards);
    if (!validation.ok) return ack({ ok: false, error: validation.error });

    if (player.potTaken && picked.cards.length === player.hand.length) {
      return ack({ ok: false, error: 'Per chiudere devi conservare una carta da scartare.' });
    }

    removeCards(player, picked.cards);
    const bType = burracoTypeFor(validation);
    const meld = {
      id: crypto.randomUUID(),
      type: validation.type,
      cards: validation.cards,
      burraco: validation.burraco,
      clean: bType === 'clean',
      burracoType: bType
    };
    player.melds.push(meld);
    player.stats.melds++;
    player.stats.cardsMelded += picked.cards.length;
    if (bType === 'clean') player.stats.cleanBurracos++;
    else if (bType === 'semi') player.stats.semiBurracos++;
    else if (bType === 'dirty') player.stats.dirtyBurracos++;

    const gotPot = givePotIfNeeded(room, player);
    const sounds = ['play'];
    if (validation.burraco) sounds.push('burraco');
    if (gotPot) sounds.push('pot');

    const burracoText = validation.burraco ? ` È un Burraco ${bType === 'clean' ? 'pulito' : bType === 'semi' ? 'semipulito' : 'sporco'}!` : '';
    const potText = gotPot ? ' Ha preso il pozzetto!' : '';
    setEvent(room, validation.burraco ? 'burraco' : 'play', player,
      `${player.name} ha calato ${picked.cards.length} carte.${burracoText}${potText}`, sounds,
      { meldId: meld.id });

    ack({ ok: true, meldId: meld.id });
    emitRoom(room);
  });

  socket.on('add-to-meld', ({ meldId, cardIds }, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage === 'draw') return ack({ ok: false, error: 'Prima devi pescare.' });

    const meld = player.melds.find(m => m.id === meldId);
    if (!meld) return ack({ ok: false, error: 'Combinazione non trovata.' });
    const picked = cardsFromHand(player, cardIds);
    if (picked.error) return ack({ ok: false, error: picked.error });
    if (!picked.cards.length) return ack({ ok: false, error: 'Seleziona almeno una carta.' });

    const validation = validateMeld([...meld.cards, ...picked.cards], meld.type);
    if (!validation.ok) return ack({ ok: false, error: 'Queste carte non possono essere aggiunte a quella combinazione.' });

    if (player.potTaken && picked.cards.length === player.hand.length) {
      return ack({ ok: false, error: 'Per chiudere devi conservare una carta da scartare.' });
    }

    const becameBurraco = !meld.burraco && validation.burraco;
    removeCards(player, picked.cards);
    const oldType = meld.burracoType || null;
    const newType = burracoTypeFor(validation);
    meld.cards = validation.cards;
    meld.burraco = validation.burraco;
    meld.clean = newType === 'clean';
    meld.burracoType = newType;
    player.stats.cardsMelded += picked.cards.length;
    if (becameBurraco) {
      if (newType === 'clean') player.stats.cleanBurracos++;
      else if (newType === 'semi') player.stats.semiBurracos++;
      else if (newType === 'dirty') player.stats.dirtyBurracos++;
    } else if (oldType && newType && oldType !== newType) {
      const map = { clean: 'cleanBurracos', semi: 'semiBurracos', dirty: 'dirtyBurracos' };
      player.stats[map[oldType]] = Math.max(0, player.stats[map[oldType]] - 1);
      player.stats[map[newType]]++;
    }

    const gotPot = givePotIfNeeded(room, player);
    const sounds = ['play'];
    if (becameBurraco) sounds.push('burraco');
    if (gotPot) sounds.push('pot');

    const burracoText = becameBurraco ? ` Ha completato un Burraco ${meld.burracoType === 'clean' ? 'pulito' : meld.burracoType === 'semi' ? 'semipulito' : 'sporco'}!` : '';
    const potText = gotPot ? ' Ha preso il pozzetto!' : '';
    setEvent(room, becameBurraco ? 'burraco' : 'play', player,
      `${player.name} ha aggiunto ${picked.cards.length} ${picked.cards.length === 1 ? 'carta' : 'carte'}.${burracoText}${potText}`,
      sounds, { meldId: meld.id });

    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('discard-card', ({ cardId }, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage === 'draw') return ack({ ok: false, error: 'Prima devi pescare.' });

    const index = player.hand.findIndex(c => c.id === cardId);
    if (index === -1) return ack({ ok: false, error: 'Carta non valida.' });

    const wouldEmptyHand = player.hand.length === 1;
    if (wouldEmptyHand && player.potTaken && !playerHasBurraco(player)) {
      return ack({ ok: false, error: 'Per chiudere devi prima completare almeno un Burraco.' });
    }

    const [card] = player.hand.splice(index, 1);
    room.discardPile.push(card);

    if (player.hand.length === 0 && player.potTaken && playerHasBurraco(player)) {
      setEvent(room, 'close', player, `${player.name} ha chiuso la mano!`, ['discard', 'end']);
      finishHand(room, player);
      ack({ ok: true, finished: true });
      emitRoom(room);
      return;
    }

    const gotPot = givePotIfNeeded(room, player);
    const next = room.players.find(p => p.id !== player.id);
    room.turnPlayerId = next.id;
    room.turnStage = 'draw';

    const potText = gotPot ? ' Ha preso il pozzetto e lo userà al prossimo turno.' : '';
    setEvent(room, 'discard', player, `${player.name} ha scartato ${cardLabel(card)}.${potText}`,
      gotPot ? ['discard', 'pot'] : ['discard']);

    ack({ ok: true });
    emitRoom(room);
  });


  socket.on('change-table-bg', ({ tableBg } = {}, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Non sei dentro una partita.' });
    if (!TABLE_BACKGROUNDS.has(tableBg)) return ack({ ok: false, error: 'Sfondo non valido.' });

    room.tableBg = tableBg;
    const label = tableBg === 'beige' ? 'telo beige' : 'telo blu';
    setEvent(room, 'background', player, `${player.name} ha scelto il ${label}.`, []);
    ack({ ok: true, tableBg });
    emitRoom(room);
  });

  socket.on('leave-game', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Non sei dentro una partita.' });

    const code = room.code;
    const opponent = room.players.find(p => p.id !== player.id);

    if (!room.started && room.players.length === 1) {
      rooms.delete(code);
    } else if (room.started && room.status !== 'match-finished' && opponent) {
      room.status = 'match-finished';
      room.winner = { id: opponent.id, name: opponent.name };
      room.turnPlayerId = null;
      room.turnStage = 'finished';
      room.matchEndedAt = Date.now();
      setEvent(room, 'end', player, `${player.name} ha abbandonato la partita. ${opponent.name} vince!`, ['end'], { reason: 'abandon' });
      player.connected = false;
      player.socketId = null;
    } else {
      player.connected = false;
      player.socketId = null;
    }

    socket.leave(code);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    ack({ ok: true });

    if (rooms.has(code)) emitRoom(room);
  });

  socket.on('custom-audio', ({ key } = {}, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Non sei dentro una partita.' });
    if (!CUSTOM_AUDIO_KEYS.has(key)) return ack({ ok: false, error: 'Audio non valido.' });

    const now = Date.now();
    if (socket.data.lastCustomAudioAt && now - socket.data.lastCustomAudioAt < 650) {
      return ack({ ok: false, error: 'Aspetta un attimo prima di inviare un altro audio.' });
    }
    socket.data.lastCustomAudioAt = now;

    io.to(room.code).emit('custom-audio', { key, playerId: player.id, playerName: player.name });
    ack({ ok: true });
  });

  socket.on('leave-room', () => socket.disconnect(true));

  socket.on('disconnect', () => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return;
    player.connected = false;
    player.socketId = null;
    room.lastAction = `${player.name} si è disconnesso.`;
    emitRoom(room);

    setTimeout(() => {
      const current = rooms.get(room.code);
      if (current && current.players.every(p => !p.connected)) rooms.delete(room.code);
    }, 30 * 60 * 1000);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Burraco 1v1 v0.6.0 avviato sulla porta ${PORT}`);
});
