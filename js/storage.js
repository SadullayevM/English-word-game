// =============================================================
// storage.js — Ma'lumotlar bilan ishlaydigan YAGONA modul.
// Ilovaning boshqa qismlari IndexedDB'ga to'g'ridan-to'g'ri
// murojaat qilmaydi, faqat shu fayldagi funksiyalarni chaqiradi.
//
// Sinxronlash uchun har bir bo'lim va so'zda qo'shimcha maydonlar bor:
//   updatedAt — oxirgi o'zgarish vaqti (shu qurilma soati bo'yicha);
//   deleted   — true bo'lsa, yozuv o'chirilgan (boshqa qurilmalarga ham
//               "o'chirildi" xabari yetib borishi uchun yozuv saqlanib qoladi,
//               lekin ekranda ko'rsatilmaydi);
//   dirty     — 1 bo'lsa, o'zgarish hali bulutga yuborilmagan, 0 — yuborilgan.
// =============================================================

const DB_NAME = 'soz-yodlash';
const DB_VERSION = 2; // 2-versiya: sinxronlash maydonlari qo'shildi

// Zaxira fayl formati belgisi
const BACKUP_APP_ID = 'soz-yodlash';
const BACKUP_FORMAT_VERSION = 1;

// Akkauntga bog'liq sozlamalar (akkauntdan chiqqanda o'chiriladi)
const ACCOUNT_SETTING_KEYS = ['session', 'syncState', 'accountUid', 'oauthPending'];

let dbPromise = null;

// Ma'lumot o'zgarganda xabar olishni istaganlar ro'yxati (sinxronlash uchun)
const changeListeners = new Set();

// ---------------- Ichki yordamchi funksiyalar ----------------

// Ma'lumotlar bazasini ochadi (birinchi marta bo'lsa — jadvallarni yaratadi,
// eski versiyadan o'tilayotgan bo'lsa — yozuvlarga sinxronlash maydonlarini qo'shadi)
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
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

      // 1-versiyadan 2-versiyaga o'tish: eski yozuvlarga sinxronlash maydonlarini qo'shamiz,
      // dirty = 1 — ular birinchi sinxronlashda bulutga yuklanadi
      if (event.oldVersion >= 1 && event.oldVersion < 2) {
        const tx = request.transaction;
        ['sections', 'words'].forEach((storeName) => {
          const cursorRequest = tx.objectStore(storeName).openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const value = cursor.value;
            if (!value.updatedAt) {
              cursor.update({
                ...value,
                updatedAt: value.createdAt || nowIso(),
                deleted: false,
                dirty: 1
              });
            }
            cursor.continue();
          };
        });
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

// Yozuvni "o'zgardi, yuborilishi kerak" deb belgilaydi
function touch(record) {
  return { ...record, updatedAt: nowIso(), dirty: 1 };
}

// Mahalliy o'zgarish bo'lganini kuzatuvchilarga xabar qiladi
function notifyChange() {
  changeListeners.forEach((listener) => {
    try { listener(); } catch (error) { console.error(error); }
  });
}

// Bitta yozuvni o'qib, o'zgartirib, qayta saqlaydi (bitta tranzaksiyada).
// O'chirilgan yozuv topilmagan deb hisoblanadi.
async function patchRecord(storeName, id, changeFn) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  let updated = null;

  const getRequest = store.get(id);
  getRequest.onsuccess = () => {
    const current = getRequest.result;
    if (!current || current.deleted) return;
    updated = touch(changeFn(current));
    store.put(updated);
  };

  await transactionDone(tx);
  if (!updated) throw new Error('Yozuv topilmadi');
  notifyChange();
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

// Yozuvdan faqat sinxronlash uchun kerak bo'lgan ichki maydonlarni olib tashlaydi
// (zaxira faylga yozish uchun)
function stripSyncFields(record) {
  const { dirty, deleted, updatedAt, serverUpdatedAt, ...rest } = record;
  return rest;
}

// ---------------- O'zgarishlarni kuzatish ----------------

// Mahalliy ma'lumot o'zgarganda chaqiriladigan funksiyani ro'yxatga oladi.
// Qaytaradi: kuzatishni to'xtatadigan funksiya.
export function onLocalChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

// ---------------- Bo'limlar ----------------

