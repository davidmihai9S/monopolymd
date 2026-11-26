// Board DOM: 11×11 grid, tiles around the edge, tokens on an overlay.

import { BOARD, GROUPS, JAIL_TILE } from './data.js';
import { esc } from './text.js';

/** Grid row/column and side ('b','l','t','r','c') for tile i. */
export function gridPos(i) {
  if (i === 0) return { r: 11, c: 11, side: 'c' };
  if (i < 10) return { r: 11, c: 11 - i, side: 'b' };
  if (i === 10) return { r: 11, c: 1, side: 'c' };
  if (i < 20) return { r: 21 - i, c: 1, side: 'l' };
  if (i === 20) return { r: 1, c: 1, side: 'c' };
  if (i < 30) return { r: 1, c: i - 19, side: 't' };
  if (i === 30) return { r: 1, c: 11, side: 'c' };
  return { r: i - 29, c: 11, side: 'r' };
}

function tileInner(t, i) {
  switch (t.type) {
    case 'prop':
      return `<span class="band"><span class="bld"></span></span>
        <span class="tinfo"><span class="tname">${esc(t.short)}</span><span class="tprice">${t.price}</span></span>
        <span class="own"></span>`;
    case 'station':
    case 'utility':
      return `<span class="ticon">${t.icon}</span>
        <span class="tinfo"><span class="tname">${esc(t.short)}</span><span class="tprice">${t.price}</span></span>
        <span class="own"></span>`;
    case 'tax':
      return `<span class="ticon">${t.icon}</span>
        <span class="tinfo"><span class="tname">${esc(t.short)}</span><span class="tprice">−${t.amount}</span></span>`;
    case 'chance':
    case 'assoc':
      return `<span class="ticon deckicon deck-${t.type}">${t.icon}</span>
        <span class="tinfo"><span class="tname">${esc(t.short)}</span></span>`;
    case 'start':
      return `<span class="corner-in"><span class="cicon">➜</span><span class="cname">Pornire</span><span class="csub">+200 la fiecare tur</span></span>`;
    case 'jail':
      return `<span class="corner-in"><span class="cicon">🔒</span><span class="cname">Închisoare</span><span class="csub">sau doar în vizită</span></span>`;
    case 'parking':
      return `<span class="corner-in"><span class="cicon cicon-p">P</span><span class="cname">Parcare</span><span class="csub pot"></span></span>`;
    case 'gotojail':
      return `<span class="corner-in"><span class="cicon">👮</span><span class="cname">Du-te la închisoare</span></span>`;
    default:
      return '';
  }
}

