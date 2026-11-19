import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const updated = document.querySelector('#updated');

const rows = new Map(); // incident id -> <li>
const acked = new Set(); // incident ids acked from this board

// R5: viewer's local zone and locale order (en-GB/de/fr… give dd/mm, en-US gives mm/dd).
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});
const localTime = (iso) => timeFmt.format(new Date(iso));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function rowFor(i) {
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'incident-row');
  li.dataset.id = i.id;
  li.className = `row ${esc(i.severity)}`;
  li.innerHTML = `
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="act"></span>`;
  setAckState(li, acked.has(i.id) ? 'acked' : 'open');
  return li;
}

function setAckState(li, state, ackedAt) {
  const act = li.querySelector('.act');
  if (state === 'acked') {
    li.classList.add('is-acked');
    act.innerHTML = `<span data-testid="acked" class="acked">✓ acked${ackedAt ? ` ${esc(localTime(ackedAt))}` : ''}</span>`;
  } else {
    li.classList.remove('is-acked');
    act.innerHTML = `<button type="button" data-testid="ack" class="ack">Ack</button>`;
    if (state === 'busy') act.querySelector('button').disabled = true;
  }
}

// R2b (product, after the 00:13 misclick): Ack asks to confirm, and the confirm names the incident id.
// The id is taken when Ack is clicked, so a row moving afterwards cannot change what gets acked.
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmText = confirmBox.querySelector('.confirm-text');
const confirmAck = confirmBox.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = confirmBox.querySelector('[data-testid="confirm-cancel"]');
let pending = null; // { li, id, summary }

function openConfirm(li) {
  const id = li.dataset.id;
  const summary = li.querySelector('.what')?.textContent ?? '';
  pending = { li, id };
  confirmText.innerHTML = `Ack <strong>${esc(id)}</strong>?<br><span class="confirm-what">${esc(summary)}</span>`;
  confirmBox.hidden = false;
  confirmCancel.focus();
}
function closeConfirm() {
  pending = null;
  confirmBox.hidden = true;
}
confirmCancel.addEventListener('click', closeConfirm);
confirmBox.addEventListener('click', (e) => e.target === confirmBox && closeConfirm());
document.addEventListener('keydown', (e) => e.key === 'Escape' && pending && closeConfirm());
confirmAck.addEventListener('click', () => {
  const { li, id } = pending;
  closeConfirm();
  sendAck(li, id);
});

list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn || btn.disabled) return;
  openConfirm(btn.closest('[data-testid="incident-row"]'));
});

async function sendAck(li, id) {
  setAckState(li, 'busy');
  try {
    const reply = await ack(id);
    acked.add(id);
    setAckState(li, 'acked', reply.ackedAt);
  } catch (err) {
    console.error(err);
    setAckState(li, 'open');
  }
}

// R1: keep existing rows (and their ack state); put new ones on top, newest first.
function render(incidents) {
  const seen = new Set();
  let prev = null;
  for (const i of incidents) {
    seen.add(i.id);
    let li = rows.get(i.id);
    if (!li) {
      li = rowFor(i);
      rows.set(i.id, li);
      li.classList.add('is-new');
      setTimeout(() => li.classList.remove('is-new'), 1500);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  for (const [id, li] of rows) {
    if (!seen.has(id)) {
      li.remove();
      rows.delete(id);
    }
  }
  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
}

async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    updated.textContent = `updated ${localTime(page.updatedAt)}`;
    updated.setAttribute('datetime', page.updatedAt);
    // R3: loader goes once the first answer is on screen.
    if (loader) loader.remove();
    board.setAttribute('aria-busy', 'false');
  } catch (err) {
    console.error(err);
    updated.textContent = 'refresh failed, retrying';
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: every 2 s while open, never overlapping
  }
}

tick();
