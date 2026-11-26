// App shell: home, local setup, online lobby, and wiring the game view.

import { TOKENS, PLAYER_COLORS, BOT_NAMES, MAX_PLAYERS } from './data.js';
import { defaultSettings } from './engine.js';
import { GameView, applyTheme, openRules } from './ui.js';
import { LocalGame } from './local.js';
import { BotDriver } from './driver.js';
import { store, sfx } from './fx.js';
import { esc, money } from './text.js';
import { toast, confirmSheet, closeSheet } from './sheet.js';

const $ = (s) => document.querySelector(s);
const net = () => import('./net.js');

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

let ctrl = null;
let driver = null;
let room = null; // OnlineRoom while in an online lobby/game
let offLobby = null;

const view = new GameView($('#screen-game'), {
  onIdle: () => driver && driver.kick(),
  onLeave: () => leaveGame(),
  onShare: () => shareRoom(),
});

function show(screen) {
  document.body.dataset.screen = screen;
  document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.id !== `screen-${screen}`; });
  window.scrollTo(0, 0);
}

const myName = () => (store.get('name', '') || '').trim();

/* -------------------------------- home -------------------------------- */

function renderHome() {
  $('#home-name').value = myName();
  const saved = LocalGame.saved();
  const last = store.get('lastRoom', null);
  const cont = $('#home-continue');
  const items = [];
  if (saved) {
    const humans = saved.players.filter((p) => !p.bot).map((p) => p.name).join(', ');
    items.push(`<button class="btn btn-block continue" data-go="resume-local">▶ Continuă jocul pe telefon <small>runda ${saved.round} · ${esc(humans || 'boți')}</small></button>`);
  }
  if (last && Date.now() - last.at < 3 * 24 * 3600 * 1000) {
    items.push(`<button class="btn btn-block continue" data-go="resume-online">▶ Revino în camera ${esc(last.code)}</button>`);
  }
  cont.innerHTML = items.join('');
  cont.hidden = !items.length;
}

function requireName() {
  const input = $('#home-name');
  const n = input.value.trim().slice(0, 16);
  if (!n) {
    input.focus();
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 500);
    toast('Scrie-ți întâi numele.', { type: 'error' });
    return null;
  }
  store.set('name', n);
  return n;
}

/* ----------------------------- local setup ----------------------------- */

let setup = null;

function defaultSetup() {
  return {
    seats: [
      { name: myName() || 'Eu', token: TOKENS[0], bot: false },
      { name: BOT_NAMES[0], token: TOKENS[1], bot: true },
      { name: BOT_NAMES[1], token: TOKENS[2], bot: true },
    ],
    settings: defaultSettings(),
  };
}

function openLocalSetup() {
  const n = requireName();
  if (!n) return;
  setup = store.get('localSetup', null) || defaultSetup();
  if (!setup.seats || setup.seats.length < 2) setup = defaultSetup();
  setup.settings = { ...defaultSettings(), ...(setup.settings || {}) };
  const firstHuman = setup.seats.find((s) => !s.bot);
  if (firstHuman) firstHuman.name = n;
  renderSetup();
  show('local');
}

