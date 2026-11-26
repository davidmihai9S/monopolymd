// Rules engine. Pure functions over a plain-JSON game state.
//
//   apply(state, seat, action, rng) -> new state   (throws RuleError if illegal)
//
// The same code runs on every client. Online, actions are applied inside a
// Firebase transaction, so the state must stay Firebase-safe: dense arrays,
// no undefined, and normalize() must repair whatever Firebase drops
// (empty arrays/objects, nulls).

import {
  BOARD, GROUPS, DECKS, STATIONS, UTILITIES, BUYABLE,
  START_CASH, GO_SALARY, JAIL_TILE, JAIL_FINE, MAX_PLAYERS, MIN_BID,
  houseCost, mortgageValue, unmortgageCost, freeCardId,
} from './data.js';

export const BANK = -1;
export const POT = -2; // the Parcare jackpot (house rule)
export const ALL = -3; // every other active player

const LOG_MAX = 80;
const FLOW = new Set(['roll', 'payJail', 'useCard', 'buy', 'decline', 'bid', 'pass', 'payDebt', 'bankrupt', 'endTurn', 'resign', 'finish', 'restart']);

export class RuleError extends Error {
  constructor(message, code = 'rule') { super(message); this.code = code; }
}
const fail = (msg, code) => { throw new RuleError(msg, code); };

export const defaultSettings = () => ({ cash: START_CASH, auctions: true, jackpot: false, rounds: 0 });

const clone = (x) => JSON.parse(JSON.stringify(x));
const int = (x) => (Number.isFinite(Number(x)) ? Math.trunc(Number(x)) : NaN);

function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function log(s, entry) {
  entry.n = ++s.n;
  s.log.push(entry);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Creation & normalisation                                            */
/* ------------------------------------------------------------------ */

export function createGame(seats, settings = {}, rng = Math.random) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > MAX_PLAYERS) {
    fail('Jocul are nevoie de 2–6 jucători.');
  }
  const set = { ...defaultSettings(), ...settings };
  // A random player starts; rotate the seats so they keep their cyclic order
  // and "round" can simply tick whenever play wraps back to seat 0.
  const first = Math.floor(rng() * seats.length);
  seats = [...seats.slice(first), ...seats.slice(0, first)];
  const s = {
    v: 2,
    seq: 0,
    flow: 0,
    n: 0,
    settings: set,
    players: seats.map((p) => ({
      name: String(p.name || 'Jucător').slice(0, 16),
      token: p.token || '🙂',
      color: p.color || '#888888',
      bot: !!p.bot,
      cid: p.cid || (p.bot ? 'bot' : 'local'),
      cash: set.cash,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      out: false,
      auto: false,
      declined: [],
    })),
    tiles: BOARD.map(() => ({ owner: -1, houses: 0, mortgaged: false })),
    turn: 0,
    phase: 'roll',
    dice: [0, 0],
    doubles: 0,
    again: false,
    pending: -1,
    auction: null,
    debt: null,
    decks: { chance: shuffled(DECKS.chance.cards.length, rng), assoc: shuffled(DECKS.assoc.cards.length, rng) },
    pot: 0,
    trades: {},
    log: [],
    round: 1,
    winner: -1,
    endReason: '',
  };
  log(s, { k: 'start' });
  log(s, { k: 'turn', p: s.turn });
  return s;
}

const asArray = (x) => {
  if (Array.isArray(x)) return x.filter((v) => v !== null && v !== undefined);
  if (x && typeof x === 'object') {
    return Object.keys(x).sort((a, b) => Number(a) - Number(b)).map((k) => x[k]).filter((v) => v != null);
  }
  return [];
};

const normSide = (o) => ({
  tiles: asArray(o && o.tiles).map(int).filter((t) => t >= 0 && t < 40),
  cash: Math.max(0, int(o && o.cash) || 0),
  cards: Math.max(0, int(o && o.cards) || 0),
});

