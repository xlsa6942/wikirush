// WikiRush : logique du jeu et rendu des écrans.

import { esc, fmtTime, uid, shuffle, pickRandom, sameTitle, ICON, avatar, colorOf, toast, store, COLORS } from './util.js';
import * as wiki from './wiki.js';
import { isForbidden } from './forbidden.js';
import { pickCandidates } from './targets.js';
import { sfx, unlockAudio } from './sound.js';
import * as stats from './stats.js';
import { openHost, openGuest, reconnectGuest, normalizeCode } from './net.js';

const VOTE_MS = 30000;
const COUNTDOWN_MS = 4000;
const DROP_MS = 20000; // délai avant de considérer une joueuse déconnectée comme partie
const MAX_PLAYERS = 8;

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');

// Identité propre à chaque onglet (garde la même après un rechargement,
// et deux onglets du même appareil comptent comme deux joueuses)
function tabId() {
  try {
    let id = sessionStorage.getItem('wr_id');
    if (!id) { id = uid(); sessionStorage.setItem('wr_id', id); }
    return id;
  } catch (e) {
    return uid();
  }
}

const me = {
  id: tabId(),
  name: store.get('wr_name', ''),
};

const app = {
  view: 'home',      // home | stats | room
  role: null,        // host | guest
  room: null,        // état de la partie (copie locale)
  offset: 0,         // décalage horloge hôte - horloge locale
  race: null,        // ma course en cours
  rulesOpen: false,
  busy: false,
  mounted: null,
  lastPhase: null,
  lastSeenHost: 0,
  connLost: false,
  savedRounds: new Set(),
};

const params = new URLSearchParams(location.search);
const prefillCode = normalizeCode(params.get('code') || '');

/* ------------------------------------------------------------------ */
/* Réseau                                                              */
/* ------------------------------------------------------------------ */

const net = {
  peer: null,
  code: null,
  conn: null,            // invitée : connexion vers l'hôte
  conns: new Map(),      // hôte : connexion -> id joueuse
  pingTimer: null,
  lastSeen: new Map(),   // hôte : id joueuse -> dernier message reçu

  send(msg) {
    if (app.role === 'host') host.handle(me.id, msg);
    else if (this.conn && this.conn.open) this.conn.send(msg);
  },

  broadcast(msg) {
    for (const conn of this.conns.keys()) if (conn.open) conn.send(msg);
  },

  destroy() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* rien */ }
    this.peer = null;
    this.conn = null;
    this.conns.clear();
    this.lastSeen.clear();
  },
};

async function createRoom() {
  const { peer, code } = await openHost();
  net.peer = peer;
  net.code = code;
  app.role = 'host';
  host.init(code);

  peer.on('connection', (conn) => {
    conn.on('open', () => net.conns.set(conn, null));
    conn.on('data', (msg) => host.onData(conn, msg));
    conn.on('close', () => host.onClose(conn));
    conn.on('error', () => host.onClose(conn));
  });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => console.warn('peer', err.type));

  net.pingTimer = setInterval(() => {
    host.publish(false);
    const now = Date.now();
    for (const [conn, id] of net.conns) {
      if (id && now - (net.lastSeen.get(id) || now) > 15000) host.onClose(conn);
    }
  }, 4000);

  host.publish();
}

async function joinRoom(code) {
  const { peer, conn } = await openGuest(code);
  net.peer = peer;
  net.code = code;
  app.role = 'guest';
  attachGuestConn(conn);
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  net.pingTimer = setInterval(() => {
    if (net.conn && net.conn.open) net.conn.send({ t: 'ping' });
    if (app.room && Date.now() - app.lastSeenHost > 14000 && !app.connLost) onHostLost();
  }, 4000);
}

function attachGuestConn(conn) {
  net.conn = conn;
  app.lastSeenHost = Date.now();
  conn.on('data', (msg) => onGuestData(msg));
  conn.on('close', () => { if (net.conn === conn) onHostLost(); });
  conn.on('error', () => { if (net.conn === conn) onHostLost(); });
  conn.send({ t: 'join', id: me.id, name: me.name });
}

function onGuestData(msg) {
  if (!msg || typeof msg !== 'object') return;
  app.lastSeenHost = Date.now();
  if (app.connLost) { app.connLost = false; toast('Reconnectée ✨'); }
  if (msg.t === 'state') {
    app.offset = msg.room.now - Date.now();
    onRoom(msg.room);
  } else if (msg.t === 'bye') {
    toast('L\'hôte a fermé la partie 👋', 4000);
    leaveRoom(true);
  } else if (msg.t === 'refuse') {
    toast(msg.reason || 'Impossible de rejoindre cette partie', 4000);
    leaveRoom(true);
  }
}

