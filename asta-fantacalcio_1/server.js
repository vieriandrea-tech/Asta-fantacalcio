// Asta Fantacalcio — server in tempo reale
//
// Un unico stato d'asta condiviso, tenuto in memoria su questo processo,
// sincronizzato a tutti i client connessi via WebSocket. Niente account,
// niente database esterno: basta che il server resti in esecuzione durante
// l'asta. Se il server si riavvia (es. il piano gratuito dell'hosting va in
// "sleep"), lo stato dell'asta in corso si perde: vedi il README per come
// tenerlo sveglio la sera dell'asta.

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MIN_TIMER = 3;
const MAX_TIMER = 180;
const MAX_LOG = 25;
const DEFAULT_TIMER = 15;

function freshState() {
  return {
    status: 'idle', // 'idle' | 'live' | 'sold'
    itemLabel: '',
    currentBid: 0,
    currentBidder: null,
    timerSeconds: DEFAULT_TIMER,
    roundEndsAt: null,
    soldTo: null,
    soldAmount: null,
    soldItem: null,
    log: [],
  };
}

const state = freshState();

/** @type {NodeJS.Timeout | null} */
let roundTimer = null;

/** name -> number of open connections using that name (for the presence list) */
const presence = new Map();

function clearRoundTimer() {
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }
}

function scheduleRoundTimer() {
  clearRoundTimer();
  if (state.status !== 'live' || !state.roundEndsAt) return;
  const ms = Math.max(0, state.roundEndsAt - Date.now());
  roundTimer = setTimeout(onRoundExpire, ms);
}

function onRoundExpire() {
  if (state.status !== 'live') return;
  state.status = 'sold';
  state.soldTo = state.currentBidder;
  state.soldAmount = state.currentBid;
  state.soldItem = state.itemLabel;
  state.roundEndsAt = null;
  clearRoundTimer();
  broadcastState();
}

function pushLog(entry) {
  state.log.unshift(entry);
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 40);
}

// --- HTTP + WebSocket server -------------------------------------------

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Asta Fantacalcio in ascolto sulla porta ${PORT}`);
});

const wss = new WebSocketServer({ server });

function presenceList() {
  return Array.from(presence.keys()).sort((a, b) => a.localeCompare(b, 'it'));
}

function broadcastState() {
  const payload = JSON.stringify({ type: 'state', state, presence: presenceList() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function addPresence(name) {
  if (!name) return;
  presence.set(name, (presence.get(name) || 0) + 1);
}

function removePresence(name) {
  if (!name) return;
  const n = (presence.get(name) || 0) - 1;
  if (n <= 0) presence.delete(name);
  else presence.set(name, n);
}

wss.on('connection', (ws) => {
  ws.playerName = null;

  // Manda subito lo stato corrente al nuovo arrivato.
  ws.send(JSON.stringify({ type: 'state', state, presence: presenceList() }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        const name = sanitizeName(msg.name);
        if (!name) return;
        if (ws.playerName && ws.playerName !== name) removePresence(ws.playerName);
        ws.playerName = name;
        addPresence(name);
        broadcastState();
        break;
      }

      case 'startRound': {
        if (state.status === 'live') return; // un'asta è già in corso
        const timerSeconds = clampInt(msg.timerSeconds, MIN_TIMER, MAX_TIMER, state.timerSeconds || DEFAULT_TIMER);
        const startPrice = clampInt(msg.startPrice, 0, 1_000_000, 1);
        state.status = 'live';
        state.itemLabel = sanitizeName(msg.itemLabel).slice(0, 60);
        state.currentBid = startPrice;
        state.currentBidder = null;
        state.timerSeconds = timerSeconds;
        state.roundEndsAt = Date.now() + timerSeconds * 1000;
        state.soldTo = null;
        state.soldAmount = null;
        state.soldItem = null;
        state.log = [];
        scheduleRoundTimer();
        broadcastState();
        break;
      }

      case 'bid': {
        if (state.status !== 'live') return;
        const name = sanitizeName(msg.name) || ws.playerName;
        if (!name) return;
        const amount = clampInt(msg.amount, 1, 1_000_000, null);
        if (amount === null) return;
        state.currentBid += amount;
        state.currentBidder = name;
        state.roundEndsAt = Date.now() + (state.timerSeconds || DEFAULT_TIMER) * 1000;
        pushLog({ name, amount, total: state.currentBid, at: Date.now() });
        scheduleRoundTimer();
        broadcastState();
        break;
      }

      case 'setTimer': {
        const timerSeconds = clampInt(msg.seconds, MIN_TIMER, MAX_TIMER, null);
        if (timerSeconds === null) return;
        state.timerSeconds = timerSeconds;
        broadcastState();
        break;
      }

      case 'cancelRound': {
        if (state.status !== 'live') return;
        clearRoundTimer();
        Object.assign(state, freshState(), { timerSeconds: state.timerSeconds });
        broadcastState();
        break;
      }

      case 'dismissSold': {
        if (state.status !== 'sold') return;
        Object.assign(state, freshState(), { timerSeconds: state.timerSeconds });
        broadcastState();
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.playerName) removePresence(ws.playerName);
    broadcastState();
  });
});