export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !raw.players) return null;
  const s = clone(raw);
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  s.players = asArray(s.players).map((p) => ({
    name: 'Jucător', token: '🙂', color: '#888888', bot: false, cid: 'local',
    cash: 0, pos: 0, inJail: false, jailTurns: 0, out: false, auto: false,
    ...p,
    jailCards: asArray(p.jailCards),
    declined: asArray(p.declined),
  }));
  const tiles = s.tiles || {};
  s.tiles = BOARD.map((_, i) => ({ owner: -1, houses: 0, mortgaged: false, ...(tiles[i] || {}) }));
  const dice = asArray(s.dice);
  s.dice = dice.length === 2 ? dice : [0, 0];
  s.decks = { chance: asArray(s.decks && s.decks.chance), assoc: asArray(s.decks && s.decks.assoc) };
  const trades = s.trades && typeof s.trades === 'object' ? s.trades : {};
  s.trades = {};
  for (const [id, t] of Object.entries(trades)) {
    if (!t) continue;
    s.trades[id] = { ...t, id, give: normSide(t.give), get: normSide(t.get) };
  }
  s.log = asArray(s.log).map((e) => {
    if (e.k === 'trade') return { ...e, give: normSide(e.give), get: normSide(e.get) };
    if (e.k === 'roll') return { ...e, d: asArray(e.d) };
    return e;
  });
  s.auction = s.auction ? { tile: -1, high: 0, leader: -1, idx: 0, ...s.auction, queue: asArray(s.auction.queue) } : null;
  s.debt = s.debt ? { per: 0, then: 'after', ...s.debt } : null;
  for (const [k, d] of [['seq', 0], ['flow', 0], ['n', 0], ['turn', 0], ['doubles', 0], ['pending', -1], ['pot', 0], ['round', 1], ['winner', -1]]) {
    if (typeof s[k] !== 'number') s[k] = d;
  }
  s.again = !!s.again;
  s.phase = s.phase || 'roll';
  s.endReason = s.endReason || '';
  return s;
}

/* ------------------------------------------------------------------ */
/* Queries (used by UI and bots too)                                   */
/* ------------------------------------------------------------------ */

export const active = (s) => s.players.map((p, i) => i).filter((i) => !s.players[i].out);

export function ownsGroup(s, seat, g) {
  return GROUPS[g].tiles.every((i) => s.tiles[i].owner === seat);
}

export function rentOf(s, tile, mul = 1) {
  const t = BOARD[tile];
  const st = s.tiles[tile];
  if (st.owner < 0 || st.mortgaged) return 0;
  let rent = 0;
  if (t.type === 'prop') {
    if (st.houses > 0) rent = t.rent[st.houses];
    else rent = ownsGroup(s, st.owner, t.group) ? t.rent[0] * 2 : t.rent[0];
  } else if (t.type === 'station') {
    const n = STATIONS.filter((i) => s.tiles[i].owner === st.owner).length;
    rent = t.rent[n - 1];
  } else if (t.type === 'utility') {
    const n = UTILITIES.filter((i) => s.tiles[i].owner === st.owner).length;
    rent = (s.dice[0] + s.dice[1]) * (n === 2 ? 10 : 4);
  }
  return rent * mul;
}

export function netWorth(s, seat) {
  const p = s.players[seat];
  if (p.out) return 0;
  let w = p.cash;
  s.tiles.forEach((st, i) => {
    if (st.owner !== seat) return;
    w += st.mortgaged ? BOARD[i].price / 2 : BOARD[i].price;
    if (st.houses) w += st.houses * houseCost(i);
  });
  return Math.round(w);
}

/** The seat whose decision the game is waiting on (ignoring trade replies). */
export function actor(s) {
  if (s.phase === 'over') return -1;
  if (s.phase === 'auction' && s.auction) return s.auction.queue[s.auction.idx] ?? -1;
  if (s.phase === 'debt' && s.debt) return s.debt.player;
  return s.turn;
}

const groupHouses = (s, g) => GROUPS[g].tiles.map((i) => s.tiles[i].houses);

export function buildError(s, seat, tile) {
  const t = BOARD[tile];
  if (!t || t.type !== 'prop') return 'Poți construi doar pe cartiere și bulevarde.';
  const st = s.tiles[tile];
  if (st.owner !== seat) return 'Nu e proprietatea ta.';
  if (s.phase === 'auction') return 'Așteaptă să se termine licitația.';
  if (!ownsGroup(s, seat, t.group)) return 'Trebuie să deții tot grupul de culoare.';
  if (GROUPS[t.group].tiles.some((i) => s.tiles[i].mortgaged)) return 'Ridică întâi ipotecile din acest grup.';
  if (st.houses >= 5) return 'Ai deja hotel aici.';
  if (st.houses > Math.min(...groupHouses(s, t.group))) return 'Construiește uniform: pune întâi case pe celelalte din grup.';
  if (s.players[seat].cash < houseCost(tile)) return 'Nu ai destui bani.';
  return '';
}

