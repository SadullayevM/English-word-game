// =============================================================
// storage.js — Ma'lumotlar bilan ishlaydigan YAGONA modul.
// Ilovaning boshqa qismlari IndexedDB'ga to'g'ridan-to'g'ri
// murojaat qilmaydi, faqat shu fayldagi funksiyalarni chaqiradi.
// Keyinchalik Firebase/Supabase'ga o'tishda faqat shu fayl
// o'zgartiriladi.
// =============================================================

const DB_NAME = 'soz-yodlash';
const DB_VERSION = 1;

// Zaxira fayl formati belgisi
const BACKUP_APP_ID = 'soz-yodlash';
const BACKUP_FORMAT_VERSION = 1;

let dbPromise = null;

// ---------------- Ichki yordamchi funksiyalar ----------------

// Ma'lumotlar bazasini ochadi (birinchi marta bo'lsa — jadvallarni yaratadi)
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Bo'limlar jadvali
      if (!db.objectStoreNames.contains('sections')) {
        db.createObjectStore('sections', { keyPath: 'id' });
      }
      // So'zlar jadvali (bo'lim bo'yicha tez qidirish uchun indeks bilan)
      if (!db.objectStoreNames.contains('words')) {
        const words = db.createObjectStore('words', { keyPath: 'id' });
        words.createIndex('bySection', 'sectionId', { unique: false });
      }
      // Sozlamalar jadvali (masalan, oxirgi tanlangan test turi)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

// IndexedDB so'rovini Promise'ga aylantiradi (await bilan ishlatish uchun)
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Tranzaksiya to'liq tugashini kutadi
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Amal bekor qilindi'));
  });
}

// Bitta yozuvni o'qib, o'zgartirib, qayta saqlaydi (bitta tranzaksiyada)
async function patchRecord(storeName, id, changeFn) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  let updated = null;

  const getRequest = store.get(id);
  getRequest.onsuccess = () => {
    if (!getRequest.result) return;
    updated = changeFn(getRequest.result);
    store.put(updated);
  };

  await transactionDone(tx);
  if (!updated) throw new Error('Yozuv topilmadi');
  return updated;
}