function settingsHtml(st, editable) {
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) =>
    `<button type="button" class="${st[key] === v ? 'on' : ''}" data-set="${key}" data-v="${v}" ${editable ? '' : 'disabled'}>${label}</button>`).join('')}</div>`;
  return `<div class="opt"><span>Bani la start</span>${seg('cash', [[1000, '1.000'], [1500, '1.500'], [2000, '2.000']])}</div>
    <div class="opt"><span>Durată</span>${seg('rounds', [[0, 'Până la final'], [30, '30 runde'], [20, '20 runde']])}</div>
    <div class="opt"><span>Licitații</span>${seg('auctions', [[true, 'Da'], [false, 'Nu']])}</div>
    <div class="opt"><span>Pot la Parcare <small>taxele și amenzile se adună pentru cine oprește acolo</small></span>${seg('jackpot', [[false, 'Nu'], [true, 'Da']])}</div>`;
}

function renderSetup() {
  const used = new Set();
  const rows = setup.seats.map((s, i) => {
    used.add(s.token);
    return `<li class="seat">
      <button type="button" class="tok-btn" data-seat-token="${i}" aria-label="Schimbă jetonul">${esc(s.token)}</button>
      <input class="input" data-seat-name="${i}" value="${esc(s.name)}" maxlength="16" aria-label="Nume jucător ${i + 1}">
      <div class="seg small" role="group"><button type="button" class="${s.bot ? '' : 'on'}" data-seat-bot="${i}" data-v="0">Om</button><button type="button" class="${s.bot ? 'on' : ''}" data-seat-bot="${i}" data-v="1">Bot</button></div>
      ${setup.seats.length > 2 ? `<button type="button" class="icon-btn" data-seat-del="${i}" aria-label="Elimină">✕</button>` : '<span class="icon-btn ghost"></span>'}
    </li>`;
  }).join('');
  const humans = setup.seats.filter((s) => !s.bot).length;
  $('#local-seats').innerHTML = rows;
  $('#local-add').disabled = setup.seats.length >= MAX_PLAYERS;
  $('#local-settings').innerHTML = settingsHtml(setup.settings, true);
  $('#local-hint').textContent = humans > 1
    ? 'Mai mulți oameni pe același telefon: dați telefonul de la unul la altul când vine rândul fiecăruia.'
    : humans === 0 ? 'Doar boți: te uiți cum joacă ei.' : 'Tu contra boților. Poți adăuga până la 6 jucători.';
  store.set('localSetup', setup);
}

function onSetupClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.seatToken != null) {
    const s = setup.seats[Number(d.seatToken)];
    const taken = new Set(setup.seats.map((x) => x.token));
    const start = TOKENS.indexOf(s.token);
    for (let k = 1; k <= TOKENS.length; k++) {
      const cand = TOKENS[(start + k) % TOKENS.length];
      if (!taken.has(cand)) { s.token = cand; break; }
    }
    sfx.pop();
  } else if (d.seatBot != null) {
    const s = setup.seats[Number(d.seatBot)];
    s.bot = d.v === '1';
    if (s.bot && !BOT_NAMES.includes(s.name)) s.name = BOT_NAMES.find((n) => !setup.seats.some((x) => x.name === n)) || s.name;
    if (!s.bot && BOT_NAMES.includes(s.name)) s.name = `Jucător ${Number(d.seatBot) + 1}`;
  } else if (d.seatDel != null) {
    setup.seats.splice(Number(d.seatDel), 1);
  } else if (d.set) {
    setup.settings[d.set] = d.v === 'true' ? true : d.v === 'false' ? false : Number(d.v);
  } else return;
  renderSetup();
}

function addLocalSeat() {
  if (setup.seats.length >= MAX_PLAYERS) return;
  const taken = new Set(setup.seats.map((x) => x.token));
  setup.seats.push({
    name: BOT_NAMES.find((n) => !setup.seats.some((x) => x.name === n)) || 'Bot',
    token: TOKENS.find((t) => !taken.has(t)) || TOKENS[0],
    bot: true,
  });
  renderSetup();
}

async function startLocal() {
  const seats = setup.seats.map((s, i) => ({ ...s, name: (s.name || '').trim() || (s.bot ? 'Bot' : `Jucător ${i + 1}`), color: PLAYER_COLORS[i] }));
  if (LocalGame.saved() && !(await confirmSheet('Începi un joc nou?', '<p>Jocul local salvat va fi înlocuit.</p>', 'Joc nou'))) return;
  const g = LocalGame.create(seats, setup.settings);
  enterGame(g);
}

/* ------------------------------- game -------------------------------- */

function enterGame(c) {
  if (driver) driver.stop();
  ctrl = c;
  driver = new BotDriver(c, view);
  show('game');
  view.attach(c);
  setTimeout(() => driver.kick(), 600);
}

function leaveGame() {
  if (driver) driver.stop();
  driver = null;
  view.detach();
  if (ctrl && ctrl.kind === 'online') {
    ctrl.stop();
    room = null;
    if (offLobby) offLobby();
    offLobby = null;
    setRoomUrl(null);
  } else if (ctrl) ctrl.leave();
  ctrl = null;
  renderHome();
  show('home');
}

/* ------------------------------- online ------------------------------- */

function setRoomUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('r', code); else url.searchParams.delete('r');
  history.replaceState(null, '', url);
}

function roomLink(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('r', code);
  const emu = new URLSearchParams(location.search).get('emu');
  if (emu) url.searchParams.set('emu', emu);
  return url.toString();
}

async function shareRoom() {
  const code = room && room.code;
  if (!code) return;
  const url = roomLink(code);
  const text = `Hai la o partidă de Capitala! Camera ${code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Capitala', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(url);
    toast('Linkul a fost copiat. Trimite-l prietenilor!', { type: 'good' });
  } catch {
    toast(`Codul camerei: <b>${esc(code)}</b>`, { ms: 6000 });
  }
}

