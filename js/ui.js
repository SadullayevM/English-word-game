// =============================================================
// ui.js — Ekran uchun umumiy yordamchilar: oynachalar (dialog),
// qisqa xabar (toast), sana formati, belgilar (ikonkalar).
// =============================================================

// Matndagi maxsus HTML belgilarini xavfsiz ko'rinishga o'tkazadi
// (foydalanuvchi yozgan matn sahifani buzmasligi uchun)
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ISO sanani "01.11.2026" ko'rinishiga keltiradi
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

// ISO vaqtni "01.11.2026 14:05" ko'rinishiga keltiradi
export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${min}`;
}

// Fayl nomi uchun sana: "2026-11-01"
export function dateStamp(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// Oddiy SVG belgilar (tashqi kutubxonasiz)
const svg = (path) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const icons = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  play: svg('<path d="M7 4l13 8-13 8V4z"/>'),
  check: svg('<path d="M20 6L9 17l-5-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  download: svg('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  upload: svg('<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  cloud: svg('<path d="M18 10h-1.3A6 6 0 1 0 7 17h11a4 4 0 0 0 0-8z"/>'),
  cloudOff: svg('<path d="M2 2l20 20"/><path d="M5.8 7.6A6 6 0 0 0 7 17h10"/><path d="M21 15.5A4 4 0 0 0 18 10h-1.3a6 6 0 0 0-7.4-4.3"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>')
};

// Ekran ustida "kuting" belgisini (aylanuvchi doira va matn) ko'rsatadi.
// Qaytaradi: belgini yopadigan funksiya.
export function showLoading(text = 'Kuting...') {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="loading-box">
      <span class="spinner" aria-hidden="true"></span>
      <span>${escapeHtml(text)}</span>
    </div>`;
  document.body.appendChild(overlay);
  return () => overlay.remove();
}

// Universal oynacha (dialog) ko'rsatadi.
// options: {
//   title, message,
//   fields: [{ name, label, value, placeholder, lang }]  — kiritish maydonlari (ixtiyoriy),
//   buttons: [{ label, value, variant: 'primary'|'secondary'|'danger', submit: true, requireFields: true }]
// }
// Natija: { action: bosilgan tugma qiymati, values: { maydon nomi: matn } }
// Oynacha yopib yuborilsa (Esc yoki "orqaga") — null.
export function showDialog({ title = '', message = '', fields = [], buttons = [] } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';

    const fieldsHtml = fields.map((field, i) => `
      <label class="field">
        <span class="field-label">${escapeHtml(field.label || '')}</span>
        <input class="input" name="${escapeHtml(field.name)}"
          value="${escapeHtml(field.value || '')}"
          placeholder="${escapeHtml(field.placeholder || '')}"
          ${field.lang ? `lang="${escapeHtml(field.lang)}"` : ''}
          autocomplete="off" autocapitalize="none" ${i === 0 ? 'autofocus' : ''}>
      </label>`).join('');

    const buttonsHtml = buttons.map((button, i) => `
      <button type="button" class="btn btn-${button.variant || 'secondary'}" data-index="${i}">
        ${escapeHtml(button.label)}
      </button>`).join('');

    dialog.innerHTML = `
      <form class="modal-body" novalidate>
        ${title ? `<h2 class="modal-title">${escapeHtml(title)}</h2>` : ''}
        ${message ? `<p class="modal-message">${escapeHtml(message)}</p>` : ''}
        ${fieldsHtml}
        <p class="form-error" hidden></p>
        <div class="modal-actions">${buttonsHtml}</div>
      </form>`;

    const form = dialog.querySelector('form');
    const errorBox = dialog.querySelector('.form-error');
    let finished = false;

    // Oynachani yopib, natijani qaytaradi
    const finish = (result) => {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    // Tugma bosilganda: kerak bo'lsa maydonlar to'ldirilganini tekshiradi
    const handleButton = (button) => {
      const values = {};
      fields.forEach((field) => {
        values[field.name] = form.elements[field.name].value;
      });
      if (button.requireFields) {
        const empty = fields.find((field) => values[field.name].trim() === '');
        if (empty) {
          errorBox.textContent = "Iltimos, barcha maydonlarni to'ldiring.";
          errorBox.hidden = false;
          form.elements[empty.name].focus();
          return;
        }
      }
      finish({ action: button.value, values });
    };

    dialog.querySelectorAll('[data-index]').forEach((el) => {
      el.addEventListener('click', () => handleButton(buttons[Number(el.dataset.index)]));
    });

    // Maydonda Enter bosilsa — asosiy (submit) tugma bosilgandek ishlaydi
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submitButton = buttons.find((b) => b.submit);
      if (submitButton) handleButton(submitButton);
    });

    // Esc yoki telefonning "orqaga" tugmasi
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

// "Ha / Yo'q" so'rovchi oynacha. Natija: true yoki false
export async function confirmDialog(message, { title = '', okLabel = 'Ha', cancelLabel = "Yo'q", danger = false } = {}) {
  const result = await showDialog({
    title,
    message,
    buttons: [
      { label: cancelLabel, value: false, variant: 'secondary' },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary', submit: true }
    ]
  });
  return Boolean(result && result.action);
}

// Faqat xabar ko'rsatadigan oynacha ("Tushunarli" tugmasi bilan)
export async function alertDialog(message, title = '') {
  await showDialog({
    title,
    message,
    buttons: [{ label: 'Tushunarli', value: true, variant: 'primary', submit: true }]
  });
}

// Bitta matn so'raydigan oynacha. Natija: kiritilgan matn yoki null
export async function promptDialog({ title = '', label = '', value = '', placeholder = '', okLabel = 'Saqlash' } = {}) {
  const result = await showDialog({
    title,
    fields: [{ name: 'text', label, value, placeholder }],
    buttons: [
      { label: 'Bekor qilish', value: false, variant: 'secondary' },
      { label: okLabel, value: true, variant: 'primary', submit: true, requireFields: true }
    ]
  });
  if (!result || !result.action) return null;
  return result.values.text.trim();
}

// Ekranning pastida qisqa xabar ko'rsatadi
let toastTimer = null;
export function toast(message) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  box.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove('is-visible');
    setTimeout(() => { box.hidden = true; }, 250);
  }, 2200);
}