// Yangi noyob identifikator (id) yaratadi
function generateId() {
  if (self.crypto && typeof self.crypto.randomUUID === 'function') {
    return self.crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// Hozirgi vaqtni ISO formatda qaytaradi (masalan "2026-11-01T08:00:00.000Z")
function nowIso() {
  return new Date().toISOString();
}

// ---------------- Bo'limlar ----------------

// Barcha bo'limlarni yaratilgan vaqti bo'yicha tartiblab qaytaradi
export async function getSections() {
  const db = await openDB();
  const store = db.transaction('sections').objectStore('sections');
  const sections = await requestToPromise(store.getAll());
  return sections.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Bitta bo'limni id bo'yicha qaytaradi (topilmasa — null)
export async function getSection(id) {
  const db = await openDB();
  const store = db.transaction('sections').objectStore('sections');
  const section = await requestToPromise(store.get(id));
  return section || null;
}

// Yangi bo'lim yaratadi va uni qaytaradi
export async function addSection(name) {
  const section = {
    id: generateId(),
    name: name.trim(),
    createdAt: nowIso(),
    lastTestedAt: null,
    masteredDates: []
  };
  const db = await openDB();
  const tx = db.transaction('sections', 'readwrite');
  tx.objectStore('sections').add(section);
  await transactionDone(tx);
  return section;
}

// Bo'lim nomini o'zgartiradi
export async function renameSection(id, newName) {
  return patchRecord('sections', id, (section) => ({ ...section, name: newName.trim() }));
}

// Bo'limning oxirgi test sanasini yozib qo'yadi
export async function setSectionTested(id, date = nowIso()) {
  return patchRecord('sections', id, (section) => ({ ...section, lastTestedAt: date }));
}

// Bo'limni "to'liq o'zlashtirilgan" deb belgilaydi (sanani ro'yxatga qo'shadi)
export async function markSectionMastered(id, date = nowIso()) {
  return patchRecord('sections', id, (section) => ({
    ...section,
    masteredDates: [...(section.masteredDates || []), date]
  }));
}

// Bo'limni va undagi barcha so'zlarni o'chiradi
export async function deleteSection(id) {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words'], 'readwrite');
  tx.objectStore('sections').delete(id);

  const wordsStore = tx.objectStore('words');
  const keysRequest = wordsStore.index('bySection').getAllKeys(id);
  keysRequest.onsuccess = () => {
    keysRequest.result.forEach((key) => wordsStore.delete(key));
  };

  await transactionDone(tx);
}

// ---------------- So'zlar ----------------

// Bo'limdagi barcha so'zlarni qo'shilgan vaqti bo'yicha qaytaradi
export async function getWords(sectionId) {
  const db = await openDB();
  const index = db.transaction('words').objectStore('words').index('bySection');
  const words = await requestToPromise(index.getAll(sectionId));
  return words.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Bo'limdagi so'zlar sonini qaytaradi
export async function countWords(sectionId) {
  const db = await openDB();
  const index = db.transaction('words').objectStore('words').index('bySection');
  return requestToPromise(index.count(sectionId));
}

// Bo'limga yangi so'z qo'shadi va uni qaytaradi
export async function addWord(sectionId, english, meanings) {
  const word = {
    id: generateId(),
    sectionId,
    english: english.trim(),
    meanings: [...meanings],
    createdAt: nowIso(),
    attempts: []
  };
  const db = await openDB();
  const tx = db.transaction('words', 'readwrite');
  tx.objectStore('words').add(word);
  await transactionDone(tx);
  return word;
}

// So'zning inglizchasini va ma'nolarini o'zgartiradi
export async function updateWord(id, english, meanings) {
  return patchRecord('words', id, (word) => ({
    ...word,
    english: english.trim(),
    meanings: [...meanings]
  }));
}

// So'zni o'chiradi
export async function deleteWord(id) {
  const db = await openDB();
  const tx = db.transaction('words', 'readwrite');
  tx.objectStore('words').delete(id);
  await transactionDone(tx);
}

// So'zga test natijasini yozib qo'yadi: { date, mode, correct }
export async function addAttempt(wordId, attempt) {
  return patchRecord('words', wordId, (word) => ({
    ...word,
    attempts: [...(word.attempts || []), {
      date: attempt.date || nowIso(),
      mode: attempt.mode,
      correct: Boolean(attempt.correct)
    }]
  }));
}

// ---------------- Sozlamalar ----------------

// Sozlamani o'qiydi; topilmasa — standart qiymatni qaytaradi
export async function getSetting(key, defaultValue = null) {
  const db = await openDB();
  const store = db.transaction('settings').objectStore('settings');
  const record = await requestToPromise(store.get(key));
  return record ? record.value : defaultValue;
}

// Sozlamani saqlaydi
export async function setSetting(key, value) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await transactionDone(tx);
}

// ---------------- Zaxira nusxa (eksport / import) ----------------

// Barcha bo'lim va so'zlarni bitta obyekt qilib qaytaradi (JSON faylga yozish uchun)
export async function exportAll() {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words']);
  const [sections, words] = await Promise.all([
    requestToPromise(tx.objectStore('sections').getAll()),
    requestToPromise(tx.objectStore('words').getAll())
  ]);
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: nowIso(),
    sections,
    words
  };
}

// Zaxira fayl mazmunini tekshiradi va tozalaydi.
// Noto'g'ri fayl bo'lsa — tushunarli xabar bilan xato chiqaradi.
export function parseBackup(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.sections) || !Array.isArray(data.words)) {
    throw new Error("Bu fayl ilovaning zaxira nusxasiga o'xshamaydi.");
  }

  const isText = (value) => typeof value === 'string' && value.trim() !== '';
  const fallbackDate = nowIso();

  const sections = data.sections
    .filter((s) => s && isText(s.id) && isText(s.name))
    .map((s) => ({
      id: s.id,
      name: s.name.trim(),
      createdAt: isText(s.createdAt) ? s.createdAt : fallbackDate,
      lastTestedAt: isText(s.lastTestedAt) ? s.lastTestedAt : null,
      masteredDates: Array.isArray(s.masteredDates) ? s.masteredDates.filter(isText) : []
    }));

  const sectionIds = new Set(sections.map((s) => s.id));

  const words = data.words
    .filter((w) => w && isText(w.id) && sectionIds.has(w.sectionId) && isText(w.english) && Array.isArray(w.meanings))
    .map((w) => ({
      id: w.id,
      sectionId: w.sectionId,
      english: w.english.trim(),
      meanings: w.meanings.filter(isText).map((m) => m.trim()),
      createdAt: isText(w.createdAt) ? w.createdAt : fallbackDate,
      attempts: Array.isArray(w.attempts)
        ? w.attempts
            .filter((a) => a && isText(a.date))
            .map((a) => ({ date: a.date, mode: a.mode, correct: Boolean(a.correct) }))
        : []
    }))
    .filter((w) => w.meanings.length > 0);

  if (sections.length === 0) {
    throw new Error("Zaxira faylda birorta ham bo'lim topilmadi.");
  }

  return { sections, words };
}

// Zaxiradagi ma'lumotlarni bazaga yozadi.
// mode = 'replace' — hozirgi hamma narsa o'chiriladi, zaxira yoziladi;
// mode = 'merge'   — hozirgi ma'lumotlar saqlanadi, zaxiradagi yangilari qo'shiladi
//                    (bir xil id'li yozuvlar o'zgartirilmaydi).
// Qaytaradi: { sections: qo'shilgan bo'limlar soni, words: qo'shilgan so'zlar soni }
export async function importAll(backup, mode) {
  const { sections, words } = backup;
  const db = await openDB();

  let sectionsToAdd = sections;
  let wordsToAdd = words;

  if (mode === 'merge') {
    // Avval mavjud id'larni bilib olamiz
    const readTx = db.transaction(['sections', 'words']);
    const [sectionKeys, wordKeys] = await Promise.all([
      requestToPromise(readTx.objectStore('sections').getAllKeys()),
      requestToPromise(readTx.objectStore('words').getAllKeys())
    ]);
    const existingSections = new Set(sectionKeys);
    const existingWords = new Set(wordKeys);
    sectionsToAdd = sections.filter((s) => !existingSections.has(s.id));
    wordsToAdd = words.filter((w) => !existingWords.has(w.id));
  }

  const tx = db.transaction(['sections', 'words'], 'readwrite');
  const sectionsStore = tx.objectStore('sections');
  const wordsStore = tx.objectStore('words');

  if (mode === 'replace') {
    sectionsStore.clear();
    wordsStore.clear();
  }
  sectionsToAdd.forEach((s) => sectionsStore.put(s));
  wordsToAdd.forEach((w) => wordsStore.put(w));

  await transactionDone(tx);
  return { sections: sectionsToAdd.length, words: wordsToAdd.length };
}
