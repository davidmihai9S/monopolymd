// Computer players. Pure: botMove(state, isAI) -> { seat, action } | null.
// The caller applies the action (with a seq guard) after a short delay so
// humans can follow what the bots are doing.

import { BOARD, GROUPS, STATIONS, UTILITIES, BUYABLE, JAIL_FINE, MIN_BID, houseCost, unmortgageCost } from './data.js';
import {
  rentOf, ownsGroup, active, buildError, sellError, mortgageError, unmortgageError,
  tradeProblem, tradeCashProblem, tradeKey,
} from './engine.js';

const groupPrice = (g) => GROUPS[g].tiles.reduce((n, i) => n + BOARD[i].price, 0);

/** Biggest single rent the bot could be hit with right now. */
function danger(s, seat) {
  let max = 0;
  s.tiles.forEach((st, i) => {
    if (st.owner < 0 || st.owner === seat || st.mortgaged || s.players[st.owner].out) return;
    const t = BOARD[i];
    let r;
    if (t.type === 'utility') {
      const n = UTILITIES.filter((u) => s.tiles[u].owner === st.owner).length;
      r = 7 * (n === 2 ? 10 : 4);
    } else {
      r = rentOf(s, i);
    }
    if (r > max) max = r;
  });
  return max;
}

const reserve = (s, seat) => Math.max(60, Math.min(700, Math.round(danger(s, seat) * 0.7)));

function countOwned(s, seat, tiles) {
  return tiles.filter((i) => s.tiles[i].owner === seat).length;
}

/** Would owning `tile` complete a colour group for `seat`? */
function completes(s, seat, tile) {
  const t = BOARD[tile];
  if (t.type !== 'prop') return false;
  return GROUPS[t.group].tiles.every((i) => i === tile || s.tiles[i].owner === seat);
}

/** Does some opponent own every other tile of this group? */
function blocks(s, seat, tile) {
  const t = BOARD[tile];
  if (t.type !== 'prop') return false;
  const others = GROUPS[t.group].tiles.filter((i) => i !== tile);
  const o = s.tiles[others[0]].owner;
  return o >= 0 && o !== seat && others.every((i) => s.tiles[i].owner === o);
}

function wantsToBuy(s, seat, tile) {
  const t = BOARD[tile];
  const p = s.players[seat];
  const after = p.cash - t.price;
  if (after < 0) return false;
  const r = reserve(s, seat);
  if (completes(s, seat, tile)) return true;
  if (after >= r) return true;
  if (blocks(s, seat, tile) && after >= r * 0.4) return true;
  if (t.type === 'station' && after >= r * 0.6) return true;
  return false;
}

function auctionMove(s, seat) {
  const A = s.auction;
  const t = BOARD[A.tile];
  const p = s.players[seat];
  let factor = t.type === 'utility' ? 0.7 : t.type === 'station' ? 0.95 : 0.85;
  if (completes(s, seat, A.tile)) factor = 1.6;
  else if (blocks(s, seat, A.tile)) factor = 1.2;
  else if (t.type === 'prop' && countOwned(s, seat, GROUPS[t.group].tiles) > 0) factor = 1.05;
  const max = Math.min(Math.round(t.price * factor), p.cash - Math.round(reserve(s, seat) * 0.5));
  const step = A.high < 100 ? 10 : A.high < 300 ? 20 : 50;
  const next = Math.max(MIN_BID, A.high + step);
  if (next <= max && next <= p.cash) return { type: 'bid', amount: next };
  return { type: 'pass' };
}

/* --------------------------- money raising --------------------------- */

function debtMove(s, seat) {
  const p = s.players[seat];
  if (p.cash >= s.debt.amount) return { type: 'payDebt' };
  return raiseCash(s, seat) || { type: 'bankrupt' };
}

/** One step of selling/mortgaging, cheapest losses first. */
function raiseCash(s, seat) {
  const mine = s.tiles.map((st, i) => i).filter((i) => s.tiles[i].owner === seat);
  // Sell buildings from the cheapest groups first.
  const sellable = mine.filter((i) => !sellError(s, seat, i)).sort((a, b) => houseCost(a) - houseCost(b));
  if (sellable.length) return { type: 'sell', tile: sellable[0] };
  // Mortgage: utilities, then lone properties, then stations, then sets.
  const rank = (i) => {
    const t = BOARD[i];
    if (t.type === 'utility') return 0;
    if (t.type === 'prop' && !ownsGroup(s, seat, t.group)) return 1 + t.price / 1000;
    if (t.type === 'station') return 2;
    return 3 + t.price / 1000;
  };
  const mortgageable = mine.filter((i) => !mortgageError(s, seat, i)).sort((a, b) => rank(a) - rank(b));
  if (mortgageable.length) return { type: 'mortgage', tile: mortgageable[0] };
  return null;
}

