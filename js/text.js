// Formatting + human-readable (Romanian) descriptions of log entries.

import { BOARD, DECKS, GROUPS } from './data.js';
import { BANK, POT, ALL } from './engine.js';

const nf = new Intl.NumberFormat('ro-RO');
export const money = (n) => `${nf.format(Math.round(n))} RON`;
export const num = (n) => nf.format(Math.round(n));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const tileName = (i) => BOARD[i]?.name ?? '?';
export const tileColor = (i) => (BOARD[i]?.type === 'prop' ? GROUPS[BOARD[i].group].color : null);

/** Player name chip (HTML). */
export function who(s, i) {
  const p = s.players[i];
  if (!p) return 'Banca';
  return `<b class="who" style="--pc:${esc(p.color)}">${esc(p.name)}</b>`;
}

const tl = (i) => {
  const c = tileColor(i);
  return `<b class="tl"${c ? ` style="--g:${c}"` : ''}>${esc(tileName(i))}</b>`;
};
const amt = (a) => `<b class="amt">${money(a)}</b>`;

function creditor(s, to, viewer) {
  if (to === BANK) return 'băncii';
  if (to === POT) return 'potului de la Parcare';
  if (to === ALL) return 'celorlalți jucători';
  if (to === viewer) return 'ție';
  return `lui ${who(s, to)}`;
}

/**
 * Describe a log entry. `viewer` is the seat reading it (-1 for spectators);
 * messages about the viewer use the second person.
 */
