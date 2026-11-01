// =============================================================
// app.js — Ilovaning asosiy qismi: ekranlarni chizadi
// (bosh sahifa, bo'lim, test), tugmalarni boshqaradi va
// ekranlar orasida o'tishni (manzil #/... orqali) boshqaradi.
// Ma'lumotlar faqat storage.js orqali, AI esa faqat ai.js orqali ishlatiladi.
// =============================================================

import * as storage from './storage.js';
import * as ai from './ai.js';
import {
  MODES, modeLabel, normalize, cleanText, parseMeanings,
  shuffle, getPrompt, getCorrectAnswer, checkAnswer
} from './quiz.js';
import {
  escapeHtml, formatDate, dateStamp, icons,
  showDialog, confirmDialog, alertDialog, promptDialog, toast, showLoading
} from './ui.js';

const app = document.getElementById('app');
const importInput = document.getElementById('import-file');

// Joriy test holati (test yo'q bo'lsa — null)
let test = null;
// Manzilni test ekraniga qaytarganda keyingi o'zgarishni e'tiborsiz qoldirish uchun
let skipNextHashChange = false;

// =============================================================
// Yo'naltirish (qaysi ekranni ko'rsatish kerakligini aniqlash)
// Manzillar: #/ — bosh sahifa, #/section/ID — bo'lim, #/test/ID — test,
// #/settings — sozlamalar
// =============================================================

