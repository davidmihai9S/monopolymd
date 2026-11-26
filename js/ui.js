// Game screen: renders a controller's state and turns clicks into actions.
//
// A controller (local.js / net.js) provides:
//   state, on(fn), send(seat, action) -> Promise<error|null>, viewer(),
//   controls(seat), isAI(seat), online(seat), canHost(), kind, code, chat API.

import { BOARD, GROUPS, DECKS, BUYABLE, STATIONS, UTILITIES, JAIL_FINE, houseCost, mortgageValue, unmortgageCost } from './data.js';
import {
  actor, rentOf, netWorth, ownsGroup, buildError, sellError, mortgageError, unmortgageError,
  tradeProblem, tradeCashProblem, isFlowAction, active, BANK, POT, ALL,
} from './engine.js';
import { describe, money, num, esc, who, tileName, sideText } from './text.js';
import { sfx, buzz, confetti, store, soundOn, setSound } from './fx.js';
import { Board } from './board.js';
import { openSheet, closeSheet, refreshSheet, activeSheet, confirmSheet, toast } from './sheet.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPE_LABEL = { prop: 'Cartier', station: 'Gară', utility: 'Utilitate', tax: 'Taxă', chance: 'Carte', assoc: 'Carte', start: 'Colț', jail: 'Colț', parking: 'Colț', gotojail: 'Colț' };
const QUIET = new Set(['turn', 'start', 'offer', 'reject', 'auto']);
const REACTIONS = ['👍', '😂', '😱', '😡', '💸', '🔥'];

