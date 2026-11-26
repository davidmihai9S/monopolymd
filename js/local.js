// Local game: everything runs on this device (vs bots and/or pass-and-play).
// Saved to localStorage after every action so a refresh never loses the game.

import { createGame, apply, normalize, RuleError, actor } from './engine.js';
import { store } from './fx.js';

const KEY = 'local-game';

export class LocalGame {
  constructor(state) {
    this.kind = 'local';
    this.state = normalize(state);
    this.subs = new Set();
    this.sticky = -1;
  }

  static create(seats, settings) {
    const g = new LocalGame(createGame(seats, settings));
    g.save();
    return g;
  }

  static saved() {
    const s = store.get(KEY, null);
    return s && s.players && s.phase !== 'over' ? s : null;
  }

  static load() {
    const s = LocalGame.saved();
    return s ? new LocalGame(s) : null;
  }

  static clear() { store.set(KEY, null); }

  get multiHuman() { return this.state.players.filter((p) => !p.bot).length > 1; }

  /** Seat whose perspective to show: the human who must act, else the last one. */
  viewer() {
    const s = this.state;
    const human = (i) => i >= 0 && s.players[i] && !s.players[i].bot;
    const a = actor(s);
    if (human(a) && !s.players[a].out) this.sticky = a;
    else {
      const T = Object.values(s.trades).find((t) => human(t.to));
      if (T) this.sticky = T.to;
    }
    if (human(this.sticky)) return this.sticky;
    return s.players.findIndex((p) => !p.bot);
  }

  controls(seat) { const p = this.state.players[seat]; return !!p && !p.bot; }
  isAI(seat) { const p = this.state.players[seat]; return !!p && (p.bot || p.auto); }
  online() { return true; }
  offlineFor() { return 0; }
  canHost() { return true; }
  isDriver() { return true; }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }

  async send(seat, action) {
    try {
      this.state = apply(this.state, seat, action);
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      throw e;
    }
    this.save();
    for (const fn of this.subs) fn(this.state);
    return null;
  }

  save() { store.set(KEY, this.state); }
  leave() { this.save(); }
}
