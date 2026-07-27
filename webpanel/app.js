'use strict';

const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const form = document.querySelector('#loginForm');
const keyInput = document.querySelector('#panelKey');
const errorText = document.querySelector('#error');
const connection = document.querySelector('#connection');
const statusBox = document.querySelector('.status');

function formatDate(value) {
  if (!value) return '–';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function render(data) {
  document.querySelector('#version').textContent = `v${data.version}`;
  document.querySelector('#systemVersion').textContent = `v${data.version}`;
  document.querySelector('#openTickets').textContent = data.tickets.open;
  document.querySelector('#closedTickets').textContent = data.tickets.closed;
  document.querySelector('#ticketTotal').textContent = `${data.tickets.total} insgesamt`;
  document.querySelector('#pendingWhitelist').textContent = data.whitelist.pending;
  document.querySelector('#activeProjects').textContent = data.projects.active;
  document.querySelector('#projectTotal').textContent = `${data.projects.total} insgesamt`;
  document.querySelector('#updatedAt').textContent = formatDate(data.updatedAt);

  const rows = document.querySelector('#ticketRows');
  rows.innerHTML = data.tickets.items.length
    ? data.tickets.items.map(ticket => `<tr><td><span class="badge ${ticket.status === 'closed' ? 'closed' : ''}">${ticket.status === 'closed' ? 'Archiviert' : 'Offen'}</span></td><td>${ticket.type || 'Unbekannt'}</td><td><code>${ticket.id}</code></td><td>${formatDate(ticket.createdAt)}</td></tr>`).join('')
    : '<tr><td colspan="4">Noch keine Tickets vorhanden.</td></tr>';
}

async function loadDashboard(key) {
  errorText.textContent = '';
  const response = await fetch(`/panel-api/overview?key=${encodeURIComponent(key)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Verbindung zum Panel fehlgeschlagen.');
  localStorage.setItem('planlos-panel-key', key);
  render(body);
  login.hidden = true;
  dashboard.hidden = false;
  connection.textContent = 'Verbunden';
  statusBox.classList.add('connected');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await loadDashboard(keyInput.value.trim());
  } catch (error) {
    errorText.textContent = error.message;
  }
});

document.querySelector('#refresh').addEventListener('click', async () => {
  try {
    await loadDashboard(localStorage.getItem('planlos-panel-key') || '');
  } catch (error) {
    errorText.textContent = error.message;
  }
});

document.querySelector('#logout').addEventListener('click', () => {
  localStorage.removeItem('planlos-panel-key');
  dashboard.hidden = true;
  login.hidden = false;
  keyInput.value = '';
  connection.textContent = 'Nicht verbunden';
  statusBox.classList.remove('connected');
});

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
}));

const storedKey = localStorage.getItem('planlos-panel-key');
if (storedKey) {
  keyInput.value = storedKey;
  loadDashboard(storedKey).catch(error => {
    localStorage.removeItem('planlos-panel-key');
    errorText.textContent = error.message;
  });
}