export function sellError(s, seat, tile) {
  const t = BOARD[tile];
  if (!t || t.type !== 'prop') return 'Aici nu sunt clădiri.';
  const st = s.tiles[tile];
  if (st.owner !== seat) return 'Nu e proprietatea ta.';
  if (s.phase === 'auction') return 'Așteaptă să se termine licitația.';
  if (st.houses <= 0) return 'Aici nu sunt clădiri.';
  if (st.houses < Math.max(...groupHouses(s, t.group))) return 'Vinde uniform: vinde întâi de unde ai mai multe clădiri.';
  return '';
}

export function mortgageError(s, seat, tile) {
  const t = BOARD[tile];
  if (!t || !BUYABLE.has(t.type)) return 'Nu se poate ipoteca.';
  const st = s.tiles[tile];
  if (st.owner !== seat) return 'Nu e proprietatea ta.';
  if (s.phase === 'auction') return 'Așteaptă să se termine licitația.';
  if (st.mortgaged) return 'E deja ipotecată.';
  if (t.type === 'prop' && groupHouses(s, t.group).some((h) => h > 0)) return 'Vinde întâi clădirile din acest grup.';
  return '';
}

export function unmortgageError(s, seat, tile) {
  const t = BOARD[tile];
  if (!t || !BUYABLE.has(t.type)) return 'Nu se poate.';
  const st = s.tiles[tile];
  if (st.owner !== seat) return 'Nu e proprietatea ta.';
  if (s.phase === 'auction') return 'Așteaptă să se termine licitația.';
  if (!st.mortgaged) return 'Nu e ipotecată.';
  if (s.players[seat].cash < unmortgageCost(tile)) return 'Nu ai destui bani.';
  return '';
}

/** Structural validity of a trade (ownership, no buildings). Cash is checked on accept. */
export function tradeProblem(s, T) {
  const a = s.players[T.from];
  const b = s.players[T.to];
  if (!a || !b || a.out || b.out || T.from === T.to) return 'Jucătorul nu mai e în joc.';
  const seen = new Set();
  for (const [side, owner] of [[T.give, T.from], [T.get, T.to]]) {
    for (const tile of side.tiles) {
      if (seen.has(tile)) return 'Proprietate duplicată.';
      seen.add(tile);
      const t = BOARD[tile];
      if (!t || !BUYABLE.has(t.type)) return 'Proprietate invalidă.';
      if (s.tiles[tile].owner !== owner) return `${t.name} nu mai aparține cui trebuie.`;
      if (t.type === 'prop' && groupHouses(s, t.group).some((h) => h > 0)) return `Grupul lui ${t.name} are clădiri.`;
    }
  }
  if (!T.give.tiles.length && !T.get.tiles.length && !T.give.cash && !T.get.cash && !T.give.cards && !T.get.cards) {
    return 'Oferta e goală.';
  }
  return '';
}

