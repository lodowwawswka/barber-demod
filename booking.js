import { request, rpc, formatTime, formatDate, warsawDay } from './supabase.js';

const messages = document.getElementById('messages');
const buttons = document.getElementById('buttons');
messages.setAttribute('aria-live', 'polite');
let data = {}, sending = false;

function message(text, className = 'bot') {
  const item = document.createElement('div');
  item.className = className;
  item.textContent = text;
  item.style.whiteSpace = 'pre-line';
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}
function clear() { buttons.replaceChildren(); }
function button(text, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text;
  element.addEventListener('click', action); buttons.append(element);
  return element;
}
function input(type, label, options = {}) {
  const element = document.createElement('input');
  element.type = type; element.placeholder = label; element.setAttribute('aria-label', label);
  Object.assign(element, options); buttons.append(element);
  return element;
}
async function start() {
  clear(); data = {}; sending = false;
  message('Cześć! 👋 Wybierz usługę:');
  try {
    const services = await request('/rest/v1/services?select=id,name,price,duration_minutes&order=price.asc');
    for (const service of services) button(`${service.name} — ${service.price} zł`, () => {
      data.service = service; message(`${service.name} — ${service.price} zł`, 'user'); askDate();
    });
  } catch {
    message('Nie udało się wczytać usług. Spróbuj ponownie.'); button('Spróbuj ponownie', start);
  }
}
function askDate() {
  clear(); message('📅 Wybierz dzień wizyty. Niedziela jest zamknięta.');
  const max = new Date(); max.setUTCDate(max.getUTCDate() + 89);
  const date = input('date', 'Data wizyty', { min: warsawDay(), max: warsawDay(max), required: true });
  button('Dalej', () => {
    if (!date.reportValidity()) return;
    data.date = date.value; message(date.value.split('-').reverse().join('.'), 'user'); askTime();
  });
}
async function askTime() {
  clear(); message('Sprawdzam dostępne godziny…');
  try {
    const slots = await rpc('available_slots', { p_date: data.date, p_service_id: data.service.id });
    clear();
    if (!slots.length) message('W tym dniu nie ma dostępnych godzin. Wybierz inny dzień.');
    else message('⏰ Wybierz godzinę (czas w Polsce):');
    for (const slot of slots) button(formatTime(slot.starts_at), () => {
      data.start = slot.starts_at; message(formatTime(data.start), 'user'); askName();
    });
    button('Wybierz inną datę', askDate);
  } catch {
    message('Nie udało się sprawdzić dostępności.');
    button('Sprawdź ponownie', askTime); button('Wybierz inną datę', askDate);
  }
}
function askName() {
  clear(); message('Jak masz na imię?');
  const name = input('text', 'Twoje imię', { autocomplete: 'name', minLength: 2, maxLength: 80, required: true, value: data.name || '' });
  button('Dalej', () => {
    name.value = name.value.trim();
    if (!name.reportValidity()) return;
    data.name = name.value; message(data.name, 'user'); askPhone();
  });
}
function askPhone() {
  clear(); message('📱 Podaj numer telefonu do kontaktu w sprawie wizyty.');
  const phone = input('tel', '123 456 789', { autocomplete: 'tel', maxLength: 20, required: true, value: data.phone || '' });
  button('Dalej', () => {
    const value = phone.value.trim();
    if (!/^\+?[0-9 ()-]{9,20}$/.test(value) || value.replace(/\D/g, '').length < 9) {
      phone.setCustomValidity('Podaj prawidłowy numer telefonu (co najmniej 9 cyfr).'); phone.reportValidity(); phone.setCustomValidity(''); return;
    }
    data.phone = value; message(value, 'user'); review();
  });
}
function review() {
  clear();
  message(`Sprawdź swoją rezerwację:\n✂ ${data.service.name} — ${data.service.price} zł\n📅 ${formatDate(data.start)}, ${formatTime(data.start)}\n⏳ ${data.service.duration_minutes} min\n👤 ${data.name}\n📱 ${data.phone}\nPo zapisaniu wizyta oczekuje na potwierdzenie salonu.`);
  button('Potwierdź rezerwację', save);
  button('Zmień termin', askDate); button('Zmień dane', askName);
}
async function save() {
  if (sending) return;
  sending = true;
  for (const item of buttons.querySelectorAll('button')) item.disabled = true;
  try {
    const id = await rpc('create_booking', { p_service_id: data.service.id, p_start: data.start, p_name: data.name, p_phone: data.phone });
    if (typeof id !== 'string') throw new Error('Brak potwierdzenia zapisu');
    clear();
    message(`✅ Rezerwacja została zapisana.\nStatus: oczekuje na potwierdzenie salonu.\n${data.service.name} — ${data.service.price} zł\n${formatDate(data.start)}, ${formatTime(data.start)}\nNumer rezerwacji: ${id}\nZachowaj to podsumowanie. W razie zmiany terminu skontaktuj się z salonem.`);
    button('Zarezerwuj kolejną wizytę', () => { messages.replaceChildren(); start(); });
  } catch (error) {
    clear();
    if (error.network || !error.status) {
      message('Nie otrzymaliśmy potwierdzenia zapisu. Wizyta mogła zostać zapisana — przed ponowną rezerwacją skontaktuj się z salonem i podaj wybrany termin.');
      button('Sprawdź dostępność tego dnia', askTime);
    } else if (error.code === 'P0001') {
      message(error.message); button('Wybierz dostępny termin', askTime);
    } else {
      message('Nie udało się zapisać rezerwacji. Spróbuj ponownie za chwilę.'); button('Wróć do podsumowania', review);
    }
  } finally { sending = false; }
}
start();