// Manzildan ekran nomi va id'ni ajratib oladi
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'section' && parts[1]) return { name: 'section', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'test' && parts[1]) return { name: 'test', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

// Bo'lim va test ekranlari manzilini yasaydi
const sectionHash = (id) => `#/section/${encodeURIComponent(id)}`;
const testHash = (id) => `#/test/${encodeURIComponent(id)}`;

// Boshqa ekranga o'tadi (manzil bir xil bo'lsa — ekranni qayta chizadi)
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Manzilga mos ekranni chizadi
async function render() {
  const route = parseRoute();
  try {
    if (route.name === 'section') await renderSection(route.id);
    else if (route.name === 'test') await renderTestSetup(route.id);
    else if (route.name === 'settings') await renderSettings();
    else await renderHome();
  } catch (error) {
    console.error(error);
    renderError();
  }
  window.scrollTo(0, 0);
}

// Manzil o'zgarganda (jumladan telefonning "orqaga" tugmasida) chaqiriladi.
// Test davom etayotgan bo'lsa — chiqishdan oldin so'raydi.
async function onHashChange() {
  if (skipNextHashChange) {
    skipNextHashChange = false;
    return;
  }
  if (test && test.active) {
    const route = parseRoute();
    if (route.name === 'test' && route.id === test.sectionId) return;
    const leave = await confirmDialog(
      "Test hali tugamadi. Chiqib ketsangiz, shu bosqich natijalari ko'rsatilmaydi.",
      { title: 'Testdan chiqasizmi?', okLabel: 'Chiqish', cancelLabel: 'Davom etish', danger: true }
    );
    if (!leave) {
      skipNextHashChange = true;
      location.hash = testHash(test.sectionId);
      focusAnswer();
      return;
    }
  }
  test = null;
  render();
}

// Xatolik ekrani
function renderError() {
  app.innerHTML = `
    <header class="topbar"><h1 class="topbar-title">Xatolik</h1></header>
    <section class="content">
      <div class="card empty-state">
        <p>Nimadir noto'g'ri ketdi. Sahifani yangilab ko'ring.</p>
        <a class="btn btn-primary" href="#/">Bosh sahifaga</a>
      </div>
    </section>`;
}

// Bo'lim topilmaganda ko'rsatiladigan ekran
function renderNotFound() {
  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Orqaga">${icons.back}</a>
      <h1 class="topbar-title">Topilmadi</h1>
    </header>
    <section class="content">
      <div class="card empty-state">
        <p>Bu bo'lim topilmadi. Ehtimol, u o'chirilgan.</p>
        <a class="btn btn-primary" href="#/">Bosh sahifaga</a>
      </div>
    </section>`;
}

// =============================================================
// BOSH SAHIFA: bo'limlar ro'yxati va zaxira nusxa
// =============================================================

async function renderHome() {
  const sections = await storage.getSections();
  const counts = await Promise.all(sections.map((s) => storage.countWords(s.id)));

  const cardsHtml = sections.map((section, i) => {
    const mastered = section.masteredDates && section.masteredDates.length > 0;
    const lastMastered = mastered ? section.masteredDates[section.masteredDates.length - 1] : null;
    return `
      <li>
        <a class="card section-card" href="${sectionHash(section.id)}">
          <div class="section-card-head">
            <span class="section-name">${escapeHtml(section.name)}</span>
            ${mastered ? `<span class="badge badge-success" title="O'zlashtirilgan: ${formatDate(lastMastered)}">${icons.check} O'zlashtirilgan</span>` : ''}
          </div>
          <div class="section-meta">
            <span>${counts[i]} ta so'z</span>
            <span>${section.lastTestedAt ? 'Oxirgi test: ' + formatDate(section.lastTestedAt) : 'Hali test qilinmagan'}</span>
          </div>
        </a>
      </li>`;
  }).join('');

  app.innerHTML = `
    <header class="topbar">
      <h1 class="topbar-title">So'z yodlash</h1>
      <a class="icon-btn" href="#/settings" aria-label="Sozlamalar" title="Sozlamalar">${icons.settings}</a>
    </header>
    <section class="content">
      <button type="button" class="btn btn-primary btn-block" id="add-section">
        ${icons.plus} Yangi bo'lim
      </button>

      ${sections.length
        ? `<ul class="card-list">${cardsHtml}</ul>`
        : `<div class="card empty-state">
             <p><strong>Hali bo'lim yo'q.</strong></p>
             <p class="muted">Darslikdagi mavzu nomi bilan bo'lim yarating, masalan: "Unit 3 — Food".</p>
           </div>`}

      <div class="card backup-card">
        <h2 class="card-title">Zaxira nusxa</h2>
        <p class="muted">Ma'lumotlar faqat shu qurilmada saqlanadi. Ularni yo'qotmaslik uchun vaqti-vaqti bilan zaxira faylini yuklab oling.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="export-btn">${icons.download} Eksport</button>
          <button type="button" class="btn btn-secondary" id="import-btn">${icons.upload} Import</button>
        </div>
      </div>
    </section>`;

  document.getElementById('add-section').addEventListener('click', handleAddSection);
  document.getElementById('export-btn').addEventListener('click', handleExport);
  document.getElementById('import-btn').addEventListener('click', () => {
    importInput.value = '';
    importInput.click();
  });
}

// Yangi bo'lim yaratish
async function handleAddSection() {
  const name = await promptDialog({
    title: "Yangi bo'lim",
    label: "Bo'lim nomi",
    placeholder: 'Masalan: Unit 3 — Food',
    okLabel: 'Yaratish'
  });
  if (!name) return;
  const section = await storage.addSection(name);
  go(sectionHash(section.id));
}

// Barcha ma'lumotlarni JSON fayl qilib yuklab beradi
async function handleExport() {
  try {
    const data = await storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `soz-yodlash-zaxira-${dateStamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Zaxira fayl yuklab olindi');
  } catch (error) {
    console.error(error);
    alertDialog('Zaxira faylni yaratib bo\'lmadi.', 'Xatolik');
  }
}

// Tanlangan JSON fayldan ma'lumotlarni yuklaydi
async function handleImportFile() {
  const file = importInput.files && importInput.files[0];
  // Maydonni tozalaymiz: shunda keyingi safar xuddi shu faylni ham tanlash mumkin
  importInput.value = '';
  if (!file) return;

  // 1) Faylni o'qish va tekshirish
  let backup;
  try {
    const text = await file.text();
    backup = storage.parseBackup(JSON.parse(text));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "Fayl o'qilmadi: bu JSON fayl emas yoki u buzilgan."
      : error.message;
    await alertDialog(message, 'Import qilib bo\'lmadi');
    return;
  }

  // 2) Birlashtirish yoki almashtirishni so'rash
  const choice = await showDialog({
    title: 'Import',
    message: `Faylda ${backup.sections.length} ta bo'lim va ${backup.words.length} ta so'z bor.\n\n` +
      "Birlashtirish — hozirgi ma'lumotlar saqlanadi, fayldagi yangi bo'lim va so'zlar qo'shiladi.\n" +
      "Almashtirish — hozirgi barcha ma'lumotlar o'chiriladi va fayldagilar yoziladi.",
    buttons: [
      { label: 'Bekor qilish', value: 'cancel', variant: 'secondary' },
      { label: 'Almashtirish', value: 'replace', variant: 'danger' },
      { label: 'Birlashtirish', value: 'merge', variant: 'primary' }
    ]
  });
  if (!choice || choice.action === 'cancel') return;

  if (choice.action === 'replace') {
    const sure = await confirmDialog(
      "Hozirgi barcha bo'limlar va so'zlar butunlay o'chiriladi. Davom etasizmi?",
      { title: 'Ishonchingiz komilmi?', okLabel: 'Ha, almashtirish', cancelLabel: 'Bekor qilish', danger: true }
    );
    if (!sure) return;
  }

  // 3) Yozish
  try {
    const added = await storage.importAll(backup, choice.action);
    toast(`Yuklandi: ${added.sections} ta bo'lim, ${added.words} ta so'z`);
    go('#/');
  } catch (error) {
    console.error(error);
    alertDialog("Ma'lumotlarni yozishda xatolik yuz berdi.", 'Xatolik');
  }
}

// =============================================================
// BO'LIM EKRANI: so'z qo'shish, so'zlar ro'yxati, test boshlash
// =============================================================

async function renderSection(sectionId) {
  const section = await storage.getSection(sectionId);
  if (!section) return renderNotFound();
  const words = await storage.getWords(sectionId);

  const mastered = section.masteredDates && section.masteredDates.length > 0;
  const lastMastered = mastered ? section.masteredDates[section.masteredDates.length - 1] : null;

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Orqaga">${icons.back}</a>
      <h1 class="topbar-title">${escapeHtml(section.name)}</h1>
      <button type="button" class="icon-btn" id="rename-section" aria-label="Nomini o'zgartirish" title="Nomini o'zgartirish">${icons.edit}</button>
      <button type="button" class="icon-btn icon-btn-danger" id="delete-section" aria-label="Bo'limni o'chirish" title="Bo'limni o'chirish">${icons.trash}</button>
    </header>
    <section class="content">
      <div class="section-summary">
        ${mastered ? `<span class="badge badge-success">${icons.check} O'zlashtirilgan: ${formatDate(lastMastered)}</span>` : ''}
        <span class="muted">${section.lastTestedAt ? 'Oxirgi test: ' + formatDate(section.lastTestedAt) : 'Hali test qilinmagan'}</span>
      </div>

      <button type="button" class="btn btn-primary btn-block" id="start-test">${icons.play} Testni boshlash</button>

      <form class="card" id="add-form" novalidate autocomplete="off">
        <h2 class="card-title">So'z qo'shish</h2>
        <label class="field">
          <span class="field-label">Inglizcha so'z yoki ibora</span>
          <input class="input" id="english-input" lang="en" placeholder="play"
            autocomplete="off" autocapitalize="none" enterkeyhint="next">
        </label>
        <label class="field">
          <span class="field-label">O'zbekcha ma'nolari (vergul bilan ajrating)</span>
          <input class="input" id="meanings-input" lang="uz" placeholder="o'ynamoq, chalmoq"
            autocomplete="off" autocapitalize="none" enterkeyhint="done">
        </label>
        <p class="form-error" id="add-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Saqlash</button>
      </form>

      <h2 class="list-title">So'zlar (<span id="word-count">${words.length}</span>)</h2>
      <ul class="word-list" id="word-list"></ul>
    </section>`;

  renderWordList(words);

  const form = document.getElementById('add-form');
  const englishInput = document.getElementById('english-input');
  const meaningsInput = document.getElementById('meanings-input');
  const errorBox = document.getElementById('add-error');

  // Inglizcha maydonda Enter bosilsa — ma'nolar maydoniga o'tadi
  englishInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      meaningsInput.focus();
    }
  });

  // Yozishni boshlaganda xato xabarini yashiradi
  [englishInput, meaningsInput].forEach((input) => {
    input.addEventListener('input', () => { errorBox.hidden = true; });
  });

  // So'zni saqlash (AI tekshiruvi ketayotganda qayta bosilishining oldini olamiz)
  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    try {
      await saveNewWord();
    } finally {
      saving = false;
    }
  });

  // Yangi so'zni tekshirib saqlaydi
  async function saveNewWord() {
    let english = cleanText(englishInput.value);
    const meanings = parseMeanings(meaningsInput.value);

    if (!english || meanings.length === 0) {
      errorBox.textContent = !english
        ? "Inglizcha so'zni yozing."
        : "Kamida bitta o'zbekcha ma'noni yozing.";
      errorBox.hidden = false;
      (!english ? englishInput : meaningsInput).focus();
      return;
    }

    // AI imloni tekshiradi (foydalanuvchi tasdiqlamasa, so'z o'zgarmaydi)
    const spelling = await reviewSpelling(english, meanings);
    if (!spelling) {
      englishInput.focus();
      return;
    }
    english = spelling.english;

    const currentWords = await storage.getWords(sectionId);
    if (!(await confirmIfDuplicate(currentWords, english))) {
      englishInput.value = english;
      englishInput.focus();
      return;
    }

    await storage.addWord(sectionId, english, meanings);

    // Tez kiritish uchun: maydonlarni tozalab, inglizcha maydonga qaytamiz
    englishInput.value = '';
    meaningsInput.value = '';
    englishInput.focus();
    renderWordList(await storage.getWords(sectionId));
    toast(spelling.notice ? `Saqlandi. ${spelling.notice}` : 'Saqlandi');
  }

  // So'zlar ro'yxatidagi tahrirlash va o'chirish tugmalari
  document.getElementById('word-list').addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');
    if (editButton) await handleEditWord(sectionId, editButton.dataset.edit);
    if (deleteButton) await handleDeleteWord(sectionId, deleteButton.dataset.delete);
  });

  document.getElementById('rename-section').addEventListener('click', () => handleRenameSection(section));
  document.getElementById('delete-section').addEventListener('click', () => handleDeleteSection(section));

  // Testni boshlash (bo'sh bo'limda — tushuntirish xabari)
  document.getElementById('start-test').addEventListener('click', async () => {
    const count = await storage.countWords(sectionId);
    if (count === 0) {
      await alertDialog("Bu bo'limda hali so'z yo'q. Test boshlash uchun avval kamida bitta so'z qo'shing.", "Bo'lim bo'sh");
      englishInput.focus();
      return;
    }
    go(testHash(sectionId));
  });
}

// So'zlar ro'yxatini chizadi (eng oxirgi qo'shilgan so'z — eng tepada)
function renderWordList(words) {
  const list = document.getElementById('word-list');
  const counter = document.getElementById('word-count');
  if (!list) return;
  counter.textContent = words.length;

  if (words.length === 0) {
    list.innerHTML = `<li class="empty-line muted">Hali so'z qo'shilmagan.</li>`;
    return;
  }

  list.innerHTML = [...words].reverse().map((word) => `
    <li class="word-item">
      <div class="word-text">
        <span class="word-en" lang="en">${escapeHtml(word.english)}</span>
        <span class="word-uz">${escapeHtml(word.meanings.join(', '))}</span>
      </div>
      <div class="word-actions">
        <button type="button" class="icon-btn" data-edit="${escapeHtml(word.id)}" aria-label="Tahrirlash" title="Tahrirlash">${icons.edit}</button>
        <button type="button" class="icon-btn icon-btn-danger" data-delete="${escapeHtml(word.id)}" aria-label="O'chirish" title="O'chirish">${icons.trash}</button>
      </div>
    </li>`).join('');
}

// AI orqali inglizcha so'z imlosini tekshiradi.
// Xato topilsa — "... demoqchimisiz?" deb so'raydi; so'z faqat foydalanuvchi rozi bo'lsa almashadi.
// Natija: { english: saqlanadigan matn, notice: qisqa ogohlantirish yoki '' }
//         yoki null — foydalanuvchi oynachani yopib, saqlashni to'xtatdi.
async function reviewSpelling(english, meanings) {
  const status = await ai.getAiStatus();
  if (!status.enabled) return { english, notice: '' };
  if (!status.hasKey) return { english, notice: 'AI kaliti kiritilmagan — imlo tekshirilmadi.' };
  if (!status.online) return { english, notice: "Internet yo'q — imlo tekshirilmadi." };

  let result;
  const hideLoading = showLoading('AI imloni tekshirmoqda...');
  try {
    result = await ai.suggestSpelling(english, meanings);
  } catch (error) {
    console.warn(error);
    return { english, notice: `${ai.getErrorMessage(error)} — imlo tekshirilmadi.` };
  } finally {
    hideLoading();
  }

  if (!result.suggestion) return { english, notice: '' };

  const choice = await showDialog({
    title: 'Imlo tekshiruvi',
    message: `Siz yozdingiz: ${english}\n\n"${result.suggestion}" demoqchimisiz?`,
    buttons: [
      { label: "Yo'q, o'zim yozganimni saqla", value: 'keep', variant: 'secondary' },
      { label: 'Ha, almashtir', value: 'replace', variant: 'primary', submit: true }
    ]
  });
  if (!choice) return null;
  return { english: choice.action === 'replace' ? result.suggestion : english, notice: '' };
}

// Bo'limda shu inglizcha so'z bor-yo'qligini tekshiradi.
// Bor bo'lsa — ogohlantirib so'raydi. Natija: saqlash mumkinmi (true/false)
async function confirmIfDuplicate(words, english, ignoreId = null) {
  const key = normalize(english);
  const duplicate = words.some((w) => w.id !== ignoreId && normalize(w.english) === key);
  if (!duplicate) return true;
  return confirmDialog(
    `"${english}" bu bo'limda allaqachon bor. Baribir saqlansinmi?`,
    { title: "Takroriy so'z", okLabel: 'Ha, saqlash', cancelLabel: "Yo'q" }
  );
}

