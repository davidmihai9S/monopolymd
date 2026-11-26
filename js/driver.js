// Runs the computer players. Waits until the board animations are done, then
// plays one bot move after a human-friendly delay. Online, only the "driver"
// client (lowest connected human seat) runs bots; the seq guard makes a
// duplicate driver harmless.

import { botMove } from './bot.js';
import { store } from './fx.js';

const DELAY = {
  roll: 750, buy: 850, decline: 750, bid: 650, pass: 550, endTurn: 500, payJail: 700, useCard: 700,
  payDebt: 650, bankrupt: 1000, build: 280, sell: 280, mortgage: 320, unmortgage: 320,
  propose: 900, accept: 1100, reject: 1000, cancel: 300,
};

export class BotDriver {
  constructor(ctrl, view) {
    this.ctrl = ctrl;
    this.view = view;
    this.timer = null;
    this.fails = 0;
    this.failSeq = -1;
    this.stopped = false;
    this.pending = false;
    // Safety net: if an update was ever missed, nudge the bots again.
    this.beat = setInterval(() => { if (!this.pending) this.kick(); }, 2500);
  }

  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.beat); }

  kick() {
    clearTimeout(this.timer);
    this.pending = false;
    if (this.stopped) return;
    const s = this.ctrl.state;
    if (!s || s.phase === 'over' || !this.ctrl.isDriver() || !this.view.idle()) return;
    let m;
    try {
      m = botMove(s, (seat) => this.ctrl.isAI(seat));
    } catch (e) {
      console.error('bot crashed', e);
      return;
    }
    if (!m) return;
    const fast = store.get('botSpeed', 'normal') === 'fast';
    const delay = (DELAY[m.action.type] || 600) * (fast ? 0.35 : 1);
    const seq = s.seq;
    this.pending = true;
    this.timer = setTimeout(async () => {
      this.pending = false;
      const cur = this.ctrl.state;
      if (this.stopped || !cur || cur.seq !== seq || !this.view.idle()) return;
      const err = await this.ctrl.send(m.seat, { ...m.action, seq });
      if (err) {
        if (this.failSeq === seq) this.fails++;
        else { this.failSeq = seq; this.fails = 1; }
        if (this.fails < 4) this.timer = setTimeout(() => this.kick(), 600);
        else console.warn('bot gave up on', m, err);
      }
    }, delay);
  }
}