function setOnlineMsg(text, type = 'error') {
  const el = $('#online-msg');
  el.textContent = text || '';
  el.dataset.type = type;
}

function busyButtons(on) {
  document.querySelectorAll('#screen-online button').forEach((b) => { b.disabled = on; });
}

async function createOnline() {
  const name = myName();
  if (!name) { show('home'); requireName(); return; }
  setOnlineMsg('Se creează camera…', 'info');
  busyButtons(true);
  try {
    const { createRoom, joinRoom } = await net();
    const code = await createRoom({ name, token: store.get('token', TOKENS[0]) });
    await openRoom(await joinRoom(code, { name, token: store.get('token', TOKENS[0]) }));
    setOnlineMsg('');
  } catch (e) {
    setOnlineMsg(e.message);
  } finally {
    busyButtons(false);
  }
}

async function joinOnline(codeArg) {
  const name = myName();
  if (!name) { show('home'); requireName(); return; }
  const code = String(codeArg || $('#join-code').value).toUpperCase().replace(/[^A-Z]/g, '');
  $('#join-code').value = code;
  if (code.length !== 4) { setOnlineMsg('Codul camerei are 4 litere.'); $('#join-code').focus(); return; }
  setOnlineMsg('Se conectează…', 'info');
  busyButtons(true);
  try {
    const { joinRoom } = await net();
    await openRoom(await joinRoom(code, { name, token: store.get('token', TOKENS[0]) }));
    setOnlineMsg('');
  } catch (e) {
    setOnlineMsg(e.message);
    if (/nu există/.test(e.message) && store.get('lastRoom', null)?.code === code) store.set('lastRoom', null);
  } finally {
    busyButtons(false);
  }
}

async function openRoom(r) {
  if (room && room !== r) room.stop();
  room = r;
  setRoomUrl(r.code);
  if (offLobby) offLobby();
  offLobby = r.onLobby(onRoomChange);
}

function onRoomChange(r) {
  if (r !== room) return;
  if (r.state) {
    if (ctrl !== r) enterGame(r);
    else view.renderTop();
    return;
  }
  if (ctrl === r) {
    // game state disappeared (room reset) — back to the lobby
    if (driver) driver.stop();
    view.detach();
    ctrl = null;
  }
  if (!r.meta) {
    toast('Camera nu mai există.', { type: 'error' });
    r.stop();
    room = null;
    setRoomUrl(null);
    store.set('lastRoom', null);
    show('online');
    return;
  }
  if (r.meta.status === 'lobby' && !r.mySeat() && r.seats.length && document.body.dataset.screen === 'room') {
    toast('Ai fost scos din cameră.', { type: 'error' });
    r.stop();
    room = null;
    setRoomUrl(null);
    store.set('lastRoom', null);
    show('online');
    return;
  }
  renderRoom(r);
  if (document.body.dataset.screen !== 'room') show('room');
}