// So'zni tahrirlash oynachasi
async function handleEditWord(sectionId, wordId) {
  const words = await storage.getWords(sectionId);
  const word = words.find((w) => w.id === wordId);
  if (!word) return;

  const result = await showDialog({
    title: "So'zni tahrirlash",
    fields: [
      { name: 'english', label: 'Inglizcha so\'z yoki ibora', value: word.english, lang: 'en' },
      { name: 'meanings', label: "O'zbekcha ma'nolari (vergul bilan)", value: word.meanings.join(', '), lang: 'uz' }
    ],
    buttons: [
      { label: 'Bekor qilish', value: false, variant: 'secondary' },
      { label: 'Saqlash', value: true, variant: 'primary', submit: true, requireFields: true }
    ]
  });
  if (!result || !result.action) return;

  let english = cleanText(result.values.english);
  const meanings = parseMeanings(result.values.meanings);
  if (!english || meanings.length === 0) {
    await alertDialog("Bo'sh maydonni saqlab bo'lmaydi.", 'Saqlanmadi');
    return;
  }

  // Inglizcha qism o'zgargan bo'lsagina AI imloni tekshiradi
  let notice = '';
  if (normalize(english) !== normalize(word.english)) {
    const spelling = await reviewSpelling(english, meanings);
    if (!spelling) return;
    english = spelling.english;
    notice = spelling.notice;
  }

  if (!(await confirmIfDuplicate(words, english, wordId))) return;

  await storage.updateWord(wordId, english, meanings);
  renderWordList(await storage.getWords(sectionId));
  toast(notice ? `O'zgartirildi. ${notice}` : "O'zgartirildi");
}

