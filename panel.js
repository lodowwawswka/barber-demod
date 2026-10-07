import { request, rpc, formatDate, formatTime, warsawDay, warsawInstant } from './supabase.js';
const $ = id => document.getElementById(id);
const key = 'barber-owner-session';
let session = null, expiryTimer, revision = 0, loading = 0, mutating = false;
const names = { pending: 'Oczekuje', confirmed: 'Potwierdzona', cancelled: 'Anulowana', blocked: 'Blokada' };
function notice(text) { $('notice').textContent = text; }
function storeSession(value) {
  session = value; revision++;
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* memory-only session if storage unavailable */ }
  clearTimeout(expiryTimer);
  if (value) expiryTimer = setTimeout(() => { signedOut(); notice('Sesja wygasła. Zaloguj się ponownie.'); }, Math.max(0, value.expires - Date.now()));
}
function signedOut() {
  storeSession(null); $('owner-section').hidden = true; $('login-section').hidden = false;
  $('rows').replaceChildren(); $('identity').textContent = ''; $('password').value = '';
}
function token() {
  if (!session || Date.now() >= session.expires) { signedOut(); throw new Error('Sesja wygasła. Zaloguj się ponownie.'); }
  return session.token;
}
async function authorize() {
  const version = revision;
  if (!(await rpc('is_salon_owner', {}, token()))) throw new Error('To konto nie ma dostępu do panelu właściciela.');
  if (revision !== version) return;
  $('login-section').hidden = true; $('owner-section').hidden = false;
  $('identity').textContent = `Zalogowano: ${session.email}`;
  await load();
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true; notice('Logowanie…');
  try {
    const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: $('email').value.trim(), password: $('password').value } });
    $('password').value = '';
    if (!result?.access_token) throw new Error('Nie udało się zalogować.');
    // No password or refresh token is stored. Sign in again when the short-lived session expires.
    storeSession({ token: result.access_token, expires: Date.now() + result.expires_in * 1000, email: result.user.email });
    await authorize(); notice('');
  } catch (error) {
    signedOut(); notice(error.status === 400 ? 'Nieprawidłowy email lub hasło.' : error.message);
  } finally { $('login-button').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  const oldToken = session?.token; signedOut(); notice('Wylogowano.');
  if (oldToken) { try { await request('/auth/v1/logout?scope=local', { method: 'POST', token: oldToken }); } catch { /* local session already cleared */ } }
});
function cell(row, value) { const td = document.createElement('td'); td.textContent = value; row.append(td); return td; }
function action(container, text, callback, danger = false) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
  if (danger) button.className = 'danger'; button.disabled = mutating;
  button.addEventListener('click', callback); container.append(button);
}
function render(rows) {
  $('rows').replaceChildren();
  for (const booking of rows) {
    const row = document.createElement('tr');
    cell(row, `${formatDate(booking.starts_at)}\n${formatTime(booking.starts_at)} – ${formatTime(booking.ends_at)}${warsawDay(new Date(booking.starts_at)) !== warsawDay(new Date(booking.ends_at)) ? ' (' + formatDate(booking.ends_at) + ')' : ''}`).style.whiteSpace = 'pre-line';
    const isBlock = !booking.service_id;
    cell(row, isBlock ? 'Blokada terminu' : booking.service_name);
    cell(row, booking.price == null ? '—' : `${booking.price} zł`);
    cell(row, booking.customer_name || '—');
    const phoneCell = cell(row, '');
    if (booking.phone) {
      const link = document.createElement('a'); link.href = 'tel:' + booking.phone.replace(/[^+0-9]/g, ''); link.textContent = booking.phone; phoneCell.append(link);
    } else phoneCell.textContent = '—';
    const badge = document.createElement('span'); badge.className = 'badge ' + booking.status; badge.textContent = names[booking.status]; cell(row, '').append(badge);
    const actions = cell(row, ''); actions.className = 'actions';
    if (booking.status === 'pending') action(actions, 'Potwierdź', () => mutate('owner_set_status', { p_id: booking.id, p_status: 'confirmed' }, 'Wizyta potwierdzona.'));
    if (['pending', 'confirmed'].includes(booking.status)) action(actions, 'Anuluj', () => {
      if (confirm(`Anulować wizytę ${booking.customer_name}, ${formatDate(booking.starts_at)} o ${formatTime(booking.starts_at)}? Termin zostanie zwolniony.`)) mutate('owner_set_status', { p_id: booking.id, p_status: 'cancelled' }, 'Wizyta anulowana.');
    }, true);
    if (booking.status === 'blocked') action(actions, 'Odblokuj', () => mutate('owner_unblock', { p_id: booking.id }, 'Termin odblokowany.'));
    $('rows').append(row);
  }
}
async function load() {
  const id = ++loading, version = revision; $('rows').replaceChildren(); $('list-status').textContent = 'Wczytywanie…';
  try {
    const from = $('from').value, to = $('to').value;
    if (!from || !to || to < from) throw new Error('Wybierz prawidłowy zakres dat.');
    const dayAfter = new Date(to + 'T12:00:00Z'); dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const params = new URLSearchParams({ select: 'id,service_id,service_name,price,starts_at,ends_at,customer_name,phone,status', ends_at: 'gt.' + warsawInstant(from + 'T00:00'), starts_at: 'lt.' + warsawInstant(warsawDay(dayAfter) + 'T00:00'), order: 'starts_at.asc,id.asc', limit: '1000' });
    if ($('status').value) params.set('status', 'eq.' + $('status').value);
    const rows = await request('/rest/v1/bookings?' + params, { token: token() });
    if (version !== revision || id !== loading) return;
    render(rows); $('list-status').textContent = rows.length === 1000 ? 'Pokazano pierwsze 1000 wpisów. Zawęź zakres dat.' : rows.length ? `Liczba wpisów: ${rows.length}` : 'Brak rezerwacji i blokad w wybranym zakresie.';
  } catch (error) {
    if (version !== revision || id !== loading) return;
    if (error.status === 401 || error.status === 403) signedOut();
    $('list-status').textContent = 'Nie udało się wczytać listy.'; notice(error.message);
  }
}
async function mutate(name, body, success) {
  if (mutating) return false;
  const version = revision; mutating = true;
  for (const button of $('owner-section').querySelectorAll('button')) if (button.id !== 'logout') button.disabled = true;
  try {
    await rpc(name, body, token());
    if (revision !== version) return false;
    notice(success); await load(); return true;
  } catch (error) {
    if (revision !== version) return false;
    if (error.status === 401 || error.status === 403) signedOut();
    notice(error.network ? 'Nie otrzymaliśmy potwierdzenia. Odśwież listę przed ponowną próbą.' : error.message);
    await load(); return false;
  } finally {
    mutating = false;
    for (const button of $('owner-section').querySelectorAll('button')) button.disabled = false;
  }
}
$('filter-form').addEventListener('submit', event => { event.preventDefault(); load(); });
$('block-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const start = warsawInstant($('block-start').value), end = warsawInstant($('block-end').value);
    if (end <= start) throw new Error('Koniec musi być późniejszy od początku.');
    if (await mutate('owner_block', { p_start: start, p_end: end }, 'Termin zablokowany.')) $('block-form').reset();
  } catch (error) { notice(error.message); }
});
$('from').value = warsawDay();
const last = new Date(); last.setUTCDate(last.getUTCDate() + 30); $('to').value = warsawDay(last);
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (saved?.token && saved.expires > Date.now()) { storeSession(saved); authorize().catch(error => { signedOut(); notice(error.message); }); }
  else signedOut();
} catch { signedOut(); }