/* ------------------------------ building ----------------------------- */

function buildMove(s, seat) {
  const p = s.players[seat];
  const r = reserve(s, seat);
  let best = null;
  let bestScore = -1;
  for (const g of GROUPS) {
    if (!ownsGroup(s, seat, g.id)) continue;
    for (const i of g.tiles) {
      if (buildError(s, seat, i)) continue;
      if (p.cash - g.house < r + 40) continue;
      const t = BOARD[i];
      const h = s.tiles[i].houses;
      const gain = t.rent[h + 1] - (h === 0 ? t.rent[0] * 2 : t.rent[h]);
      const score = gain / g.house + (h < 3 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return best === null ? null : { type: 'build', tile: best };
}

function unmortgageMove(s, seat) {
  const p = s.players[seat];
  const r = reserve(s, seat);
  const cands = s.tiles.map((st, i) => i)
    .filter((i) => !unmortgageError(s, seat, i) && p.cash - unmortgageCost(i) >= r * 1.5 + 100)
    .sort((a, b) => {
      const ga = BOARD[a].type === 'prop' && ownsGroup(s, seat, BOARD[a].group) ? 1 : 0;
      const gb = BOARD[b].type === 'prop' && ownsGroup(s, seat, BOARD[b].group) ? 1 : 0;
      return gb - ga || BOARD[b].price - BOARD[a].price;
    });
  return cands.length ? { type: 'unmortgage', tile: cands[0] } : null;
}

/* ------------------------------- trading ----------------------------- */

function ownersAfter(s, T) {
  const owners = s.tiles.map((st) => st.owner);
  for (const t of T.give.tiles) owners[t] = T.to;
  for (const t of T.get.tiles) owners[t] = T.from;
  return owners;
}

const fullGroups = (owners, seat) =>
  GROUPS.filter((g) => g.tiles.every((i) => owners[i] === seat)).map((g) => g.id);

/** Value of trade T from `seat`'s point of view (seat is T.from or T.to). */
export function tradeGain(s, seat, T) {
  const mine = seat === T.from ? T.get : T.give; // what I receive
  const theirs = seat === T.from ? T.give : T.get; // what I hand over
  const other = seat === T.from ? T.to : T.from;
  const worth = (i) => (s.tiles[i].mortgaged ? BOARD[i].price * 0.45 : BOARD[i].price);
  let gain = mine.cash - theirs.cash + 40 * (mine.cards - theirs.cards);
  for (const i of mine.tiles) gain += worth(i);
  for (const i of theirs.tiles) gain -= worth(i);
  const before = s.tiles.map((st) => st.owner);
  const after = ownersAfter(s, T);
  const mineBefore = new Set(fullGroups(before, seat));
  const theirsBefore = new Set(fullGroups(before, other));
  for (const g of fullGroups(after, seat)) if (!mineBefore.has(g)) gain += groupPrice(g);
  for (const g of fullGroups(after, other)) if (!theirsBefore.has(g)) gain -= groupPrice(g) * 0.6;
  for (const g of mineBefore) if (!fullGroups(after, seat).includes(g)) gain -= groupPrice(g) * 2;
  return gain;
}

function respondTrade(s, seat, T) {
  if (tradeProblem(s, T) || tradeCashProblem(s, T)) return { type: 'reject', id: T.id };
  const p = s.players[seat];
  const cashAfter = p.cash - T.get.cash + T.give.cash;
  const ok = tradeGain(s, seat, T) >= 20 && cashAfter >= 0;
  if (!ok) return { type: 'reject', id: T.id };
  if (s.phase === 'auction') return null; // accept once the auction is over
  return { type: 'accept', id: T.id };
}

/** Look for a deal that completes one of our colour groups. */
function proposeMove(s, seat) {
  if (Object.values(s.trades).some((T) => T.from === seat)) return null;
  const p = s.players[seat];
  const r = reserve(s, seat);
  for (const g of GROUPS) {
    const missing = g.tiles.filter((i) => s.tiles[i].owner !== seat);
    if (missing.length !== 1 || g.tiles.length - missing.length < 1) continue;
    const m = missing[0];
    const owner = s.tiles[m].owner;
    if (owner < 0 || s.players[owner].out) continue;
    const base = { from: seat, to: owner, give: { tiles: [], cash: 0, cards: 0 }, get: { tiles: [m], cash: 0, cards: 0 } };
    if (p.declined.includes(tradeKey(base))) continue;
    // 1) A swap that also completes one of their groups.
    for (const g2 of GROUPS) {
      if (g2.id === g.id) continue;
      const theirMissing = g2.tiles.filter((i) => s.tiles[i].owner !== owner);
      if (theirMissing.length !== 1 || s.tiles[theirMissing[0]].owner !== seat) continue;
      const k = theirMissing[0];
      if (GROUPS[g.id].tiles.includes(k)) continue;
      const T = { ...base, give: { tiles: [k], cash: 0, cards: 0 } };
      if (tradeProblem(s, T)) continue;
      const theirGain = tradeGain(s, owner, T);
      if (theirGain < 20) T.give.cash = Math.min(Math.ceil((20 - theirGain) / 10) * 10, Math.max(0, p.cash - r));
      if (tradeGain(s, owner, T) >= 20 && tradeGain(s, seat, T) > 0) return { type: 'propose', to: owner, give: T.give, get: T.get };
    }
    // 2) Cash buy-out at a premium they should like.
    const T = { ...base, give: { tiles: [], cash: 0, cards: 0 } };
    if (tradeProblem(s, T)) continue;
    const need = 20 - tradeGain(s, owner, T);
    const offer = Math.ceil(need / 10) * 10;
    if (offer > 0 && offer <= p.cash - r) {
      T.give.cash = offer;
      if (tradeGain(s, seat, T) > 0) return { type: 'propose', to: owner, give: T.give, get: T.get };
    }
  }
  return null;
}

/* ------------------------------ the turn ----------------------------- */

function jailMove(s, seat) {
  const p = s.players[seat];
  let developed = 0;
  let unowned = 0;
  s.tiles.forEach((st, i) => {
    if (!BUYABLE.has(BOARD[i].type)) return;
    if (st.owner < 0) unowned++;
    else if (st.owner !== seat && st.houses > 0) developed++;
  });
  const wantOut = unowned > 6 || developed < 2;
  if (wantOut && p.jailCards.length) return { type: 'useCard' };
  if (wantOut && p.cash >= JAIL_FINE + reserve(s, seat)) return { type: 'payJail' };
  return { type: 'roll' };
}

function turnMove(s, seat) {
  const p = s.players[seat];
  switch (s.phase) {
    case 'buy':
      return wantsToBuy(s, seat, s.pending) ? { type: 'buy' } : { type: 'decline' };
    case 'roll':
      return buildMove(s, seat) || unmortgageMove(s, seat) || (p.inJail ? jailMove(s, seat) : { type: 'roll' });
    case 'end':
      return buildMove(s, seat) || unmortgageMove(s, seat) || proposeMove(s, seat) || cancelStale(s, seat) || { type: 'endTurn' };
    default:
      return null;
  }
}

function cancelStale(s, seat) {
  const T = Object.values(s.trades).find((x) => x.from === seat && s.seq - x.at > 150);
  return T ? { type: 'cancel', id: T.id } : null;
}

/**
 * Next move for any AI-controlled seat, or null if the game is waiting on a human.
 * isAI(seat) tells which seats the computer plays (bots, and humans on autopilot).
 */
export function botMove(s, isAI) {
  if (!s || s.phase === 'over') return null;
  for (const T of Object.values(s.trades)) {
    if (isAI(T.to) && !s.players[T.to].out) {
      const a = respondTrade(s, T.to, T);
      if (a) return { seat: T.to, action: a };
    }
  }
  if (s.phase === 'auction' && s.auction) {
    const b = s.auction.queue[s.auction.idx];
    return b != null && isAI(b) ? { seat: b, action: auctionMove(s, b) } : null;
  }
  if (s.phase === 'debt' && s.debt) {
    const d = s.debt.player;
    return isAI(d) ? { seat: d, action: debtMove(s, d) } : null;
  }
  if (!isAI(s.turn) || s.players[s.turn].out) return null;
  const a = turnMove(s, s.turn);
  return a ? { seat: s.turn, action: a } : null;
}

/** Hint for humans: what the bot logic would do to raise cash. */
export { raiseCash };
export const _test = { reserve, wantsToBuy, completes, blocks, STATIONS };
