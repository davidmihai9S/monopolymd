// Online play over Firebase Realtime Database.
//
// rooms/{CODE}/meta      { v, created, status: 'lobby'|'playing', settings }
// rooms/{CODE}/seats     [ { cid, name, token, color, bot } ]   (lobby; seats[0] is the host)
// rooms/{CODE}/presence  { [cid]: true }                       (onDisconnect -> removed)
// rooms/{CODE}/state     game state (written only through transactions)
// rooms/{CODE}/chat      push list
//
// Every game action is a transaction that re-runs the rules engine on the
// latest server state, so two phones can never overwrite each other.

import { createGame, apply, normalize, RuleError, defaultSettings } from './engine.js';
import { TOKENS, PLAYER_COLORS, BOT_NAMES, MAX_PLAYERS } from './data.js';
import { store } from './fx.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const CONFIG = {
  apiKey: 'AIzaSyBD9yxz2SP35xzNvN9Q5MYM3lcQgd8snAA',
  authDomain: 'monopolymd.firebaseapp.com',
  databaseURL: 'https://monopolymd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'monopolymd',
  storageBucket: 'monopolymd.firebasestorage.app',
  messagingSenderId: '175522958186',
  appId: '1:175522958186:web:fb224b774ec3ea287bf313',
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_TTL = 3 * 24 * 3600 * 1000;
export const CODE_RE = /^[A-Z]{4}$/;

let fbPromise = null;
export function firebase() {
  if (!fbPromise) {
    fbPromise = (async () => {
      const [{ initializeApp }, D] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-database.js')]);
      const app = initializeApp(CONFIG);
      const db = D.getDatabase(app);
      // Test hook: ?emu=localhost:9000 talks to a local Firebase emulator (localhost only).
      const emu = new URLSearchParams(location.search).get('emu');
      if (emu && /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(emu)) {
        const [h, p] = emu.split(':');
        D.connectDatabaseEmulator(db, h, Number(p));
      }
      return { db, ...D };
    })().catch((e) => { fbPromise = null; throw e; });
  }
  return fbPromise;
}

export function clientId() {
  let id = store.get('cid', null);
  if (!id) {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    id = 'c' + [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
    store.set('cid', id);
  }
  return id;
}

const asArray = (x) => (Array.isArray(x) ? x.filter(Boolean) : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]).filter(Boolean) : []);
const clean = (x) => JSON.parse(JSON.stringify(x));
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

function friendly(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/permission/i.test(m)) return 'Serverul a refuzat cererea (regulile bazei de date Firebase nu permit accesul).';
  if (/timeout|timp/i.test(m)) return 'Serverul nu răspunde. Verifică internetul.';
  if (/import|fetch|network|load/i.test(m)) return 'Nu mă pot conecta la server. Verifică internetul sau joacă pe telefon.';
  return (e && e.message) || 'Ceva n-a mers.';
}

function randomCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

function pickFree(list, used, prefer) {
  if (prefer && !used.has(prefer)) return prefer;
  return list.find((x) => !used.has(x)) || list[0];
}

/** Create a new room and seat the creator. Returns the code. */
export async function createRoom(profile) {
  let F;
  try {
    F = await withTimeout(firebase(), 12000, 'timeout');
  } catch (e) {
    throw new Error(friendly(e));
  }
  const cid = clientId();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const now = Date.now();
    const seat = { cid, name: profile.name, token: profile.token || TOKENS[0], color: PLAYER_COLORS[0], bot: false };
    try {
      const res = await withTimeout(F.runTransaction(F.ref(F.db, `rooms/${code}`), (cur) => {
        if (cur && cur.meta && cur.meta.v === 2 && now - (cur.meta.created || 0) < ROOM_TTL) return undefined;
        return { meta: { v: 2, created: now, status: 'lobby', settings: defaultSettings() }, seats: [seat] };
      }, { applyLocally: false }), 12000, 'timeout');
      if (res.committed) return code;
    } catch (e) {
      throw new Error(friendly(e));
    }
  }
  throw new Error('Nu am putut crea camera. Încearcă din nou.');
}

