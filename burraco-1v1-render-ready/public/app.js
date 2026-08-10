const socket = io();

const $ = id => document.getElementById(id);
const home = $('home');
const lobby = $('lobby');
const game = $('game');
const nameInput = $('nameInput');
const roomInput = $('roomInput');
const homeError = $('homeError');
const gameError = $('gameError');

let currentState = null;
let selectedCardId = null;
let localHandOrder = [];
let reconnectData = readSession();

if (reconnectData?.name) nameInput.value = reconnectData.name;

$('createBtn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return setHomeError('Inserisci il tuo nome.');
  socket.emit('create-room', { name, token: reconnectData?.token }, result => {
    if (!result.ok) return setHomeError(result.error);
    saveSession({ code: result.code, token: result.token, name });
    reconnectData = readSession();
    showLobby(result.code);
  });
});

$('joinBtn').addEventListener('click', () => {
  joinRoom(roomInput.value);
});

roomInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom(roomInput.value);
});

$('copyCode').addEventListener('click', async () => {
  const code = $('copyCode').textContent;
  try {
    await navigator.clipboard.writeText(code);
    $('copyCode').textContent = 'COPIATO!';
    setTimeout(() => $('copyCode').textContent = code, 900);
  } catch (_) {}
});

$('deckBtn').addEventListener('click', () => action('draw-deck'));
$('discardBtn').addEventListener('click', () => action('take-discard'));
$('discardSelected').addEventListener('click', () => {
  if (!selectedCardId) return;
  socket.emit('discard-card', { cardId: selectedCardId }, result => {
    if (!result.ok) return setGameError(result.error);
    selectedCardId = null;
  });
});

$('sortSuit').addEventListener('click', () => {
  if (!currentState) return;
  const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3, joker: 4 };
  const rankOrder = rankMap();
  localHandOrder = [...currentState.you.hand]
    .sort((a,b) => suitOrder[a.suit]-suitOrder[b.suit] || rankOrder[a.rank]-rankOrder[b.rank])
    .map(c => c.id);
  renderHand();
});

$('sortRank').addEventListener('click', () => {
  if (!currentState) return;
  const rankOrder = rankMap();
  const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3, joker: 4 };
  localHandOrder = [...currentState.you.hand]
    .sort((a,b) => rankOrder[a.rank]-rankOrder[b.rank] || suitOrder[a.suit]-suitOrder[b.suit])
    .map(c => c.id);
  renderHand();
});

socket.on('connect', () => {
  const s = readSession();
  if (s?.code && s?.token && s?.name) {
    socket.emit('join-room', s, result => {
      if (!result.ok) clearSession();
    });
  }
});

socket.on('game-state', state => {
  currentState = state;
  mergeHandOrder(state.you.hand);
  if (state.started) showGame();
  else showLobby(state.roomCode);
  render(state);
});

function joinRoom(rawCode) {
  const name = nameInput.value.trim();
  const code = rawCode.trim().toUpperCase();
  if (!name) return setHomeError('Inserisci il tuo nome.');
  if (code.length !== 6) return setHomeError('Inserisci il codice stanza di 6 caratteri.');

  const existing = readSession();
  const token = existing?.code === code ? existing.token : undefined;
  socket.emit('join-room', { code, name, token }, result => {
    if (!result.ok) return setHomeError(result.error);
    saveSession({ code: result.code, token: result.token, name });
    reconnectData = readSession();
  });
}

function action(eventName) {
  socket.emit(eventName, result => {
    if (!result.ok) setGameError(result.error);
  });
}