export function tradeCashProblem(s, T) {
  const a = s.players[T.from];
  const b = s.players[T.to];
  if (a.cash < T.give.cash) return `${a.name} nu mai are ${T.give.cash} RON.`;
  if (b.cash < T.get.cash) return `${b.name} nu are ${T.get.cash} RON.`;
  if (a.jailCards.length < T.give.cards) return `${a.name} nu mai are cartonașul.`;
  if (b.jailCards.length < T.get.cards) return `${b.name} nu are cartonașul.`;
  return '';
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

const feeTarget = (s) => (s.settings.jackpot ? POT : BANK);

function credit(s, to, amount, per = 0, payer = -1) {
  if (to >= 0) s.players[to].cash += amount;
  else if (to === POT) s.pot += amount;
  else if (to === ALL) {
    for (const i of active(s)) if (i !== payer) s.players[i].cash += per;
  }
}

/**
 * Charge `amount`. Pays immediately if possible and returns true; otherwise
 * opens a debt (phase 'debt') and returns false. `entry` is logged either way.
 */
function charge(s, seat, amount, to, then, entry, per = 0) {
  const p = s.players[seat];
  if (amount <= 0) { if (entry) log(s, entry); return true; }
  if (p.cash >= amount) {
    p.cash -= amount;
    credit(s, to, amount, per, seat);
    if (entry) log(s, entry);
    return true;
  }
  if (entry) { entry.owed = true; log(s, entry); }
  s.debt = { player: seat, amount, to, then, per };
  s.phase = 'debt';
  return false;
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

function salary(s, seat) {
  s.players[seat].cash += GO_SALARY;
  log(s, { k: 'go', p: seat, a: GO_SALARY });
}

function advance(s, seat, steps, rng) {
  const p = s.players[seat];
  const from = p.pos;
  p.pos = (from + steps) % 40;
  log(s, { k: 'move', p: seat, from, to: p.pos, how: 'dice' });
  if (from + steps >= 40) salary(s, seat);
  land(s, seat, 1, rng);
}

function moveTo(s, seat, target, mul, rng) {
  const p = s.players[seat];
  const from = p.pos;
  const steps = (target - from + 40) % 40;
  p.pos = target;
  log(s, { k: 'move', p: seat, from, to: target, how: 'card' });
  if (steps > 0 && from + steps >= 40) salary(s, seat);
  land(s, seat, mul, rng);
}

function toJail(s, seat, why) {
  const p = s.players[seat];
  log(s, { k: 'jail', p: seat, why });
  log(s, { k: 'move', p: seat, from: p.pos, to: JAIL_TILE, how: 'jail' });
  p.pos = JAIL_TILE;
  p.inJail = true;
  p.jailTurns = 0;
  s.again = false;
  s.doubles = 0;
}

function land(s, seat, mul, rng) {
  const p = s.players[seat];
  const t = BOARD[p.pos];
  const st = s.tiles[p.pos];
  switch (t.type) {
    case 'prop':
    case 'station':
    case 'utility': {
      if (st.owner < 0) {
        s.phase = 'buy';
        s.pending = p.pos;
        return;
      }
      if (st.owner === seat || st.mortgaged || s.players[st.owner].out) return;
      const rent = rentOf(s, p.pos, mul);
      charge(s, seat, rent, st.owner, 'after', { k: 'rent', p: seat, to: st.owner, t: p.pos, a: rent });
      return;
    }
    case 'tax':
      charge(s, seat, t.amount, feeTarget(s), 'after', { k: 'tax', p: seat, t: p.pos, a: t.amount });
      return;
    case 'chance':
    case 'assoc':
      drawCard(s, seat, t.type, rng);
      return;
    case 'parking':
      if (s.settings.jackpot && s.pot > 0) {
        p.cash += s.pot;
        log(s, { k: 'pot', p: seat, a: s.pot });
        s.pot = 0;
      }
      return;
    case 'gotojail':
      toJail(s, seat, 'tile');
      return;
    default:
      return;
  }
}

function drawCard(s, seat, deck, rng) {
  const p = s.players[seat];
  let pile = s.decks[deck];
  if (!pile.length) {
    // Rebuild from every card not currently held by a player.
    const held = s.players.reduce((n, q) => n + q.jailCards.filter((d) => d === deck).length, 0);
    const free = freeCardId(deck);
    pile = shuffled(DECKS[deck].cards.length, rng).filter((id) => id !== free || held === 0);
    s.decks[deck] = pile;
  }
  const id = pile.shift();
  const fx = DECKS[deck].cards[id].fx;
  if (fx.k !== 'free') pile.push(id); // back to the bottom of the deck
  log(s, { k: 'card', p: seat, d: deck, c: id });

  switch (fx.k) {
    case 'go':
      moveTo(s, seat, fx.to, 1, rng);
      break;
    case 'back': {
      const from = p.pos;
      p.pos = (p.pos - fx.n + 40) % 40;
      log(s, { k: 'move', p: seat, from, to: p.pos, how: 'back' });
      land(s, seat, 1, rng);
      break;
    }
    case 'cash':
      if (fx.a >= 0) {
        p.cash += fx.a;
        log(s, { k: 'cash', p: seat, a: fx.a });
      } else {
        charge(s, seat, -fx.a, feeTarget(s), 'after', { k: 'cash', p: seat, a: fx.a });
      }
      break;
    case 'jail':
      toJail(s, seat, 'card');
      break;
    case 'free':
      p.jailCards.push(deck);
      break;
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      s.tiles.forEach((st) => {
        if (st.owner !== seat) return;
        if (st.houses === 5) hotels++;
        else houses += st.houses;
      });
      const total = houses * fx.h + hotels * fx.H;
      charge(s, seat, total, feeTarget(s), 'after', { k: 'repairs', p: seat, a: total });
      break;
    }
    case 'payEach': {
      const others = active(s).filter((i) => i !== seat);
      charge(s, seat, fx.a * others.length, ALL, 'after', { k: 'each', p: seat, a: fx.a, dir: 'pay' }, fx.a);
      break;
    }
    case 'collectEach': {
      let total = 0;
      for (const i of active(s)) {
        if (i === seat) continue;
        const amt = Math.min(fx.a, s.players[i].cash);
        s.players[i].cash -= amt;
        total += amt;
      }
      p.cash += total;
      log(s, { k: 'each', p: seat, a: fx.a, dir: 'collect', total });
      break;
    }
    case 'station': {
      const target = STATIONS.find((i) => i > p.pos) ?? STATIONS[0];
      moveTo(s, seat, target, 2, rng);
      break;
    }
    default:
      break;
  }
}

/** Called once a move has fully resolved with no pending decision. */
function finishMove(s) {
  const p = s.players[s.turn];
  s.pending = -1;
  if (p.out) { nextTurn(s); return; }
  if (s.again && !p.inJail) s.phase = 'roll';
  else { s.again = false; s.phase = 'end'; }
}

function nextTurn(s) {
  const n = s.players.length;
  const prev = s.turn;
  let i = prev;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!s.players[i].out) break;
  }
  if (i <= prev) s.round++;
  s.turn = i;
  s.phase = 'roll';
  s.doubles = 0;
  s.again = false;
  s.pending = -1;
  if (s.settings.rounds > 0 && s.round > s.settings.rounds) {
    endByWorth(s, 'rounds');
    return;
  }
  log(s, { k: 'turn', p: i });
}