/** Join (or re-join) a room. Resolves to an OnlineRoom that is already listening. */
export async function joinRoom(code, profile) {
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!CODE_RE.test(code)) throw new Error('Codul camerei are 4 litere.');
  let F;
  let meta;
  try {
    F = await withTimeout(firebase(), 12000, 'timeout');
    const snap = await withTimeout(F.get(F.ref(F.db, `rooms/${code}/meta`)), 12000, 'timeout');
    meta = snap.val();
  } catch (e) {
    throw new Error(friendly(e));
  }
  if (!meta || meta.v !== 2) throw new Error('Camera nu există. Verifică codul.');
  const cid = clientId();
  let result = 'joined';
  if (meta.status === 'lobby') {
    try {
      await withTimeout(F.runTransaction(F.ref(F.db, `rooms/${code}/seats`), (cur) => {
        const seats = asArray(cur);
        const mine = seats.findIndex((s) => s.cid === cid);
        if (mine >= 0) {
          seats[mine] = { ...seats[mine], name: profile.name };
          result = 'joined';
          return seats;
        }
        if (seats.length >= MAX_PLAYERS) { result = 'full'; return undefined; }
        const usedT = new Set(seats.map((s) => s.token));
        const usedC = new Set(seats.map((s) => s.color));
        seats.push({ cid, name: profile.name, token: pickFree(TOKENS, usedT, profile.token), color: pickFree(PLAYER_COLORS, usedC), bot: false });
        result = 'joined';
        return seats;
      }, { applyLocally: false }), 12000, 'timeout');
    } catch (e) {
      throw new Error(friendly(e));
    }
    if (result === 'full') throw new Error('Camera e plină (maxim 6 jucători).');
  }
  const room = new OnlineRoom(F, code);
  await room.listen();
  store.set('lastRoom', { code, at: Date.now() });
  return room;
}

export class OnlineRoom {
  constructor(F, code) {
    this.F = F;
    this.kind = 'online';
    this.code = code;
    this.cid = clientId();
    this.meta = null;
    this.seats = [];
    this.presence = {};
    this.state = null;
    this.chat = [];
    this.chatKeys = new Set();
    this.offlineAt = {};
    this.connected = true;
    this.subs = new Set();
    this.lobbySubs = new Set();
    this.chatSubs = new Set();
    this.offs = [];
    this.multiHuman = false;
  }

  ref(path = '') { return this.F.ref(this.F.db, `rooms/${this.code}${path ? '/' + path : ''}`); }

  listen() {
    const F = this.F;
    this.joinedAt = Date.now();
    const ready = { meta: false, seats: false, state: false };
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const tick = (k) => { ready[k] = true; if (ready.meta && ready.seats && ready.state) resolve(); };
    const err = (e) => console.warn('firebase listener', e);
    this.offs.push(F.onValue(this.ref('meta'), (s) => { this.meta = s.val(); tick('meta'); this.emitLobby(); }, err));
    this.offs.push(F.onValue(this.ref('seats'), (s) => { this.seats = asArray(s.val()); tick('seats'); this.emitLobby(); }, err));
    this.offs.push(F.onValue(this.ref('presence'), (s) => {
      const now = Date.now();
      const next = s.val() || {};
      for (const cid of Object.keys(this.presence)) if (!next[cid]) this.offlineAt[cid] = now;
      for (const cid of Object.keys(next)) delete this.offlineAt[cid];
      this.presence = next;
      this.emitLobby();
      if (this.state) this.emit();
    }, err));
    this.offs.push(F.onValue(this.ref('state'), (s) => {
      this.state = normalize(s.val());
      tick('state');
      this.emit();
      this.emitLobby();
    }, err));
    this.offs.push(F.onValue(F.query(this.ref('chat'), F.limitToLast(60)), (s) => {
      const list = [];
      s.forEach((c) => { list.push({ key: c.key, ...c.val() }); });
      const fresh = list.filter((m) => !this.chatKeys.has(m.key));
      fresh.forEach((m) => this.chatKeys.add(m.key));
      this.chat = list.map((m) => ({ ...m, text: String(m.text || '').slice(0, 200), name: String(m.name || '?').slice(0, 16), mine: m.cid === this.cid }));
      const freshMapped = this.chat.filter((m) => fresh.some((f) => f.key === m.key));
      for (const fn of this.chatSubs) fn(this.chat, this.firstChat ? freshMapped : []);
      this.firstChat = true;
    }, err));
    const me = this.ref(`presence/${this.cid}`);
    this.offs.push(F.onValue(F.ref(F.db, '.info/connected'), (s) => {
      this.connected = !!s.val();
      if (this.connected) {
        F.onDisconnect(me).remove().then(() => F.set(me, true)).catch(err);
      }
      this.emitLobby();
      if (this.state) this.emit();
    }));
    return withTimeout(done, 15000, 'timeout').catch(() => { throw new Error('Serverul nu răspunde. Verifică internetul.'); });
  }

  stop() {
    this.offs.forEach((off) => { try { off(); } catch { /* ignore */ } });
    this.offs = [];
    const me = this.ref(`presence/${this.cid}`);
    this.F.onDisconnect(me).cancel().catch(() => {});
    this.F.remove(me).catch(() => {});
  }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  onLobby(fn) { this.lobbySubs.add(fn); fn(this); return () => this.lobbySubs.delete(fn); }
  onChat(fn) { this.chatSubs.add(fn); fn(this.chat, []); return () => this.chatSubs.delete(fn); }
  emit() { for (const fn of this.subs) fn(this.state); }
  emitLobby() { for (const fn of this.lobbySubs) fn(this); }

