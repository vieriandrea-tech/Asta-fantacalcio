// Asta Fantacalcio — server in tempo reale
//
// Stato condiviso tenuto in memoria su questo processo, sincronizzato a tutti
// i client connessi via WebSocket. Niente account, niente database esterno.
//
// Due modalità per ogni chiamata:
//  - 'open'  : rilanci pubblici (+1 o un importo libero), timer fisso di 10s
//              che riparte a ogni rilancio.
//  - 'busta' : scatta in automatico quando l'offerta pubblica supera i 100
//              crediti. I rilanci pubblici si fermano, ognuno scrive
//              un'offerta segreta (o sceglie di non partecipare); quando
//              tutti i partecipanti dell'elenco hanno risposto, chi ha
//              chiamato quel giocatore può rivelare il risultato. In caso
//              di parità sulla cifra più alta, si apre uno spareggio: solo
//              chi era in parità rifà l'offerta, gli altri restano fuori.

const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const FIXED_TIMER_SECONDS = 10;
const BUSTA_THRESHOLD = 100; // sopra questa cifra scatta la busta chiusa
const MAX_LOG = 25;
const MAX_ROSTER = 40;

function freshRoundState() {
  return {
    status: 'idle', // 'idle' | 'live' | 'sold'
    itemLabel: '',
    currentBid: 0,
    currentBidder: null,
    roundEndsAt: null,
    mode: null, // 'open' | 'busta' (solo quando status === 'live')
    starter: null, // nome di chi ha avviato questa chiamata
    openSnapshot: null, // { amount, bidder } al momento del passaggio a busta
    busta: null, // { responses: { [nome]: {amount|null, declined} }, revealed, tiebreakNames, tiebreakAmount }
    bustaResult: null, // elenco ordinato dopo la rivelazione
    soldTo: null,
    soldAmount: null,
    soldItem: null,
    soldVia: null, // 'open' | 'busta' | 'busta-none'
    log: [],
  };
}

const state = freshRoundState();

/** Elenco fisso e ordinato dei partecipanti, e indice di chi tocca chiamare. */
let roster = [];
let turnIndex = 0;

/** @type {NodeJS.Timeout | null} */
let roundTimer = null;

/** name -> numero di connessioni aperte con quel nome (per la lista presenze) */
const presence = new Map();

function clearRoundTimer() {
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }
}

function scheduleRoundTimer() {
  clearRoundTimer();
  if (state.status !== 'live' || state.mode !== 'open' || !state.roundEndsAt) return;
  const ms = Math.max(0, state.roundEndsAt - Date.now());
  roundTimer = setTimeout(onRoundExpire, ms);
}

function advanceTurn() {
  if (roster.length) turnIndex = (turnIndex + 1) % roster.length;
}