// So'zni o'chirish (tasdiqlash bilan)
async function handleDeleteWord(sectionId, wordId) {
  const words = await storage.getWords(sectionId);
  const word = words.find((w) => w.id === wordId);
  if (!word) return;
  const ok = await confirmDialog(`"${word.english}" so'zi o'chirilsinmi?`, {
    title: "So'zni o'chirish", okLabel: "O'chirish", cancelLabel: 'Bekor qilish', danger: true
  });
  if (!ok) return;
  await storage.deleteWord(wordId);
  renderWordList(await storage.getWords(sectionId));
  toast("O'chirildi");
}

// Bo'lim nomini o'zgartirish
async function handleRenameSection(section) {
  const name = await promptDialog({
    title: "Bo'lim nomini o'zgartirish",
    label: "Yangi nom",
    value: section.name
  });
  if (!name || name === section.name) return;
  await storage.renameSection(section.id, name);
  render();
  toast("Nom o'zgartirildi");
}

// Bo'limni o'chirish (tasdiqlash bilan)
async function handleDeleteSection(section) {
  const count = await storage.countWords(section.id);
  const ok = await confirmDialog(
    `"${section.name}" bo'limi va undagi ${count} ta so'z butunlay o'chiriladi. Davom etasizmi?`,
    { title: "Bo'limni o'chirish", okLabel: "O'chirish", cancelLabel: 'Bekor qilish', danger: true }
  );
  if (!ok) return;
  await storage.deleteSection(section.id);
  toast("Bo'lim o'chirildi");
  go('#/');
}