export function describe(e, s, viewer = -1) {
  const me = e.p === viewer;
  const P = () => who(s, e.p);
  switch (e.k) {
    case 'start': return 'Jocul a început. Baftă!';
    case 'turn': return me ? 'E rândul tău.' : `E rândul lui ${P()}.`;
    case 'roll': {
      const [a, b] = e.d || [0, 0];
      const dbl = a === b ? ' — dublă!' : '';
      return me ? `Ai dat ${a} și ${b}${dbl}` : `${P()} a dat ${a} și ${b}${dbl}`;
    }
    case 'move':
      if (e.how === 'jail') return null;
      return me ? `Ai ajuns pe ${tl(e.to)}.` : `${P()} a ajuns pe ${tl(e.to)}.`;
    case 'go': return me ? `Ai trecut pe la Pornire: +${money(e.a)}.` : `${P()} a trecut pe la Pornire: +${money(e.a)}.`;
    case 'buy': return me ? `Ai cumpărat ${tl(e.t)} cu ${amt(e.a)}.` : `${P()} a cumpărat ${tl(e.t)} cu ${amt(e.a)}.`;
    case 'rent':
      if (e.owed) {
        return me ? `Datorezi ${amt(e.a)} chirie ${creditor(s, e.to, viewer)} pentru ${tl(e.t)}.`
          : `${P()} datorează ${amt(e.a)} chirie ${creditor(s, e.to, viewer)}.`;
      }
      if (me) return `Ai plătit ${amt(e.a)} chirie lui ${who(s, e.to)} pentru ${tl(e.t)}.`;
      if (e.to === viewer) return `${P()} ți-a plătit ${amt(e.a)} chirie pentru ${tl(e.t)}.`;
      return `${P()} i-a plătit ${amt(e.a)} chirie lui ${who(s, e.to)} pentru ${tl(e.t)}.`;
    case 'tax':
      if (e.owed) return me ? `Datorezi ${amt(e.a)}: ${tl(e.t)}.` : `${P()} datorează ${amt(e.a)}: ${tl(e.t)}.`;
      return me ? `Ai plătit ${tl(e.t)}: ${amt(e.a)}.` : `${P()} a plătit ${tl(e.t)}: ${amt(e.a)}.`;
    case 'card': {
      const d = DECKS[e.d];
      const c = d?.cards[e.c];
      return `${me ? 'Ai tras' : `${P()} a tras`} o carte <b class="deck deck-${esc(e.d)}">${esc(d?.name)}</b>: „${esc(c?.text)}”`;
    }
    case 'cash':
      if (e.owed) return me ? `Datorezi ${amt(-e.a)} băncii.` : `${P()} datorează ${amt(-e.a)} băncii.`;
      return null; // the card text already says it
    case 'repairs':
      if (!e.a) return me ? 'Nu ai clădiri, deci nu plătești nimic.' : `${P()} nu are clădiri, deci nu plătește nimic.`;
      return e.owed ? `${P()} datorează ${amt(e.a)} pentru reparații.` : `${me ? 'Ai plătit' : `${P()} a plătit`} ${amt(e.a)} pentru reparații.`;
    case 'each':
      if (e.dir === 'collect') return `${me ? 'Ai primit' : `${P()} a primit`} în total ${amt(e.total)}.`;
      return e.owed ? `${P()} datorează câte ${amt(e.a)} fiecărui jucător.` : `${me ? 'Ai plătit' : `${P()} a plătit`} câte ${amt(e.a)} fiecărui jucător.`;
    case 'jail':
      if (e.why === 'dbl') return `Trei duble la rând! ${me ? 'Mergi' : `${P()} merge`} la închisoare pentru viteză.`;
      if (e.why === 'tile') return me ? 'Ai fost arestat! Mergi la închisoare.' : `${P()} a fost arestat!`;
      return me ? 'Mergi direct la închisoare.' : `${P()} merge la închisoare.`;
    case 'stay': return me ? `Rămâi la închisoare (încercarea ${e.n} din 3).` : `${P()} rămâne la închisoare (${e.n}/3).`;
    case 'free':
      if (e.how === 'dbl') return `${me ? 'Ai dat' : `${P()} a dat`} dublă și ${me ? 'ieși' : 'iese'} din închisoare!`;
      if (e.how === 'card') return `${me ? 'Ai folosit' : `${P()} a folosit`} cartonașul și ${me ? 'ieși' : 'iese'} din închisoare.`;
      return `${me ? 'Ai plătit' : `${P()} a plătit`} ${amt(e.a || 50)} și ${me ? 'ieși' : 'iese'} din închisoare.`;
    case 'fine':
      return e.owed ? `${P()} trebuie să plătească amenda de ${amt(e.a)}.` : `După trei încercări, ${me ? 'plătești' : `${P()} plătește`} amenda de ${amt(e.a)}.`;
    case 'pot': return `${me ? 'Ai luat' : `${P()} a luat`} potul de la Parcare: ${amt(e.a)}!`;
    case 'auction': return `Licitație pentru ${tl(e.t)}!`;
    case 'bid': return me ? `Ai oferit ${amt(e.a)}.` : `${P()} oferă ${amt(e.a)}.`;
    case 'pass':
      if (e.auto) return `${P()} nu are destui bani și iese din licitație.`;
      return me ? 'Ai renunțat la licitație.' : `${P()} renunță.`;
    case 'won': return `${me ? 'Ai câștigat' : `${P()} a câștigat`} licitația pentru ${tl(e.t)} cu ${amt(e.a)}.`;
    case 'unsold': return `Nimeni nu a cumpărat ${tl(e.t)}. Rămâne la bancă.`;
    case 'skip': return `${me ? 'Nu ai cumpărat' : `${P()} nu a cumpărat`} ${tl(e.t)}.`;
    case 'build':
      return e.h === 5 ? `${me ? 'Ai construit' : `${P()} a construit`} un hotel pe ${tl(e.t)}!`
        : `${me ? 'Ai construit' : `${P()} a construit`} o casă pe ${tl(e.t)} (${e.h}).`;
    case 'sell': return `${me ? 'Ai vândut' : `${P()} a vândut`} o clădire de pe ${tl(e.t)} (+${money(e.a)}).`;
    case 'mortgage': return `${me ? 'Ai ipotecat' : `${P()} a ipotecat`} ${tl(e.t)} (+${money(e.a)}).`;
    case 'unmortgage': return `${me ? 'Ai ridicat' : `${P()} a ridicat`} ipoteca de pe ${tl(e.t)} (−${money(e.a)}).`;
    case 'offer':
      if (e.to === viewer) return `${P()} ți-a propus un schimb.`;
      return me ? `I-ai propus un schimb lui ${who(s, e.to)}.` : `${P()} i-a propus un schimb lui ${who(s, e.to)}.`;
    case 'trade': return `Schimb încheiat între ${who(s, e.p)} și ${who(s, e.to)}: ${tradeSummary(s, e)}`;
    case 'reject': return `${me ? 'Ai refuzat' : `${P()} a refuzat`} oferta ${e.to === viewer ? 'ta' : `lui ${who(s, e.to)}`}.`;
    case 'paid': return `${me ? 'Ți-ai plătit' : `${P()} și-a plătit`} datoria de ${amt(e.a)}.`;
    case 'bankrupt':
      return `${P()} a dat faliment!${e.to >= 0 ? ` Tot ce avea trece la ${who(s, e.to)}.` : ''}`;
    case 'resign': return `${P()} a ieșit din joc.`;
    case 'auto': return e.on ? `Un bot joacă acum pentru ${P()}.` : `${P()} a revenit la joc.`;
    case 'over': {
      const why = e.why === 'rounds' ? 'Limita de runde s-a atins — câștigă cel mai bogat. ' : e.why === 'host' ? 'Jocul a fost încheiat — câștigă cel mai bogat. ' : '';
      return e.p >= 0 ? `${why}${who(s, e.p)} câștigă jocul! 🏆` : 'Jocul s-a terminat.';
    }
    default: return null;
  }
}

function sideText(side) {
  const parts = side.tiles.map((t) => esc(tileName(t)));
  if (side.cash) parts.push(money(side.cash));
  if (side.cards) parts.push(side.cards === 1 ? 'cartonaș de închisoare' : `${side.cards} cartonașe`);
  return parts.length ? parts.join(', ') : 'nimic';
}

export function tradeSummary(s, T) {
  const from = s.players[T.p ?? T.from]?.name ?? '?';
  return `${esc(from)} dă ${sideText(T.give)} și primește ${sideText(T.get)}.`;
}

export { sideText };

/** Short label for a tile's current rent situation. */
export function rentLabel(t) {
  if (t.type === 'utility') return '4× / 10× zarurile';
  if (t.type === 'station') return '25 – 200 RON';
  return money(t.rent[0]);
}