function render(state) {
  $('roomLabel').textContent = `Stanza ${state.roomCode}`;
  $('youName').textContent = state.you.name;
  $('handCount').textContent = `${state.you.hand.length} carte`;
  $('deckCount').textContent = state.deckCount;
  $('pot1').querySelector('b').textContent = state.pots[0].cardCount;
  $('pot2').querySelector('b').textContent = state.pots[1].cardCount;
  $('actionText').textContent = state.lastAction || '';

  if (state.opponent) {
    $('opponentName').textContent = state.opponent.name;
    $('opponentCount').textContent = `${state.opponent.cardCount} carte`;
    $('opponentStatus').classList.toggle('offline', !state.opponent.connected);
    $('opponentCards').innerHTML = Array.from({ length: Math.min(state.opponent.cardCount, 18) }, () => '<div class="card-back"></div>').join('');
  }

  const badge = $('turnBadge');
  if (state.isYourTurn) {
    badge.textContent = state.turnStage === 'draw' ? 'TOCCA A TE · PESCA' : 'TOCCA A TE · SCARTA';
    badge.classList.add('yours');
  } else {
    badge.textContent = `TURNO DI ${state.turnPlayerName || 'AVVERSARIO'}`;
    badge.classList.remove('yours');
  }

  $('deckBtn').disabled = !(state.isYourTurn && state.turnStage === 'draw' && state.deckCount > 0);
  $('discardBtn').disabled = !(state.isYourTurn && state.turnStage === 'draw' && state.discardPile.length > 0);
  $('discardSelected').disabled = !(state.isYourTurn && state.turnStage === 'discard' && selectedCardId);

  renderDiscard(state.discardTop);
  renderHand();
}

function renderDiscard(card) {
  const holder = $('discardCard');
  holder.innerHTML = card ? cardHtml(card) : '<span>Vuoto</span>';
}

function renderHand() {
  if (!currentState) return;
  const byId = new Map(currentState.you.hand.map(c => [c.id, c]));
  const ordered = localHandOrder.map(id => byId.get(id)).filter(Boolean);
  const holder = $('hand');
  holder.innerHTML = '';

  for (const card of ordered) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardHtml(card);
    const el = wrapper.firstElementChild;
    el.dataset.id = card.id;
    if (card.id === selectedCardId) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedCardId = selectedCardId === card.id ? null : card.id;
      renderHand();
      $('discardSelected').disabled = !(currentState.isYourTurn && currentState.turnStage === 'discard' && selectedCardId);
    });
    holder.appendChild(el);
  }
}

function cardHtml(card) {
  if (card.joker) {
    return `<div class="playing-card joker"><span>JOKER</span><span class="suit">🃏</span><span>★</span></div>`;
  }
  const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const symbol = symbols[card.suit];
  return `<div class="playing-card ${isRed ? 'red' : ''}"><span>${card.rank}${symbol}</span><span class="suit">${symbol}</span><span>${card.rank}</span></div>`;
}

function mergeHandOrder(hand) {
  const ids = new Set(hand.map(c => c.id));
  localHandOrder = localHandOrder.filter(id => ids.has(id));
  for (const c of hand) if (!localHandOrder.includes(c.id)) localHandOrder.push(c.id);
  if (selectedCardId && !ids.has(selectedCardId)) selectedCardId = null;
}

function rankMap() {
  return { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, JOKER: 99 };
}

function showLobby(code) {
  home.classList.add('hidden');
  game.classList.add('hidden');
  lobby.classList.remove('hidden');
  $('copyCode').textContent = code;
}

function showGame() {
  home.classList.add('hidden');
  lobby.classList.add('hidden');
  game.classList.remove('hidden');
}

function setHomeError(text) {
  homeError.textContent = text || '';
}

let errorTimer;
function setGameError(text) {
  gameError.textContent = text || '';
  gameError.classList.add('show');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => gameError.classList.remove('show'), 2200);
}

function saveSession(data) {
  localStorage.setItem('burraco1v1-session', JSON.stringify(data));
}
function readSession() {
  try { return JSON.parse(localStorage.getItem('burraco1v1-session')); }
  catch { return null; }
}
function clearSession() {
  localStorage.removeItem('burraco1v1-session');
}