// =============================================================
// TEST: tur tanlash, savollar, natijalar, qayta test, tabrik
// =============================================================

// Test turini tanlash ekrani
async function renderTestSetup(sectionId) {
  test = null;
  const section = await storage.getSection(sectionId);
  if (!section) return renderNotFound();
  const words = await storage.getWords(sectionId);
  const lastMode = await storage.getSetting('lastMode', MODES.EN_UZ);

  const header = `
    <header class="topbar">
      <a class="icon-btn" href="${sectionHash(sectionId)}" aria-label="Orqaga">${icons.back}</a>
      <h1 class="topbar-title">${escapeHtml(section.name)}</h1>
    </header>`;

  // Bo'sh bo'limda test boshlanmaydi
  if (words.length === 0) {
    app.innerHTML = `${header}
      <section class="content">
        <div class="card empty-state">
          <p><strong>Bu bo'limda hali so'z yo'q.</strong></p>
          <p class="muted">Test boshlash uchun avval kamida bitta so'z qo'shing.</p>
          <a class="btn btn-primary" href="${sectionHash(sectionId)}">So'z qo'shish</a>
        </div>
      </section>`;
    return;
  }

  const option = (mode, title, description) => `
    <label class="mode-option">
      <input type="radio" name="mode" value="${mode}" ${mode === lastMode ? 'checked' : ''}>
      <span class="mode-text">
        <strong>${title}</strong>
        <small>${description}</small>
      </span>
    </label>`;

  app.innerHTML = `${header}
    <section class="content">
      <form id="setup-form" class="setup-form">
        <h2 class="list-title">Test turini tanlang</h2>
        <div class="mode-list">
          ${option(MODES.EN_UZ, "Inglizcha → O'zbekcha", "Inglizcha so'z ko'rsatiladi. Uning barcha o'zbekcha ma'nolarini vergul bilan yozasiz.")}
          ${option(MODES.UZ_EN, "O'zbekcha → Inglizcha", "O'zbekcha ma'nolar ko'rsatiladi. Inglizcha so'z yoki iborani yozasiz.")}
        </div>
        <p class="muted">${words.length} ta so'z tasodifiy tartibda beriladi.</p>
        <button type="submit" class="btn btn-primary btn-block">${icons.play} Boshlash</button>
      </form>
    </section>`;

  document.getElementById('setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = new FormData(event.target).get('mode') || MODES.EN_UZ;
    await storage.setSetting('lastMode', mode);
    startTest(section, words, mode);
  });
}

// Yangi testni boshlaydi (1-bosqich — bo'limdagi barcha so'zlar)
function startTest(section, words, mode) {
  test = {
    sectionId: section.id,
    sectionName: section.name,
    mode,
    round: 1,
    queue: shuffle(words),   // shu bosqich savollari (aralashtirilgan)
    index: 0,                // joriy savol raqami
    wrong: [],               // noto'g'ri javoblar: { word, answer }
    correctCount: 0,
    phase: 'answer',         // 'answer' — javob kutilmoqda, 'feedback' — natija ko'rsatilgan
    checkedAt: 0,
    active: true
  };
  renderTestScreen();
}

// Qayta test: faqat noto'g'ri javob berilgan so'zlar bilan yangi bosqich
function startRetestRound() {
  const wrongWords = test.wrong.map((item) => item.word);
  test.round += 1;
  test.queue = shuffle(wrongWords);
  test.index = 0;
  test.wrong = [];
  test.correctCount = 0;
  test.phase = 'answer';
  test.active = true;
  renderTestScreen();
}

// Test ekranini bir marta chizadi; keyingi savollar shu ekranda almashadi
// (telefonda klaviatura yopilib-ochilmasligi uchun)
function renderTestScreen() {
  const isEnUz = test.mode === MODES.EN_UZ;
  app.innerHTML = `
    <header class="topbar">
      <button type="button" class="icon-btn" id="quit-test" aria-label="Testni to'xtatish" title="Testni to'xtatish">${icons.close}</button>
      <h1 class="topbar-title">${escapeHtml(test.sectionName)}</h1>
      <span class="progress-text" id="progress-text"></span>
    </header>
    <section class="content">
      <div class="progress" aria-hidden="true"><div class="progress-bar" id="progress-bar"></div></div>
      <p class="round-label">
        ${test.round > 1 ? `<span class="badge">Qayta test · ${test.round}-bosqich</span>` : ''}
        <span class="muted">${modeLabel(test.mode)}</span>
      </p>

      <div class="card question-card">
        <p class="question-hint">${isEnUz ? "Barcha o'zbekcha ma'nolarini vergul bilan yozing:" : "Inglizcha so'z yoki iborani yozing:"}</p>
        <p class="question-text" id="question-text" lang="${isEnUz ? 'en' : 'uz'}"></p>
      </div>

      <form id="answer-form" class="answer-form" novalidate autocomplete="off">
        <input class="input input-lg" id="answer-input" lang="${isEnUz ? 'uz' : 'en'}"
          placeholder="Javobingiz..." autocomplete="off" autocorrect="off"
          autocapitalize="none" spellcheck="false" enterkeyhint="send">
        <div class="feedback" id="feedback" hidden></div>
        <button type="submit" class="btn btn-primary btn-block" id="answer-btn">Tekshirish</button>
      </form>
    </section>`;

  document.getElementById('answer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (test.phase === 'answer') submitAnswer();
    else if (test.phase === 'feedback') nextQuestion();
    // 'checking' — AI tekshirayotganda bosilgan Enter e'tiborsiz qoldiriladi
  });

  document.getElementById('quit-test').addEventListener('click', () => go(sectionHash(test.sectionId)));

  showCurrentQuestion();
}