function endGame(s, winner, why) {
  s.phase = 'over';
  s.winner = winner;
  s.endReason = why;
  s.auction = null;
  s.debt = null;
  s.pending = -1;
  s.trades = {};
  log(s, { k: 'over', p: winner, why });
}

function endByWorth(s, why) {
  const ranked = active(s).sort((a, b) => netWorth(s, b) - netWorth(s, a));
  endGame(s, ranked[0], why);
}

/** Give everything a player owns to `heir` (a seat) or back to the bank. */
function liquidate(s, seat, heir) {
  const p = s.players[seat];
  let cash = p.cash;
  s.tiles.forEach((st, i) => {
    if (st.owner === seat && st.houses > 0) {
      cash += (st.houses * houseCost(i)) / 2;
      st.houses = 0;
    }
  });
  if (heir >= 0 && !s.players[heir].out && heir !== seat) {
    const h = s.players[heir];
    h.cash += Math.max(0, cash);
    s.tiles.forEach((st) => { if (st.owner === seat) st.owner = heir; });
    h.jailCards.push(...p.jailCards);
  } else {
    heir = BANK;
    s.tiles.forEach((st) => {
      if (st.owner === seat) { st.owner = -1; st.mortgaged = false; st.houses = 0; }
    });
    for (const d of p.jailCards) s.decks[d].push(freeCardId(d));
  }
  p.cash = 0;
  p.jailCards = [];
  p.inJail = false;
  p.jailTurns = 0;
  p.out = true;
  for (const [id, T] of Object.entries(s.trades)) if (T.from === seat || T.to === seat) delete s.trades[id];
  if (s.debt && s.debt.to === seat) s.debt.to = BANK;
  return heir;
}

/* ------------------------------------------------------------------ */
/* Auctions                                                            */
/* ------------------------------------------------------------------ */

function startAuction(s, tile) {
  const n = s.players.length;
  const queue = [];
  for (let k = 0; k < n; k++) {
    const i = (s.turn + k) % n;
    if (!s.players[i].out && s.players[i].cash >= MIN_BID) queue.push(i);
  }
  log(s, { k: 'auction', t: tile, p: s.turn });
  s.auction = { tile, high: 0, leader: -1, queue, idx: 0 };
  s.phase = 'auction';
  settleAuction(s);
}

function settleAuction(s) {
  const A = s.auction;
  // Bidders who cannot top the current bid drop out automatically.
  let guard = 0;
  while (A.queue.length && guard++ < 20) {
    const b = A.queue[A.idx];
    if (b === A.leader) break;
    const minNext = Math.max(MIN_BID, A.high + 1);
    if (s.players[b].cash >= minNext) break;
    A.queue.splice(A.idx, 1);
    if (A.idx >= A.queue.length) A.idx = 0;
    log(s, { k: 'pass', p: b, auto: true });
  }
  if (A.queue.length === 0 || (A.queue.length === 1 && A.queue[0] === A.leader)) {
    const winner = A.leader;
    if (winner >= 0) {
      s.players[winner].cash -= A.high;
      s.tiles[A.tile].owner = winner;
      log(s, { k: 'won', p: winner, t: A.tile, a: A.high });
    } else {
      log(s, { k: 'unsold', t: A.tile });
    }
    s.auction = null;
    finishMove(s);
  }
}

/* ------------------------------------------------------------------ */
/* Action handlers                                                     */
/* ------------------------------------------------------------------ */

