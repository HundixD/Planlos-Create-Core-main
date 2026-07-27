'use strict';

const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#loginForm');
const configForm = document.querySelector('#configForm');
const keyInput = document.querySelector('#panelKey');
const errorText = document.querySelector('#error');
const connection = document.querySelector('#connection');
const statusBox = document.querySelector('.status');
let panelKey = localStorage.getItem('planlos-panel-key') || '';
let overviewData = null;

const formatDate = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '–';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-panel-key': panelKey, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Anfrage fehlgeschlagen.');
  return body;
}

function renderOverview(data) {
  overviewData = data;
  document.querySelector('#version').textContent = `v${data.version}`;
  document.querySelector('#systemVersion').textContent = `v${data.version}`;
  document.querySelector('#openTickets').textContent = data.tickets.open;
  document.querySelector('#closedTickets').textContent = data.tickets.closed;
  document.querySelector('#ticketTotal').textContent = `${data.tickets.total} insgesamt`;
  document.querySelector('#pendingWhitelist').textContent = data.whitelist.pending;
  document.querySelector('#activeProjects').textContent = data.projects.active;
  document.querySelector('#projectTotal').textContent = `${data.projects.total} insgesamt`;
  document.querySelector('#updatedAt').textContent = formatDate(data.updatedAt);

  document.querySelector('#ticketRows').innerHTML = data.tickets.items.slice(0, 12).map(ticket => `
    <tr><td><span class="badge ${ticket.status === 'closed' ? 'closed' : ''}">${ticket.status === 'closed' ? 'Archiviert' : 'Offen'}</span></td><td>${escapeHtml(ticket.type || 'Unbekannt')}</td><td><code>${escapeHtml(ticket.id)}</code></td><td>${formatDate(ticket.createdAt)}</td></tr>
  `).join('') || '<tr><td colspan="4">Noch keine Tickets vorhanden.</td></tr>';

  document.querySelector('#allTicketRows').innerHTML = data.tickets.items.map(ticket => `
    <tr><td><span class="badge ${ticket.status === 'closed' ? 'closed' : ''}">${ticket.status === 'closed' ? 'Archiviert' : 'Offen'}</span></td><td>${escapeHtml(ticket.type || 'Unbekannt')}</td><td><code>${escapeHtml(ticket.userId || '–')}</code></td><td><code>${escapeHtml(ticket.claimedBy || '–')}</code></td><td>${formatDate(ticket.createdAt)}</td></tr>
  `).join('') || '<tr><td colspan="5">Noch keine Tickets vorhanden.</td></tr>';
}

function fillSelect(select, items, selected) {
  select.innerHTML = '<option value="">Nicht eingerichtet</option>' + items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  select.value = selected || '';
}

async function loadConfiguration() {
  const [settings, options] = await Promise.all([api('/panel-api/config'), api('/panel-api/options')]);
  for (const element of configForm.elements) {
    if (!element.name) continue;
    if (element.tagName === 'SELECT') fillSelect(element, options[element.dataset.source] || [], settings[element.name]);
    else element.value = settings[element.name] || (element.type === 'color' ? '#2f81f7' : '');
  }
}

async function connect() {
  errorText.textContent = '';
  const data = await api('/panel-api/overview');
  localStorage.setItem('planlos-panel-key', panelKey);
  renderOverview(data);
  await loadConfiguration();
  login.hidden = true;
  dashboard.hidden = false;
  connection.textContent = 'Verbunden';
  statusBox.classList.add('connected');
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  panelKey = keyInput.value.trim();
  try { await connect(); } catch (error) { errorText.textContent = error.message; }
});

document.querySelector('#refresh').addEventListener('click', async () => {
  try { renderOverview(await api('/panel-api/overview')); } catch (error) { errorText.textContent = error.message; }
});

document.querySelector('#logout').addEventListener('click', () => {
  localStorage.removeItem('planlos-panel-key');
  panelKey = '';
  dashboard.hidden = true;
  login.hidden = false;
  keyInput.value = '';
  connection.textContent = 'Nicht verbunden';
  statusBox.classList.remove('connected');
});

configForm.addEventListener('submit', async event => {
  event.preventDefault();
  const saveStatus = document.querySelector('#saveStatus');
  const payload = Object.fromEntries(new FormData(configForm).entries());
  saveStatus.textContent = 'Speichert …';
  try {
    const result = await api('/panel-api/config', { method: 'PUT', body: JSON.stringify(payload) });
    saveStatus.textContent = result.message;
  } catch (error) {
    saveStatus.textContent = `Fehler: ${error.message}`;
  }
});

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  button.classList.add('active');
  const page = button.dataset.view;
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelector('#pageTitle').textContent = page === 'config' ? 'Bot konfigurieren' : page === 'tickets' ? 'Ticket-Verwaltung' : 'Community Dashboard';
  if (page === 'config') await loadConfiguration().catch(error => { document.querySelector('#saveStatus').textContent = error.message; });
}));

if (panelKey) {
  keyInput.value = panelKey;
  connect().catch(error => {
    localStorage.removeItem('planlos-panel-key');
    panelKey = '';
    errorText.textContent = error.message;
  });
}