function renderRoom(r) {
  const host = r.isHost();
  $('#room-code').textContent = r.code;
  const used = new Set(r.seats.map((s) => s.token));
  $('#room-seats').innerHTML = r.seats.map((s, i) => {
    const online = s.bot || !!r.presence[s.cid];
    const me = s.cid === r.cid;
    return `<li class="seat ${online ? '' : 'is-off'}" style="--pc:${esc(s.color)}">
      ${me ? `<button type="button" class="tok-btn" data-room-token aria-label="Schimbă jetonul">${esc(s.token)}</button>` : `<span class="tok-btn">${esc(s.token)}</span>`}
      <span class="seat-name">${esc(s.name)}${me ? ' <small>(tu)</small>' : ''}${i === 0 ? ' <small class="pill">gazdă</small>' : ''}${s.bot ? ' <small class="pill">bot</small>' : ''}</span>
      <span class="dot ${online ? 'on' : ''}" title="${online ? 'conectat' : 'deconectat'}"></span>
      ${host && !me ? `<button type="button" class="icon-btn" data-room-kick="${esc(s.cid)}" aria-label="Scoate">✕</button>` : '<span class="icon-btn ghost"></span>'}
    </li>`;
  }).join('') + (r.seats.length < MAX_PLAYERS ? `<li class="seat seat-empty">${r.seats.length < 2 ? 'Așteptăm încă un jucător…' : 'Mai e loc'}</li>` : '');
  void used;
  const st = { ...defaultSettings(), ...((r.meta && r.meta.settings) || {}) };
  $('#room-settings').innerHTML = settingsHtml(st, host);
  $('#room-addbot').hidden = !host;
  $('#room-addbot').disabled = r.seats.length >= MAX_PLAYERS;
  $('#room-start').hidden = !host;
  $('#room-start').disabled = r.seats.length < 2;
  $('#room-wait').hidden = host;
  $('#room-conn').hidden = r.connected;
}

async function onRoomClick(e) {
  const t = e.target.closest('button');
  if (!t || !room) return;
  const r = room;
  try {
    if (t.id === 'room-share') shareRoom();
    else if (t.id === 'room-addbot') await r.addBot();
    else if (t.id === 'room-start') { t.disabled = true; await r.startGame(); }
    else if (t.id === 'room-leave') {
      await r.leave();
      room = null;
      if (offLobby) offLobby();
      offLobby = null;
      setRoomUrl(null);
      renderHome();
      show('home');
    } else if (t.dataset.roomKick) await r.kick(t.dataset.roomKick);
    else if (t.dataset.roomToken != null) {
      const me = r.mySeat();
      const taken = new Set(r.seats.filter((s) => s.cid !== r.cid).map((s) => s.token));
      const start = TOKENS.indexOf(me.token);
      for (let k = 1; k <= TOKENS.length; k++) {
        const cand = TOKENS[(start + k) % TOKENS.length];
        if (!taken.has(cand)) { store.set('token', cand); await r.setToken(cand); break; }
      }
    } else if (t.dataset.set && r.isHost()) {
      const v = t.dataset.v === 'true' ? true : t.dataset.v === 'false' ? false : Number(t.dataset.v);
      await r.setSettings({ [t.dataset.set]: v });
    }
  } catch (err) {
    toast(esc(err.message), { type: 'error' });
    renderRoom(r);
  }
}

/* -------------------------------- boot -------------------------------- */

function bind() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    const where = go.dataset.go;
    if (where === 'home') { renderHome(); show('home'); }
    if (where === 'local') openLocalSetup();
    if (where === 'online') { if (requireName()) { setOnlineMsg(''); show('online'); } }
    if (where === 'rules') openRules();
    if (where === 'resume-local') { const g = LocalGame.load(); if (g) enterGame(g); else renderHome(); }
    if (where === 'resume-online') {
      const last = store.get('lastRoom', null);
      if (last && requireName()) { show('online'); joinOnline(last.code); }
    }
    if (where === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('#home-install').hidden = true; }
  });
  $('#home-name').addEventListener('change', (e) => store.set('name', e.target.value.trim().slice(0, 16)));
  $('#screen-local').addEventListener('click', onSetupClick);
  $('#screen-local').addEventListener('input', (e) => {
    const i = e.target.dataset.seatName;
    if (i != null) { setup.seats[Number(i)].name = e.target.value.slice(0, 16); store.set('localSetup', setup); }
  });
  $('#local-add').addEventListener('click', addLocalSeat);
  $('#local-start').addEventListener('click', startLocal);
  $('#online-create').addEventListener('click', createOnline);
  $('#join-form').addEventListener('submit', (e) => { e.preventDefault(); joinOnline(); });
  $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  $('#screen-room').addEventListener('click', onRoomClick);
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#home-install').hidden = false;
});

function boot() {
  bind();
  renderHome();
  const code = new URLSearchParams(location.search).get('r');
  if (code) {
    $('#join-code').value = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (myName()) { show('online'); joinOnline(code); } else {
      show('home');
      toast('Scrie-ți numele, apoi apasă „Joacă online” ca să intri în cameră.', { ms: 5000 });
    }
  } else show('home');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}

boot();
void closeSheet;
void money;
