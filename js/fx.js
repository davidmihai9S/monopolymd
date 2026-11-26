// Tiny synthesized sound effects (no audio files), haptics and confetti.

const store = {
  get(k, d) { try { const v = localStorage.getItem('capitala.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('capitala.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export { store };

let ctx = null;
let enabled = store.get('sound', true);

export const soundOn = () => enabled;
export function setSound(on) { enabled = !!on; store.set('sound', enabled); }

function ac() {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

// Browsers only allow audio after a user gesture.
if (typeof window !== 'undefined') {
  const unlock = () => { if (enabled) ac(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
}

function tone(freq, dur, type = 'sine', vol = 0.1, when = 0, slide = 0) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, vol, when = 0, freq = 2000) {
  const c = ac(); if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  dice() { for (let i = 0; i < 6; i++) noise(0.05, 0.35, i * 0.07 + Math.random() * 0.03, 1400 + Math.random() * 1600); },
  hop() { tone(500 + Math.random() * 80, 0.05, 'triangle', 0.05); },
  coin() { tone(988, 0.07, 'square', 0.035); tone(1319, 0.18, 'square', 0.035, 0.07); },
  pay() { tone(392, 0.1, 'triangle', 0.08); tone(294, 0.18, 'triangle', 0.08, 0.09); },
  card() { noise(0.22, 0.25, 0, 3200); tone(660, 0.08, 'sine', 0.04, 0.12); },
  turn() { tone(660, 0.12, 'sine', 0.09); tone(880, 0.22, 'sine', 0.09, 0.11); },
  error() { tone(150, 0.2, 'sawtooth', 0.04); },
  build() { tone(740, 0.06, 'triangle', 0.07); tone(988, 0.1, 'triangle', 0.07, 0.06); },
  jail() { tone(330, 0.12, 'square', 0.04); tone(247, 0.28, 'square', 0.04, 0.12); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.11)); },
  pop() { tone(880, 0.05, 'sine', 0.05, 0, 1320); },
};

export function buzz(ms = 30) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ }
}

export function confetti(container = document.body, count = 90) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f43f5e', '#0ea5e9', '#eab308', '#22c55e', '#a855f7', '#f97316', '#ffffff'];
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < count; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.animationDuration = 2.2 + Math.random() * 1.6 + 's';
    c.style.setProperty('--dx', (Math.random() * 2 - 1) * 120 + 'px');
    c.style.setProperty('--r', Math.random() * 720 - 360 + 'deg');
    box.appendChild(c);
  }
  container.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}
