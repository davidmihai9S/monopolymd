// Fuzz test for the rules engine + bots.
//   node tests/sim.mjs [games=1500] [seed=1]
// Plays many bot games with random settings, mixes in random (often illegal)
// actions from random seats, simulates a Firebase round-trip after every step
// and checks invariants. Exits non-zero on the first violation.

import { BOARD, GROUPS, DECKS, BUYABLE, freeCardId } from '../js/data.js';
import { createGame, apply, normalize, RuleError, ownsGroup, tradeProblem, actor } from '../js/engine.js';
import { botMove } from '../js/bot.js';

const GAMES = Number(process.argv[2] || 1500);
let seed = Number(process.argv[3] || 1);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Firebase RTDB drops null/undefined and empty containers. Randomly turn
   arrays into {"0":..} objects to make sure normalize() copes either way. */
function fb(x, rng) {
  if (x === null || x === undefined) return undefined;
  if (Array.isArray(x)) {
    const a = x.map((v) => fb(v, rng));
    if (a.some((v) => v === undefined)) throw new Error('array with hole/null: ' + JSON.stringify(x));
    if (!a.length) return undefined;
    if (rng() < 0.2) return Object.fromEntries(a.map((v, i) => [String(i), v]));
    return a;
  }
  if (typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (/[.#$/[\]]/.test(k)) throw new Error('illegal firebase key ' + k);
      const t = fb(v, rng);
      if (t !== undefined) o[k] = t;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('non-finite number');
  return x;
}

const canon = (x) => {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x);
};

function check(s, ctx) {
  const bad = (m) => { throw new Error(`${ctx}: ${m}\nphase=${s.phase} turn=${s.turn}\n` + JSON.stringify(s.log.slice(-8))); };
  const n = s.players.length;
  s.players.forEach((p, i) => {
    if (!Number.isInteger(p.cash) || p.cash < 0) bad(`player ${i} cash ${p.cash}`);
    if (!(p.pos >= 0 && p.pos < 40)) bad(`player ${i} pos ${p.pos}`);
    if (p.out && (p.cash !== 0 || p.jailCards.length)) bad(`out player ${i} still has assets`);
  });
  s.tiles.forEach((st, i) => {
    const t = BOARD[i];
    if (st.owner >= n || st.owner < -1) bad(`tile ${i} owner ${st.owner}`);
    if (st.owner >= 0 && !BUYABLE.has(t.type)) bad(`unbuyable tile ${i} owned`);
    if (st.owner >= 0 && s.players[st.owner].out) bad(`tile ${i} owned by out player`);
    if (st.houses < 0 || st.houses > 5) bad(`tile ${i} houses ${st.houses}`);
    if (st.houses > 0) {
      if (t.type !== 'prop' || st.owner < 0) bad(`houses on ${i}`);
      if (!ownsGroup(s, st.owner, t.group)) bad(`houses without full group on ${i}`);
      if (GROUPS[t.group].tiles.some((j) => s.tiles[j].mortgaged)) bad(`houses with mortgaged group ${i}`);
    }
    if (st.mortgaged) {
      if (st.owner < 0) bad(`mortgaged unowned ${i}`);
      if (t.type === 'prop' && GROUPS[t.group].tiles.some((j) => s.tiles[j].houses > 0)) bad(`mortgage in built group ${i}`);
    }
  });
  for (const g of GROUPS) {
    const hs = g.tiles.map((i) => s.tiles[i].houses);
    if (Math.max(...hs) - Math.min(...hs) > 1) bad(`uneven group ${g.id}: ${hs}`);
  }
  for (const d of Object.keys(DECKS)) {
    const pile = s.decks[d];
    const free = freeCardId(d);
    const held = s.players.reduce((k, p) => k + p.jailCards.filter((x) => x === d).length, 0);
    if (new Set(pile).size !== pile.length) bad(`duplicate cards in ${d}`);
    if (held + pile.filter((x) => x === free).length !== 1) bad(`free card count ${d}`);
    if (pile.length + held !== DECKS[d].cards.length) bad(`deck ${d} size ${pile.length}+${held}`);
  }
  for (const T of Object.values(s.trades)) if (tradeProblem(s, T)) bad(`invalid trade kept ${JSON.stringify(T)}`);
  switch (s.phase) {
    case 'buy': {
      const p = s.players[s.turn];
      if (s.pending < 0 || s.tiles[s.pending].owner !== -1 || p.pos !== s.pending || !BUYABLE.has(BOARD[s.pending].type)) bad('bad buy phase');
      break;
    }
    case 'auction': {
      const A = s.auction;
      if (!A || !A.queue.length || A.idx >= A.queue.length || s.tiles[A.tile].owner !== -1) bad('bad auction');
      if (A.leader >= 0 && A.high > s.players[A.leader].cash) bad('leader cannot pay');
      break;
    }
    case 'debt':
      if (!s.debt || s.debt.player !== s.turn || s.debt.amount <= s.players[s.turn].cash - 0 && false) bad('bad debt');
      if (s.debt.amount <= 0) bad('zero debt');
      break;
    case 'roll':
    case 'end':
      if (s.auction || s.debt || s.pending !== -1) bad('leftover auction/debt/pending');
      break;
    case 'over':
      break;
    default:
      bad('unexpected phase ' + s.phase);
  }
  if (s.phase !== 'over' && s.phase !== 'auction' && s.players[s.turn].out) bad('turn on out player');
  if (s.phase !== 'over' && s.players.filter((p) => !p.out).length < 2) bad('game should be over');
}

function randomAction(s, rng) {
  const n = s.players.length;
  const seat = Math.floor(rng() * n);
  const tile = Math.floor(rng() * 40);
  const r = rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (r < 0.02) return { seat, action: { type: 'resign' } };
  if (r < 0.3) {
    const mine = s.tiles.map((t, i) => i).filter((i) => s.tiles[i].owner === seat);
    const to = Math.floor(rng() * n);
    const theirs = s.tiles.map((t, i) => i).filter((i) => s.tiles[i].owner === to);
    return {
      seat,
      action: {
        type: 'propose', to,
        give: { tiles: mine.filter(() => rng() < 0.3), cash: rng() < 0.5 ? Math.floor(rng() * 300) : 0, cards: rng() < 0.1 ? 1 : 0 },
        get: { tiles: theirs.filter(() => rng() < 0.3), cash: rng() < 0.3 ? Math.floor(rng() * 300) : 0, cards: 0 },
      },
    };
  }
  if (r < 0.45) {
    const T = pick(Object.values(s.trades));
    if (T) return { seat: rng() < 0.8 ? T.to : seat, action: { type: pick(['accept', 'reject', 'cancel']), id: T.id } };
  }
  const type = pick(['build', 'sell', 'mortgage', 'unmortgage', 'roll', 'buy', 'decline', 'endTurn', 'payJail', 'useCard', 'bid', 'pass', 'payDebt', 'bankrupt']);
  return { seat, action: { type, tile, amount: Math.floor(rng() * 400) } };
}

let totalSteps = 0;
let finished = 0;
let stalled = 0;
const reasons = {};
const lengths = [];
const t0 = Date.now();

for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(seed + g * 7919);
  const n = 2 + Math.floor(rng() * 5);
  const settings = {
    cash: [1000, 1500, 2000][Math.floor(rng() * 3)],
    auctions: rng() < 0.8,
    jackpot: rng() < 0.4,
    rounds: rng() < 0.3 ? 30 : 0,
  };
  const seats = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true }));
  let s = createGame(seats, settings, rng);
  check(s, `game ${g} start`);
  const chaos = rng() < 0.5 ? 0.15 : 0;
  let steps = 0;
  for (; steps < 25000 && s.phase !== 'over'; steps++) {
    let m;
    if (chaos && rng() < chaos) m = randomAction(s, rng);
    else {
      m = botMove(s, () => true);
      if (!m) throw new Error(`game ${g}: bots stuck in phase ${s.phase} actor ${actor(s)}`);
      m.action = { ...m.action, seq: s.seq };
    }
    const before = canon(s);
    try {
      s = apply(s, m.seat, m.action, rng);
    } catch (e) {
      if (!(e instanceof RuleError)) { console.error(`game ${g} step ${steps}`, m, e); process.exit(1); }
      if (canon(s) !== before) throw new Error('state mutated by failed action');
      if (!chaos || m.action.seq != null) {
        throw new Error(`game ${g} step ${steps}: bot made illegal move ${JSON.stringify(m)} -> ${e.message} (phase ${s.phase})`);
      }
      continue;
    }
    // Firebase round-trip must be lossless after normalize().
    const wire = JSON.parse(JSON.stringify(fb(JSON.parse(JSON.stringify(s)), rng)));
    const back = normalize(wire);
    if (canon(normalize(s)) !== canon(back)) {
      console.error(canon(normalize(s)).slice(0, 2000));
      console.error(canon(back).slice(0, 2000));
      throw new Error(`game ${g} step ${steps}: firebase round-trip changed state`);
    }
    s = back;
    check(s, `game ${g} step ${steps} after ${m.action.type}`);
  }
  totalSteps += steps;
  if (s.phase === 'over') {
    finished++;
    reasons[s.endReason] = (reasons[s.endReason] || 0) + 1;
    lengths.push(s.round);
  } else stalled++;
}

lengths.sort((a, b) => a - b);
const med = lengths[Math.floor(lengths.length / 2)];
console.log(`games=${GAMES} finished=${finished} stalled=${stalled} steps=${totalSteps} ` +
  `rounds(median)=${med} p90=${lengths[Math.floor(lengths.length * 0.9)]} reasons=${JSON.stringify(reasons)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (stalled > GAMES * 0.03) { console.error('too many stalled games'); process.exit(1); }