function needTurn(s, seat, phase) {
  if (s.turn !== seat) fail('Nu e rândul tău.');
  if (s.phase !== phase) fail('Acum nu poți face asta.');
}

function tileArg(x) {
  const t = int(x);
  if (!(t >= 0 && t < 40)) fail('Proprietate invalidă.');
  return t;
}

const H = {
  roll(s, seat, a, rng) {
    needTurn(s, seat, 'roll');
    const p = s.players[seat];
    const d1 = 1 + Math.floor(rng() * 6);
    const d2 = 1 + Math.floor(rng() * 6);
    s.dice = [d1, d2];
    const dbl = d1 === d2;
    log(s, { k: 'roll', p: seat, d: [d1, d2] });
    if (p.inJail) {
      if (dbl) {
        p.inJail = false;
        p.jailTurns = 0;
        s.again = false;
        log(s, { k: 'free', p: seat, how: 'dbl' });
        s.phase = 'move';
        advance(s, seat, d1 + d2, rng);
      } else {
        p.jailTurns++;
        if (p.jailTurns < 3) {
          log(s, { k: 'stay', p: seat, n: p.jailTurns });
          s.again = false;
          s.phase = 'end';
          return;
        }
        s.phase = 'move';
        s.again = false;
        if (!charge(s, seat, JAIL_FINE, feeTarget(s), 'jailmove', { k: 'fine', p: seat, a: JAIL_FINE })) return;
        p.inJail = false;
        p.jailTurns = 0;
        advance(s, seat, d1 + d2, rng);
      }
    } else {
      if (dbl) {
        s.doubles++;
        if (s.doubles >= 3) {
          toJail(s, seat, 'dbl');
          s.phase = 'end';
          return;
        }
        s.again = true;
      } else {
        s.again = false;
      }
      s.phase = 'move';
      advance(s, seat, d1 + d2, rng);
    }
    if (s.phase === 'move') finishMove(s);
  },

  payJail(s, seat) {
    needTurn(s, seat, 'roll');
    const p = s.players[seat];
    if (!p.inJail) fail('Nu ești la închisoare.');
    if (p.cash < JAIL_FINE) fail(`Nu ai ${JAIL_FINE} RON.`);
    p.cash -= JAIL_FINE;
    credit(s, feeTarget(s), JAIL_FINE);
    p.inJail = false;
    p.jailTurns = 0;
    log(s, { k: 'free', p: seat, how: 'fine', a: JAIL_FINE });
  },

  useCard(s, seat) {
    needTurn(s, seat, 'roll');
    const p = s.players[seat];
    if (!p.inJail) fail('Nu ești la închisoare.');
    if (!p.jailCards.length) fail('Nu ai cartonașul.');
    const d = p.jailCards.pop();
    s.decks[d].push(freeCardId(d));
    p.inJail = false;
    p.jailTurns = 0;
    log(s, { k: 'free', p: seat, how: 'card' });
  },

  buy(s, seat) {
    needTurn(s, seat, 'buy');
    const t = BOARD[s.pending];
    const p = s.players[seat];
    if (p.cash < t.price) fail('Nu ai destui bani. Ipotechează ceva sau scoate la licitație.');
    p.cash -= t.price;
    s.tiles[s.pending].owner = seat;
    log(s, { k: 'buy', p: seat, t: s.pending, a: t.price });
    finishMove(s);
  },

  decline(s, seat) {
    needTurn(s, seat, 'buy');
    const tile = s.pending;
    s.pending = -1;
    if (s.settings.auctions) {
      startAuction(s, tile);
    } else {
      log(s, { k: 'skip', p: seat, t: tile });
      finishMove(s);
    }
  },

  bid(s, seat, a) {
    const A = s.auction;
    if (s.phase !== 'auction' || !A) fail('Nu e nicio licitație.');
    if (A.queue[A.idx] !== seat) fail('Nu e rândul tău la licitație.');
    const amount = int(a.amount);
    if (!(amount >= MIN_BID)) fail(`Oferta minimă e ${MIN_BID} RON.`);
    if (amount <= A.high) fail(`Oferta trebuie să depășească ${A.high} RON.`);
    if (amount > s.players[seat].cash) fail('Nu ai atâția bani.');
    A.high = amount;
    A.leader = seat;
    log(s, { k: 'bid', p: seat, a: amount });
    A.idx = (A.idx + 1) % A.queue.length;
    settleAuction(s);
  },

  pass(s, seat) {
    const A = s.auction;
    if (s.phase !== 'auction' || !A) fail('Nu e nicio licitație.');
    if (A.queue[A.idx] !== seat) fail('Nu e rândul tău la licitație.');
    A.queue.splice(A.idx, 1);
    if (A.idx >= A.queue.length) A.idx = 0;
    log(s, { k: 'pass', p: seat });
    settleAuction(s);
  },

  payDebt(s, seat, a, rng) {
    const D = s.debt;
    if (s.phase !== 'debt' || !D || D.player !== seat) fail('Nu ai nicio datorie.');
    const p = s.players[seat];
    if (p.cash < D.amount) fail('Încă nu ai destui bani. Vinde clădiri sau ipotechează.');
    p.cash -= D.amount;
    credit(s, D.to, D.amount, D.per, seat);
    log(s, { k: 'paid', p: seat, a: D.amount, to: D.to });
    s.debt = null;
    s.phase = 'move';
    if (D.then === 'jailmove') {
      p.inJail = false;
      p.jailTurns = 0;
      advance(s, seat, s.dice[0] + s.dice[1], rng);
    }
    if (s.phase === 'move') finishMove(s);
  },

  bankrupt(s, seat) {
    const D = s.debt;
    if (s.phase !== 'debt' || !D || D.player !== seat) fail('Nu ai nicio datorie.');
    s.debt = null;
    const heir = liquidate(s, seat, D.to);
    log(s, { k: 'bankrupt', p: seat, to: heir });
    afterRemoval(s, seat);
  },

  resign(s, seat) {
    const wasDebtor = s.debt && s.debt.player === seat;
    const heir0 = wasDebtor ? s.debt.to : BANK;
    if (wasDebtor) s.debt = null;
    if (s.phase === 'auction' && s.auction) {
      const A = s.auction;
      const qi = A.queue.indexOf(seat);
      if (qi >= 0) {
        A.queue.splice(qi, 1);
        if (qi < A.idx) A.idx--;
        if (A.idx >= A.queue.length) A.idx = 0;
      }
      if (A.leader === seat) { A.leader = -1; A.high = 0; }
    }
    const heir = liquidate(s, seat, heir0);
    log(s, { k: 'resign', p: seat, to: heir });
    afterRemoval(s, seat);
  },

  endTurn(s, seat) {
    needTurn(s, seat, 'end');
    nextTurn(s);
  },

  build(s, seat, a) {
    const tile = tileArg(a.tile);
    const e = buildError(s, seat, tile);
    if (e) fail(e);
    s.players[seat].cash -= houseCost(tile);
    s.tiles[tile].houses++;
    log(s, { k: 'build', p: seat, t: tile, h: s.tiles[tile].houses });
  },

  sell(s, seat, a) {
    const tile = tileArg(a.tile);
    const e = sellError(s, seat, tile);
    if (e) fail(e);
    const amount = houseCost(tile) / 2;
    s.players[seat].cash += amount;
    s.tiles[tile].houses--;
    log(s, { k: 'sell', p: seat, t: tile, h: s.tiles[tile].houses, a: amount });
  },

  mortgage(s, seat, a) {
    const tile = tileArg(a.tile);
    const e = mortgageError(s, seat, tile);
    if (e) fail(e);
    const amount = mortgageValue(tile);
    s.players[seat].cash += amount;
    s.tiles[tile].mortgaged = true;
    log(s, { k: 'mortgage', p: seat, t: tile, a: amount });
  },

  unmortgage(s, seat, a) {
    const tile = tileArg(a.tile);
    const e = unmortgageError(s, seat, tile);
    if (e) fail(e);
    const cost = unmortgageCost(tile);
    s.players[seat].cash -= cost;
    s.tiles[tile].mortgaged = false;
    log(s, { k: 'unmortgage', p: seat, t: tile, a: cost });
  },

  propose(s, seat, a) {
    const to = int(a.to);
    const T = { id: `x${s.seq}`, from: seat, to, give: normSide(a.give), get: normSide(a.get), at: s.seq };
    T.give.tiles = [...new Set(T.give.tiles)];
    T.get.tiles = [...new Set(T.get.tiles)];
    const e = tradeProblem(s, T);
    if (e) fail(e);
    const p = s.players[seat];
    if (p.cash < T.give.cash) fail('Nu ai atâția bani.');
    if (p.jailCards.length < T.give.cards) fail('Nu ai atâtea cartonașe.');
    for (const [id, old] of Object.entries(s.trades)) if (old.from === seat) delete s.trades[id];
    s.trades[T.id] = T;
    log(s, { k: 'offer', p: seat, to });
  },

  accept(s, seat, a) {
    const T = s.trades[a.id];
    if (!T) fail('Oferta nu mai există.');
    if (T.to !== seat) fail('Oferta nu e pentru tine.');
    if (s.phase === 'auction') fail('Așteaptă să se termine licitația.');
    const e = tradeProblem(s, T) || tradeCashProblem(s, T);
    if (e) fail(e);
    const A = s.players[T.from];
    const B = s.players[T.to];
    for (const t of T.give.tiles) s.tiles[t].owner = T.to;
    for (const t of T.get.tiles) s.tiles[t].owner = T.from;
    A.cash += T.get.cash - T.give.cash;
    B.cash += T.give.cash - T.get.cash;
    for (let i = 0; i < T.give.cards; i++) B.jailCards.push(A.jailCards.pop());
    for (let i = 0; i < T.get.cards; i++) A.jailCards.push(B.jailCards.pop());
    delete s.trades[T.id];
    log(s, { k: 'trade', p: T.from, to: T.to, give: T.give, get: T.get });
  },

  reject(s, seat, a) {
    const T = s.trades[a.id];
    if (!T) fail('Oferta nu mai există.');
    if (T.to !== seat) fail('Oferta nu e pentru tine.');
    delete s.trades[T.id];
    const pr = s.players[T.from];
    pr.declined.push(tradeKey(T));
    if (pr.declined.length > 30) pr.declined.splice(0, pr.declined.length - 30);
    log(s, { k: 'reject', p: seat, to: T.from });
  },

  cancel(s, seat, a) {
    const T = s.trades[a.id];
    if (!T) fail('Oferta nu mai există.');
    if (T.from !== seat) fail('Nu e oferta ta.');
    delete s.trades[T.id];
  },

  autopilot(s, seat, a) {
    const target = int(a.target);
    const p = s.players[target];
    if (!p || p.bot) fail('Jucător invalid.');
    p.auto = !!a.on;
    log(s, { k: 'auto', p: target, on: p.auto });
  },

  finish(s) {
    endByWorth(s, 'host');
  },
};