export class Board {
  constructor(el, onTile) {
    this.el = el;
    this.tiles = [];
    this.tokens = [];
    this.layout = [];
    const frag = document.createDocumentFragment();
    BOARD.forEach((t, i) => {
      const { r, c, side } = gridPos(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tile t-${t.type} side-${side}`;
      b.dataset.tile = i;
      b.style.gridArea = `${r} / ${c}`;
      if (t.type === 'prop') b.style.setProperty('--g', GROUPS[t.group].color);
      b.setAttribute('aria-label', t.name);
      b.innerHTML = tileInner(t, i);
      frag.appendChild(b);
      this.tiles.push(b);
    });
    el.appendChild(frag);
    this.layer = document.createElement('div');
    this.layer.className = 'tokens';
    el.appendChild(this.layer);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.tile');
      if (b) onTile(Number(b.dataset.tile));
    });
    this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.measure(); this.place(this.lastPos || [], this.lastJail || [], false); });
      this.ro.observe(el);
    }
  }

  /** Tile centres and sizes as % of the board, so tokens survive resizes. */
  measure() {
    const W = this.el.clientWidth || 1;
    const Hh = this.el.clientHeight || 1;
    this.layout = this.tiles.map((t) => ({
      x: ((t.offsetLeft + t.offsetWidth / 2) / W) * 100,
      y: ((t.offsetTop + t.offsetHeight / 2) / Hh) * 100,
      w: (t.offsetWidth / W) * 100,
      h: (t.offsetHeight / Hh) * 100,
    }));
  }

  setPlayers(players) {
    this.layer.innerHTML = '';
    this.tokens = players.map((p, i) => {
      const d = document.createElement('div');
      d.className = 'token';
      d.dataset.p = i;
      d.style.setProperty('--pc', p.color);
      d.innerHTML = `<span class="tk">${esc(p.token)}</span>`;
      this.layer.appendChild(d);
      return d;
    });
  }

  render(s, opts = {}) {
    s.tiles.forEach((st, i) => {
      const el = this.tiles[i];
      const t = BOARD[i];
      const owner = st.owner >= 0 ? s.players[st.owner] : null;
      el.classList.toggle('owned', !!owner);
      el.classList.toggle('mort', !!st.mortgaged);
      el.classList.toggle('pending', s.phase === 'buy' && s.pending === i);
      el.classList.toggle('auction', s.phase === 'auction' && s.auction && s.auction.tile === i);
      if (owner) el.style.setProperty('--own', owner.color);
      else el.style.removeProperty('--own');
      const own = el.querySelector('.own');
      if (own) {
        const html = owner ? esc(owner.token) : '';
        if (own.innerHTML !== html) own.innerHTML = html;
      }
      if (t.type === 'prop') {
        const bld = el.querySelector('.bld');
        const key = String(st.houses);
        if (bld.dataset.h !== key) {
          bld.dataset.h = key;
          bld.innerHTML = st.houses === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(st.houses);
        }
      }
      const label = owner ? `${t.name} — ${owner.name}${st.mortgaged ? ', ipotecat' : ''}${st.houses ? `, ${st.houses === 5 ? 'hotel' : st.houses + ' case'}` : ''}` : t.name;
      el.setAttribute('aria-label', label);
    });
    const pot = this.tiles[20].querySelector('.pot');
    if (pot) pot.textContent = s.settings.jackpot ? `Pot: ${s.pot} RON` : 'Odihnă gratuită';
    if (opts.highlight != null) this.flash(opts.highlight);
  }

  flash(i) {
    const el = this.tiles[i];
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /** Place every token. positions[i] = tile index; jailed[i] = in jail. */
  place(positions, jailed = [], animate = true, hidden = []) {
    this.lastPos = positions.slice();
    this.lastJail = jailed.slice();
    const groups = {};
    positions.forEach((pos, i) => {
      if (hidden[i]) return;
      const key = pos === JAIL_TILE ? `${pos}:${jailed[i] ? 'in' : 'out'}` : String(pos);
      (groups[key] = groups[key] || []).push(i);
    });
    for (const [key, list] of Object.entries(groups)) {
      const pos = Number(key.split(':')[0]);
      const L = this.layout[pos];
      if (!L) continue;
      const side = gridPos(pos).side;
      list.forEach((pi, k) => {
        let { x, y } = L;
        const n = list.length;
        if (pos === JAIL_TILE) {
          // Jail corner (bottom-left): inmates up-right behind bars, visitors along the outer edge.
          if (key.endsWith(':in')) { x += L.w * 0.18 + (k % 2) * L.w * 0.2 - L.w * 0.1; y -= L.h * 0.18 - Math.floor(k / 2) * L.h * 0.2; }
          else { x -= L.w * 0.3; y += L.h * 0.3 - k * L.h * 0.12; x += (k % 2) * L.w * 0.12; }
        } else if (side === 'c') {
          const cols = n > 4 ? 3 : 2;
          const rows = Math.ceil(n / cols);
          x += ((k % cols) - (Math.min(n, cols) - 1) / 2) * L.w * 0.3;
          y += (Math.floor(k / cols) - (rows - 1) / 2) * L.h * 0.3;
        } else if (side === 'b' || side === 't') {
          const span = Math.min(L.h * 0.22, (L.h * 0.7) / Math.max(n, 1));
          y += (k - (n - 1) / 2) * span;
          x += n > 1 ? (k % 2 ? 1 : -1) * L.w * 0.12 : 0;
        } else {
          const span = Math.min(L.w * 0.22, (L.w * 0.7) / Math.max(n, 1));
          x += (k - (n - 1) / 2) * span;
          y += n > 1 ? (k % 2 ? 1 : -1) * L.h * 0.12 : 0;
        }
        const tok = this.tokens[pi];
        if (!tok) return;
        tok.classList.toggle('no-anim', !animate);
        tok.style.left = x + '%';
        tok.style.top = y + '%';
        tok.classList.toggle('jailed', pos === JAIL_TILE && !!jailed[pi]);
      });
    }
    this.tokens.forEach((t, i) => t.classList.toggle('gone', !!hidden[i]));
  }

  hop(pi) {
    const t = this.tokens[pi];
    if (!t) return;
    t.classList.remove('hop');
    void t.offsetWidth;
    t.classList.add('hop');
  }

  setActive(pi) {
    this.tokens.forEach((t, i) => t.classList.toggle('active', i === pi));
  }
}
