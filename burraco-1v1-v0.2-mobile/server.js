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

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.2.0' }));

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
    potTaken: false
  };
}

function startGame(room) {
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
  room.winner = null;
  setEvent(room, 'start', null, `La partita è iniziata. Comincia ${playerById(room, room.turnPlayerId)?.name}.`, ['start']);
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
    clean: meld.clean
  };
}

function stateFor(room, player) {
  const opponent = room.players.find(p => p.id !== player.id);
  return {
    roomCode: room.code,
    status: room.status,
    started: room.started,
    winner: room.winner,
    you: {
      id: player.id,
      name: player.name,
      hand: player.hand.map(publicCard),
      melds: player.melds.map(publicMeld),
      potTaken: player.potTaken,
      burracoCount: player.melds.filter(m => m.burraco).length
    },
    opponent: opponent ? {
      id: opponent.id,
      name: opponent.name,
      cardCount: opponent.hand.length,
      connected: opponent.connected,
      melds: opponent.melds.map(publicMeld),
      potTaken: opponent.potTaken,
      burracoCount: opponent.melds.filter(m => m.burraco).length
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
  return true;
}

function ensureCanAct(room, player, ack) {
  if (!room || !player) { ack({ ok: false, error: 'Partita non trovata.' }); return false; }
  if (!room.started || room.status !== 'playing') { ack({ ok: false, error: 'La partita non è in corso.' }); return false; }
  if (room.turnPlayerId !== player.id) { ack({ ok: false, error: 'Non è il tuo turno.' }); return false; }
  return true;
}

io.on('connection', socket => {
  socket.on('create-room', ({ name, token }, ack = () => {}) => {
    const code = makeRoomCode();
    const player = freshPlayer({ name, token, socketId: socket.id });
    const room = {
      code,
      players: [player],
      deck: [],
      pots: [[], []],
      discardPile: [],
      turnPlayerId: null,
      turnStage: 'draw',
      started: false,
      status: 'waiting',
      winner: null,
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

  socket.on('draw-deck', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!ensureCanAct(room, player, ack)) return;
    if (room.turnStage !== 'draw') return ack({ ok: false, error: 'Hai già pescato.' });
    if (!room.deck.length) return ack({ ok: false, error: 'Il tallone è terminato.' });

    const card = room.deck.pop();
    player.hand.push(card);
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
    const meld = {
      id: crypto.randomUUID(),
      type: validation.type,
      cards: validation.cards,
      burraco: validation.burraco,
      clean: validation.clean
    };
    player.melds.push(meld);

    const gotPot = givePotIfNeeded(room, player);
    const sounds = ['play'];
    if (validation.burraco) sounds.push('burraco');
    if (gotPot) sounds.push('pot');

    const burracoText = validation.burraco ? ` È un Burraco ${validation.clean ? 'pulito' : 'sporco'}!` : '';
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
    meld.cards = validation.cards;
    meld.burraco = validation.burraco;
    meld.clean = validation.clean;

    const gotPot = givePotIfNeeded(room, player);
    const sounds = ['play'];
    if (becameBurraco) sounds.push('burraco');
    if (gotPot) sounds.push('pot');

    const burracoText = becameBurraco ? ` Ha completato un Burraco ${meld.clean ? 'pulito' : 'sporco'}!` : '';
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
      room.status = 'finished';
      room.winner = { id: player.id, name: player.name };
      room.turnPlayerId = null;
      room.turnStage = 'finished';
      setEvent(room, 'end', player, `${player.name} ha chiuso la partita!`, ['discard', 'end']);
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
  console.log(`Burraco 1v1 v0.2.0 avviato sulla porta ${PORT}`);
});