function onRoundExpire() {
  if (state.status !== 'live' || state.mode !== 'open') return;
  state.status = 'sold';
  state.soldTo = state.currentBidder;
  state.soldAmount = state.currentBid;
  state.soldItem = state.itemLabel;
  state.soldVia = 'open';
  state.roundEndsAt = null;
  clearRoundTimer();
  advanceTurn();
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

function requiredResponders() {
  // Durante uno spareggio rispondono solo i pari merito. Altrimenti, se
  // l'elenco partecipanti è impostato usiamo quello; in mancanza di un
  // elenco, contiamo chi è collegato in questo momento.
  if (state.busta && state.busta.tiebreakNames) return state.busta.tiebreakNames;
  return roster.length ? roster : presenceList();
}

function tryTransitionToBusta() {
  if (state.currentBid <= BUSTA_THRESHOLD) return false;
  clearRoundTimer();
  state.mode = 'busta';
  state.openSnapshot = { amount: state.currentBid, bidder: state.currentBidder };
  state.busta = { responses: {}, revealed: false, tiebreakNames: null, tiebreakAmount: null };
  state.roundEndsAt = null;
  return true;
}

function finalizeBusta(entries, winner) {
  entries.sort((a, b) => {
    if (a.declined !== b.declined) return a.declined ? 1 : -1;
    return (b.amount || 0) - (a.amount || 0);
  });
  state.busta.revealed = true;
  state.bustaResult = entries;
  state.status = 'sold';
  state.soldVia = winner ? 'busta' : 'busta-none';
  state.soldTo = winner ? winner.name : null;
  state.soldAmount = winner ? winner.amount : 0;
  state.soldItem = state.itemLabel;
  advanceTurn();
}

function startTiebreak(names, amount) {
  state.busta.tiebreakNames = names;
  state.busta.tiebreakAmount = amount;
  state.busta.responses = {};
  state.busta.revealed = false;
  // resta status 'live', mode 'busta': si aspettano le nuove offerte
  // solo dei pari merito, senza svelare nulla degli altri.
}

function resolveBustaReveal() {
  const required = requiredResponders();
  const entries = required.map((name) => {
    const r = state.busta.responses[name];
    return r ? { name, amount: r.amount, declined: !!r.declined } : { name, amount: null, declined: true };
  });
  const candidates = entries.filter((e) => !e.declined && e.amount != null);

  if (candidates.length === 0) {
    finalizeBusta(entries, null);
    return;
  }

  let maxAmount = -Infinity;
  for (const c of candidates) if (c.amount > maxAmount) maxAmount = c.amount;
  const topTied = candidates.filter((c) => c.amount === maxAmount);

  if (topTied.length > 1) {
    startTiebreak(topTied.map((c) => c.name), maxAmount);
    return;
  }

  finalizeBusta(entries, topTied[0]);
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

function publicState() {
  return {
    status: state.status,
    itemLabel: state.itemLabel,
    currentBid: state.currentBid,
    currentBidder: state.currentBidder,
    roundEndsAt: state.roundEndsAt,
    mode: state.mode,
    starter: state.starter,
    openSnapshot: state.openSnapshot,
    bustaPublic: state.busta
      ? {
          respondedNames: Object.keys(state.busta.responses),
          revealed: state.busta.revealed,
          required: requiredResponders(),
          tiebreak: !!state.busta.tiebreakNames,
          tiebreakAmount: state.busta.tiebreakAmount,
        }
      : null,
    bustaResult: state.busta && state.busta.revealed ? state.bustaResult : null,
    soldTo: state.soldTo,
    soldAmount: state.soldAmount,
    soldItem: state.soldItem,
    soldVia: state.soldVia,
    log: state.log,
  };
}

function fullPayload() {
  return JSON.stringify({
    type: 'state',
    state: publicState(),
    presence: presenceList(),
    roster,
    turnIndex,
    turnName: roster.length ? roster[turnIndex % roster.length] : null,
  });
}

function broadcastState() {
  const payload = fullPayload();
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function sendNotice(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'notice', message }));
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

  ws.send(fullPayload());

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

      case 'setRoster': {
        if (!Array.isArray(msg.names)) return;
        const seen = new Set();
        const cleaned = [];
        for (const raw of msg.names) {
          const n = sanitizeName(raw);
          if (!n || seen.has(n)) continue;
          seen.add(n);
          cleaned.push(n);
          if (cleaned.length >= MAX_ROSTER) break;
        }
        roster = cleaned;
        if (turnIndex >= roster.length) turnIndex = 0;
        broadcastState();
        break;
      }

      case 'startRound': {
        if (state.status === 'live') return; // una chiamata è già in corso
        const starter = sanitizeName(msg.name);
        const startPrice = clampInt(msg.startPrice, 0, 1_000_000, 1);
        state.status = 'live';
        state.itemLabel = sanitizeName(msg.itemLabel).slice(0, 60);
        state.currentBid = startPrice;
        state.currentBidder = null;
        state.mode = 'open';
        state.starter = starter || null;
        state.openSnapshot = null;
        state.busta = null;
        state.bustaResult = null;
        state.roundEndsAt = Date.now() + FIXED_TIMER_SECONDS * 1000;
        state.soldTo = null;
        state.soldAmount = null;
        state.soldItem = null;
        state.soldVia = null;
        state.log = [];
        scheduleRoundTimer();
        broadcastState();
        break;
      }

      case 'bid': {
        if (state.status !== 'live' || state.mode !== 'open') return;
        const name = sanitizeName(msg.name) || ws.playerName;
        if (!name) return;
        const amount = clampInt(msg.amount, 1, 1_000_000, null);
        if (amount === null) return;
        state.currentBid += amount;
        state.currentBidder = name;
        pushLog({ name, amount, total: state.currentBid, at: Date.now() });

        if (tryTransitionToBusta()) {
          broadcastState();
          break;
        }
        state.roundEndsAt = Date.now() + FIXED_TIMER_SECONDS * 1000;
        scheduleRoundTimer();
        broadcastState();
        break;
      }

      case 'bustaOffer': {
        if (state.status !== 'live' || state.mode !== 'busta' || state.busta.revealed) return;
        const name = sanitizeName(msg.name) || ws.playerName;
        if (!name) return;
        const amount = clampInt(msg.amount, 1, 1_000_000, null);
        if (amount === null) return;
        state.busta.responses[name] = { amount, declined: false };
        broadcastState();
        break;
      }

      case 'bustaDecline': {
        if (state.status !== 'live' || state.mode !== 'busta' || state.busta.revealed) return;
        const name = sanitizeName(msg.name) || ws.playerName;
        if (!name) return;
        state.busta.responses[name] = { amount: null, declined: true };
        broadcastState();
        break;
      }

      case 'bustaReveal': {
        if (state.status !== 'live' || state.mode !== 'busta' || state.busta.revealed) return;
        const name = sanitizeName(msg.name) || ws.playerName;
        if (state.starter && name !== state.starter) {
          sendNotice(ws, 'Solo chi ha chiamato questo giocatore può rivelare il risultato.');
          return;
        }
        const required = requiredResponders();
        const allResponded = required.every((n) => Object.prototype.hasOwnProperty.call(state.busta.responses, n));
        if (!allResponded) {
          sendNotice(ws, 'Non tutti hanno ancora risposto alla busta.');
          return;
        }
        resolveBustaReveal();
        broadcastState();
        break;
      }

      case 'cancelRound': {
        if (state.status !== 'live') return;
        clearRoundTimer();
        Object.assign(state, freshRoundState());
        broadcastState();
        break;
      }

      case 'dismissSold': {
        if (state.status !== 'sold') return;
        Object.assign(state, freshRoundState());
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
