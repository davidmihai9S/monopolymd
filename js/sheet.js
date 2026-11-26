// Bottom sheets (dialogs) and toasts.

import { esc } from './text.js';

let current = null;

export function closeSheet() {
  if (!current) return;
  const c = current;
  current = null;
  c.el.classList.remove('open');
  c.onClose && c.onClose();
  setTimeout(() => c.el.remove(), 220);
  if (c.prevFocus && c.prevFocus.focus) c.prevFocus.focus({ preventScroll: true });
}

/**
 * Open a sheet. `render()` returns the body HTML and is re-run by refresh().
 * Clicks on [data-act] inside call onAct(name, element, event).
 */
export function openSheet({ title, render, onAct, onClose, cls = '', key = '' }) {
  closeSheetNow();
  const root = document.getElementById('sheet-root');
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn sheet-x" data-act="close" aria-label="Închide">✕</button></header>
      <div class="sheet-body"></div>
    </div>`;
  root.appendChild(el);
  const body = el.querySelector('.sheet-body');
  const api = {
    el, body, key, onClose,
    prevFocus: document.activeElement,
    refresh() {
      const scroll = body.scrollTop;
      const html = render();
      if (html === null) { closeSheet(); return; }
      body.innerHTML = html;
      body.scrollTop = scroll;
    },
    close: closeSheet,
  };
  el.addEventListener('click', (e) => {
    if (e.target === el) { closeSheet(); return; }
    const a = e.target.closest('[data-act]');
    if (!a || !el.contains(a)) return;
    if (a.dataset.act === 'close') { closeSheet(); return; }
    onAct && onAct(a.dataset.act, a, e);
  });
  el.addEventListener('input', (e) => onAct && onAct('input', e.target, e));
  current = api;
  api.refresh();
  requestAnimationFrame(() => {
    el.classList.add('open');
    const f = el.querySelector('[autofocus]') || el.querySelector('.sheet-x');
    f && f.focus({ preventScroll: true });
  });
  return api;
}

function closeSheetNow() {
  if (!current) return;
  const c = current;
  current = null;
  c.onClose && c.onClose();
  c.el.remove();
}

export const activeSheet = () => current;

export function refreshSheet() { if (current) current.refresh(); }

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closeSheet(); });

/** Promise<boolean> confirmation dialog. */
export function confirmSheet(title, html, okLabel = 'Da', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title,
      cls: 'sheet-small',
      render: () => `<div class="confirm-body">${html}</div>
        <div class="btn-row"><button class="btn" data-act="no">Renunță</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes" autofocus>${okLabel}</button></div>`,
      onAct: (a) => {
        if (a === 'yes' || a === 'no') { done = true; resolve(a === 'yes'); closeSheet(); }
      },
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function toast(html, { type = 'info', ms = 3200, action = null } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.innerHTML = `<span>${html}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('.toast-btn').addEventListener('click', () => { action.fn(); t.remove(); });
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}
