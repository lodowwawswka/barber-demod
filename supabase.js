// Publishable key: intended for browsers. Database permissions remain enforced by RLS.
export const SUPABASE_URL = 'https://lchzbsbzbhuldtdzeuda.supabase.co';
export const PUBLISHABLE_KEY = 'sb_publishable_tkF1D9K8URcJy86foRuH_Q_-7w7vWmB';

export async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
  } catch {
    const error = new Error('Nie udało się uzyskać odpowiedzi. Sprawdź połączenie z internetem.');
    error.network = true;
    throw error;
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || 'Nie udało się wykonać operacji.');
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

export const rpc = (name, body, token) => request('/rest/v1/rpc/' + name, { method: 'POST', body, token });
export const formatTime = value => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
export const formatDate = value => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function warsawDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
// Convert salon wall time rather than the visitor's computer timezone.
export function warsawInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Wybierz datę i godzinę.');
  const target = Date.parse(value + ':00Z');
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function wall(ms) {
    const parts = formatter.formatToParts(new Date(ms));
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  }
  for (let i = 0; i < 4; i++) candidate += target - Date.parse(wall(candidate) + 'Z');
  if (wall(candidate).slice(0, 16) !== value) throw new Error('Ta godzina nie istnieje ze względu na zmianę czasu. Wybierz inną.');
  return new Date(candidate).toISOString();
}