  /* ----- controller interface for the game view ----- */
  viewer() { return this.state ? this.state.players.findIndex((p) => p.cid === this.cid) : -1; }
  controls(seat) { return seat >= 0 && seat === this.viewer(); }
  isAI(seat) { const p = this.state && this.state.players[seat]; return !!p && (p.bot || p.auto); }
  online(seat) { const p = this.state && this.state.players[seat]; return !!p && (p.bot || !!this.presence[p.cid]); }
  offlineFor(seat) {
    const p = this.state && this.state.players[seat];
    if (!p || this.online(seat)) return 0;
    return Date.now() - (this.offlineAt[p.cid] || this.joinedAt || Date.now());
  }
  /** Lowest-seated connected human runs the bots and has host powers. */
  isDriver() {
    if (!this.state || !this.connected) return false;
    const d = this.state.players.findIndex((p) => !p.bot && this.presence[p.cid]);
    return d >= 0 && this.state.players[d].cid === this.cid;
  }
  canHost() { return this.isDriver(); }

  async send(seat, action) {
    if (!this.connected) return 'Nu ești conectat. Așteaptă reconectarea.';
    const F = this.F;
    let err = null;
    try {
      const res = await withTimeout(F.runTransaction(this.ref('state'), (cur) => {
        if (cur === null) return null;
        err = null;
        try {
          return clean(apply(normalize(cur), seat, action));
        } catch (e) {
          if (e instanceof RuleError) { err = e.code === 'stale' ? 'stale' : e.message; return undefined; }
          throw e;
        }
      }, { applyLocally: false }), 15000, 'timeout');
      if (!res.committed && !err) err = 'Nu s-a putut trimite. Încearcă din nou.';
    } catch (e) {
      err = friendly(e);
    }
    if (err === 'stale') return action.seq != null ? 'stale' : 'Jocul a mers mai departe între timp.';
    return err;
  }

  sendChat(text) {
    const F = this.F;
    const v = this.viewer();
    const p = v >= 0 ? this.state.players[v] : this.seats.find((s) => s.cid === this.cid);
    const name = p ? p.name : store.get('name', 'Spectator');
    F.push(this.ref('chat'), { cid: this.cid, name, color: p ? p.color : '', text: String(text).slice(0, 200), ts: F.serverTimestamp() })
      .catch((e) => console.warn(e));
  }

  /* ----- lobby ----- */
  isHost() { return !!this.seats[0] && this.seats[0].cid === this.cid; }
  mySeat() { return this.seats.find((s) => s.cid === this.cid) || null; }

  seatsTxn(fn) {
    return withTimeout(this.F.runTransaction(this.ref('seats'), (cur) => fn(asArray(cur)), { applyLocally: false }), 12000, 'timeout')
      .catch((e) => { throw new Error(friendly(e)); });
  }

  addBot() {
    return this.seatsTxn((seats) => {
      if (seats.length >= MAX_PLAYERS) return undefined;
      const usedN = new Set(seats.map((s) => s.name));
      const usedT = new Set(seats.map((s) => s.token));
      const usedC = new Set(seats.map((s) => s.color));
      const name = BOT_NAMES.find((n) => !usedN.has(n)) || `Bot ${seats.length}`;
      seats.push({ cid: 'bot-' + Math.random().toString(36).slice(2, 8), name, token: pickFree(TOKENS, usedT), color: pickFree(PLAYER_COLORS, usedC), bot: true });
      return seats;
    });
  }

  kick(cid) { return this.seatsTxn((seats) => seats.filter((s) => s.cid !== cid)); }

  setToken(token) {
    return this.seatsTxn((seats) => {
      if (seats.some((s) => s.cid !== this.cid && s.token === token)) return undefined;
      const me = seats.find((s) => s.cid === this.cid);
      if (!me) return undefined;
      me.token = token;
      return seats;
    });
  }

  setSettings(patch) {
    return this.F.update(this.ref('meta/settings'), patch).catch((e) => { throw new Error(friendly(e)); });
  }

  async startGame() {
    const seats = this.seats;
    if (seats.length < 2) throw new Error('Ai nevoie de cel puțin 2 jucători. Poți adăuga un bot.');
    const settings = { ...defaultSettings(), ...((this.meta && this.meta.settings) || {}) };
    const state = createGame(seats.map((s) => ({ name: s.name, token: s.token, color: s.color, bot: s.bot, cid: s.cid })), settings);
    try {
      await this.F.update(this.ref(), { state: clean(state), 'meta/status': 'playing', 'meta/started': Date.now() });
    } catch (e) {
      throw new Error(friendly(e));
    }
  }

  async leave() {
    try {
      if (this.meta && this.meta.status === 'lobby') await this.seatsTxn((seats) => seats.filter((s) => s.cid !== this.cid));
    } catch { /* leaving anyway */ }
    this.stop();
    store.set('lastRoom', null);
  }
}
