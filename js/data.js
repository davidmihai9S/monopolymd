// Static game data: board, colour groups, card decks, tokens.
// Pure data — no DOM, safe to import from Node (tests) and the browser.

export const START_CASH = 1500;
export const GO_SALARY = 200;
export const JAIL_TILE = 10;
export const JAIL_FINE = 50;
export const MAX_PLAYERS = 6;
export const MIN_BID = 10;

// Colour groups, cheapest to most expensive. Colours run around the
// colour wheel so the board reads as one gradient ring.
export const GROUPS = [
  { id: 0, color: '#8b5cf6', tiles: [1, 3], house: 50 },
  { id: 1, color: '#3b82f6', tiles: [6, 8, 9], house: 50 },
  { id: 2, color: '#06b6d4', tiles: [11, 13, 14], house: 100 },
  { id: 3, color: '#10b981', tiles: [16, 18, 19], house: 100 },
  { id: 4, color: '#84cc16', tiles: [21, 23, 24], house: 150 },
  { id: 5, color: '#facc15', tiles: [26, 27, 29], house: 150 },
  { id: 6, color: '#f97316', tiles: [31, 32, 34], house: 200 },
  { id: 7, color: '#f43f5e', tiles: [37, 39], house: 200 },
];

const P = (name, short, group, price, rent) => ({ type: 'prop', name, short, group, price, rent });
const STATION = (name, short) => ({ type: 'station', name, short, price: 200, rent: [25, 50, 100, 200], icon: '🚆' });