// Barcha (o'chirilmagan) bo'limlarni yaratilgan vaqti bo'yicha tartiblab qaytaradi
export async function getSections() {
  const db = await openDB();
  const store = db.transaction('sections').objectStore('sections');
  const sections = await requestToPromise(store.getAll());
  return sections
    .filter((s) => !s.deleted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Bitta bo'limni id bo'yicha qaytaradi (topilmasa yoki o'chirilgan bo'lsa — null)
export async function getSection(id) {
  const db = await openDB();
  const store = db.transaction('sections').objectStore('sections');
  const section = await requestToPromise(store.get(id));
  return section && !section.deleted ? section : null;
}

// Yangi bo'lim yaratadi va uni qaytaradi
export async function addSection(name) {
  const now = nowIso();
  const section = {
    id: generateId(),
    name: name.trim(),
    createdAt: now,
    lastTestedAt: null,
    masteredDates: [],
    updatedAt: now,
    deleted: false,
    dirty: 1
  };
  const db = await openDB();
  const tx = db.transaction('sections', 'readwrite');
  tx.objectStore('sections').add(section);
  await transactionDone(tx);
  notifyChange();
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
// (yozuvlar "o'chirilgan" deb belgilanadi — bu xabar boshqa qurilmalarga ham boradi)
export async function deleteSection(id) {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words'], 'readwrite');
  const sectionsStore = tx.objectStore('sections');
  const wordsStore = tx.objectStore('words');

  const sectionRequest = sectionsStore.get(id);
  sectionRequest.onsuccess = () => {
    const section = sectionRequest.result;
    if (section && !section.deleted) sectionsStore.put(touch({ ...section, deleted: true }));
  };

  const wordsRequest = wordsStore.index('bySection').getAll(id);
  wordsRequest.onsuccess = () => {
    wordsRequest.result
      .filter((word) => !word.deleted)
      .forEach((word) => wordsStore.put(touch({ ...word, deleted: true })));
  };

  await transactionDone(tx);
  notifyChange();
}

// Ikki bo'limni birlashtiradi: manba bo'limdagi so'zlar maqsad bo'limga ko'chadi.
// wordKey(word) — so'zning "kaliti" (inglizchasi + barcha ma'nolari). Kaliti maqsad bo'limdagi
// biror so'z bilan bir xil bo'lgan so'z ko'chirilmaydi: ikkisi bitta bo'lib qoladi
// (test tarixlari qo'shiladi). Ma'nolari farq qiladigan so'zlar alohida ko'chiriladi.
// Manba bo'lim faqat nomi bilan, bo'sh holda qoladi. Ikkala bo'limning "o'zlashtirilgan"
// belgisi olib tashlanadi (masteredResetAt — shu vaqtgacha bo'lgan sanalar boshqa
// qurilmalardan qaytib kelmasligi uchun belgi).
// Qaytaradi: { moved: ko'chirilgan so'zlar soni, merged: bittaga birlashgan so'zlar soni }
export async function mergeSections(targetId, sourceId, wordKey) {
  if (targetId === sourceId) throw new Error("Bo'limni o'zi bilan birlashtirib bo'lmaydi");
  const db = await openDB();
  const tx = db.transaction(['sections', 'words'], 'readwrite');
  const sectionsStore = tx.objectStore('sections');
  const wordsStore = tx.objectStore('words');
  const bySection = wordsStore.index('bySection');

  const targetReq = sectionsStore.get(targetId);
  const sourceReq = sectionsStore.get(sourceId);
  const targetWordsReq = bySection.getAll(targetId);
  const sourceWordsReq = bySection.getAll(sourceId);

  const result = { moved: 0, merged: 0 };
  let failed = false;
  let pending = 4;

  // To'rttala o'qish tugagach, birlashtirishni bajaradi
  const whenAllRead = () => {
    pending -= 1;
    if (pending > 0) return;

    const target = targetReq.result;
    const source = sourceReq.result;
    if (!target || target.deleted || !source || source.deleted) {
      failed = true;
      return;
    }

    const now = nowIso();
    // Maqsad bo'limdagi so'zlar kaliti bo'yicha
    const targetByKey = new Map();
    targetWordsReq.result
      .filter((word) => !word.deleted)
      .forEach((word) => targetByKey.set(wordKey(word), word));
    const changedTargets = new Map();

    sourceWordsReq.result
      .filter((word) => !word.deleted)
      .forEach((word) => {
        const key = wordKey(word);
        const match = targetByKey.get(key);
        if (match) {
          // Bir xil so'z: test tarixlarini qo'shamiz, manbadagisini o'chiramiz
          const seen = new Set();
          const attempts = [...(match.attempts || []), ...(word.attempts || [])]
            .filter((a) => {
              const id = `${a.date}|${a.mode}`;
              if (seen.has(id)) return false;
              seen.add(id);
              return true;
            })
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
          const updated = { ...match, attempts };
          targetByKey.set(key, updated);
          changedTargets.set(updated.id, updated);
          wordsStore.put(touch({ ...word, deleted: true }));
          result.merged += 1;
        } else {
          // Yangi so'z: maqsad bo'limga ko'chiramiz
          wordsStore.put(touch({ ...word, sectionId: targetId }));
          result.moved += 1;
        }
      });

    changedTargets.forEach((word) => wordsStore.put(touch(word)));

    sectionsStore.put(touch({ ...target, masteredDates: [], masteredResetAt: now }));
    sectionsStore.put(touch({
      ...source,
      masteredDates: [],
      masteredResetAt: now,
      lastTestedAt: null,
      testedResetAt: now
    }));
  };

  [targetReq, sourceReq, targetWordsReq, sourceWordsReq].forEach((request) => {
    request.onsuccess = whenAllRead;
  });

  await transactionDone(tx);
  if (failed) throw new Error("Bo'lim topilmadi");
  notifyChange();
  return result;
}

// ---------------- So'zlar ----------------

// Bo'limdagi barcha (o'chirilmagan) so'zlarni qo'shilgan vaqti bo'yicha qaytaradi
export async function getWords(sectionId) {
  const db = await openDB();
  const index = db.transaction('words').objectStore('words').index('bySection');
  const words = await requestToPromise(index.getAll(sectionId));
  return words
    .filter((w) => !w.deleted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Bo'limdagi (o'chirilmagan) so'zlar sonini qaytaradi
export async function countWords(sectionId) {
  const words = await getWords(sectionId);
  return words.length;
}

// Bo'limga yangi so'z qo'shadi va uni qaytaradi
export async function addWord(sectionId, english, meanings) {
  const now = nowIso();
  const word = {
    id: generateId(),
    sectionId,
    english: english.trim(),
    meanings: [...meanings],
    createdAt: now,
    attempts: [],
    updatedAt: now,
    deleted: false,
    dirty: 1
  };
  const db = await openDB();
  const tx = db.transaction('words', 'readwrite');
  tx.objectStore('words').add(word);
  await transactionDone(tx);
  notifyChange();
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

// So'zni o'chiradi ("o'chirilgan" deb belgilaydi)
export async function deleteWord(id) {
  return patchRecord('words', id, (word) => ({ ...word, deleted: true }));
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

// Sozlamani o'chiradi
export async function deleteSetting(key) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').delete(key);
  await transactionDone(tx);
}

// ---------------- Sinxronlash uchun funksiyalar ----------------
// (bular faqat sync.js tomonidan ishlatiladi)

// Bulutga hali yuborilmagan yozuvlarni qaytaradi. storeName: 'sections' yoki 'words'
export async function getDirtyRecords(storeName) {
  const db = await openDB();
  const store = db.transaction(storeName).objectStore(storeName);
  const records = await requestToPromise(store.getAll());
  return records.filter((record) => record.dirty === 1);
}

// Yuborilmagan o'zgarishlar sonini qaytaradi (bo'limlar + so'zlar)
export async function countDirty() {
  const [sections, words] = await Promise.all([
    getDirtyRecords('sections'),
    getDirtyRecords('words')
  ]);
  return sections.length + words.length;
}

// Yuborilgan yozuvlarni "yuborildi" deb belgilaydi.
// Yuborish paytida yozuv yana o'zgargan bo'lsa (updatedAt boshqacha) — belgilanmaydi,
// keyingi sinxronlashda yangi holati yuboriladi.
export async function markSynced(storeName, sentRecords) {
  if (!sentRecords.length) return;
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  sentRecords.forEach((sent) => {
    const request = store.get(sent.id);
    request.onsuccess = () => {
      const current = request.result;
      if (current && current.dirty === 1 && current.updatedAt === sent.updatedAt) {
        store.put({ ...current, dirty: 0 });
      }
    };
  });
  await transactionDone(tx);
}

// Bulutdan kelgan yozuvlarni mahalliy ma'lumot bilan birlashtiradi.
// mergeFn(local, remote) — birlashtirilgan yozuvni yoki null (o'zgarish kerak emas) qaytaradi.
// Qaytaradi: nechta yozuv o'zgargani.
export async function mergeRemoteRecords(storeName, remoteRecords, mergeFn) {
  if (!remoteRecords.length) return 0;
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  let changed = 0;
  remoteRecords.forEach((remote) => {
    const request = store.get(remote.id);
    request.onsuccess = () => {
      const merged = mergeFn(request.result || null, remote);
      if (merged) {
        store.put(merged);
        changed += 1;
      }
    };
  });
  await transactionDone(tx);
  return changed;
}

// Qurilmada biror bo'lim yoki so'z bor-yo'qligini aytadi (o'chirilganlari ham hisobga olinadi)
export async function hasAnyData() {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words']);
  const [sections, words] = await Promise.all([
    requestToPromise(tx.objectStore('sections').count()),
    requestToPromise(tx.objectStore('words').count())
  ]);
  return sections + words > 0;
}

// Qurilmadagi barcha bo'lim va so'zlarni hamda sinxronlash holatini o'chiradi
// (boshqa akkaunt bilan kirilganda ishlatiladi; sessiya saqlanib qoladi)
export async function clearLocalData() {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words', 'settings'], 'readwrite');
  tx.objectStore('sections').clear();
  tx.objectStore('words').clear();
  tx.objectStore('settings').delete('syncState');
  await transactionDone(tx);
}

// Akkauntdan chiqishda: barcha bo'lim va so'zlarni hamda akkaunt sozlamalarini o'chiradi.
// Qurilmaga tegishli sozlamalar (AI kaliti, oxirgi test turi) qoladi.
export async function clearAccountData() {
  const db = await openDB();
  const tx = db.transaction(['sections', 'words', 'settings'], 'readwrite');
  tx.objectStore('sections').clear();
  tx.objectStore('words').clear();
  const settings = tx.objectStore('settings');
  ACCOUNT_SETTING_KEYS.forEach((key) => settings.delete(key));
  await transactionDone(tx);
}

// ---------------- Zaxira nusxa (eksport / import) ----------------

// Barcha (o'chirilmagan) bo'lim va so'zlarni bitta obyekt qilib qaytaradi (JSON faylga yozish uchun)
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
    sections: sections.filter((s) => !s.deleted).map(stripSyncFields),
    words: words.filter((w) => !w.deleted).map(stripSyncFields)
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
//                    (bir xil id'li mavjud yozuvlar o'zgartirilmaydi).
// Yuklangan yozuvlar "yangi o'zgarish" sifatida belgilanadi va akkauntga ham yuboriladi.
// Qaytaradi: { sections: qo'shilgan bo'limlar soni, words: qo'shilgan so'zlar soni }
export async function importAll(backup, mode) {
  const now = nowIso();
  const stamp = (record) => ({ ...record, updatedAt: now, deleted: false, dirty: 1 });
  const db = await openDB();

  // Avval hozirgi yozuvlarni o'qiymiz
  const readTx = db.transaction(['sections', 'words']);
  const [currentSections, currentWords] = await Promise.all([
    requestToPromise(readTx.objectStore('sections').getAll()),
    requestToPromise(readTx.objectStore('words').getAll())
  ]);

  let sectionsToAdd = backup.sections;
  let wordsToAdd = backup.words;

  if (mode === 'merge') {
    const existingSections = new Set(currentSections.filter((s) => !s.deleted).map((s) => s.id));
    const existingWords = new Set(currentWords.filter((w) => !w.deleted).map((w) => w.id));
    sectionsToAdd = backup.sections.filter((s) => !existingSections.has(s.id));
    wordsToAdd = backup.words.filter((w) => !existingWords.has(w.id));
  }

  const tx = db.transaction(['sections', 'words'], 'readwrite');
  const sectionsStore = tx.objectStore('sections');
  const wordsStore = tx.objectStore('words');

  if (mode === 'replace') {
    // Hozirgi yozuvlar "o'chirilgan" deb belgilanadi (o'chirish boshqa qurilmalarga ham yetadi)
    currentSections.filter((s) => !s.deleted).forEach((s) => sectionsStore.put({ ...s, deleted: true, updatedAt: now, dirty: 1 }));
    currentWords.filter((w) => !w.deleted).forEach((w) => wordsStore.put({ ...w, deleted: true, updatedAt: now, dirty: 1 }));
  }
  sectionsToAdd.forEach((s) => sectionsStore.put(stamp(s)));
  wordsToAdd.forEach((w) => wordsStore.put(stamp(w)));

  await transactionDone(tx);
  notifyChange();
  return { sections: sectionsToAdd.length, words: wordsToAdd.length };
}