export class GameView {
  constructor(root, hooks = {}) {
    this.root = root;
    this.hooks = hooks;
    this.ctrl = null;
    this.state = null;
    this.unsub = null;
    this.reset();
    this.$ = (sel) => root.querySelector(sel);
    this.boardEl = this.$('#board');
    this.board = new Board(this.boardEl, (i) => this.openTile(i));
    this.$players = this.$('#players');
    this.$head = this.$('#c-head');
    this.$dice = [...this.$('#dice').children];
    this.$msg = this.$('#c-msg');
    this.$act = this.$('#c-act');
    this.tab = store.get('tab', 'log');
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'chat-form') this.sendChat();
    });
    // Online: re-check now and then so "player disconnected" prompts appear on time.
    setInterval(() => {
      if (this.ctrl && this.ctrl.kind === 'online' && this.state && this.idle() && this.state.phase !== 'over') this.renderCenter();
    }, 4000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.state && this.queue.length) { this.queue = []; this.syncPositions(); this.renderAll(); }
    });
  }

  reset() {
    this.lastN = 0;
    this.gameKey = '';
    this.queue = [];
    this.playing = false;
    this.busy = false;
    this.cash = [];
    this.pos = [];
    this.lastMsg = '';
    this.seenOffers = new Set();
    this.overShown = false;
    this.chatSeen = 0;
    this.lastViewer = -1;
  }

  attach(ctrl) {
    this.detach();
    this.reset();
    this.ctrl = ctrl;
    this.root.classList.toggle('is-online', ctrl.kind === 'online');
    this.unsub = ctrl.on((s) => this.update(s));
    if (ctrl.onChat) this.unsubChat = ctrl.onChat((msgs, fresh) => this.onChat(msgs, fresh));
    if (ctrl.state) this.update(ctrl.state);
  }

  detach() {
    if (this.unsub) this.unsub();
    if (this.unsubChat) this.unsubChat();
    this.unsub = this.unsubChat = null;
    closeSheet();
  }

  viewer() { return this.ctrl ? this.ctrl.viewer() : -1; }
  mine(seat) { return seat >= 0 && this.ctrl.controls(seat) && !this.ctrl.isAI(seat); }
  idle() { return !this.playing && !this.busy; }

  /* ----------------------------- state in ----------------------------- */

  update(s) {
    if (!s) return;
    const key = s.players.map((p) => p.name + p.token).join('|');
    const fresh = s.log.filter((e) => e.n > this.lastN);
    const hard = !this.state || key !== this.gameKey || s.n < this.lastN || fresh.some((e) => e.k === 'start');
    this.state = s;
    if (hard) {
      this.gameKey = key;
      this.lastN = s.n;
      this.queue = [];
      this.overShown = s.phase === 'over' && this.overShown;
      this.board.setPlayers(s.players);
      this.$players.dataset.key = '';
      this.syncPositions();
      this.cash = s.players.map((p) => p.cash);
      this.lastMsg = this.latestMessage(s);
      this.renderAll();
      this.afterPlayback();
      return;
    }
    this.lastN = s.n;
    if (document.hidden || reduced() || fresh.length > 40) {
      this.queue = [];
      this.syncPositions();
      this.lastMsg = this.latestMessage(s);
      if (!this.playing) { this.renderAll(); this.afterPlayback(); }
      return;
    }
    this.queue.push(...fresh);
    if (!this.playing) this.play();
    else this.renderPanels();
  }

  syncPositions() { this.pos = this.state.players.map((p) => p.pos); }

  latestMessage(s) {
    const v = this.viewer();
    for (let i = s.log.length - 1; i >= 0; i--) {
      const e = s.log[i];
      if (QUIET.has(e.k) || e.k === 'move') continue;
      const d = describe(e, s, v);
      if (d) return d;
    }
    return '';
  }

  async play() {
    this.playing = true;
    this.renderCenter();
    while (this.queue.length) {
      const e = this.queue.shift();
      try { await this.animate(e); } catch (err) { console.error(err); }
    }
    this.playing = false;
    this.syncPositions();
    this.renderAll();
    this.afterPlayback();
  }

  afterPlayback() {
    const s = this.state;
    if (s.phase === 'over' && !this.overShown) {
      this.overShown = true;
      setTimeout(() => { confetti(); this.openGameOver(); }, 400);
    }
    this.checkOffers();
    const v = this.viewer();
    if (v !== this.lastViewer) { this.lastViewer = v; this.renderPanels(); }
    this.hooks.onIdle && this.hooks.onIdle();
  }

  setMsg(html) {
    this.lastMsg = html;
    this.$msg.innerHTML = html;
  }

  async animate(e) {
    const s = this.state;
    const text = QUIET.has(e.k) ? null : describe(e, s, this.viewer());
    switch (e.k) {
      case 'roll':
        if (text) this.setMsg(text);
        sfx.dice();
        await this.rollDice(e.d || [1, 1]);
        break;
      case 'move':
        await this.moveToken(e);
        if (text) this.setMsg(text);
        break;
      case 'card':
        if (text) this.setMsg(text);
        sfx.card();
        await this.showCard(e);
        break;
      case 'turn':
        this.board.setActive(e.p);
        if (this.mine(e.p)) { sfx.turn(); buzz(25); }
        await wait(100);
        break;
      default:
        if (text) this.setMsg(text);
        if (['rent', 'tax', 'fine', 'repairs', 'each', 'paid'].includes(e.k)) {
          sfx.pay();
          if (e.t != null) this.board.flash(e.t);
          await wait(450);
        } else if (['go', 'buy', 'won', 'pot'].includes(e.k) || (e.k === 'cash' && e.a > 0)) {
          sfx.coin();
          await wait(320);
        } else if (e.k === 'jail') {
          sfx.jail(); buzz(40);
          await wait(250);
        } else if (e.k === 'build') {
          sfx.build();
          this.board.render(s);
          this.board.flash(e.t);
        } else if (e.k === 'bankrupt' || e.k === 'resign') {
          sfx.jail();
          await wait(500);
        } else if (e.k === 'auction') {
          sfx.pop();
          await wait(250);
        } else if (e.k === 'offer' && this.mine(e.to)) {
          sfx.pop();
        } else if (e.k === 'over') {
          sfx.win();
        }
    }
  }

  async rollDice([a, b]) {
    const [d1, d2] = this.$dice;
    d1.classList.add('rolling');
    d2.classList.add('rolling');
    const t0 = performance.now();
    while (performance.now() - t0 < 520) {
      d1.dataset.v = 1 + Math.floor(Math.random() * 6);
      d2.dataset.v = 1 + Math.floor(Math.random() * 6);
      await wait(75);
    }
    d1.dataset.v = a;
    d2.dataset.v = b;
    d1.classList.remove('rolling');
    d2.classList.remove('rolling');
    this.$('#dice').classList.toggle('dbl', a === b);
    await wait(200);
  }

  async moveToken(e) {
    const pi = e.p;
    const from = this.pos[pi];
    const to = e.to;
    this.board.setActive(pi);
    if (from === to) return;
    if (e.how === 'jail') {
      this.pos[pi] = to;
      this.placeTokens(true);
      await wait(450);
      return;
    }
    const back = e.how === 'back';
    const steps = back ? (from - to + 40) % 40 : (to - from + 40) % 40;
    const dt = steps > 12 ? 70 : 115;
    for (let k = 1; k <= steps; k++) {
      this.pos[pi] = back ? (from - k + 40) % 40 : (from + k) % 40;
      this.placeTokens(true);
      this.board.hop(pi);
      sfx.hop();
      await wait(dt);
    }
    this.board.flash(to);
    await wait(160);
  }

  async showCard(e) {
    const d = DECKS[e.d];
    const c = d && d.cards[e.c];
    if (!c) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `card-pop deck-${e.d}`;
    el.innerHTML = `<span class="card-face"><span class="card-deck">${d.icon} ${esc(d.name)}</span>
      <span class="card-text">${esc(c.text)}</span><span class="card-who">${who(this.state, e.p)}</span></span>`;
    this.boardEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    await new Promise((res) => {
      let t;
      const done = () => { clearTimeout(t); el.removeEventListener('click', done); res(); };
      t = setTimeout(done, this.mine(e.p) ? 3600 : 2800);
      el.addEventListener('click', done);
    });
    el.classList.remove('in');
    el.classList.add('outro');
    setTimeout(() => el.remove(), 320);
    await wait(120);
  }

  placeTokens(animate) {
    const s = this.state;
    this.board.place(this.pos, s.players.map((p) => p.inJail), animate, s.players.map((p) => p.out));
  }

  /* ------------------------------ render ------------------------------ */

  renderAll() {
    const s = this.state;
    if (!s) return;
    this.board.render(s);
    this.placeTokens(true);
    this.board.setActive(s.phase === 'over' ? -1 : s.turn);
    const [a, b] = s.dice;
    if (a && !this.$dice[0].classList.contains('rolling')) {
      this.$dice[0].dataset.v = a;
      this.$dice[1].dataset.v = b;
    }
    this.renderPlayers();
    this.renderCenter();
    this.renderPanels();
    this.renderTop();
    refreshSheet();
  }

  renderTop() {
    const s = this.state;
    this.$('#round-label').textContent = s.phase === 'over' ? 'Final' : `Runda ${s.round}${s.settings.rounds ? ` / ${s.settings.rounds}` : ''}`;
    const chip = this.$('#room-chip');
    chip.hidden = this.ctrl.kind !== 'online';
    if (this.ctrl.kind === 'online') chip.textContent = this.ctrl.code;
    this.$('#net-banner').hidden = this.ctrl.kind !== 'online' || this.ctrl.connected !== false;
    this.$('[data-act="sound"]').textContent = soundOn() ? '🔊' : '🔇';
  }

  renderPlayers() {
    const s = this.state;
    const box = this.$players;
    if (box.dataset.key !== this.gameKey) {
      box.innerHTML = s.players.map((p, i) => `<button class="pl" type="button" data-act="player" data-p="${i}" style="--pc:${esc(p.color)}">
          <span class="pl-tok">${esc(p.token)}</span>
          <span class="pl-main"><span class="pl-name">${esc(p.name)}</span><span class="pl-cash"></span></span>
          <span class="pl-flags"></span></button>`).join('');
      box.dataset.key = this.gameKey;
      this.cash = s.players.map((p) => p.cash);
      [...box.children].forEach((el, i) => { el.querySelector('.pl-cash').textContent = num(this.cash[i]); });
    }
    const act = actor(s);
    const v = this.viewer();
    s.players.forEach((p, i) => {
      const el = box.children[i];
      if (!el) return;
      el.classList.toggle('turn', s.turn === i && s.phase !== 'over' && !p.out);
      el.classList.toggle('actor', act === i && act !== s.turn);
      el.classList.toggle('out', p.out);
      el.classList.toggle('me', i === v);
      el.classList.toggle('offline', !this.ctrl.online(i));
      el.classList.toggle('winner', s.phase === 'over' && s.winner === i);
      const flags = [];
      if (s.phase === 'over' && s.winner === i) flags.push('🏆');
      if (p.out) flags.push('<span class="flag-out">faliment</span>');
      if (p.inJail) flags.push('🔒');
      if (p.jailCards.length) flags.push(`🎫${p.jailCards.length > 1 ? p.jailCards.length : ''}`);
      if (p.bot) flags.push('<span title="Bot">🤖</span>');
      else if (p.auto) flags.push('<span title="Joacă un bot">🤖</span>');
      if (!this.ctrl.online(i)) flags.push('<span class="flag-off" title="Deconectat">offline</span>');
      const f = flags.join(' ');
      const fl = el.querySelector('.pl-flags');
      if (fl.innerHTML !== f) fl.innerHTML = f;
      const from = this.cash[i] ?? p.cash;
      if (from !== p.cash) {
        this.countTo(el.querySelector('.pl-cash'), from, p.cash);
        this.floater(el, p.cash - from);
        this.cash[i] = p.cash;
      }
    });
    const turnEl = box.children[s.turn];
    if (turnEl && box.scrollWidth > box.clientWidth) {
      const l = turnEl.offsetLeft - box.offsetLeft;
      if (l < box.scrollLeft || l + turnEl.offsetWidth > box.scrollLeft + box.clientWidth) {
        box.scrollTo({ left: Math.max(0, l - 12), behavior: reduced() ? 'auto' : 'smooth' });
      }
    }
  }

  countTo(el, from, to) {
    if (reduced()) { el.textContent = num(to); return; }
    const t0 = performance.now();
    const dur = 650;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      el.textContent = num(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  floater(el, delta) {
    if (!delta) return;
    const f = document.createElement('span');
    f.className = `floater ${delta > 0 ? 'up' : 'down'}`;
    f.textContent = `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))}`;
    el.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  renderCenter() {
    const s = this.state;
    if (!s) return;
    const a = actor(s);
    const ap = s.players[a];
    const mine = this.mine(a);
    const multi = this.ctrl.multiHuman;
    let head;
    if (s.phase === 'over') {
      head = s.winner >= 0 ? `🏆 ${who(s, s.winner)} a câștigat` : 'Joc terminat';
    } else if (s.phase === 'auction' && s.auction) {
      head = `<span class="c-tag">Licitație</span> ${esc(tileName(s.auction.tile))}`;
    } else {
      const tp = s.players[s.turn];
      const label = this.mine(s.turn) ? (multi ? `${esc(tp.name)}, e rândul tău` : 'E rândul tău') : `Rândul lui ${esc(tp.name)}`;
      head = `<span class="c-tok" style="--pc:${esc(tp.color)}">${esc(tp.token)}</span> ${label}`;
    }
    if (this.$head.innerHTML !== head) this.$head.innerHTML = head;
    if (!this.playing) this.$msg.innerHTML = this.lastMsg || '&nbsp;';

    let html = '';
    if (this.playing) {
      html = '<div class="c-wait" aria-hidden="true"><i></i><i></i><i></i></div>';
    } else if (s.phase === 'over') {
      html = `<button class="btn btn-primary" data-act="results">Vezi clasamentul</button>`;
    } else if (mine) {
      html = this.actionsFor(s, a);
    } else {
      html = this.waitingFor(s, a, ap);
    }
    const auc = s.phase === 'auction' && s.auction ? this.auctionStatus(s) : '';
    const full = auc + html;
    if (this.$act.innerHTML !== full) this.$act.innerHTML = full;
    this.$act.classList.toggle('busy', this.busy);
    this.$act.querySelectorAll('button').forEach((b) => { if (this.busy) b.disabled = true; });
  }

  auctionStatus(s) {
    const A = s.auction;
    const lead = A.leader >= 0 ? `${money(A.high)} · ${who(s, A.leader)}` : 'nicio ofertă încă';
    return `<div class="c-auc"><span>Oferta cea mai mare</span><b>${lead}</b></div>`;
  }

  waitingFor(s, a, ap) {
    if (!ap) return '';
    const name = who(s, a);
    let text;
    if (this.ctrl.isAI(a)) text = `${name} se gândește…`;
    else {
      switch (s.phase) {
        case 'roll': text = `Așteptăm ca ${name} să arunce zarurile.`; break;
        case 'buy': text = `${name} decide dacă ia ${esc(tileName(s.pending))}.`; break;
        case 'auction': text = `${name} licitează…`; break;
        case 'debt': text = `${name} strânge bani pentru o datorie de ${money(s.debt.amount)}.`; break;
        case 'end': text = `${name} își termină tura.`; break;
        default: text = '';
      }
    }
    let extra = '';
    const v = this.viewer();
    if (this.ctrl.kind === 'online') {
      if (v >= 0 && s.players[v].auto) {
        extra = `<div class="c-note">Un bot joacă pentru tine.</div><button class="btn btn-primary" data-act="takeback">Preiau controlul</button>`;
      } else if (!ap.bot && !ap.auto && !this.ctrl.online(a) && this.ctrl.offlineFor(a) > 15000 && v >= 0) {
        extra = `<button class="btn" data-act="autopilot" data-p="${a}">🤖 Lasă un bot să joace pentru ${esc(ap.name)}</button>`;
      }
    }
    return `<div class="c-wait-text">${text}</div>${extra}`;
  }

  actionsFor(s, a) {
    const p = s.players[a];
    const B = (act, label, cls = '', attrs = '', disabled = false) =>
      `<button type="button" class="btn ${cls}" data-act="${act}" ${attrs} ${disabled ? 'disabled' : ''}>${label}</button>`;
    switch (s.phase) {
      case 'roll':
        if (p.inJail) {
          return `<div class="c-note">Ești la închisoare · încercarea ${p.jailTurns + 1} din 3</div>
            ${B('roll', '🎲 Încearcă o dublă', 'btn-primary')}
            <div class="btn-row">${B('payJail', `Plătește ${JAIL_FINE}`, '', '', p.cash < JAIL_FINE)}${p.jailCards.length ? B('useCard', '🎫 Cartonaș') : ''}</div>`;
        }
        return B('roll', s.doubles > 0 ? '🎲 Aruncă din nou' : '🎲 Aruncă zarurile', 'btn-primary btn-big');
      case 'buy': {
        const i = s.pending;
        const t = BOARD[i];
        const short = t.price - p.cash;
        const g = t.type === 'prop' ? GROUPS[t.group].color : 'var(--ink-3)';
        const rent = t.type === 'prop' ? money(t.rent[0]) : t.type === 'station' ? money(25) : '4× zarurile';
        return `<button type="button" class="mini" data-act="tile" data-tile="${i}" style="--g:${g}">
            <b>${esc(t.name)}</b><span>${TYPE_LABEL[t.type]} · chirie de la ${rent}</span></button>
          <div class="btn-row">${B('buy', `Cumpără · ${num(t.price)}`, 'btn-primary', '', short > 0)}${B('decline', s.settings.auctions ? 'Licitație' : 'Nu cumpăr')}</div>
          ${short > 0 ? `<div class="c-note">Îți lipsesc ${money(short)}. <a href="#" data-act="raise">Ipotechează ceva</a> sau scoate la licitație.</div>` : ''}`;
      }
      case 'auction': {
        const A = s.auction;
        const opts = A.high === 0 ? [10, 50, 100] : [A.high + 10, A.high + 50, A.high + 100];
        return `<div class="btn-row bids">${opts.map((v) => B('bid', num(v), 'btn-bid', `data-amount="${v}"`, v > p.cash)).join('')}</div>
          ${B('pass', 'Renunț', 'btn-ghost')}
          <div class="c-note">Ai ${money(p.cash)}.</div>`;
      }
      case 'debt': {
        const D = s.debt;
        const to = D.to >= 0 ? `lui ${who(s, D.to)}` : D.to === ALL ? 'celorlalți' : 'băncii';
        return `<div class="c-note bad">Datorezi ${money(D.amount)} ${to}. Ai ${money(p.cash)}.</div>
          <div class="btn-row">${B('payDebt', 'Plătește', 'btn-primary', '', p.cash < D.amount)}${B('raise', 'Vinde / ipotechează')}</div>
          ${B('bankrupt', 'Declar faliment', 'btn-ghost btn-danger-text')}`;
      }
      case 'end':
        return B('endTurn', 'Termină tura', 'btn-primary btn-big');
      default:
        return '';
    }
  }

  /* ------------------------------ panels ------------------------------ */

  renderPanels() {
    const s = this.state;
    if (!s) return;
    const tabs = this.$('#tabs');
    tabs.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.root.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== this.tab; });
    const v = this.viewer();
    const incoming = Object.values(s.trades).filter((T) => this.mine(T.to)).length;
    this.$('#badge-trades').textContent = incoming || '';
    if (this.ctrl.kind !== 'online' && this.tab === 'chat') this.tab = 'log';
    switch (this.tab) {
      case 'log': this.$('#panel-log').innerHTML = this.logHtml(s, v); break;
      case 'props': this.$('#panel-props').innerHTML = this.propsHtml(s, v); break;
      case 'trades': this.$('#panel-trades').innerHTML = this.tradesHtml(s, v); break;
      case 'chat': this.renderChat(); break;
      default: break;
    }
  }

  logHtml(s, v) {
    const rows = [];
    for (let i = s.log.length - 1; i >= 0 && rows.length < 70; i--) {
      const e = s.log[i];
      if (e.k === 'turn') {
        const p = s.players[e.p];
        if (p) rows.push(`<li class="ev-turn" style="--pc:${esc(p.color)}"><span>${esc(p.token)} ${e.p === v ? 'Tura ta' : `Tura lui ${esc(p.name)}`}</span></li>`);
        continue;
      }
      const d = describe(e, s, v);
      if (d) rows.push(`<li class="ev ev-${e.k}">${d}</li>`);
    }
    return `<ol class="log">${rows.join('')}</ol>`;
  }

  propsHtml(s, v) {
    if (v < 0) return '<p class="empty">Urmărești jocul. Atinge un jucător sau o proprietate pentru detalii.</p>';
    const p = s.players[v];
    if (p.out) return '<p class="empty">Ai ieșit din joc. Poți urmări în continuare.</p>';
    const mine = s.tiles.map((t, i) => i).filter((i) => s.tiles[i].owner === v);
    const head = `<div class="psum"><div><span>Bani</span><b>${money(p.cash)}</b></div><div><span>Avere</span><b>${money(netWorth(s, v))}</b></div>
      ${p.jailCards.length ? `<div><span>Cartonașe</span><b>🎫 ${p.jailCards.length}</b></div>` : ''}</div>`;
    if (!mine.length) return head + '<p class="empty">Nu ai încă proprietăți. Cumpără tot ce prinzi — mai ales grupuri complete!</p>';
    const sections = [];
    const groupRows = (tiles, label, color) => {
      const rows = tiles.map((i) => this.propRow(s, v, i)).join('');
      return `<section class="pgroup" style="--g:${color}"><h3>${label}</h3>${rows}</section>`;
    };
    for (const g of GROUPS) {
      const owned = g.tiles.filter((i) => s.tiles[i].owner === v);
      if (!owned.length) continue;
      const full = owned.length === g.tiles.length;
      sections.push(groupRows(owned, `${full ? '★ Grup complet' : `${owned.length} din ${g.tiles.length}`}`, g.color));
    }
    const st = STATIONS.filter((i) => s.tiles[i].owner === v);
    if (st.length) sections.push(groupRows(st, `Gări · ${st.length} din 4`, 'var(--ink-3)'));
    const ut = UTILITIES.filter((i) => s.tiles[i].owner === v);
    if (ut.length) sections.push(groupRows(ut, `Utilități · ${ut.length} din 2`, 'var(--ink-3)'));
    const canTrade = active(s).length > 1;
    return head + sections.join('') + (canTrade ? '<button class="btn btn-block" data-act="newtrade">⇄ Propune un schimb</button>' : '');
  }

  propRow(s, v, i) {
    const t = BOARD[i];
    const st = s.tiles[i];
    const status = st.mortgaged ? '<span class="pill pill-bad">ipotecat</span>'
      : st.houses === 5 ? '<span class="pill">🏨 hotel</span>'
      : st.houses ? `<span class="pill">${'🏠'.repeat(st.houses)}</span>` : '';
    const rent = st.mortgaged ? '' : `<span class="prent">chirie ${t.type === 'utility' ? (UTILITIES.every((u) => s.tiles[u].owner === v) ? '10×' : '4×') + ' zaruri' : money(rentOf(s, i))}</span>`;
    const btns = [];
    if (!buildError(s, v, i)) btns.push(`<button class="chip-btn" data-act="build" data-tile="${i}">+${st.houses === 4 ? '🏨' : '🏠'} ${houseCost(i)}</button>`);
    if (!sellError(s, v, i)) btns.push(`<button class="chip-btn" data-act="sell" data-tile="${i}">−${st.houses === 5 ? '🏨' : '🏠'} +${houseCost(i) / 2}</button>`);
    if (!mortgageError(s, v, i)) btns.push(`<button class="chip-btn" data-act="mortgage" data-tile="${i}">Ipotechează +${mortgageValue(i)}</button>`);
    if (st.mortgaged) {
      const e = unmortgageError(s, v, i);
      btns.push(`<button class="chip-btn" data-act="unmortgage" data-tile="${i}" ${e ? 'disabled' : ''}>Răscumpără −${unmortgageCost(i)}</button>`);
    }
    return `<div class="prow${st.mortgaged ? ' is-mort' : ''}">
        <button class="pname" data-act="tile" data-tile="${i}">${esc(t.name)}</button>
        <div class="pmeta">${status}${rent}</div>
        ${btns.length ? `<div class="pbtns">${btns.join('')}</div>` : ''}
      </div>`;
  }

  tradesHtml(s, v) {
    const list = Object.values(s.trades);
    const card = (T) => {
      const forMe = this.mine(T.to);
      const fromMe = this.mine(T.from);
      const problem = tradeProblem(s, T) || tradeCashProblem(s, T);
      const title = forMe ? `${who(s, T.from)} → ${this.ctrl.multiHuman ? who(s, T.to) : 'tine'}` : `${who(s, T.from)} → ${who(s, T.to)}`;
      const recv = forMe ? T.give : T.get;
      const give = forMe ? T.get : T.give;
      const lines = forMe || fromMe
        ? `<div class="tr-side"><span>Primești</span><b>${sideText(recv)}</b></div><div class="tr-side"><span>Dai</span><b>${sideText(give)}</b></div>`
        : `<div class="tr-side"><span>${esc(s.players[T.from].name)} dă</span><b>${sideText(T.give)}</b></div><div class="tr-side"><span>Cere</span><b>${sideText(T.get)}</b></div>`;
      const btns = forMe
        ? `<div class="btn-row"><button class="btn btn-primary" data-act="accept" data-id="${esc(T.id)}" ${problem || s.phase === 'auction' ? 'disabled' : ''}>Accept</button><button class="btn" data-act="reject" data-id="${esc(T.id)}">Refuz</button></div>`
        : fromMe ? `<button class="btn btn-ghost" data-act="cancel" data-id="${esc(T.id)}">Retrage oferta</button>` : '';
      return `<article class="trade${forMe ? ' for-me' : ''}"><h3>${title}</h3>${lines}${problem ? `<p class="c-note bad">${esc(problem)}</p>` : ''}${btns}</article>`;
    };
    const canPropose = v >= 0 && !s.players[v].out && active(s).length > 1 && s.phase !== 'over';
    const intro = '<p class="hint">Schimbă proprietăți, bani sau cartonașe cu ceilalți. Grupurile complete îți dau voie să construiești.</p>';
    return (canPropose ? '<button class="btn btn-primary btn-block" data-act="newtrade">⇄ Propune un schimb</button>' : '')
      + (list.length ? list.map(card).join('') : `${intro}<p class="empty">Nicio ofertă deschisă.</p>`);
  }

  /* ------------------------------- chat ------------------------------- */

  onChat(msgs, fresh) {
    this.chat = msgs;
    for (const m of fresh) {
      if (m.mine) continue;
      if (/^\p{Extended_Pictographic}+$/u.test(m.text)) this.reaction(m);
      else if (this.tab !== 'chat') toast(`<b>${esc(m.name)}:</b> ${esc(m.text)}`, { ms: 2600 });
    }
    if (this.tab === 'chat') this.chatSeen = msgs.length;
    const unread = Math.max(0, msgs.length - this.chatSeen);
    this.$('#badge-chat').textContent = unread ? String(Math.min(unread, 9)) : '';
    if (this.tab === 'chat') this.renderChat();
  }

  reaction(m) {
    const el = document.createElement('span');
    el.className = 'reaction';
    el.textContent = m.text;
    el.style.left = 30 + Math.random() * 40 + '%';
    this.boardEl.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  renderChat() {
    const box = this.$('#panel-chat');
    const msgs = this.chat || [];
    if (!box.querySelector('.chat-list')) {
      box.innerHTML = `<ol class="chat-list"></ol>
        <div class="reactions">${REACTIONS.map((r) => `<button type="button" class="react" data-act="react" data-r="${r}">${r}</button>`).join('')}</div>
        <form id="chat-form" class="chat-form" autocomplete="off"><input id="chat-input" maxlength="200" placeholder="Scrie un mesaj…" enterkeyhint="send"><button class="btn btn-primary" type="submit">Trimite</button></form>`;
    }
    const list = box.querySelector('.chat-list');
    list.innerHTML = msgs.length ? msgs.map((m) => `<li class="${m.mine ? 'mine' : ''}"><b style="--pc:${esc(m.color || 'var(--ink-2)')}">${esc(m.name)}</b> ${esc(m.text)}</li>`).join('')
      : '<li class="empty">Niciun mesaj încă. Salută-i pe ceilalți!</li>';
    list.scrollTop = list.scrollHeight;
    this.chatSeen = msgs.length;
    this.$('#badge-chat').textContent = '';
  }

  sendChat() {
    const input = this.$('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this.ctrl.sendChat(text);
  }

  /* ------------------------------ actions ----------------------------- */

  async act(seat, action) {
    if (this.busy || seat < 0) return 'busy';
    const s = this.state;
    const a = isFlowAction(action.type) ? { ...action, flow: s.flow } : action;
    this.busy = true;
    this.renderCenter();
    let err = null;
    try {
      err = await this.ctrl.send(seat, a);
    } catch (e) {
      console.error(e);
      err = 'Ceva n-a mers. Încearcă din nou.';
    }
    this.busy = false;
    if (err) { sfx.error(); toast(esc(err), { type: 'error' }); }
    this.renderCenter();
    // The state update may have landed while we were busy; let the bots continue.
    if (!this.playing && this.hooks.onIdle) this.hooks.onIdle();
    return err;
  }

  onClick(e) {
    const el = e.target.closest('[data-act], [data-tab]');
    if (!el || !this.state) return;
    if (el.dataset.tab) {
      this.tab = el.dataset.tab;
      store.set('tab', this.tab);
      this.renderPanels();
      return;
    }
    const act = el.dataset.act;
    if (el.tagName === 'A') e.preventDefault();
    const s = this.state;
    const a = actor(s);
    const v = this.viewer();
    const tile = el.dataset.tile != null ? Number(el.dataset.tile) : null;
    switch (act) {
      case 'roll': case 'payJail': case 'useCard': case 'buy': case 'decline': case 'pass': case 'payDebt': case 'endTurn':
        this.act(a, { type: act });
        break;
      case 'bid':
        this.act(a, { type: 'bid', amount: Number(el.dataset.amount) });
        break;
      case 'bankrupt':
        confirmSheet('Declari faliment?', `<p>Ieși din joc. ${s.debt && s.debt.to >= 0 ? `Tot ce ai trece la ${who(s, s.debt.to)}.` : 'Proprietățile tale revin băncii.'}</p>`, 'Da, faliment', true)
          .then((ok) => ok && this.act(a, { type: 'bankrupt' }));
        break;
      case 'raise':
        this.tab = 'props';
        store.set('tab', this.tab);
        this.renderPanels();
        this.$('#tabs').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        break;
      case 'build': case 'sell': case 'mortgage': case 'unmortgage':
        this.act(v, { type: act, tile });
        break;
      case 'tile': this.openTile(tile); break;
      case 'player': this.openPlayer(Number(el.dataset.p)); break;
      case 'newtrade': this.openTradeComposer(); break;
      case 'accept': case 'reject': case 'cancel': {
        const T = s.trades[el.dataset.id];
        if (!T) return;
        this.act(act === 'cancel' ? T.from : T.to, { type: act, id: T.id });
        break;
      }
      case 'results': this.openGameOver(); break;
      case 'menu': this.openMenu(); break;
      case 'sound': setSound(!soundOn()); this.renderTop(); break;
      case 'react': this.ctrl.sendChat(el.dataset.r); break;
      case 'autopilot': this.act(v, { type: 'autopilot', target: Number(el.dataset.p), on: true }); break;
      case 'takeback': this.act(v, { type: 'autopilot', target: v, on: false }); break;
      case 'share': this.hooks.onShare && this.hooks.onShare(); break;
      default: break;
    }
  }

  checkOffers() {
    const s = this.state;
    for (const T of Object.values(s.trades)) {
      if (this.seenOffers.has(T.id)) continue;
      this.seenOffers.add(T.id);
      if (!this.mine(T.to)) continue;
      if (!activeSheet()) this.openIncoming(T.id);
      else toast(`${who(s, T.from)} ți-a propus un schimb.`, { action: { label: 'Vezi', fn: () => this.openIncoming(T.id) } });
    }
  }

  /* ------------------------------- sheets ------------------------------ */

  openTile(i) {
    const t = BOARD[i];
    if (!t) return;
    openSheet({
      title: esc(t.name),
      cls: 'sheet-tile',
      render: () => this.tileHtml(i),
      onAct: (act, el) => {
        if (['build', 'sell', 'mortgage', 'unmortgage'].includes(act)) this.act(this.viewer(), { type: act, tile: i });
        if (act === 'player') this.openPlayer(Number(el.dataset.p));
      },
    });
  }

  tileHtml(i) {
    const s = this.state;
    const t = BOARD[i];
    const st = s.tiles[i];
    const v = this.viewer();
    const color = t.type === 'prop' ? GROUPS[t.group].color : 'var(--surface-3)';
    let body = `<div class="deed" style="--g:${color}"><div class="deed-band"><span>${TYPE_LABEL[t.type]}</span><b>${esc(t.name)}</b></div>`;
    if (BUYABLE.has(t.type)) {
      const owner = st.owner >= 0 ? s.players[st.owner] : null;
      body += `<p class="deed-owner">${owner ? `Proprietar: <button class="link" data-act="player" data-p="${st.owner}">${who(s, st.owner)}</button>${st.mortgaged ? ' · <span class="pill pill-bad">ipotecat</span>' : ''}` : `Liber · se vinde cu <b>${money(t.price)}</b>`}</p>`;
      if (t.type === 'prop') {
        const full = st.owner >= 0 && ownsGroup(s, st.owner, t.group);
        const level = st.owner < 0 ? -1 : st.houses > 0 ? st.houses + 1 : full ? 1 : 0;
        const rows = [['Teren', t.rent[0]], ['Grup complet', t.rent[0] * 2], ['Cu 1 casă', t.rent[1]], ['Cu 2 case', t.rent[2]], ['Cu 3 case', t.rent[3]], ['Cu 4 case', t.rent[4]], ['Cu hotel', t.rent[5]]];
        body += `<table class="rent">${rows.map(([l, r], k) => `<tr class="${k === level ? 'cur' : ''}"><td>${l}</td><td>${money(r)}</td></tr>`).join('')}</table>
          <p class="deed-foot">Casă: ${money(houseCost(i))} (hotel = a 5-a casă) · Ipotecă: ${money(mortgageValue(i))}</p>`;
      } else if (t.type === 'station') {
        const n = st.owner >= 0 ? STATIONS.filter((k) => s.tiles[k].owner === st.owner).length : 0;
        body += `<table class="rent">${t.rent.map((r, k) => `<tr class="${k + 1 === n ? 'cur' : ''}"><td>${k + 1} ${k ? 'gări' : 'gară'}</td><td>${money(r)}</td></tr>`).join('')}</table>
          <p class="deed-foot">Ipotecă: ${money(mortgageValue(i))}</p>`;
      } else {
        const n = st.owner >= 0 ? UTILITIES.filter((k) => s.tiles[k].owner === st.owner).length : 0;
        body += `<table class="rent"><tr class="${n === 1 ? 'cur' : ''}"><td>O uzină</td><td>4 × zarurile</td></tr><tr class="${n === 2 ? 'cur' : ''}"><td>Ambele uzine</td><td>10 × zarurile</td></tr></table>
          <p class="deed-foot">Ipotecă: ${money(mortgageValue(i))}</p>`;
      }
      if (v >= 0 && st.owner === v) {
        const btn = (act, label, err, primary = true) => `<button class="btn ${err || !primary ? '' : 'btn-primary'}" data-act="${act}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
        const acts = [];
        if (t.type === 'prop') {
          acts.push(btn('build', st.houses === 4 ? `Hotel · ${houseCost(i)}` : `Casă · ${houseCost(i)}`, buildError(s, v, i)));
          if (st.houses) acts.push(btn('sell', `Vinde clădire · +${houseCost(i) / 2}`, sellError(s, v, i), false));
        }
        if (st.mortgaged) acts.push(btn('unmortgage', `Răscumpără · ${unmortgageCost(i)}`, unmortgageError(s, v, i)));
        else acts.push(btn('mortgage', `Ipotechează · +${mortgageValue(i)}`, mortgageError(s, v, i), false));
        const hint = t.type === 'prop' ? buildError(s, v, i) : '';
        body += `<div class="deed-acts">${acts.join('')}</div>${hint && st.houses < 5 && !st.mortgaged ? `<p class="hint">${esc(hint)}</p>` : ''}`;
      }
    } else {
      const about = {
        start: 'Primești 200 RON de fiecare dată când treci pe aici.',
        jail: 'Dacă doar treci pe aici, ești în vizită. La închisoare: plătești 50 RON, folosești un cartonaș sau încerci o dublă (maxim 3 ture).',
        parking: s.settings.jackpot ? `Loc de odihnă. Cine oprește aici ia potul cu taxe și amenzi: acum ${money(s.pot)}.` : 'Loc de odihnă. Nu se întâmplă nimic.',
        gotojail: 'Mergi direct la închisoare. Nu treci pe la Pornire.',
        tax: `Plătești ${money(t.amount)}${s.settings.jackpot ? ' (banii merg în potul de la Parcare)' : ''}.`,
        chance: 'Tragi o carte Șansă: deplasări, amenzi, noroc.',
        assoc: 'Tragi o carte din Cufărul Comunității.',
      }[t.type];
      body += `<p class="deed-about">${esc(about)}</p>`;
    }
    const here = s.players.filter((p) => !p.out && p.pos === i);
    if (here.length) body += `<p class="deed-here">Aici: ${here.map((p) => `${esc(p.token)} ${esc(p.name)}`).join(', ')}</p>`;
    return body + '</div>';
  }

  openPlayer(pi) {
    openSheet({
      title: 'Jucător',
      render: () => {
        const s = this.state;
        const p = s.players[pi];
        if (!p) return null;
        const v = this.viewer();
        const tiles = s.tiles.map((t, i) => i).filter((i) => s.tiles[i].owner === pi);
        const list = tiles.length ? `<ul class="plist">${tiles.map((i) => {
          const st = s.tiles[i];
          const c = BOARD[i].type === 'prop' ? GROUPS[BOARD[i].group].color : 'var(--ink-3)';
          return `<li style="--g:${c}"><button class="link" data-act="tile" data-tile="${i}">${esc(BOARD[i].name)}</button>${st.mortgaged ? ' <span class="pill pill-bad">ipotecat</span>' : ''}${st.houses ? ` <span class="pill">${st.houses === 5 ? '🏨' : '🏠'.repeat(st.houses)}</span>` : ''}</li>`;
        }).join('')}</ul>` : '<p class="empty">Nicio proprietate.</p>';
        const canTrade = v >= 0 && v !== pi && !p.out && !s.players[v].out && s.phase !== 'over';
        return `<div class="phead" style="--pc:${esc(p.color)}"><span class="pl-tok big">${esc(p.token)}</span><div><b>${esc(p.name)}</b>
            <span>${p.out ? 'a ieșit din joc' : p.inJail ? 'la închisoare' : `pe ${esc(tileName(p.pos))}`}${p.bot ? ' · bot' : p.auto ? ' · joacă un bot' : ''}</span></div></div>
          <div class="psum"><div><span>Bani</span><b>${money(p.cash)}</b></div><div><span>Avere</span><b>${money(netWorth(s, pi))}</b></div>${p.jailCards.length ? `<div><span>Cartonașe</span><b>🎫 ${p.jailCards.length}</b></div>` : ''}</div>
          ${list}${canTrade ? `<button class="btn btn-primary btn-block" data-act="tradewith">⇄ Propune un schimb</button>` : ''}`;
      },
      onAct: (act, el) => {
        if (act === 'tile') this.openTile(Number(el.dataset.tile));
        if (act === 'tradewith') this.openTradeComposer(pi);
      },
    });
  }

  openTradeComposer(target) {
    const s0 = this.state;
    const me = this.viewer();
    if (me < 0 || s0.players[me].out) return;
    const others = active(s0).filter((i) => i !== me);
    if (!others.length) return;
    const st = { to: target != null && others.includes(target) ? target : others[0], give: new Set(), get: new Set(), giveCash: 0, getCash: 0, giveCards: 0, getCards: 0 };
    const tradable = (s, seat) => s.tiles.map((t, i) => i).filter((i) => s.tiles[i].owner === seat && BUYABLE.has(BOARD[i].type)
      && !(BOARD[i].type === 'prop' && GROUPS[BOARD[i].group].tiles.some((k) => s.tiles[k].houses > 0)));
    const chips = (s, seat, set, side) => {
      const list = tradable(s, seat);
      if (!list.length) return '<p class="empty small">Nimic de dat.</p>';
      return `<div class="tchips">${list.map((i) => {
        const c = BOARD[i].type === 'prop' ? GROUPS[BOARD[i].group].color : 'var(--ink-3)';
        return `<button type="button" class="tchip ${set.has(i) ? 'on' : ''}" data-act="toggle" data-side="${side}" data-tile="${i}" style="--g:${c}">${esc(BOARD[i].name)}${s.tiles[i].mortgaged ? ' <small>(ipot.)</small>' : ''}</button>`;
      }).join('')}</div>`;
    };
    const cashRow = (side, value, max) => `<div class="cash-step"><span>Bani</span>
      <button type="button" class="icon-btn" data-act="cash" data-side="${side}" data-d="-50" ${value <= 0 ? 'disabled' : ''}>−</button>
      <input type="number" inputmode="numeric" min="0" max="${max}" step="10" value="${value}" data-cash="${side}" aria-label="Bani">
      <button type="button" class="icon-btn" data-act="cash" data-side="${side}" data-d="50" ${value >= max ? 'disabled' : ''}>+</button><small>max ${num(max)}</small></div>`;
    const render = () => {
      const s = this.state;
      if (!s.players[st.to] || s.players[st.to].out || s.players[me].out) return null;
      for (const i of [...st.give]) if (s.tiles[i].owner !== me) st.give.delete(i);
      for (const i of [...st.get]) if (s.tiles[i].owner !== st.to) st.get.delete(i);
      const P = s.players[me];
      const Q = s.players[st.to];
      st.giveCash = Math.min(st.giveCash, P.cash);
      st.getCash = Math.min(st.getCash, Q.cash);
      const T = this.draftTrade(st, me);
      const problem = tradeProblem(s, T);
      const partner = `<div class="partners">${active(s).filter((i) => i !== me).map((i) => `<button type="button" class="pchip ${i === st.to ? 'on' : ''}" data-act="partner" data-p="${i}" style="--pc:${esc(s.players[i].color)}">${esc(s.players[i].token)} ${esc(s.players[i].name)}</button>`).join('')}</div>`;
      return `${partner}
        <section class="tside"><h3>Tu dai</h3>${chips(s, me, st.give, 'give')}${cashRow('give', st.giveCash, P.cash)}
          ${P.jailCards.length ? `<label class="check"><input type="checkbox" data-card="give" ${st.giveCards ? 'checked' : ''}> 🎫 Cartonaș de ieșire din închisoare</label>` : ''}</section>
        <section class="tside"><h3>Primești de la ${esc(Q.name)}</h3>${chips(s, st.to, st.get, 'get')}${cashRow('get', st.getCash, Q.cash)}
          ${Q.jailCards.length ? `<label class="check"><input type="checkbox" data-card="get" ${st.getCards ? 'checked' : ''}> 🎫 Cartonaș de ieșire din închisoare</label>` : ''}</section>
        <p class="hint">Proprietățile din grupuri cu clădiri nu pot fi schimbate. Ipotecile rămân pe proprietate.</p>
        ${problem && problem !== 'Oferta e goală.' ? `<p class="c-note bad">${esc(problem)}</p>` : ''}
        <button class="btn btn-primary btn-block" data-act="send" ${problem ? 'disabled' : ''}>Trimite oferta</button>`;
    };
    const sheet = openSheet({
      title: '⇄ Propune un schimb',
      cls: 'sheet-trade',
      render,
      onAct: async (act, el) => {
        const s = this.state;
        if (act === 'partner') { st.to = Number(el.dataset.p); st.get.clear(); st.getCash = 0; st.getCards = 0; sheet.refresh(); }
        else if (act === 'toggle') {
          const set = el.dataset.side === 'give' ? st.give : st.get;
          const i = Number(el.dataset.tile);
          if (set.has(i)) set.delete(i); else set.add(i);
          sheet.refresh();
        } else if (act === 'cash') {
          const k = el.dataset.side === 'give' ? 'giveCash' : 'getCash';
          const max = el.dataset.side === 'give' ? s.players[me].cash : s.players[st.to].cash;
          st[k] = Math.max(0, Math.min(max, st[k] + Number(el.dataset.d)));
          sheet.refresh();
        } else if (act === 'input') {
          if (el.dataset.cash) {
            const k = el.dataset.cash === 'give' ? 'giveCash' : 'getCash';
            const max = el.dataset.cash === 'give' ? s.players[me].cash : s.players[st.to].cash;
            st[k] = Math.max(0, Math.min(max, Math.floor(Number(el.value) || 0)));
            const btn = sheet.body.querySelector('[data-act="send"]');
            const T = this.draftTrade(st, me);
            if (btn) btn.disabled = !!tradeProblem(s, T);
          } else if (el.dataset.card) {
            st[el.dataset.card === 'give' ? 'giveCards' : 'getCards'] = el.checked ? 1 : 0;
            sheet.refresh();
          }
        } else if (act === 'send') {
          const T = this.draftTrade(st, me);
          const err = await this.act(me, { type: 'propose', to: st.to, give: T.give, get: T.get });
          if (!err) { closeSheet(); toast('Oferta a fost trimisă.', { type: 'good' }); }
        }
      },
    });
  }

  draftTrade(st, me) {
    return {
      from: me,
      to: st.to,
      give: { tiles: [...st.give], cash: st.giveCash, cards: st.giveCards },
      get: { tiles: [...st.get], cash: st.getCash, cards: st.getCards },
    };
  }

  openIncoming(id) {
    openSheet({
      title: '⇄ Ofertă de schimb',
      cls: 'sheet-small',
      render: () => {
        const s = this.state;
        const T = s.trades[id];
        if (!T) return null;
        const problem = tradeProblem(s, T) || tradeCashProblem(s, T);
        const forName = this.ctrl.multiHuman ? `<p class="hint">Pentru ${who(s, T.to)}</p>` : '';
        return `${forName}<p>${who(s, T.from)} îți propune:</p>
          <div class="tr-side big"><span>Primești</span><b>${sideText(T.give)}</b></div>
          <div class="tr-side big"><span>Dai</span><b>${sideText(T.get)}</b></div>
          ${problem ? `<p class="c-note bad">${esc(problem)}</p>` : ''}
          ${s.phase === 'auction' ? '<p class="hint">Poți accepta după licitație.</p>' : ''}
          <div class="btn-row"><button class="btn" data-act="reject">Refuz</button><button class="btn btn-primary" data-act="accept" ${problem || s.phase === 'auction' ? 'disabled' : ''}>Accept</button></div>`;
      },
      onAct: async (act) => {
        const T = this.state.trades[id];
        if (!T) { closeSheet(); return; }
        if (act === 'accept' || act === 'reject') {
          const err = await this.act(T.to, { type: act, id });
          if (!err) { closeSheet(); if (act === 'accept') toast('Schimb încheiat!', { type: 'good' }); }
        }
      },
    });
  }

  openGameOver() {
    openSheet({
      title: '🏁 Final de joc',
      cls: 'sheet-over',
      render: () => {
        const s = this.state;
        if (s.phase !== 'over') return null;
        const order = s.players.map((p, i) => i).sort((a, b) => (a === s.winner ? -1 : b === s.winner ? 1 : 0)
          || (s.players[a].out - s.players[b].out) || netWorth(s, b) - netWorth(s, a));
        const why = s.endReason === 'rounds' ? 'S-a atins limita de runde — câștigă cea mai mare avere.'
          : s.endReason === 'host' ? 'Jocul a fost încheiat — câștigă cea mai mare avere.' : 'Toți ceilalți au dat faliment.';
        const w = s.players[s.winner];
        const canRestart = this.ctrl.canHost();
        return `<div class="winner" style="--pc:${esc(w ? w.color : '#888')}"><span class="pl-tok huge">${w ? esc(w.token) : '🏁'}</span>
            <b>${w ? esc(w.name) : 'Nimeni'}</b><span>${w && this.mine(s.winner) && !this.ctrl.multiHuman ? 'Ai câștigat! 🎉' : 'câștigă jocul!'}</span></div>
          <p class="hint center">${why}</p>
          <ol class="ranks">${order.map((i, k) => `<li class="${i === s.winner ? 'win' : ''}"><span>${k + 1}.</span> ${esc(s.players[i].token)} ${esc(s.players[i].name)}
            <b>${s.players[i].out ? 'faliment' : money(netWorth(s, i))}</b></li>`).join('')}</ol>
          <div class="btn-col">${canRestart ? '<button class="btn btn-primary" data-act="again">🔁 Revanșă</button>' : '<p class="hint center">Gazda poate porni o revanșă.</p>'}
          <button class="btn" data-act="leave">Meniul principal</button></div>`;
      },
      onAct: async (act) => {
        if (act === 'again') {
          const err = await this.act(Math.max(0, this.viewer()), { type: 'restart' });
          if (!err) closeSheet();
        }
        if (act === 'leave') { closeSheet(); this.hooks.onLeave && this.hooks.onLeave(); }
      },
    });
  }

  openMenu() {
    const s = this.state;
    const v = this.viewer();
    const canEnd = this.ctrl.canHost() && s.phase !== 'over';
    const canResign = v >= 0 && !s.players[v].out && s.phase !== 'over';
    openSheet({
      title: 'Meniu',
      cls: 'sheet-small',
      render: () => `<div class="menu">
          ${this.ctrl.kind === 'online' ? `<button class="menu-item" data-act="share">🔗 Invită prieteni <small>camera ${esc(this.ctrl.code)}</small></button>` : ''}
          <button class="menu-item" data-act="rules">📖 Cum se joacă</button>
          <button class="menu-item" data-act="sound">${soundOn() ? '🔊 Sunet pornit' : '🔇 Sunet oprit'}</button>
          <button class="menu-item" data-act="speed">⏩ Viteza boților: <b>${store.get('botSpeed', 'normal') === 'fast' ? 'rapidă' : 'normală'}</b></button>
          <button class="menu-item" data-act="theme">🌓 Temă: <b>${{ auto: 'automată', light: 'luminoasă', dark: 'întunecată' }[store.get('theme', 'auto')]}</b></button>
          ${canEnd ? '<button class="menu-item" data-act="finish">🏁 Încheie jocul acum <small>câștigă cel mai bogat</small></button>' : ''}
          ${canResign ? '<button class="menu-item danger" data-act="resign">🏳️ Renunță la joc</button>' : ''}
          <button class="menu-item" data-act="leave">🚪 Ieși în meniul principal <small>${this.ctrl.kind === 'online' ? 'poți reveni cu codul camerei' : 'jocul se salvează'}</small></button>
        </div>`,
      onAct: async (act) => {
        if (act === 'share') this.hooks.onShare && this.hooks.onShare();
        if (act === 'rules') openRules();
        if (act === 'sound') { setSound(!soundOn()); this.renderTop(); refreshSheet(); }
        if (act === 'speed') { store.set('botSpeed', store.get('botSpeed', 'normal') === 'fast' ? 'normal' : 'fast'); refreshSheet(); }
        if (act === 'theme') {
          const next = { auto: 'light', light: 'dark', dark: 'auto' }[store.get('theme', 'auto')];
          store.set('theme', next);
          applyTheme();
          refreshSheet();
        }
        if (act === 'finish') {
          if (await confirmSheet('Închei jocul?', '<p>Câștigă jucătorul cu cea mai mare avere (bani + proprietăți + clădiri).</p>', 'Încheie')) this.act(Math.max(0, v), { type: 'finish' });
        }
        if (act === 'resign') {
          if (await confirmSheet('Renunți?', '<p>Ieși din joc, iar proprietățile tale revin băncii.</p>', 'Renunț', true)) this.act(v, { type: 'resign' });
        }
        if (act === 'leave') { closeSheet(); this.hooks.onLeave && this.hooks.onLeave(); }
      },
    });
  }
}

export function applyTheme() {
  const t = store.get('theme', 'auto');
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0e1120' : '#f3efe7'));
}

export function openRules() {
  openSheet({
    title: '📖 Cum se joacă',
    cls: 'sheet-rules',
    render: () => `<div class="rules">
      <p><b>Scopul:</b> rămâi ultimul jucător fără faliment — sau cel mai bogat când se termină rundele.</p>
      <h3>Tura ta</h3>
      <ul><li>Arunci zarurile și avansezi. La fiecare trecere pe la <b>Pornire</b> primești 200 RON.</li>
      <li>Dai <b>dublă</b>? Mai arunci o dată. A treia dublă la rând te trimite la închisoare.</li>
      <li>Ajungi pe o proprietate liberă: o <b>cumperi</b> sau o scoți la <b>licitație</b> (licitează toată lumea, inclusiv tu).</li>
      <li>Ajungi pe proprietatea altcuiva: plătești <b>chirie</b>.</li></ul>
      <h3>Proprietăți</h3>
      <ul><li>Un <b>grup complet</b> de aceeași culoare dublează chiria pe terenuri și îți permite să construiești <b>case</b> (maxim 4), apoi un <b>hotel</b>. Construiești uniform pe tot grupul.</li>
      <li><b>Gările</b> aduc mai mult cu cât ai mai multe. <b>Uzinele</b> iau 4× sau 10× suma zarurilor.</li>
      <li>Ai nevoie de bani? <b>Ipotechează</b> (primești jumătate din preț, dar nu mai încasezi chirie) sau vinde clădiri la jumătate de preț. Răscumpărarea costă ipoteca + 10%.</li>
      <li><b>Schimbă</b> proprietăți, bani și cartonașe cu ceilalți oricând — din tabul Schimburi.</li></ul>
      <h3>Închisoarea</h3>
      <ul><li>Ieși plătind 50 RON, cu un cartonaș sau dând dublă. După 3 încercări plătești și ieși.</li>
      <li>Și din închisoare încasezi chirie.</li></ul>
      <h3>Datorii și faliment</h3>
      <ul><li>Dacă nu ai cu ce plăti, poți vinde clădiri, ipoteca sau face schimburi. Dacă tot nu ajunge, dai faliment și ieși din joc.</li></ul>
      <h3>Cărți</h3>
      <ul><li><b>Șansă</b> și <b>Cufărul Comunității</b> aduc deplasări, amenzi și bani.</li></ul>
      <p class="hint">Opțional: potul de la Parcare strânge taxele și amenzile pentru cine oprește acolo.</p></div>`,
  });
}
