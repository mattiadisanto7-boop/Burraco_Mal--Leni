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
let selectedCardIds = new Set();
let selectedMeldId = null;
let localHandOrder = [];
let sortMode = localStorage.getItem('burraco1v1-sort') || 'suit';
let reconnectData = readSession();
let lastEventSeq = 0;
let previousTurnWasMine = false;

if (reconnectData?.name) nameInput.value = reconnectData.name;

// ---------- Audio: musica e SFX generati dal browser, nessun file esterno ----------
class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.enabled = localStorage.getItem('burraco1v1-audio') !== 'off';
  }

  async unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.musicGain.gain.value = 0.12;
      this.sfxGain.gain.value = 0.42;
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.startMusic();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem('burraco1v1-audio', enabled ? 'on' : 'off');
    if (!enabled) {
      this.stopMusic();
      if (this.master) this.master.gain.value = 0;
    } else {
      if (this.master) this.master.gain.value = 0.7;
      this.unlock();
    }
    updateAudioButton();
  }

  tone(freq, duration = 0.09, volume = 0.18, delay = 0, type = 'sine', target = 'sfx') {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(target === 'music' ? this.musicGain : this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  noise(duration = 0.06, volume = 0.08, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.sfxGain);
    source.start(this.ctx.currentTime + delay);
  }

  play(type) {
    if (!this.enabled || !this.ctx) return;
    const patterns = {
      start: () => [392, 494, 587].forEach((f, i) => this.tone(f, .24, .18, i * .08, 'triangle')),
      join: () => [523, 659].forEach((f, i) => this.tone(f, .16, .12, i * .06, 'sine')),
      draw: () => { this.noise(.08, .08); this.tone(520, .08, .08, .02, 'triangle'); },
      'take-discard': () => [330, 392, 494].forEach((f, i) => this.tone(f, .08, .09, i * .035, 'triangle')),
      play: () => { this.tone(440, .07, .11, 0, 'triangle'); this.tone(660, .09, .1, .055, 'triangle'); },
      discard: () => { this.noise(.07, .12); this.tone(190, .1, .11, 0, 'sine'); },
      turn: () => { this.tone(740, .09, .1, 0, 'sine'); this.tone(988, .14, .09, .08, 'sine'); },
      burraco: () => [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .32, .16, i * .075, 'triangle')),
      pot: () => [294, 392, 494, 587].forEach((f, i) => this.tone(f, .22, .13, i * .06, 'sine')),
      error: () => { this.tone(150, .12, .13, 0, 'square'); this.tone(125, .14, .10, .09, 'square'); },
      end: () => [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, .45, .17, i * .11, 'triangle'))
    };
    patterns[type]?.();
  }

  startMusic() {
    if (!this.enabled || !this.ctx || this.musicTimer) return;
    const notes = [261.63, 329.63, 392.00, 493.88, 392.00, 329.63, 293.66, 349.23, 440.00, 523.25, 440.00, 349.23];
    const tick = () => {
      if (!this.enabled || !this.ctx) return;
      const root = notes[this.musicStep % notes.length];
      this.tone(root, .55, .055, 0, 'sine', 'music');
      if (this.musicStep % 3 === 0) this.tone(root / 2, .8, .035, 0, 'triangle', 'music');
      this.musicStep++;
    };
    tick();
    this.musicTimer = setInterval(tick, 620);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

const audio = new GameAudio();
updateAudioButton();

function unlockAudio() { audio.unlock().catch(() => {}); }

$('audioBtn').addEventListener('click', async () => {
  if (!audio.enabled) {
    audio.setEnabled(true);
    await audio.unlock();
    audio.play('join');
  } else {
    audio.setEnabled(false);
  }
});

function updateAudioButton() {
  const btn = $('audioBtn');
  if (!btn) return;
  btn.textContent = audio.enabled ? '🔊' : '🔇';
  btn.title = audio.enabled ? 'Disattiva audio' : 'Attiva audio';
}

// ---------- Home / stanza ----------
$('createBtn').addEventListener('click', () => {
  unlockAudio();
  const name = nameInput.value.trim();
  if (!name) return setHomeError('Inserisci il tuo nome.');
  socket.emit('create-room', { name, token: reconnectData?.token }, result => {
    if (!result.ok) return setHomeError(result.error);
    saveSession({ code: result.code, token: result.token, name });
    reconnectData = readSession();
    showLobby(result.code);
  });
});

$('joinBtn').addEventListener('click', () => { unlockAudio(); joinRoom(roomInput.value); });
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') { unlockAudio(); joinRoom(roomInput.value); } });

$('copyCode').addEventListener('click', async () => {
  unlockAudio();
  const code = $('copyCode').textContent;
  try {
    await navigator.clipboard.writeText(code);
    $('copyCode').textContent = 'COPIATO!';
    setTimeout(() => $('copyCode').textContent = code, 900);
  } catch (_) {}
});

// ---------- Azioni di gioco ----------
$('deckBtn').addEventListener('click', () => { unlockAudio(); action('draw-deck'); });
$('discardBtn').addEventListener('click', () => { unlockAudio(); action('take-discard'); });

$('playSelected').addEventListener('click', () => {
  unlockAudio();
  const ids = [...selectedCardIds];
  socket.emit('play-meld', { cardIds: ids }, result => {
    if (!result.ok) return setGameError(result.error);
    selectedCardIds.clear();
    selectedMeldId = null;
  });
});

$('addSelected').addEventListener('click', () => {
  unlockAudio();
  if (!selectedMeldId) return setGameError('Tocca prima una delle tue combinazioni sul tavolo.');
  const ids = [...selectedCardIds];
  socket.emit('add-to-meld', { meldId: selectedMeldId, cardIds: ids }, result => {
    if (!result.ok) return setGameError(result.error);
    selectedCardIds.clear();
    selectedMeldId = null;
  });
});

$('discardSelected').addEventListener('click', () => {
  unlockAudio();
  if (selectedCardIds.size !== 1) return setGameError('Per scartare seleziona una sola carta.');
  socket.emit('discard-card', { cardId: [...selectedCardIds][0] }, result => {
    if (!result.ok) return setGameError(result.error);
    selectedCardIds.clear();
    selectedMeldId = null;
  });
});

$('clearSelection').addEventListener('click', () => {
  selectedCardIds.clear();
  selectedMeldId = null;
  renderHand();
  renderMelds();
  updateActionButtons();
});

$('sortSuit').addEventListener('click', () => setSortMode('suit'));
$('sortRank').addEventListener('click', () => setSortMode('rank'));

function setSortMode(mode) {
  sortMode = mode;
  localStorage.setItem('burraco1v1-sort', mode);
  applySort();
  renderHand();
  updateSortButtons();
}

socket.on('connect', () => {
  const s = readSession();
  if (s?.code && s?.token && s?.name) {
    socket.emit('join-room', s, result => { if (!result.ok) clearSession(); });
  }
});

socket.on('game-state', state => {
  const wasMine = previousTurnWasMine;
  currentState = state;
  mergeHandOrder(state.you.hand);
  if (sortMode) applySort();

  if (state.started) showGame();
  else showLobby(state.roomCode);
  render(state);

  if (state.lastEvent?.seq && state.lastEvent.seq > lastEventSeq) {
    lastEventSeq = state.lastEvent.seq;
    const sounds = state.lastEvent.sounds || [state.lastEvent.type];
    sounds.forEach((sound, i) => setTimeout(() => audio.play(sound), i * 150));
  }

  if (!wasMine && state.isYourTurn && state.status === 'playing') {
    setTimeout(() => audio.play('turn'), 220);
  }
  previousTurnWasMine = state.isYourTurn;
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
  socket.emit(eventName, result => { if (!result.ok) setGameError(result.error); });
}

// ---------- Rendering ----------
function render(state) {
  $('roomLabel').textContent = `Stanza ${state.roomCode}`;
  $('youName').textContent = state.you.name;
  $('handCount').textContent = `${state.you.hand.length} carte`;
  $('deckCount').textContent = state.deckCount;
  $('pot1').querySelector('b').textContent = state.pots[0].cardCount;
  $('pot2').querySelector('b').textContent = state.pots[1].cardCount;
  $('actionText').textContent = state.lastAction || '';
  $('potStatus').textContent = state.you.potTaken ? 'Pozzetto preso' : '';
  $('potStatus').classList.toggle('hidden', !state.you.potTaken);

  if (state.opponent) {
    $('opponentName').textContent = state.opponent.name;
    $('opponentCount').textContent = `${state.opponent.cardCount} carte`;
    $('opponentBurraco').textContent = state.opponent.burracoCount ? `🏅 ${state.opponent.burracoCount}` : '';
    $('opponentStatus').classList.toggle('offline', !state.opponent.connected);
    $('opponentCards').innerHTML = Array.from({ length: Math.min(state.opponent.cardCount, 18) }, () => '<div class="card-back"></div>').join('');
  }

  const badge = $('turnBadge');
  if (state.status === 'finished') {
    badge.textContent = 'PARTITA FINITA';
    badge.classList.remove('yours');
  } else if (state.isYourTurn) {
    const stageText = state.turnStage === 'draw' ? 'PESCA' : 'GIOCA / SCARTA';
    badge.textContent = `TOCCA A TE · ${stageText}`;
    badge.classList.add('yours');
  } else {
    badge.textContent = `TURNO DI ${state.turnPlayerName || 'AVVERSARIO'}`;
    badge.classList.remove('yours');
  }

  $('deckBtn').disabled = !(state.isYourTurn && state.turnStage === 'draw' && state.deckCount > 0 && state.status === 'playing');
  $('discardBtn').disabled = !(state.isYourTurn && state.turnStage === 'draw' && state.discardPile.length > 0 && state.status === 'playing');

  renderDiscard(state.discardPile);
  renderMelds();
  renderHand();
  updateSortButtons();
  updateActionButtons();

  if (state.status === 'finished' && state.winner) {
    $('winnerText').textContent = state.winner.id === state.you.id ? 'Hai vinto! 🏆' : `${state.winner.name} ha vinto!`;
    $('endOverlay').classList.remove('hidden');
  }
}

function renderDiscard(cards) {
  const holder = $('discardFan');
  holder.innerHTML = '';
  if (!cards?.length) {
    holder.innerHTML = '<span class="empty-discard">Vuoto</span>';
    return;
  }
  for (const card of cards) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardHtml(card, 'mini');
    holder.appendChild(wrapper.firstElementChild);
  }
  requestAnimationFrame(() => { holder.scrollLeft = holder.scrollWidth; });
}

function renderMelds() {
  if (!currentState) return;
  renderMeldList($('opponentMelds'), currentState.opponent?.melds || [], false);
  renderMeldList($('yourMelds'), currentState.you.melds || [], true);

  $('meldHint').textContent = selectedMeldId ? '· destinazione selezionata' : '';
}

function renderMeldList(holder, melds, own) {
  holder.innerHTML = '';
  holder.classList.toggle('empty-placeholder', melds.length === 0);
  if (!melds.length) {
    holder.textContent = own ? 'Tocca le carte in mano e premi “Gioca”' : 'Nessuna combinazione';
    return;
  }

  melds.forEach(meld => {
    const box = document.createElement('div');
    box.className = `meld ${own ? 'own-meld' : ''} ${selectedMeldId === meld.id ? 'target' : ''}`;
    box.dataset.id = meld.id;

    const cards = document.createElement('div');
    cards.className = 'meld-cards';
    meld.cards.forEach(card => {
      const wrap = document.createElement('div');
      wrap.innerHTML = cardHtml(card, 'table-card');
      cards.appendChild(wrap.firstElementChild);
    });
    box.appendChild(cards);

    if (meld.burraco) {
      const badge = document.createElement('div');
      badge.className = `burraco-label ${meld.clean ? 'clean' : 'dirty'}`;
      badge.textContent = `BURRACO ${meld.clean ? 'PULITO' : 'SPORCO'}`;
      box.appendChild(badge);
    }

    if (own) {
      box.addEventListener('click', () => {
        selectedMeldId = selectedMeldId === meld.id ? null : meld.id;
        renderMelds();
        updateActionButtons();
      });
    }
    holder.appendChild(box);
  });
}

function renderHand() {
  if (!currentState) return;
  const byId = new Map(currentState.you.hand.map(c => [c.id, c]));
  const ordered = localHandOrder.map(id => byId.get(id)).filter(Boolean);
  const holder = $('hand');
  holder.innerHTML = '';

  for (const card of ordered) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardHtml(card, 'hand-card');
    const el = wrapper.firstElementChild;
    el.dataset.id = card.id;
    if (selectedCardIds.has(card.id)) el.classList.add('selected');
    el.addEventListener('click', () => {
      unlockAudio();
      if (selectedCardIds.has(card.id)) selectedCardIds.delete(card.id);
      else selectedCardIds.add(card.id);
      renderHand();
      updateActionButtons();
    });
    holder.appendChild(el);
  }
}