// Joriy savolni ekranga chiqaradi
function showCurrentQuestion() {
  const word = test.queue[test.index];
  const total = test.queue.length;

  document.getElementById('progress-text').textContent = `${test.index + 1} / ${total}`;
  document.getElementById('progress-bar').style.width = `${(test.index / total) * 100}%`;
  document.getElementById('question-text').textContent = getPrompt(word, test.mode);

  const input = document.getElementById('answer-input');
  input.value = '';
  input.readOnly = false;
  input.classList.remove('is-correct', 'is-wrong');

  const feedback = document.getElementById('feedback');
  feedback.hidden = true;
  feedback.className = 'feedback';
  feedback.innerHTML = '';

  const button = document.getElementById('answer-btn');
  button.textContent = 'Tekshirish';
  button.disabled = false;
  test.phase = 'answer';
  focusAnswer();
}

// Javob maydoniga kursor qo'yadi
function focusAnswer() {
  const input = document.getElementById('answer-input');
  if (input) input.focus();
}

// Javobni tekshiradi va natijani ko'rsatadi.
// Avval qat'iy tekshiruv ishlaydi. Inglizcha → O'zbekcha rejimida u "noto'g'ri" desa,
// AI ma'nolarni mazmun bo'yicha tekshiradi. AI ishlamasa — qat'iy natija qoladi.
async function submitAnswer() {
  const currentTest = test;
  const word = test.queue[test.index];
  const input = document.getElementById('answer-input');
  const button = document.getElementById('answer-btn');
  const answer = input.value;

  test.phase = 'checking';
  input.readOnly = true;

  let result = checkAnswer(word, test.mode, answer);
  let aiResult = null;  // AI natijasi (agar AI tekshirgan bo'lsa)
  let notice = '';      // AI ishlamagani haqida qisqa xabar

  // AI faqat: Inglizcha → O'zbekcha rejimi, qat'iy tekshiruv xato degan va javob bo'sh emas
  if (!result.correct && test.mode === MODES.EN_UZ && cleanText(answer) !== '') {
    const status = await ai.getAiStatus();
    if (status.enabled && !status.hasKey) {
      notice = "AI kaliti kiritilmagan — qat'iy tekshiruv natijasi.";
    } else if (status.enabled && !status.online) {
      notice = "Internet yo'q — qat'iy tekshiruv natijasi.";
    } else if (status.enabled) {
      showCheckingState();
      try {
        aiResult = await ai.checkMeanings(word.english, word.meanings, answer);
        if (aiResult.correct) result = { ...result, correct: true };
      } catch (error) {
        console.warn(error);
        notice = `${ai.getErrorMessage(error)} — qat'iy tekshiruv natijasi.`;
      }
    }
  }

  // AI javobini kutayotganda foydalanuvchi testdan chiqib ketgan bo'lsa — to'xtaymiz
  if (test !== currentTest || !document.getElementById('answer-input')) return;

  test.phase = 'feedback';
  test.checkedAt = Date.now();

  if (result.correct) test.correctCount += 1;
  else test.wrong.push({ word, answer: cleanText(answer) });

  // Natijani so'z tarixiga yozib qo'yamiz (keyingi bosqichlar uchun kerak)
  storage.addAttempt(word.id, {
    date: new Date().toISOString(),
    mode: test.mode,
    correct: result.correct
  }).catch((error) => console.error(error));

  // Ekranda ko'rsatish
  input.classList.add(result.correct ? 'is-correct' : 'is-wrong');

  const feedback = document.getElementById('feedback');
  feedback.hidden = false;
  const noticeHtml = notice ? `<span class="feedback-note">${escapeHtml(notice)}</span>` : '';

  if (result.correct && aiResult) {
    // Qat'iy tekshiruv xato degan, lekin AI ma'nolarni to'g'ri deb topdi
    feedback.className = 'feedback feedback-ok';
    feedback.innerHTML = `
      <span class="feedback-mark">✓</span> To'g'ri! <span class="feedback-tag">AI: ma'nosi mos</span>
      <span class="feedback-answer">Saqlangan ma'nolar: <strong>${escapeHtml(result.correctAnswer)}</strong></span>`;
  } else if (result.correct) {
    feedback.className = 'feedback feedback-ok';
    feedback.innerHTML = `<span class="feedback-mark">✓</span> To'g'ri!`;
  } else {
    const details = [];
    if (aiResult && aiResult.missingMeanings.length) {
      details.push(`<span class="feedback-answer">Yetishmagan: <strong>${escapeHtml(aiResult.missingMeanings.join(', '))}</strong></span>`);
    }
    if (aiResult && aiResult.wrongMeanings.length) {
      details.push(`<span class="feedback-answer">Noto'g'ri ma'no: <strong>${escapeHtml(aiResult.wrongMeanings.join(', '))}</strong></span>`);
    }
    feedback.className = 'feedback feedback-bad';
    feedback.innerHTML = `
      <span class="feedback-mark">✗</span> Noto'g'ri.
      <span class="feedback-answer">To'g'ri javob: <strong>${escapeHtml(result.correctAnswer)}</strong></span>
      ${details.join('')}
      ${noticeHtml}`;
  }

  const total = test.queue.length;
  document.getElementById('progress-bar').style.width = `${((test.index + 1) / total) * 100}%`;
  button.textContent = 'Keyingi';
  button.disabled = false;
  focusAnswer();
}