async function onHostLost() {
  if (app.connLost || app.role !== 'guest') return;
  app.connLost = true;
  renderConnBanner();
  for (let i = 0; i < 6 && app.role === 'guest'; i++) {
    try {
      const conn = await reconnectGuest(net.peer, net.code);
      attachGuestConn(conn);
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  if (app.role === 'guest') {
    toast('L\'hôte a quitté la partie 😢', 4000);
    leaveRoom(true);
  }
}

function renderConnBanner() {
  let el = document.getElementById('conn-banner');
  if (app.connLost) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'conn-banner';
      el.className = 'conn-banner';
      el.textContent = 'Connexion perdue, on essaie de te reconnecter…';
      document.body.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Hôte : gardienne de l'état de la partie                             */
/* ------------------------------------------------------------------ */

const host = {
  room: null,
  timers: {},
  used: new Set(),
  token: 0,

  init(code) {
    this.room = {
      code,
      hostId: me.id,
      phase: 'lobby',
      round: 0,
      settings: { start: 'same', rank: 'clicks', limit: 10, back: true, find: false, forbidden: true },
      players: {},
      order: [],
      options: [],
      votes: {},
      voteEndsAt: null,
      target: null,
      starts: {},
      raceStartAt: null,
      raceEndAt: null,
      loading: null,
      error: null,
      now: Date.now(),
    };
    this.addPlayer(me.id, me.name);
  },

  addPlayer(id, name) {
    const r = this.room;
    const p = r.players[id];
    if (p) {
      p.connected = true;
      if (name) p.name = name;
      clearTimeout(this.timers['drop_' + id]);
      return;
    }
    const taken = new Set(Object.values(r.players).map((x) => x.color));
    let color = COLORS.findIndex((c, i) => !taken.has(i));
    if (color < 0) color = r.order.length % COLORS.length;
    r.players[id] = { id, name: name || 'Joueuse', color, connected: true, status: 'idle', current: null, clicks: 0, time: null, path: [] };
    r.order.push(id);
  },

  removePlayer(id) {
    const r = this.room;
    delete r.players[id];
    delete r.votes[id];
    r.order = r.order.filter((x) => x !== id);
  },

  publish(local = true) {
    const r = this.room;
    if (!r) return;
    r.now = Date.now();
    net.broadcast({ t: 'state', room: r });
    if (local) onRoom(r);
  },

  onData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      const r = this.room;
      const id = String(msg.id || '').slice(0, 40);
      const name = String(msg.name || '').trim().slice(0, 16) || 'Joueuse';
      if (!id) return;
      const known = !!r.players[id];
      if (!known && r.phase !== 'lobby') {
        conn.send({ t: 'refuse', reason: 'La partie a déjà commencé, attends la prochaine manche !' });
        setTimeout(() => conn.close(), 600);
        return;
      }
      if (!known && r.order.length >= MAX_PLAYERS) {
        conn.send({ t: 'refuse', reason: 'La salle est pleine (8 joueuses max).' });
        setTimeout(() => conn.close(), 600);
        return;
      }
      for (const [c, pid] of net.conns) if (pid === id && c !== conn) net.conns.delete(c);
      net.conns.set(conn, id);
      net.lastSeen.set(id, Date.now());
      this.addPlayer(id, name);
      if (!known) sfx.join();
      this.publish();
      return;
    }
    const id = net.conns.get(conn);
    if (!id) return;
    net.lastSeen.set(id, Date.now());
    if (msg.t === 'ping') return;
    this.handle(id, msg);
  },

  onClose(conn) {
    const id = net.conns.get(conn);
    net.conns.delete(conn);
    if (!id || !this.room) return;
    const stillHere = [...net.conns.values()].includes(id);
    if (stillHere) return;
    const p = this.room.players[id];
    if (!p) return;
    p.connected = false;
    this.publish();
    clearTimeout(this.timers['drop_' + id]);
    this.timers['drop_' + id] = setTimeout(() => {
      const r = this.room;
      const q = r && r.players[id];
      if (!q || q.connected) return;
      if (r.phase === 'lobby' || r.phase === 'vote') this.removePlayer(id);
      else if (q.status === 'racing') q.status = 'abandoned';
      this.publish();
      this.checkVotes();
      this.checkEnd();
    }, DROP_MS);
  },

  handle(id, msg) {
    const r = this.room;
    if (!r) return;
    const isHost = id === r.hostId;
    const p = r.players[id];
    if (!p) return;

    switch (msg.t) {
      case 'settings': {
        if (!isHost || r.phase !== 'lobby') return;
        const s = msg.settings || {};
        const next = { ...r.settings };
        if (s.start === 'same' || s.start === 'each') next.start = s.start;
        if (s.rank === 'clicks' || s.rank === 'time') next.rank = s.rank;
        if ([0, 5, 10].includes(Number(s.limit))) next.limit = Number(s.limit);
        for (const k of ['back', 'find', 'forbidden']) if (typeof s[k] === 'boolean') next[k] = s[k];
        r.settings = next;
        break;
      }
      case 'start':
        if (isHost && r.phase === 'lobby') this.startVote();
        return;
      case 'vote':
        if (r.phase !== 'vote' || r.loading) return;
        if (Number.isInteger(msg.idx) && msg.idx >= 0 && msg.idx < r.options.length) r.votes[id] = msg.idx;
        this.publish();
        this.checkVotes();
        return;
      case 'reroll':
        if (r.phase === 'vote' && !r.loading) this.startVote();
        return;
      case 'launch':
        if (isHost && r.phase === 'vote' && !r.loading) this.resolveVote();
        return;
      case 'progress':
        if ((r.phase !== 'race' && r.phase !== 'countdown') || p.status !== 'racing') return;
        p.current = String(msg.current || '').slice(0, 300);
        p.clicks = Number(msg.clicks) || 0;
        p.path = Array.isArray(msg.path) ? msg.path.slice(0, 500).map((x) => String(x).slice(0, 300)) : p.path;
        break;
      case 'finish':
        if ((r.phase !== 'race' && r.phase !== 'countdown') || p.status !== 'racing') return;
        p.status = 'finished';
        p.clicks = Number(msg.clicks) || 0;
        p.time = Number(msg.time) || 0;
        p.path = Array.isArray(msg.path) ? msg.path.slice(0, 500).map((x) => String(x).slice(0, 300)) : p.path;
        p.current = r.target ? r.target.title : p.current;
        this.publish();
        this.checkEnd();
        return;
      case 'abandon':
        if ((r.phase !== 'race' && r.phase !== 'countdown') || p.status !== 'racing') return;
        p.status = msg.reason === 'timeout' ? 'timeout' : 'abandoned';
        p.clicks = Number(msg.clicks) || p.clicks;
        p.path = Array.isArray(msg.path) ? msg.path.slice(0, 500).map((x) => String(x).slice(0, 300)) : p.path;
        this.publish();
        this.checkEnd();
        return;
      case 'end':
        if (isHost && (r.phase === 'race' || r.phase === 'countdown')) this.endRace();
        return;
      case 'rematch':
        if (isHost && r.phase === 'results') {
          r.order.filter((pid) => !r.players[pid].connected).forEach((pid) => this.removePlayer(pid));
          this.startVote();
        }
        return;
      case 'lobby':
        if (isHost && (r.phase === 'results' || r.phase === 'vote')) this.toLobby();
        return;
      default:
        return;
    }
    this.publish();
  },

  clearTimers(...names) {
    for (const n of names) { clearTimeout(this.timers[n]); delete this.timers[n]; }
  },

  async startVote() {
    const r = this.room;
    this.clearTimers('vote', 'resolve', 'go', 'end');
    const token = ++this.token;
    r.phase = 'vote';
    r.loading = 'On cherche des cibles…';
    r.error = null;
    r.options = [];
    r.votes = {};
    r.voteEndsAt = null;
    r.target = null;
    r.order.forEach((id) => { const p = r.players[id]; p.status = 'idle'; p.clicks = 0; p.time = null; p.path = []; p.current = null; });
    this.publish();

    let options = [];
    try {
      for (let tries = 0; tries < 3 && options.length < 3; tries++) {
        const cands = pickCandidates(9, this.used);
        const sums = await wiki.fetchSummaries(cands.map((c) => c.title));
        const seenCats = new Set();
        const valid = [];
        for (const c of cands) {
          const s = sums.get(c.title);
          if (!s || seenCats.has(c.category) || valid.some((v) => sameTitle(v.title, s.title))) continue;
          seenCats.add(c.category);
          valid.push({ ...s, category: c.category });
          if (valid.length === 3) break;
        }
        options = valid;
      }
    } catch (e) {
      console.warn(e);
    }
    if (token !== this.token) return;
    if (options.length < 3) {
      r.loading = null;
      r.error = 'Wikipédia ne répond pas. Vérifie ta connexion et retente.';
      this.publish();
      return;
    }
    r.options = options;
    r.loading = null;
    r.voteEndsAt = Date.now() + VOTE_MS;
    this.publish();
    this.timers.vote = setTimeout(() => this.resolveVote(), VOTE_MS);
  },

  checkVotes() {
    const r = this.room;
    if (r.phase !== 'vote' || r.loading || !r.options.length) return;
    const present = r.order.filter((id) => r.players[id].connected);
    if (present.length && present.every((id) => r.votes[id] != null)) {
      this.clearTimers('resolve');
      this.timers.resolve = setTimeout(() => this.resolveVote(), 1200);
    }
  },

  async resolveVote() {
    const r = this.room;
    if (r.phase !== 'vote' || r.loading || !r.options.length) return;
    this.clearTimers('vote', 'resolve');
    const counts = r.options.map(() => 0);
    Object.values(r.votes).forEach((i) => { if (counts[i] != null) counts[i]++; });
    const max = Math.max(...counts);
    const best = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    const chosen = r.options[pickRandom(best)];
    r.target = chosen;
    this.used.add(chosen.title);
    r.phase = 'prep';
    r.loading = 'Tirage de la page de départ…';
    this.publish();

    const token = ++this.token;
    const ids = r.order.filter((id) => r.players[id].connected);
    const starts = {};
    try {
      if (r.settings.start === 'same') {
        const s = await wiki.randomStart({ exclude: [chosen.title], forbidden: r.settings.forbidden });
        ids.forEach((id) => { starts[id] = s; });
      } else {
        const list = await Promise.all(ids.map(() => wiki.randomStart({ exclude: [chosen.title], forbidden: r.settings.forbidden })));
        ids.forEach((id, i) => { starts[id] = list[i]; });
      }
    } catch (e) {
      console.warn(e);
      if (token !== this.token) return;
      r.phase = 'vote';
      r.loading = null;
      r.error = 'Impossible de tirer une page de départ. Réessaie !';
      this.publish();
      return;
    }
    if (token !== this.token) return;

    r.round += 1;
    r.starts = starts;
    r.order.forEach((id) => {
      const p = r.players[id];
      if (starts[id]) {
        Object.assign(p, { status: 'racing', current: starts[id], path: [starts[id]], clicks: 0, time: null });
      } else {
        Object.assign(p, { status: 'idle', current: null, path: [], clicks: 0, time: null });
      }
    });
    r.loading = null;
    r.error = null;
    r.raceStartAt = Date.now() + COUNTDOWN_MS;
    r.raceEndAt = r.settings.limit ? r.raceStartAt + r.settings.limit * 60000 : null;
    r.phase = 'countdown';
    this.publish();
    this.timers.go = setTimeout(() => {
      if (this.room.phase === 'countdown') { this.room.phase = 'race'; this.publish(); }
    }, COUNTDOWN_MS);
    if (r.raceEndAt) this.timers.end = setTimeout(() => this.endRace(), r.raceEndAt - Date.now() + 2000);
  },

  checkEnd() {
    const r = this.room;
    if (r.phase !== 'race' && r.phase !== 'countdown') return;
    const racing = r.order.filter((id) => r.players[id].status === 'racing');
    if (!racing.length) {
      this.clearTimers('endSoon');
      this.timers.endSoon = setTimeout(() => this.endRace(), 2500);
    }
  },

  endRace() {
    const r = this.room;
    if (r.phase !== 'race' && r.phase !== 'countdown') return;
    this.clearTimers('go', 'end', 'endSoon');
    r.order.forEach((id) => { const p = r.players[id]; if (p.status === 'racing') p.status = 'timeout'; });
    r.phase = 'results';
    this.publish();
  },

  toLobby() {
    const r = this.room;
    this.token++;
    this.clearTimers('vote', 'resolve', 'go', 'end', 'endSoon');
    r.phase = 'lobby';
    r.loading = null;
    r.error = null;
    r.options = [];
    r.votes = {};
    r.order.filter((pid) => !r.players[pid].connected).forEach((pid) => this.removePlayer(pid));
    r.order.forEach((id) => { const p = r.players[id]; p.status = 'idle'; });
    this.publish();
  },
};

/* ------------------------------------------------------------------ */
/* Réception de l'état                                                 */
/* ------------------------------------------------------------------ */

function hostNow() {
  return Date.now() + app.offset;
}

function onRoom(room) {
  const prev = app.lastPhase;
  app.room = room;
  app.view = 'room';
  app.lastPhase = room.phase;

  if (room.phase === 'vote' && prev !== 'vote' && prev !== 'prep') sfx.pop();

  const myStart = room.starts && room.starts[me.id];
  if ((room.phase === 'countdown' || room.phase === 'race') && myStart && (!app.race || app.race.round !== room.round)) {
    initRace(room);
  }
  if (app.race && (room.phase !== 'countdown' && room.phase !== 'race')) stopRaceListeners();

  if (room.phase === 'results' && prev !== 'results') {
    if (app.race && app.race.round === room.round && app.race.status === 'racing') {
      app.race.status = 'timeout';
    }
    saveRound(room);
    sfx.results();
  }
  render();
}

function saveRound(room) {
  if (app.savedRounds.has(room.round)) return;
  const mine = room.players[me.id];
  if (!mine || !room.starts || !room.starts[me.id] || !room.target) return;
  app.savedRounds.add(room.round);
  const ranking = rankPlayers(room);
  const pos = ranking.findIndex((x) => x.id === me.id);
  stats.add({
    id: `${room.code}-${room.round}-${room.raceStartAt}`,
    date: Date.now(),
    target: room.target.title,
    status: mine.status,
    clicks: mine.clicks,
    time: mine.time,
    rank: mine.status === 'finished' ? pos + 1 : null,
    players: ranking.length,
    rankMode: room.settings.rank,
    opponents: ranking.filter((x) => x.id !== me.id).map((x) => x.name),
    path: mine.path,
  });
}

// Classement : les arrivées d'abord (selon le mode), puis les autres
function rankPlayers(room) {
  const list = room.order.map((id) => room.players[id]).filter((p) => p && p.status !== 'idle');
  const byClicks = (a, b) => a.clicks - b.clicks || a.time - b.time;
  const byTime = (a, b) => a.time - b.time || a.clicks - b.clicks;
  const fin = list.filter((p) => p.status === 'finished').sort(room.settings.rank === 'time' ? byTime : byClicks);
  const rest = list.filter((p) => p.status !== 'finished').sort((a, b) => b.clicks - a.clicks);
  return [...fin, ...rest];
}

/* ------------------------------------------------------------------ */
/* La course                                                           */
/* ------------------------------------------------------------------ */

let tickTimer = null;

function initRace(room) {
  stopRaceListeners();
  const start = room.starts[me.id];
  app.race = {
    round: room.round,
    target: room.target,
    rules: { ...room.settings },
    stack: [start],
    path: [start],
    current: start,
    clicks: 0,
    startLocal: room.raceStartAt - app.offset,
    endLocal: room.raceEndAt ? room.raceEndAt - app.offset : null,
    status: 'racing',
    time: null,
    page: null,
    loading: true,
    countdownShown: null,
    finishPlace: null,
  };
  const R = app.race;
  loadInitial(R, start);
  if (!R.rules.find) document.addEventListener('keydown', blockFind, true);
  tickTimer = setInterval(tick, 200);
  tick();
}

function stopRaceListeners() {
  document.removeEventListener('keydown', blockFind, true);
  clearInterval(tickTimer);
  tickTimer = null;
  hideOverlay();
}

function blockFind(e) {
  const k = (e.key || '').toLowerCase();
  if (((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'g')) || k === 'f3') {
    e.preventDefault();
    e.stopPropagation();
    toast('La recherche dans la page est désactivée 🙈');
  }
}

async function loadInitial(R, title) {
  for (let i = 0; i < 4; i++) {
    try {
      const page = await wiki.loadArticle(title);
      if (app.race !== R) return;
      R.page = page;
      R.current = page.title;
      R.stack = [page.title];
      R.path = [page.title];
      R.loading = false;
      if (app.mounted === 'race') showArticle();
      updateRaceUi();
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (app.race === R) {
    R.loading = false;
    toast('Impossible de charger la page de départ 😕', 4000);
    updateRaceUi();
  }
}

async function goTo(title, { back = false } = {}) {
  const R = app.race;
  if (!R || R.status !== 'racing' || R.loading) return;
  if (Date.now() < R.startLocal) return;
  if (R.rules.forbidden && isForbidden(title)) {
    toast('Page interdite 🚫');
    sfx.error();
    return;
  }
  R.loading = true;
  updateRaceUi();
  sfx.click();
  let page;
  try {
    page = await wiki.loadArticle(title);
  } catch (e) {
    R.loading = false;
    toast('La page n\'a pas chargé, réessaie');
    updateRaceUi();
    return;
  }
  if (app.race !== R || R.status !== 'racing') return;
  R.loading = false;
  if (R.rules.forbidden && isForbidden(page.title)) {
    toast(`« ${page.title} » est une page interdite 🚫`);
    sfx.error();
    updateRaceUi();
    return;
  }
  if (back) R.stack.pop();
  else R.stack.push(page.title);
  R.current = page.title;
  R.path.push(page.title);
  R.clicks += 1;
  R.page = page;
  showArticle();
  if (sameTitle(page.title, R.target.title)) {
    finishRace();
    return;
  }
  net.send({ t: 'progress', current: R.current, clicks: R.clicks, path: R.path });
  updateRaceUi();
}

function finishRace() {
  const R = app.race;
  R.status = 'finished';
  R.time = Date.now() - R.startLocal;
  const others = app.room ? Object.values(app.room.players).filter((p) => p.id !== me.id && p.status === 'finished').length : 0;
  R.finishPlace = others + 1;
  net.send({ t: 'finish', clicks: R.clicks, time: R.time, path: R.path });
  document.removeEventListener('keydown', blockFind, true);
  sfx.win();
  render();
  celebrate();
}

function abandonRace(reason) {
  const R = app.race;
  if (!R || R.status !== 'racing') return;
  R.status = reason === 'timeout' ? 'timeout' : 'abandoned';
  net.send({ t: 'abandon', reason, clicks: R.clicks, path: R.path });
  document.removeEventListener('keydown', blockFind, true);
  sfx.sad();
  render();
}

function celebrate() {
  const c = window.confetti;
  if (!c) return;
  const colors = ['#FFC93C', '#4A2FE0', '#2EC4B6', '#FF8A73', '#FFFFFF'];
  const opts = { colors, disableForReducedMotion: true, zIndex: 50 };
  c({ ...opts, particleCount: 140, spread: 80, origin: { y: 0.55 } });
  setTimeout(() => c({ ...opts, particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.7 } }), 250);
  setTimeout(() => c({ ...opts, particleCount: 80, angle: 120, spread: 70, origin: { x: 1, y: 0.7 } }), 400);
  setTimeout(() => c({ ...opts, particleCount: 120, spread: 120, startVelocity: 35, origin: { y: 0.3 } }), 900);
}

function tick() {
  const R = app.race;
  if (!R) return;
  const now = Date.now();
  // Décompte 3, 2, 1
  if (now < R.startLocal) {
    const n = Math.ceil((R.startLocal - now) / 1000);
    if (R.countdownShown !== n && n <= 3) {
      R.countdownShown = n;
      showOverlay(`<div class="countdown"><span class="cd-num" key="${n}">${n}</span><span class="cd-target">Cible : ${esc(R.target.title)}</span></div>`);
      sfx.tick();
    } else if (R.countdownShown == null) {
      R.countdownShown = 'wait';
      showOverlay(`<div class="countdown"><span class="cd-ready">Prête ?</span><span class="cd-target">Cible : ${esc(R.target.title)}</span></div>`);
    }
  } else if (R.countdownShown !== 'go' && R.countdownShown !== 'done') {
    R.countdownShown = 'go';
    showOverlay('<div class="countdown"><span class="cd-num cd-go">GO !</span></div>');
    sfx.go();
    setTimeout(() => { if (app.race === R) { R.countdownShown = 'done'; hideOverlay(); } }, 700);
  }
  if (R.status === 'racing' && R.endLocal && now >= R.endLocal) {
    toast('Temps écoulé ⏰', 3000);
    abandonRace('timeout');
  }
  updateRaceClock();
}

function updateRaceClock() {
  const R = app.race;
  if (!R || app.mounted !== 'race') return;
  const elapsed = Math.max(0, Date.now() - R.startLocal);
  const el = document.getElementById('r-time');
  if (el) el.textContent = fmtTime(elapsed);
  const bar = document.getElementById('r-bar');
  if (bar && R.endLocal) bar.style.width = `${Math.min(100, (elapsed / (R.endLocal - R.startLocal)) * 100)}%`;
}

function showOverlay(html) {
  $overlay.innerHTML = html;
  $overlay.hidden = false;
}

function hideOverlay() {
  $overlay.hidden = true;
  $overlay.innerHTML = '';
}

function showArticle() {
  const R = app.race;
  const box = document.getElementById('r-article');
  if (!R || !R.page || !box) return;
  box.innerHTML = wiki.buildArticle(R.page.html, { forbidden: R.rules.forbidden });
  const t = document.getElementById('r-title');
  if (t) t.textContent = R.page.display;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function updateRaceUi() {
  const R = app.race;
  const r = app.room;
  if (!R || !r || app.mounted !== 'race') return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
  set('r-clicks', String(R.clicks));

  const loading = document.getElementById('r-loading');
  if (loading) loading.hidden = !R.loading;
  document.querySelector('.race')?.classList.toggle('is-loading', !!R.loading);

  const canBack = R.rules.back && R.stack.length > 1 && !R.loading;
  document.querySelectorAll('[data-action="back"]').forEach((b) => { b.disabled = !canBack; });

  // Fil d'Ariane
  const trail = R.path.slice(-6);
  const hidden = R.path.length - trail.length;
  set('r-trail', (hidden ? `<span class="trail-more">+${hidden}</span><span aria-hidden="true">›</span>` : '') +
    trail.map((t, i) => `<span class="${i === trail.length - 1 ? 'trail-now' : ''}">${esc(t)}</span>`).join('<span aria-hidden="true">›</span>'));
  const trailEl = document.getElementById('r-trail');
  if (trailEl) trailEl.scrollLeft = trailEl.scrollWidth;

  // Adversaires
  const others = r.order.map((id) => r.players[id]).filter((p) => p && p.id !== me.id && p.status !== 'idle');
  set('r-opps', others.slice(0, 2).map((p) => `<div class="opp">${avatar(p, 22)}<span>${oppText(p)}</span></div>`).join('') +
    (others.length > 2 ? `<div class="opp opp-more">+${others.length - 2}</div>` : ''));

  // Barre latérale (ordi)
  const everyone = r.order.map((id) => r.players[id]).filter((p) => p && p.status !== 'idle');
  set('r-side-players', everyone.map((p) => `
    <div class="side-player">${avatar(p, 34)}<div class="side-player-txt"><strong>${esc(p.name)}${p.id === me.id ? ' (toi)' : ''}</strong>
    <span>${p.id === me.id ? `${esc(R.current)} · ${R.clicks} clic${R.clicks > 1 ? 's' : ''}` : sideText(p)}</span></div></div>`).join(''));
  set('r-side-path', R.path.map((t, i) => `<li class="${i === R.path.length - 1 ? 'is-now' : ''}"><span>${i}</span>${esc(t)}</li>`).join(''));
}

function oppText(p) {
  const n = `<strong>${esc(p.name)}</strong>`;
  if (p.status === 'finished') return `${n} est arrivée ! 🏁 · ${p.clicks} clics`;
  if (p.status === 'abandoned') return `${n} a abandonné`;
  if (p.status === 'timeout') return `${n} n'a plus de temps`;
  if (!p.connected) return `${n} est déconnectée…`;
  return `${esc(p.name)} est sur <strong>${esc(p.current || '…')}</strong> · ${p.clicks} clic${p.clicks > 1 ? 's' : ''}`;
}

function sideText(p) {
  if (p.status === 'finished') return `Arrivée en ${p.clicks} clics · ${fmtTime(p.time)}`;
  if (p.status === 'abandoned') return 'Abandon';
  if (p.status === 'timeout') return 'Temps écoulé';
  if (!p.connected) return 'Déconnectée…';
  return `${esc(p.current || '…')} · ${p.clicks} clic${p.clicks > 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Écrans                                                              */
/* ------------------------------------------------------------------ */

function screenKey() {
  if (app.view === 'stats') return 'stats';
  const r = app.room;
  if (!r) return 'home';
  switch (r.phase) {
    case 'lobby': return 'lobby';
    case 'vote':
    case 'prep': return 'vote';
    case 'countdown':
    case 'race': {
      const R = app.race;
      if (R && R.round === r.round) return R.status === 'racing' ? 'race' : 'done';
      return 'done';
    }
    case 'results': return 'results';
    default: return 'home';
  }
}

const isHost = () => app.role === 'host';

function render() {
  const key = screenKey();
  if (key === 'race' && app.mounted === 'race') { updateRaceUi(); return; }
  const html = SCREENS[key]();
  $app.innerHTML = html;
  const changed = app.mounted !== key;
  app.mounted = key;
  document.body.dataset.screen = key;
  document.body.dataset.tone = key === 'done' && !(app.race && app.race.round === (app.room && app.room.round) && app.race.status === 'finished') ? 'out' : '';
  if (key === 'race') {
    if (app.race && app.race.page) showArticle();
    updateRaceUi();
    updateRaceClock();
  }
  if (changed && key !== 'race') window.scrollTo({ top: 0, behavior: 'auto' });
  if (changed) document.getElementById('toast')?.classList.remove('show');
  updateCountdowns();
}

const SCREENS = {
  home() {
    return `
    <main class="screen home">
      <div class="blob blob-1" aria-hidden="true"></div>
      <div class="blob blob-2" aria-hidden="true"></div>
      <header class="home-head">
        <div class="brand-row"><div class="logo-mark">${ICON.bolt}</div><span class="kicker">Wikirace entre potes</span></div>
        <h1 class="display">Wiki<br>Rush</h1>
        <p class="lead">Une page au hasard, une cible, et la première qui l'atteint en cliquant de lien en lien gagne.</p>
      </header>
      <form class="stack" data-form="create" novalidate>
        <label for="pseudo" class="label">Ton pseudo</label>
        <input id="pseudo" name="pseudo" class="input" maxlength="16" autocomplete="nickname" placeholder="Ex : Elsa" value="${esc(me.name)}">
        <button class="btn btn-primary" type="submit" ${app.busy ? 'disabled' : ''}>${ICON.plus}<span>${app.busy === 'create' ? 'Création de la salle…' : 'Créer une partie'}</span></button>
      </form>
      <div class="divider"><span>ou rejoins une partie</span></div>
      <form class="join-row" data-form="join" novalidate>
        <label for="code" class="sr-only">Code de la partie</label>
        <input id="code" name="code" class="input input-code" placeholder="CODE" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(prefillCode)}">
        <button class="btn btn-dark" type="submit" ${app.busy ? 'disabled' : ''}>${app.busy === 'join' ? 'Connexion…' : 'Rejoindre'}</button>
      </form>
      <button type="button" class="link-btn" data-action="stats">${ICON.chart}<span>Mes stats et parties passées</span></button>
    </main>`;
  },

  lobby() {
    const r = app.room;
    const s = r.settings;
    const host = isHost();
    const players = r.order.map((id) => r.players[id]);
    const seg = (key, label, options) => `
      <div class="rule-row rule-col">
        <span class="rule-name" id="lbl-${key}">${label}</span>
        <div class="seg" role="group" aria-labelledby="lbl-${key}">
          ${options.map(([v, l]) => `<button type="button" aria-pressed="${String(s[key]) === String(v)}" data-action="set" data-key="${key}" data-value="${v}" ${host ? '' : 'disabled'}>${l}</button>`).join('')}
        </div>
      </div>`;
    const sw = (key, label, sub) => `
      <div class="rule-row">
        <div class="rule-txt"><span class="rule-name">${label}</span><span class="rule-sub">${sub}</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${!!s[key]}" aria-label="${label}" data-action="toggle" data-key="${key}" ${host ? '' : 'disabled'}><span></span></button>
      </div>`;
    return `
    <main class="screen lobby">
      <div class="topbar">
        <button type="button" class="icon-btn" data-action="leave" aria-label="Quitter la salle">${ICON.chevL}</button>
        <span class="wordmark">WikiRush</span>
        <span class="icon-spacer"></span>
      </div>
      <section class="code-card">
        <div class="code-txt"><span class="code-label">Code de la salle</span><span class="code">${esc(r.code)}</span></div>
        <button type="button" class="icon-btn icon-btn-dark" data-action="invite" aria-label="Copier le lien d'invitation">${ICON.copy}</button>
      </section>
      <section class="stack-sm">
        <h2 class="h2">Joueuses (${players.length})</h2>
        <div class="players-grid">
          ${players.map((p) => `
            <div class="player-card ${p.connected ? '' : 'is-off'}">
              ${avatar(p, 40)}
              <div class="player-txt"><span class="player-name">${esc(p.name)}${p.id === me.id ? ' <span class="you">(toi)</span>' : ''}</span>
              <span class="player-sub ${p.id === r.hostId ? '' : 'ok'}">${!p.connected ? 'Déconnectée…' : p.id === r.hostId ? 'Hôte' : 'Prête'}</span></div>
            </div>`).join('')}
        </div>
        ${players.length < 2 ? '<p class="hint">Envoie le code (ou le lien avec le bouton copier) à tes potes pour qu\'elles te rejoignent.</p>' : ''}
      </section>
      <section class="stack-sm">
        <h2 class="h2">Règles de la partie</h2>
        ${host ? '' : '<p class="hint">Seule l\'hôte peut modifier les règles.</p>'}
        <div class="card rules">
          ${seg('start', 'Page de départ', [['same', 'La même pour toutes'], ['each', 'Chacune la sienne']])}
          ${seg('rank', 'Classement', [['time', 'Au temps'], ['clicks', 'Au moins de clics']])}
          ${seg('limit', 'Limite de temps', [[5, '5 min'], [10, '10 min'], [0, 'Illimité']])}
          <button type="button" class="rules-toggle" data-action="rules-open" aria-expanded="${app.rulesOpen}">
            <span class="rule-txt"><span class="rule-name">Règles personnalisées</span><span class="rule-sub">Retour, recherche, pages interdites</span></span>
            ${app.rulesOpen ? ICON.chevU : ICON.chevD}
          </button>
          ${app.rulesOpen ? `<div class="rules-more">
            ${sw('back', 'Bouton retour', 'Revenir à la page précédente (compte 1 clic)')}
            ${sw('find', 'Rechercher dans la page', s.find ? 'Le Ctrl+F est autorisé' : 'Le Ctrl+F est bloqué')}
            ${sw('forbidden', 'Pages interdites', 'Pays et années bloqués')}
          </div>` : ''}
        </div>
      </section>
      <div class="bottom-cta">
        ${host
          ? `<button type="button" class="btn btn-primary" data-action="start"><span>Démarrer</span>${ICON.arrowR}</button>`
          : '<div class="waiting-note"><span class="dot pulse"></span>En attente de l\'hôte pour démarrer</div>'}
      </div>
    </main>`;
  },

  vote() {
    const r = app.room;
    const prep = r.phase === 'prep';
    const myVote = r.votes[me.id];
    const present = r.order.filter((id) => r.players[id].connected);
    const voted = present.filter((id) => r.votes[id] != null).length;
    const counts = r.options.map((_, i) => Object.values(r.votes).filter((v) => v === i).length);
    const max = Math.max(0, ...counts);
    const leaders = counts.map((c, i) => (c === max && c > 0 ? i : -1)).filter((i) => i >= 0);
    const swatch = ['#FFC93C', '#2EC4B6', '#FF8A73'];

    let body;
    if (r.loading && !prep) {
      body = `<div class="card loading-card"><span class="spinner" aria-hidden="true"></span><span>${esc(r.loading)}</span></div>`;
    } else if (r.error) {
      body = `<div class="card loading-card is-error"><span>${esc(r.error)}</span>
        <button type="button" class="btn btn-outline btn-sm" data-action="reroll">Réessayer</button></div>`;
    } else {
      body = `<div class="vote-list">${r.options.map((o, i) => {
        const chosen = prep && r.target && sameTitle(r.target.title, o.title);
        const voters = r.order.filter((id) => r.votes[id] === i).map((id) => r.players[id]).filter(Boolean);
        return `
        <button type="button" class="vote-card ${myVote === i && !prep ? 'is-mine' : ''} ${chosen ? 'is-chosen' : ''} ${prep && !chosen ? 'is-out' : ''}"
          data-action="vote" data-idx="${i}" aria-pressed="${myVote === i}" ${prep ? 'disabled' : ''}>
          <span class="vote-thumb" style="background:${swatch[i % 3]}">
            ${o.thumb ? `<img src="${esc(o.thumb)}" alt="" loading="lazy">` : `<span class="vote-letter">${esc(o.title.charAt(0))}</span>`}
          </span>
          <span class="vote-body">
            <span class="vote-top"><span class="vote-cat">${esc(o.category)}</span>
              ${chosen ? '<span class="badge badge-yellow">La cible !</span>' : myVote === i ? '<span class="badge">Ton vote</span>' : ''}</span>
            <span class="vote-title">${esc(o.title)}</span>
            <span class="vote-extract">${esc(o.extract)}</span>
            <span class="vote-voters">${voters.length
              ? `${voters.map((p) => avatar(p, 24)).join('')}<strong>${voters.length} vote${voters.length > 1 ? 's' : ''}</strong>`
              : '<span class="muted">Aucun vote</span>'}</span>
          </span>
        </button>`;
      }).join('')}</div>`;
    }

    let status = '';
    if (prep) status = `<span class="spinner spinner-sm" aria-hidden="true"></span>${esc(r.loading || 'Préparation…')}`;
    else if (r.options.length && !r.loading) {
      if (voted === present.length && present.length) status = '<span class="dot dot-ok"></span>Tout le monde a voté !';
      else if (leaders.length > 1) status = `<span class="dot dot-warn"></span>Égalité pour l'instant : tirage au sort à 0:00 · ${voted}/${present.length} votes`;
      else if (leaders.length === 1) status = `<span class="dot"></span>En tête : ${esc(r.options[leaders[0]].title)} · ${voted}/${present.length} votes`;
      else status = `<span class="dot"></span>Clique sur une carte pour voter`;
    }

    return `
    <main class="screen vote">
      <div class="vote-head">
        <div class="row-between">
          <span class="kicker">Salle ${esc(r.code)}</span>
          ${r.voteEndsAt && !prep && !r.loading ? `<span class="timer-pill">${ICON.timer}<span data-until="${r.voteEndsAt}">0:30</span></span>` : ''}
        </div>
        <h1 class="h1">${prep ? 'La cible est choisie !' : 'Choisis la cible'}</h1>
        <p class="sub">${prep ? 'On tire la page de départ, prépare-toi…' : 'La page la plus votée devient l\'objectif. Égalité : tirage au sort.'}</p>
      </div>
      ${body}
      ${!prep && !r.loading && r.options.length ? `<button type="button" class="link-btn" data-action="reroll">${ICON.reroll}<span>Proposer 3 autres cibles</span></button>` : ''}
      <div class="bottom-cta">
        ${status ? `<div class="vote-status">${status}</div>` : ''}
        ${isHost() && !prep
          ? `<button type="button" class="btn btn-dark" data-action="launch" ${r.loading || !r.options.length ? 'disabled' : ''}><span>Lancer la course</span>${ICON.boltSm}</button>`
          : ''}
        ${isHost() && !prep ? '<button type="button" class="link-btn link-muted" data-action="lobby">Revenir aux règles</button>' : ''}
      </div>
    </main>`;
  },

  race() {
    const R = app.race;
    const r = app.room;
    const limit = R.endLocal ? fmtTime(R.endLocal - R.startLocal) : null;
    const actions = (cls) => `
      <button type="button" class="btn btn-outline ${cls}" data-action="back" ${R.rules.back ? '' : 'disabled'}>${ICON.chevL}<span>${R.rules.back ? 'Page précédente' : 'Retour désactivé'}</span></button>
      <button type="button" class="icon-btn ${cls === 'btn-top' ? 'icon-btn-dark' : ''}" data-action="abandon" aria-label="Abandonner la partie">${ICON.flag}</button>`;
    return `
    <main class="race">
      <header class="race-top">
        <div class="race-top-inner">
          <div class="race-brand">WikiRush</div>
          <div class="target"><span class="t-label">Cible</span><span class="t-name">${esc(R.target.title)}</span></div>
          <div class="race-right">
            <div class="race-stats">
              <div class="stat-box"><span class="v" id="r-time">00:00</span><span class="l">${limit ? `/ ${limit}` : 'chrono'}</span></div>
              <div class="stat-box"><span class="v" id="r-clicks">0</span><span class="l">clics</span></div>
            </div>
            <div class="top-actions">${actions('btn-top')}</div>
          </div>
        </div>
        ${limit ? '<div class="limit-bar" aria-hidden="true"><div id="r-bar"></div></div>' : ''}
        <div class="opponents" id="r-opps"></div>
      </header>
      <nav class="trail" id="r-trail" aria-label="Ton chemin"></nav>
      <div class="race-body">
        <aside class="race-side">
          <section class="side-card"><h2 class="side-h">En direct</h2><div id="r-side-players" class="side-players"></div></section>
          <section class="side-card"><h2 class="side-h">Ton chemin</h2><ol id="r-side-path" class="side-path"></ol></section>
          <section class="side-card"><h2 class="side-h">Règles</h2>
            <ul class="side-rules">
              <li>Classement ${r.settings.rank === 'time' ? 'au temps' : 'aux clics'}</li>
              <li>Retour ${R.rules.back ? 'autorisé' : 'désactivé'}</li>
              <li>Ctrl+F ${R.rules.find ? 'autorisé' : 'bloqué'}</li>
              <li>${R.rules.forbidden ? 'Pays et années interdits' : 'Aucune page interdite'}</li>
            </ul>
          </section>
        </aside>
        <article class="wiki-wrap">
          <div class="wiki-loading" id="r-loading"><span class="spinner spinner-sm" aria-hidden="true"></span>Chargement…</div>
          <h1 class="wiki-title" id="r-title">${R.page ? esc(R.page.display) : ''}</h1>
          <p class="wiki-src">Contenu chargé depuis Wikipédia</p>
          <div class="wiki" id="r-article"></div>
        </article>
      </div>
      <footer class="race-bottom">${actions('')}</footer>
    </main>`;
  },

  done() {
    const r = app.room;
    const R = app.race && app.race.round === r.round ? app.race : null;
    const status = R ? R.status : 'spectate';
    const finished = status === 'finished';
    const others = r.order.map((id) => r.players[id]).filter((p) => p && p.id !== me.id && p.status !== 'idle');
    const racing = others.filter((p) => p.status === 'racing');
    const places = ['Première', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième', 'Septième', 'Huitième'];
    const head = {
      finished: { kick: `Tu as trouvé ${esc(r.target.title)}`, title: 'Arrivée !', sub: `${places[(R && R.finishPlace ? R.finishPlace : 1) - 1] || 'Encore une'} arrivée de la salle` },
      abandoned: { kick: `Cible : ${esc(r.target.title)}`, title: 'Abandon', sub: 'Pas grave, la revanche t\'attend 💪' },
      timeout: { kick: `Cible : ${esc(r.target.title)}`, title: 'Temps écoulé !', sub: 'Le chrono a eu raison de toi cette fois' },
      spectate: { kick: `Cible : ${esc(r.target.title)}`, title: 'Course en cours', sub: 'Tu rejoindras la prochaine manche' },
    }[status];
    return `
    <main class="screen done ${finished ? 'is-win' : 'is-out'}">
      ${finished ? '<div class="confetti-static" aria-hidden="true">' + Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('') + '</div>' : ''}
      <div class="done-head">
        <span class="kicker kicker-light">${head.kick}</span>
        <h1 class="display-xl">${head.title}</h1>
        <p class="sub-light">${head.sub}</p>
      </div>
      ${R ? `
      <div class="tiles">
        <div class="tile"><span class="tile-l">Temps</span><span class="tile-v">${finished ? fmtTime(R.time) : '--:--'}</span></div>
        <div class="tile"><span class="tile-l">Clics</span><span class="tile-v">${R.clicks}</span></div>
      </div>
      <div class="chips">${R.path.map((t, i) => `<span class="chip ${finished && i === R.path.length - 1 ? 'chip-win' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="wait-card">
        <div class="wait-head"><span class="dot dot-live"></span><strong>${racing.length ? 'En attente des autres' : 'Tout le monde a fini !'}</strong></div>
        ${others.map((p) => `
          <div class="wait-row">${avatar(p, 40)}
            <div class="wait-txt"><strong>${esc(p.name)}</strong><span>${waitText(p)}</span></div>
          </div>`).join('') || '<p class="sub-light">Tu jouais en solo cette fois.</p>'}
        ${racing.length ? (isHost()
          ? '<button type="button" class="btn btn-ghost-dark" data-action="end">Voir les résultats maintenant</button>'
          : '<p class="wait-note">Les résultats s\'affichent quand tout le monde a fini.</p>')
          : '<p class="wait-note"><span class="spinner spinner-sm spinner-light" aria-hidden="true"></span>Les résultats arrivent…</p>'}
      </div>
    </main>`;
  },

  results() {
    const r = app.room;
    const ranking = rankPlayers(r);
    const finished = ranking.filter((p) => p.status === 'finished');
    const rest = ranking.filter((p) => p.status !== 'finished');
    const podium = finished.slice(0, 3);
    const order = podium.length === 3 ? [1, 0, 2] : podium.length === 2 ? [1, 0] : [0];
    const heights = [100, 70, 50];
    const metric = (p) => r.settings.rank === 'time' ? `${fmtTime(p.time)} · ${p.clicks} clics` : `${p.clicks} clics · ${fmtTime(p.time)}`;
    return `
    <main class="screen results">
      <div class="stack-sm">
        <h1 class="h1">Résultats</h1>
        <div class="pills">
          <span class="pill pill-yellow">Cible : ${esc(r.target ? r.target.title : '')}</span>
          <span class="pill">Classement ${r.settings.rank === 'time' ? 'au temps' : 'aux clics'}</span>
          <span class="pill">${r.settings.start === 'same' ? 'Même départ' : 'Départs différents'}</span>
        </div>
      </div>
      ${podium.length ? `
      <div class="podium">
        ${order.map((i) => {
          const p = podium[i];
          return `<div class="podium-col">
            ${i === 0 ? `<span class="crown">${ICON.crown}</span>` : ''}
            ${avatar(p, 52)}
            <div class="podium-txt"><strong>${esc(p.name)}</strong><span>${metric(p)}</span></div>
            <div class="podium-block podium-${i + 1}" style="height:${heights[i]}px">${i + 1}</div>
          </div>`;
        }).join('')}
      </div>` : `<div class="card empty-card">Personne n'a trouvé ${esc(r.target ? r.target.title : 'la cible')} cette fois 😭</div>`}
      ${finished.length > 3 || rest.length ? `
      <div class="card rank-list">
        ${finished.slice(3).map((p, i) => `<div class="rank-row"><span class="rank-n">${i + 4}</span>${avatar(p, 30)}<strong>${esc(p.name)}</strong><span class="rank-m">${metric(p)}</span></div>`).join('')}
        ${rest.map((p) => `<div class="rank-row is-out"><span class="rank-n">–</span>${avatar(p, 30)}<strong>${esc(p.name)}</strong><span class="rank-m">${p.status === 'timeout' ? 'Temps écoulé' : 'Abandon'} · ${p.clicks} clics</span></div>`).join('')}
      </div>` : ''}
      <section class="stack-sm">
        <h2 class="h2">Les chemins</h2>
        <div class="paths">
          ${ranking.map((p) => `
          <div class="path-card">
            <span class="path-name" style="color:${colorOf(p).ink}">${esc(p.name)}</span>
            <ol class="path-list">${(p.path || []).map((t, i) => `<li class="${p.status === 'finished' && i === p.path.length - 1 ? 'is-win' : ''}"><span>${i}</span>${esc(t)}</li>`).join('')}</ol>
          </div>`).join('')}
        </div>
      </section>
      <div class="bottom-cta">
        <div class="row-gap">
          ${isHost()
            ? `<button type="button" class="btn btn-primary grow" data-action="rematch">${ICON.reroll}<span>Revanche</span></button>`
            : '<div class="waiting-note grow"><span class="dot pulse"></span>L\'hôte peut lancer la revanche</div>'}
          <button type="button" class="icon-btn icon-btn-lg" data-action="share" aria-label="Partager les résultats">${ICON.share}</button>
        </div>
        ${isHost() ? '<button type="button" class="link-btn link-muted" data-action="lobby">Changer les règles</button>' : ''}
        <button type="button" class="link-btn link-muted" data-action="leave">Quitter la partie</button>
      </div>
    </main>`;
  },

  stats() {
    const list = stats.all();
    const s = stats.summary(list);
    const fmtDate = (d) => {
      const date = new Date(d);
      const today = new Date();
      const y = new Date(); y.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return 'Aujourd\'hui';
      if (date.toDateString() === y.toDateString()) return 'Hier';
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    };
    return `
    <main class="screen stats">
      <div class="topbar topbar-left">
        <button type="button" class="icon-btn" data-action="home" aria-label="Retour à l'accueil">${ICON.chevL}</button>
        <h1 class="h1 h1-sm">Mes stats</h1>
      </div>
      <div class="stats-grid">
        <div class="stat-tile stat-dark"><span class="tile-l">Victoires</span><span class="tile-v tile-yellow">${s.wins}</span><span class="tile-s">sur ${s.played} partie${s.played > 1 ? 's' : ''}</span></div>
        <div class="stat-tile"><span class="tile-l">Record de clics</span><span class="tile-v">${s.bestClicks ? s.bestClicks.clicks : '–'}</span><span class="tile-s">${s.bestClicks ? 'vers ' + esc(s.bestClicks.target) : 'pas encore'}</span></div>
        <div class="stat-tile"><span class="tile-l">Record de temps</span><span class="tile-v">${s.bestTime ? fmtTime(s.bestTime.time) : '–'}</span><span class="tile-s">${s.bestTime ? 'vers ' + esc(s.bestTime.target) : 'pas encore'}</span></div>
        <div class="stat-tile"><span class="tile-l">Moyenne</span><span class="tile-v">${s.avg != null ? s.avg.toFixed(1).replace('.', ',') : '–'}</span><span class="tile-s">clics par arrivée</span></div>
      </div>
      <section class="stack-sm">
        <h2 class="h2">Parties passées</h2>
        ${list.length ? `<div class="card history">
          ${list.slice(0, 30).map((g) => `
            <details class="history-row">
              <summary>
                <span class="hist-rank ${g.rank === 1 ? 'is-gold' : ''}">${g.rank || '–'}</span>
                <span class="hist-txt"><strong>${esc(g.target)}</strong><span>${fmtDate(g.date)}${g.opponents && g.opponents.length ? ' · avec ' + esc(g.opponents.join(', ')) : ' · en solo'}</span></span>
                <span class="hist-m">${g.status === 'finished' ? `${g.clicks} clic${g.clicks > 1 ? 's' : ''}` : g.status === 'timeout' ? 'Temps' : 'Abandon'}</span>
              </summary>
              <ol class="path-list path-inline">${(g.path || []).map((t, i) => `<li><span>${i}</span>${esc(t)}</li>`).join('')}</ol>
            </details>`).join('')}
        </div>` : '<div class="card empty-card">Pas encore de partie ici. Lance-toi, la première victoire t\'attend ✨</div>'}
      </section>
    </main>`;
  },
};

function waitText(p) {
  if (p.status === 'finished') return `Arrivée ! ${p.clicks} clics · ${fmtTime(p.time)}`;
  if (p.status === 'abandoned') return 'A abandonné';
  if (p.status === 'timeout') return 'Temps écoulé';
  if (!p.connected) return 'Déconnectée…';
  return `Sur <strong>${esc(p.current || '…')}</strong> · ${p.clicks} clic${p.clicks > 1 ? 's' : ''}`;
}

// Met à jour les petits chronos (vote) sans tout redessiner
function updateCountdowns() {
  document.querySelectorAll('[data-until]').forEach((el) => {
    const left = Number(el.dataset.until) - hostNow();
    const s = Math.max(0, Math.ceil(left / 1000));
    el.textContent = `0:${String(s).padStart(2, '0')}`;
  });
}
setInterval(updateCountdowns, 250);

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function readName() {
  const input = document.getElementById('pseudo');
  const name = (input ? input.value : me.name).trim().slice(0, 16);
  if (!name) {
    toast('Choisis un pseudo d\'abord 😉');
    input && input.focus();
    return null;
  }
  me.name = name;
  store.set('wr_name', name);
  return name;
}

function errorText(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') return 'Aucune partie avec ce code. Vérifie-le !';
  if (type === 'timeout' || (err && err.message === 'timeout')) return 'La connexion prend trop de temps. Réessaie !';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Impossible de joindre le serveur de connexion. Vérifie ta connexion.';
  if (type === 'browser-incompatible') return 'Ton navigateur ne gère pas le multijoueur 😕';
  return (err && err.message) || 'Oups, quelque chose a coincé. Réessaie !';
}

async function onCreate() {
  if (app.busy) return;
  if (!readName()) return;
  unlockAudio();
  app.busy = 'create';
  render();
  try {
    await createRoom();
  } catch (e) {
    console.warn(e);
    net.destroy();
    app.role = null;
    toast(errorText(e), 4000);
    app.busy = false;
    render();
    return;
  }
  app.busy = false;
  render();
}

async function onJoin() {
  if (app.busy) return;
  if (!readName()) return;
  const input = document.getElementById('code');
  const code = normalizeCode(input && input.value);
  if (!code) {
    toast('Entre le code de la partie');
    input && input.focus();
    return;
  }
  unlockAudio();
  app.busy = 'join';
  render();
  try {
    await joinRoom(code);
  } catch (e) {
    console.warn(e);
    net.destroy();
    app.role = null;
    toast(errorText(e), 4000);
    app.busy = false;
    render();
    const again = document.getElementById('code');
    if (again) again.value = code;
    return;
  }
  app.busy = false;
  // l'écran change à la réception du premier état
}

function leaveRoom(silent = false) {
  stopRaceListeners();
  if (app.role === 'host') {
    net.broadcast({ t: 'bye' });
    const peer = net.peer;
    net.peer = null;
    setTimeout(() => { try { peer && peer.destroy(); } catch (e) { /* rien */ } }, 400);
  }
  net.destroy();
  Object.values(host.timers).forEach((t) => clearTimeout(t));
  host.timers = {};
  host.room = null;
  app.role = null;
  app.room = null;
  app.race = null;
  app.view = 'home';
  app.lastPhase = null;
  app.connLost = false;
  renderConnBanner();
  if (!silent) sfx.pop();
  render();
}

async function invite() {
  const r = app.room;
  const url = `${location.origin}${location.pathname}?code=${encodeURIComponent(r.code)}`;
  const text = `Viens jouer à WikiRush avec moi ! Code : ${r.code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'WikiRush', text, url }); return; } catch (e) { /* annulé */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Lien d\'invitation copié 📋');
  } catch (e) {
    toast(`Code : ${r.code}`);
  }
}

async function shareResults() {
  const r = app.room;
  const ranking = rankPlayers(r);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranking.map((p, i) => p.status === 'finished'
    ? `${medals[i] || `${i + 1}.`} ${p.name} : ${p.clicks} clics en ${fmtTime(p.time)}`
    : `💀 ${p.name} : ${p.status === 'timeout' ? 'temps écoulé' : 'abandon'}`);
  const text = `WikiRush · cible ${r.target ? r.target.title : ''}\n${lines.join('\n')}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'WikiRush', text }); return; } catch (e) { /* annulé */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Résultats copiés 📋');
  } catch (e) {
    toast('Impossible de copier 😕');
  }
}

$app.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'create') onCreate();
  if (form.dataset.form === 'join') onJoin();
});

$app.addEventListener('click', (e) => {
  // Liens d'article pendant la course
  const wl = e.target.closest('#r-article a, #r-article .wl-dead');
  if (wl) {
    e.preventDefault();
    if (wl.classList.contains('wl-forbidden')) { toast('Page interdite 🚫'); sfx.error(); return; }
    if (wl.classList.contains('wl') && wl.dataset.title) goTo(wl.dataset.title);
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  unlockAudio();
  const action = btn.dataset.action;
  const r = app.room;

  switch (action) {
    case 'stats': app.view = 'stats'; render(); break;
    case 'home': app.view = app.room ? 'room' : 'home'; render(); break;
    case 'leave':
      if (app.room && !confirm(isHost() ? 'Quitter ? La partie s\'arrêtera pour tout le monde.' : 'Quitter la partie ?')) return;
      leaveRoom();
      break;
    case 'invite': invite(); break;
    case 'set': {
      const key = btn.dataset.key;
      let value = btn.dataset.value;
      if (key === 'limit') value = Number(value);
      net.send({ t: 'settings', settings: { [key]: value } });
      sfx.click();
      break;
    }
    case 'toggle': {
      const key = btn.dataset.key;
      net.send({ t: 'settings', settings: { [key]: !(r && r.settings[key]) } });
      sfx.click();
      break;
    }
    case 'rules-open': app.rulesOpen = !app.rulesOpen; render(); break;
    case 'start': net.send({ t: 'start' }); break;
    case 'vote': {
      const idx = Number(btn.dataset.idx);
      if (r.votes[me.id] === idx) return;
      net.send({ t: 'vote', idx });
      sfx.pop();
      break;
    }
    case 'reroll': net.send({ t: 'reroll' }); break;
    case 'launch': net.send({ t: 'launch' }); break;
    case 'back': {
      const R = app.race;
      if (R && R.rules.back && R.stack.length > 1) goTo(R.stack[R.stack.length - 2], { back: true });
      break;
    }
    case 'abandon':
      if (confirm('Abandonner cette manche ?')) abandonRace('abandon');
      break;
    case 'end': net.send({ t: 'end' }); break;
    case 'rematch': net.send({ t: 'rematch' }); break;
    case 'lobby': net.send({ t: 'lobby' }); break;
    case 'share': shareResults(); break;
    default: break;
  }
});

// L'hôte qui ferme l'onglet arrête la partie : on prévient avant
window.addEventListener('beforeunload', (e) => {
  if (app.room && (app.role === 'host' || (app.race && app.race.status === 'racing'))) {
    e.preventDefault();
    e.returnValue = '';
  }
});

render();
if (prefillCode) {
  const input = document.getElementById(me.name ? 'code' : 'pseudo');
  if (input) input.focus();
}

// Accès pour les tests automatisés
window.__wikirush = { app, host, me };