function cardHtml(card, extra = '') {
  if (card.joker) {
    return `<div class="playing-card joker ${extra}"><span class="corner-star">★</span><span class="joker-symbol">🃏</span><span class="corner-star bottom">★</span></div>`;
  }
  const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const symbol = symbols[card.suit];
  return `<div class="playing-card ${isRed ? 'red' : ''} ${extra}"><span class="corner">${card.rank}${symbol}</span><span class="suit">${symbol}</span><span class="corner bottom">${card.rank}${symbol}</span></div>`;
}

function mergeHandOrder(hand) {
  const ids = new Set(hand.map(c => c.id));
  localHandOrder = localHandOrder.filter(id => ids.has(id));
  for (const c of hand) if (!localHandOrder.includes(c.id)) localHandOrder.push(c.id);
  for (const id of [...selectedCardIds]) if (!ids.has(id)) selectedCardIds.delete(id);
}

function applySort() {
  if (!currentState) return;
  const byId = new Map(currentState.you.hand.map(c => [c.id, c]));
  const cards = [...currentState.you.hand];
  const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3, joker: 4 };
  const ranks = rankMap();

  if (sortMode === 'suit') {
    cards.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || ranks[a.rank] - ranks[b.rank] || a.id.localeCompare(b.id));
  } else {
    cards.sort((a, b) => ranks[a.rank] - ranks[b.rank] || suitOrder[a.suit] - suitOrder[b.suit] || a.id.localeCompare(b.id));
  }
  localHandOrder = cards.filter(c => byId.has(c.id)).map(c => c.id);
}