// AI tekshirayotgan paytdagi holat: tugma o'chadi, "AI tekshirmoqda..." ko'rinadi
function showCheckingState() {
  const button = document.getElementById('answer-btn');
  button.textContent = 'Tekshirilmoqda...';
  button.disabled = true;
  const feedback = document.getElementById('feedback');
  feedback.hidden = false;
  feedback.className = 'feedback feedback-loading';
  feedback.innerHTML = `<span class="spinner" aria-hidden="true"></span> AI ma'nolarni tekshirmoqda...`;
}

// Keyingi savolga o'tadi yoki bosqichni yakunlaydi
function nextQuestion() {
  // Enter tugmasi tasodifan ikki marta bosilsa, natijani o'tkazib yubormaslik uchun
  if (Date.now() - test.checkedAt < 300) return;

  test.index += 1;
  if (test.index < test.queue.length) showCurrentQuestion();
  else finishRound();
}

// Bosqich tugadi: sanani yozadi va natija yoki tabrik ekranini ko'rsatadi
async function finishRound() {
  test.active = false;
  const now = new Date().toISOString();
  try {
    await storage.setSectionTested(test.sectionId, now);
    if (test.wrong.length === 0) {
      await storage.markSectionMastered(test.sectionId, now);
    }
  } catch (error) {
    console.error(error);
  }
  if (test.wrong.length === 0) renderCongrats(now);
  else renderResults();
  window.scrollTo(0, 0);
}

// Natijalar ekrani (noto'g'ri javoblar ro'yxati va qayta test taklifi)
function renderResults() {
  const wrongHtml = test.wrong.map(({ word, answer }) => `
    <li class="result-item">
      <div class="result-prompt">${escapeHtml(getPrompt(word, test.mode))}</div>
      <div class="result-row">
        <span class="result-label">Sizning javobingiz:</span>
        <span class="text-bad">${answer ? escapeHtml(answer) : "(bo'sh)"}</span>
      </div>
      <div class="result-row">
        <span class="result-label">To'g'ri javob:</span>
        <span class="text-ok">${escapeHtml(getCorrectAnswer(word, test.mode))}</span>
      </div>
    </li>`).join('');

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="${sectionHash(test.sectionId)}" aria-label="Bo'limga qaytish">${icons.close}</a>
      <h1 class="topbar-title">Natijalar</h1>
    </header>
    <section class="content">
      ${test.round > 1 ? `<p class="round-label"><span class="badge">Qayta test · ${test.round}-bosqich</span></p>` : ''}
      <div class="stats">
        <div class="stat stat-ok"><span class="stat-number">${test.correctCount}</span><span>To'g'ri</span></div>
        <div class="stat stat-bad"><span class="stat-number">${test.wrong.length}</span><span>Noto'g'ri</span></div>
      </div>

      <h2 class="list-title">Noto'g'ri javoblar</h2>
      <ul class="result-list">${wrongHtml}</ul>

      <div class="card retest-card">
        <p class="retest-question">Noto'g'ri javoblar uchun yana test olinishini xohlaysizmi?</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="retest-no">Yo'q</button>
          <button type="button" class="btn btn-primary" id="retest-yes">Ha</button>
        </div>
      </div>
    </section>`;

  document.getElementById('retest-yes').addEventListener('click', startRetestRound);
  document.getElementById('retest-no').addEventListener('click', () => {
    const sectionId = test.sectionId;
    test = null;
    go(sectionHash(sectionId));
  });
}

// Tabrik ekrani: bo'limdagi barcha so'zlar to'g'ri topildi
function renderCongrats(date) {
  const sectionId = test.sectionId;
  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="${sectionHash(sectionId)}" aria-label="Bo'limga qaytish">${icons.close}</a>
      <h1 class="topbar-title">${escapeHtml(test.sectionName)}</h1>
    </header>
    <section class="content">
      <div class="card congrats">
        <div class="congrats-icon" aria-hidden="true">🎉</div>
        <h2 class="congrats-title">Tabriklaymiz!</h2>
        <p>"${escapeHtml(test.sectionName)}" bo'limidagi barcha so'zlarga to'g'ri javob berdingiz. Bo'lim to'liq o'zlashtirildi.</p>
        <p class="muted">${test.round === 1 ? "Birinchi urinishdayoq!" : `${test.round} bosqichda`} · ${formatDate(date)}</p>
        <div class="btn-row">
          <a class="btn btn-secondary" href="#/">Bosh sahifa</a>
          <a class="btn btn-primary" href="${sectionHash(sectionId)}">Bo'limga qaytish</a>
        </div>
      </div>
    </section>`;
}

