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
app.get('/health', (_req, res) => res.json({ ok: true }));

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
        deck.push({
          id: `${copy}-${suit}-${rank}`,
          rank,
          suit,
          joker: false
        });
      }
    }
    for (let j = 1; j <= 2; j++) {
      deck.push({
        id: `${copy}-joker-${j}`,
        rank: 'JOKER',
        suit: 'joker',
        joker: true
      });
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

function startGame(room) {
  const deck = createDeck();
  room.players.forEach(p => { p.hand = []; });

  // 11 carte a testa, alternate.
  for (let i = 0; i < 11; i++) {
    room.players[0].hand.push(deck.pop());
    room.players[1].hand.push(deck.pop());
  }

  // Due pozzetti da 11 carte.
  room.pots = [[], []];
  for (let i = 0; i < 11; i++) room.pots[0].push(deck.pop());
  for (let i = 0; i < 11; i++) room.pots[1].push(deck.pop());

  // Prima carta scoperta del monte scarti.
  room.discardPile = [deck.pop()];
  room.deck = deck;
  room.turnPlayerId = room.players[crypto.randomInt(2)].id;
  room.turnStage = 'draw';
  room.started = true;
  room.status = 'playing';
  room.lastAction = 'La partita è iniziata.';
}

function publicCard(card) {
  return card ? { ...card } : null;
}

function stateFor(room, player) {
  const opponent = room.players.find(p => p.id !== player.id);
  return {
    roomCode: room.code,
    status: room.status,
    started: room.started,
    you: {
      id: player.id,
      name: player.name,
      hand: player.hand.map(publicCard)
    },
    opponent: opponent ? {
      name: opponent.name,
      cardCount: opponent.hand.length,
      connected: opponent.connected
    } : null,
    deckCount: room.deck.length,
    discardPile: room.discardPile.map(publicCard),
    discardTop: publicCard(room.discardPile.at(-1)),
    pots: room.pots.map(p => ({ cardCount: p.length })),
    isYourTurn: room.turnPlayerId === player.id,
    turnStage: room.turnStage,
    turnPlayerName: room.players.find(p => p.id === room.turnPlayerId)?.name || null,
    lastAction: room.lastAction
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit('game-state', stateFor(room, player));
  }
}

function roomAndPlayer(socket) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  const room = rooms.get(code);
  const player = room?.players.find(p => p.id === playerId);
  return { room, player };
}

function normalizeName(name) {
  const cleaned = String(name || '').trim().slice(0, 20);
  return cleaned || 'Giocatore';
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

io.on('connection', socket => {
  socket.on('create-room', ({ name, token }, ack = () => {}) => {
    const code = makeRoomCode();
    const player = {
      id: crypto.randomUUID(),
      token: token || crypto.randomUUID(),
      name: normalizeName(name),
      socketId: socket.id,
      connected: true,
      hand: []
    };

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

    // Riconnessione tramite token.
    let player = token ? room.players.find(p => p.token === token) : null;
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      player.name = normalizeName(name || player.name);
    } else {
      if (room.players.length >= 2) return ack({ ok: false, error: 'La stanza è già piena.' });
      player = {
        id: crypto.randomUUID(),
        token: token || crypto.randomUUID(),
        name: normalizeName(name),
        socketId: socket.id,
        connected: true,
        hand: []
      };
      room.players.push(player);
      room.lastAction = `${player.name} è entrato nella stanza.`;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    if (room.players.length === 2 && !room.started) startGame(room);

    ack({ ok: true, code, token: player.token });
    emitRoom(room);
  });

  socket.on('draw-deck', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Partita non trovata.' });
    if (!room.started) return ack({ ok: false, error: 'La partita non è ancora iniziata.' });
    if (room.turnPlayerId !== player.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    if (room.turnStage !== 'draw') return ack({ ok: false, error: 'Hai già pescato.' });
    if (!room.deck.length) return ack({ ok: false, error: 'Il tallone è terminato.' });

    const card = room.deck.pop();
    player.hand.push(card);
    room.turnStage = 'discard';
    room.lastAction = `${player.name} ha pescato dal tallone.`;
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('take-discard', (ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Partita non trovata.' });
    if (!room.started) return ack({ ok: false, error: 'La partita non è ancora iniziata.' });
    if (room.turnPlayerId !== player.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    if (room.turnStage !== 'draw') return ack({ ok: false, error: 'Hai già pescato.' });
    if (!room.discardPile.length) return ack({ ok: false, error: 'Il monte scarti è vuoto.' });

    player.hand.push(...room.discardPile);
    const count = room.discardPile.length;
    room.discardPile = [];
    room.turnStage = 'discard';
    room.lastAction = `${player.name} ha raccolto il monte scarti (${count} carte).`;
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('discard-card', ({ cardId }, ack = () => {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return ack({ ok: false, error: 'Partita non trovata.' });
    if (!room.started) return ack({ ok: false, error: 'La partita non è ancora iniziata.' });
    if (room.turnPlayerId !== player.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    if (room.turnStage !== 'discard') return ack({ ok: false, error: 'Prima devi pescare.' });

    const index = player.hand.findIndex(c => c.id === cardId);
    if (index === -1) return ack({ ok: false, error: 'Carta non valida.' });

    const [card] = player.hand.splice(index, 1);
    room.discardPile.push(card);
    const next = room.players.find(p => p.id !== player.id);
    room.turnPlayerId = next.id;
    room.turnStage = 'draw';
    room.lastAction = `${player.name} ha scartato ${card.rank}${symbolFor(card.suit)}.`;

    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('leave-room', () => {
    socket.disconnect(true);
  });

  socket.on('disconnect', () => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player) return;
    player.connected = false;
    player.socketId = null;
    room.lastAction = `${player.name} si è disconnesso.`;
    emitRoom(room);

    // Elimina stanze vuote dopo 30 minuti.
    setTimeout(() => {
      const current = rooms.get(room.code);
      if (current && current.players.every(p => !p.connected)) rooms.delete(room.code);
    }, 30 * 60 * 1000);
  });
});

function symbolFor(suit) {
  return ({ hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '🃏' })[suit] || '';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Burraco 1v1 avviato sulla porta ${PORT}`);
});