// 40 tiles, index = position on the board (0 = Pornire, counter-clockwise).
export const BOARD = [
  { type: 'start', name: 'Pornire', short: 'Pornire', icon: '➜' },
  P('Rahova', 'Rahova', 0, 60, [2, 10, 30, 90, 160, 250]),
  { type: 'assoc', name: 'Asociația', short: 'Aso\u00ADciația', icon: '🏢' },
  P('Giulești', 'Giulești', 0, 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Impozit pe venit', short: 'Impozit', amount: 200, icon: '🧾' },
  STATION('Gara Progresul', 'Pro\u00ADgresul'),
  P('Vitan', 'Vitan', 1, 100, [6, 30, 90, 270, 400, 550]),
  { type: 'chance', name: 'Șansă', short: 'Șansă', icon: '?' },
  P('Pantelimon', 'Pante\u00ADlimon', 1, 100, [6, 30, 90, 270, 400, 550]),
  P('Berceni', 'Berceni', 1, 120, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Închisoare', short: 'Închisoare', icon: '🔒' },
  P('Titan', 'Titan', 2, 140, [10, 50, 150, 450, 625, 750]),
  { type: 'utility', name: 'Uzina Electrică', short: 'Curent', price: 150, icon: '💡' },
  P('Colentina', 'Colen\u00ADtina', 2, 140, [10, 50, 150, 450, 625, 750]),
  P('Tei', 'Tei', 2, 160, [12, 60, 180, 500, 700, 900]),
  STATION('Gara Obor', 'Obor'),
  P('Bd. Timișoara', 'Timi\u00ADșoara', 3, 180, [14, 70, 200, 550, 750, 950]),
  { type: 'assoc', name: 'Asociația', short: 'Aso\u00ADciația', icon: '🏢' },
  P('Bd. Brașov', 'Brașov', 3, 180, [14, 70, 200, 550, 750, 950]),
  P('Drumul Taberei', 'Taberei', 3, 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'parking', name: 'Parcare', short: 'Parcare', icon: 'P' },
  P('Bd. Carol I', 'Carol I', 4, 220, [18, 90, 250, 700, 875, 1050]),
  { type: 'chance', name: 'Șansă', short: 'Șansă', icon: '?' },
  P('Bd. Kogălniceanu', 'Kogăl\u00ADniceanu', 4, 220, [18, 90, 250, 700, 875, 1050]),
  P('Bd. Eroilor', 'Eroilor', 4, 240, [20, 100, 300, 750, 925, 1100]),
  STATION('Gara Basarab', 'Basarab'),
  P('Bd. Titulescu', 'Titu\u00ADlescu', 5, 260, [22, 110, 330, 800, 975, 1150]),
  P('Bd. 1 Mai', '1 Mai', 5, 260, [22, 110, 330, 800, 975, 1150]),
  { type: 'utility', name: 'Uzina de Apă', short: 'Apă', price: 150, icon: '💧' },
  P('Calea Dorobanți', 'Doro\u00ADbanți', 5, 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Du-te la închisoare', short: 'La pușcărie', icon: '👮' },
  P('Piața Unirii', 'Unirii', 6, 300, [26, 130, 390, 900, 1100, 1275]),
  P('Cotroceni', 'Cotro\u00ADceni', 6, 300, [26, 130, 390, 900, 1100, 1275]),
  { type: 'assoc', name: 'Asociația', short: 'Aso\u00ADciația', icon: '🏢' },
  P('Calea Victoriei', 'Victo\u00ADriei', 6, 320, [28, 150, 450, 1000, 1200, 1400]),
  STATION('Gara de Nord', 'Nord'),
  { type: 'chance', name: 'Șansă', short: 'Șansă', icon: '?' },
  P('Bd. Magheru', 'Magheru', 7, 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Taxă de lux', short: 'Lux', amount: 100, icon: '💎' },
  P('Bd. Primăverii', 'Primă\u00ADverii', 7, 400, [50, 200, 600, 1400, 1700, 2000]),
];

export const STATIONS = [5, 15, 25, 35];
export const UTILITIES = [12, 28];
export const BUYABLE = new Set(['prop', 'station', 'utility']);

// Card effects are data so the engine can apply them deterministically.
//   go: advance to tile (salary if passing Pornire)   back: move back n
//   cash: +/- money with the bank                      jail / free (keep card)
//   repairs: pay per house / hotel                     payEach / collectEach
//   station: nearest station, double rent
export const DECKS = {
  chance: {
    name: 'Șansă',
    icon: '?',
    cards: [
      { text: 'Ai prins metroul la fix. Mergi la Pornire și încasezi 200 RON.', fx: { k: 'go', to: 0 } },
      { text: 'Ai o întâlnire de afaceri pe Calea Victoriei. Mergi acolo.', fx: { k: 'go', to: 34 } },
      { text: 'Plimbare de seară pe Bd. Magheru. Mergi acolo.', fx: { k: 'go', to: 37 } },
      { text: 'Pleci în concediu cu trenul. Mergi la Gara de Nord.', fx: { k: 'go', to: 35 } },
      { text: 'Ești invitat la o nuntă în Titan. Mergi acolo.', fx: { k: 'go', to: 11 } },
      { text: 'Ai pierdut ultimul autobuz. Mergi la cea mai apropiată gară. Dacă are proprietar, plătești chirie dublă.', fx: { k: 'station' } },
      { text: 'Te-ai rătăcit printre blocuri. Mergi înapoi 3 spații.', fx: { k: 'back', n: 3 } },
      { text: 'Controlorii te-au prins fără bilet în tramvai. Plătești amendă 50 RON.', fx: { k: 'cash', a: -50 } },
      { text: 'Te-a prins radarul pe Kiseleff. Plătești amendă 30 RON.', fx: { k: 'cash', a: -30 } },
      { text: 'Ai răzuit un loz câștigător. Încasezi 150 RON.', fx: { k: 'cash', a: 150 } },
      { text: 'Prima de Crăciun a venit mai devreme. Încasezi 100 RON.', fx: { k: 'cash', a: 100 } },
      { text: 'Reparații capitale la bloc: plătești 25 RON pentru fiecare casă și 100 RON pentru fiecare hotel.', fx: { k: 'repairs', h: 25, H: 100 } },
      { text: 'Ai parcat pe trotuar a treia oară săptămâna asta. Mergi direct la închisoare.', fx: { k: 'jail' } },
      { text: 'Ai pile la poliție. Ieși gratis din închisoare când ai nevoie. Păstrează cartonașul.', fx: { k: 'free' } },
      { text: 'Ai fost ales administrator de bloc. Plătești fiecărui jucător câte 50 RON.', fx: { k: 'payEach', a: 50 } },
      { text: 'Ți-ai vândut vinilurile vechi în Obor. Încasezi 50 RON.', fx: { k: 'cash', a: 50 } },
    ],
  },
  assoc: {
    name: 'Asociația',
    icon: '🏢',
    cards: [
      { text: 'Administratorul a greșit calculul la întreținere în favoarea ta. Încasezi 200 RON.', fx: { k: 'cash', a: 200 } },
      { text: 'A venit factura la căldură. Plătești 100 RON.', fx: { k: 'cash', a: -100 } },
      { text: 'Vecinul de sus ți-a inundat baia. Primești 100 RON despăgubire.', fx: { k: 'cash', a: 100 } },
      { text: 'E ziua ta onomastică! Fiecare jucător îți dă câte 20 RON.', fx: { k: 'collectEach', a: 20 } },
      { text: 'Ai uitat de impozitul pe clădire. Plătești 50 RON.', fx: { k: 'cash', a: -50 } },
      { text: 'Liftul e iar stricat, așa că o iei pe scări. Mergi la Pornire și încasezi 200 RON.', fx: { k: 'go', to: 0 } },
      { text: 'Cumnatul tău e polițist. Ieși gratis din închisoare când ai nevoie. Păstrează cartonașul.', fx: { k: 'free' } },
      { text: 'Ai făcut grătar pe balcon și vecinii au sunat la poliție. Mergi direct la închisoare.', fx: { k: 'jail' } },
      { text: 'Ai închiriat camera liberă unor turiști. Încasezi 100 RON.', fx: { k: 'cash', a: 100 } },
      { text: 'Moștenire de la o mătușă din Ploiești. Încasezi 100 RON.', fx: { k: 'cash', a: 100 } },
      { text: 'Analize la clinica privată. Plătești 50 RON.', fx: { k: 'cash', a: -50 } },
      { text: 'Ai primit dividende de la acțiunile tale. Încasezi 50 RON.', fx: { k: 'cash', a: 50 } },
      { text: 'Asociația renovează fațada: plătești 40 RON pentru fiecare casă și 115 RON pentru fiecare hotel.', fx: { k: 'repairs', h: 40, H: 115 } },
      { text: 'Ai vândut vecinilor murături din cămară. Încasezi 25 RON.', fx: { k: 'cash', a: 25 } },
      { text: 'Ai găsit 10 lei uitați în geaca de iarnă.', fx: { k: 'cash', a: 10 } },
      { text: 'Balconul tău cu mușcate a câștigat concursul asociației. Încasezi 30 RON.', fx: { k: 'cash', a: 30 } },
    ],
  },
};

export const TOKENS = ['🚋', '🥨', '🚕', '🛴', '☕', '🎸', '🦉', '🍉'];
export const PLAYER_COLORS = ['#f43f5e', '#0ea5e9', '#eab308', '#22c55e', '#a855f7', '#f97316'];
export const BOT_NAMES = ['Gigel', 'Mitică', 'Tanti Lenuța', 'Nea Costel', 'Dorel', 'Coana Mița', 'Vasilică', 'Florica'];

export const houseCost = (tile) => GROUPS[BOARD[tile].group].house;
export const mortgageValue = (tile) => BOARD[tile].price / 2;
export const unmortgageCost = (tile) => Math.ceil((BOARD[tile].price / 2) * 1.1);
export const freeCardId = (deck) => DECKS[deck].cards.findIndex((c) => c.fx.k === 'free');