// =============================================================
// SOZLAMALAR: AI'ni yoqish/o'chirish va API kalitini saqlash
// =============================================================

async function renderSettings() {
  const enabled = Boolean(await storage.getSetting(ai.SETTING_ENABLED, false));
  const apiKey = String(await storage.getSetting(ai.SETTING_API_KEY, '') || '');

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Orqaga">${icons.back}</a>
      <h1 class="topbar-title">Sozlamalar</h1>
    </header>
    <section class="content">
      <form class="card" id="ai-form" novalidate autocomplete="off">
        <h2 class="card-title">Sun'iy intellekt (AI)</h2>
        <p class="muted">AI ikki ishda yordam beradi: yangi so'z qo'shganda inglizcha imloni tekshiradi va Inglizcha → O'zbekcha testida boshqacha so'z bilan yozilgan, lekin ma'nosi to'g'ri javoblarni qabul qiladi.</p>

        <label class="switch-row">
          <span class="switch-text">
            <strong>AI'ni yoqish</strong>
            <small class="muted" id="ai-state">${enabled ? 'Yoqilgan' : "O'chirilgan"}</small>
          </span>
          <input type="checkbox" class="switch" id="ai-enabled" ${enabled ? 'checked' : ''}>
        </label>

        <label class="field">
          <span class="field-label">Gemini API kaliti</span>
          <span class="input-group">
            <input class="input" id="ai-key" type="password" value="${escapeHtml(apiKey)}"
              placeholder="AIza..." autocomplete="off" autocapitalize="none" spellcheck="false">
            <button type="button" class="icon-btn" id="toggle-key" aria-label="Kalitni ko'rsatish" title="Kalitni ko'rsatish">${icons.eye}</button>
          </span>
        </label>
        <p class="muted">Kalitni bepul olish: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>

        <p class="notice">Kalit faqat shu qurilmada saqlanadi va zaxira faylga qo'shilmaydi. Bu usul faqat shaxsiy foydalanish uchun mos.</p>
        <p class="form-error" id="key-error" hidden></p>

        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="delete-key">Kalitni o'chirish</button>
          <button type="submit" class="btn btn-primary">Saqlash</button>
        </div>
      </form>
    </section>`;

  const form = document.getElementById('ai-form');
  const enabledInput = document.getElementById('ai-enabled');
  const stateText = document.getElementById('ai-state');
  const keyInput = document.getElementById('ai-key');
  const errorBox = document.getElementById('key-error');

  // Yoqish/o'chirish tugmasi — darhol saqlanadi
  enabledInput.addEventListener('change', async () => {
    await storage.setSetting(ai.SETTING_ENABLED, enabledInput.checked);
    stateText.textContent = enabledInput.checked ? 'Yoqilgan' : "O'chirilgan";
    const hasKey = String(await storage.getSetting(ai.SETTING_API_KEY, '') || '').trim() !== '';
    if (enabledInput.checked && !hasKey) toast('AI yoqildi. Endi API kalitini kiriting.');
    else toast(enabledInput.checked ? 'AI yoqildi' : "AI o'chirildi");
  });

  // Kalitni ko'rsatish / yashirish
  document.getElementById('toggle-key').addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  keyInput.addEventListener('input', () => { errorBox.hidden = true; });

  // Kalitni saqlash (saqlanganda AI avtomatik yoqiladi)
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key) {
      errorBox.textContent = 'API kalitini kiriting.';
      errorBox.hidden = false;
      keyInput.focus();
      return;
    }
    await storage.setSetting(ai.SETTING_API_KEY, key);
    keyInput.value = key;
    keyInput.type = 'password';
    if (!enabledInput.checked) {
      enabledInput.checked = true;
      stateText.textContent = 'Yoqilgan';
      await storage.setSetting(ai.SETTING_ENABLED, true);
      toast('Kalit saqlandi, AI yoqildi');
    } else {
      toast('Kalit saqlandi');
    }
  });

  // Kalitni o'chirish (AI ham o'chiriladi)
  document.getElementById('delete-key').addEventListener('click', async () => {
    const ok = await confirmDialog("API kaliti shu qurilmadan o'chirilsinmi? AI ham o'chiriladi.", {
      title: "Kalitni o'chirish", okLabel: "O'chirish", cancelLabel: 'Bekor qilish', danger: true
    });
    if (!ok) return;
    await storage.setSetting(ai.SETTING_API_KEY, '');
    await storage.setSetting(ai.SETTING_ENABLED, false);
    keyInput.value = '';
    enabledInput.checked = false;
    stateText.textContent = "O'chirilgan";
    toast("Kalit o'chirildi");
  });
}

// =============================================================
// Ishga tushirish
// =============================================================

window.addEventListener('hashchange', onHashChange);
importInput.addEventListener('change', handleImportFile);
render();

// Offline ishlash uchun service worker'ni ro'yxatdan o'tkazamiz
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn("Service worker ro'yxatdan o'tmadi:", error);
    });
  });
}