function updateSortButtons() {
  $('sortSuit').classList.toggle('active', sortMode === 'suit');
  $('sortRank').classList.toggle('active', sortMode === 'rank');
}

function updateActionButtons() {
  if (!currentState) return;
  const count = selectedCardIds.size;
  const canPlay = currentState.isYourTurn && currentState.turnStage !== 'draw' && currentState.status === 'playing';
  $('playSelected').disabled = !(canPlay && count >= 3);
  $('addSelected').disabled = !(canPlay && count >= 1 && selectedMeldId);
  $('discardSelected').disabled = !(canPlay && count === 1);
  $('playCount').textContent = count ? `(${count})` : '';

  if (selectedMeldId && count) $('selectionHelp').textContent = `${count} ${count === 1 ? 'carta selezionata' : 'carte selezionate'} · premi Aggiungi.`;
  else if (count >= 3) $('selectionHelp').textContent = `${count} carte selezionate · puoi creare una combinazione.`;
  else if (count === 1) $('selectionHelp').textContent = '1 carta selezionata · puoi scartarla o aggiungerla a una combinazione.';
  else $('selectionHelp').textContent = 'Seleziona le carte toccandole.';
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

function setHomeError(text) { homeError.textContent = text || ''; }

let errorTimer;
function setGameError(text) {
  audio.play('error');
  gameError.textContent = text || '';
  gameError.classList.add('show');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => gameError.classList.remove('show'), 2600);
}

function saveSession(data) { localStorage.setItem('burraco1v1-session', JSON.stringify(data)); }
function readSession() {
  try { return JSON.parse(localStorage.getItem('burraco1v1-session')); }
  catch { return null; }
}
function clearSession() { localStorage.removeItem('burraco1v1-session'); }