export const tradeKey = (T) => `${T.to}:${[...T.get.tiles].sort((x, y) => x - y).join(',')}`;

function afterRemoval(s, seat) {
  const left = active(s);
  if (left.length <= 1) {
    endGame(s, left.length ? left[0] : -1, 'last');
    return;
  }
  if (s.phase === 'auction' && s.auction) {
    settleAuction(s);
    return;
  }
  if (s.turn === seat) nextTurn(s);
}

function pruneTrades(s) {
  for (const [id, T] of Object.entries(s.trades)) {
    if (tradeProblem(s, T)) delete s.trades[id];
  }
}

/**
 * Apply `action` for `seat` to `state`. Returns a NEW state; never mutates the input.
 * `action.seq` / `action.flow` (optional) guard against acting on a stale view.
 */
export function apply(state, seat, action, rng = Math.random) {
  if (!action || typeof action.type !== 'string') fail('Acțiune invalidă.');
  if (action.type === 'restart') {
    if (state.phase !== 'over') fail('Jocul e încă în desfășurare.');
    return restart(state, rng);
  }
  const s = clone(state);
  if (s.phase === 'over') fail('Jocul s-a terminat.');
  if (action.seq != null && action.seq !== s.seq) fail('Jocul a mers mai departe între timp.', 'stale');
  if (action.flow != null && action.flow !== s.flow) fail('Jocul a mers mai departe între timp.', 'stale');
  const p = s.players[seat];
  if (!p) fail('Nu ești în acest joc.');
  if (p.out && action.type !== 'autopilot') fail('Ai ieșit din joc.');
  const handler = Object.prototype.hasOwnProperty.call(H, action.type) ? H[action.type] : null;
  if (!handler) fail('Acțiune necunoscută.');
  handler(s, seat, action, rng);
  if (FLOW.has(action.type)) s.flow++;
  s.seq++;
  pruneTrades(s);
  return s;
}

function restart(state, rng) {
  const seats = state.players.map((p) => ({ name: p.name, token: p.token, color: p.color, bot: p.bot, cid: p.cid }));
  const s = createGame(seats, state.settings, rng);
  s.seq = state.seq + 1;
  s.flow = state.flow + 1;
  // keep log numbering monotonic so clients notice the new game
  const base = state.n;
  s.log.forEach((e, i) => { e.n = base + i + 1; });
  s.n = base + s.log.length;
  return s;
}

/** Whether an action type advances the turn flow (used by clients for the flow guard). */
export const isFlowAction = (type) => FLOW.has(type);
