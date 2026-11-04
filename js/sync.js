// =============================================================
// sync.js — Sinxronlash mantiqi: qurilmadagi ma'lumotlarni bulut
// bilan bir xil holatga keltiradi.
//   1) Bulutdan yangi o'zgarishlarni oladi va mahalliy ma'lumot bilan birlashtiradi;
//   2) Qurilmadagi yuborilmagan o'zgarishlarni bulutga yuboradi.
// Mahalliy ma'lumot storage.js orqali, bulut esa cloud.js orqali ishlatiladi.
// =============================================================

import * as storage from './storage.js';
import * as cloud from './cloud.js';

const STATE_KEY = 'syncState';
const COLLECTIONS = ['sections', 'words'];

// Mahalliy o'zgarishdan keyin shuncha kutib, keyin yuboramiz (o'zgarishlar guruhlanadi)
const CHANGE_DELAY_MS = 3000;
// Xatodan keyin qayta urinish vaqti
const RETRY_DELAY_MS = 60000;
// Bulutdan o'qishda ozgina orqaga qaytib o'qiymiz (hech narsa tushib qolmasligi uchun)
const PULL_OVERLAP_MS = 60000;
// Bitta so'rovda yuboriladigan yozuvlar soni (Firestore cheklovi — 500)
const PUSH_BATCH = 400;

// Holat: 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
let status = { state: 'idle', lastSyncAt: null, message: '' };
let running = null;      // hozir ketayotgan sinxronlash
let queued = false;      // sinxronlash paytida yangi o'zgarish bo'ldimi
let timer = null;        // kechiktirilgan sinxronlash taymeri
let started = false;
let unsubscribeLocal = null;

const statusListeners = new Set();
const remoteListeners = new Set();
const authListeners = new Set();

// ---------------- Kuzatuvchilar ----------------

// Holat o'zgarganda chaqiriladigan funksiyani qo'shadi (darhol joriy holat bilan ham chaqiriladi)
export function onStatusChange(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

// Bulutdan yangi ma'lumot kelganda chaqiriladigan funksiyani qo'shadi
export function onRemoteChange(listener) {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}

// Kirish muddati tugaganda chaqiriladigan funksiyani qo'shadi
export function onAuthExpired(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

// Joriy holatni qaytaradi
export function getStatus() {
  return status;
}

// Holatni yangilab, kuzatuvchilarga xabar beradi
function setStatus(changes) {
  status = { ...status, ...changes };
  statusListeners.forEach((listener) => {
    try { listener(status); } catch (error) { console.error(error); }
  });
}

// ---------------- Birlashtirish qoidalari ----------------

// Ikki ro'yxatni takrorlarsiz birlashtiradi; keyFn — elementning "kaliti"
function union(listA, listB, keyFn) {
  const map = new Map();
  [...(listA || []), ...(listB || [])].forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  });
  return [...map.values()];
}

// Yozuvning faqat mazmunini (sinxronlash belgilarisiz) solishtirish uchun matnga aylantiradi
function contentKey(record) {
  const { dirty, serverUpdatedAt, ...rest } = record;
  return JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]]));
}

// Bitta yozuvning mahalliy va bulutdagi nusxasini birlashtiradi.
// Qoida: yangiroq (updatedAt kattaroq) nusxa yutadi. Istisnolar:
//   so'z — test natijalari (attempts) ikkala nusxadan qo'shiladi;
//   bo'lim — o'zlashtirilgan sanalar qo'shiladi, oxirgi test sanasi — kechrog'i.
// Qaytaradi: saqlanadigan yozuv yoki null (mahalliy yozuv o'zgarmasa).
function mergeRecord(kind, local, remoteRaw) {
  const { serverUpdatedAt, dirty, ...remote } = remoteRaw;
  remote.updatedAt = remote.updatedAt || remote.createdAt || '';
  remote.deleted = Boolean(remote.deleted);

  if (!local) return { ...remote, dirty: 0 };

  const localIsNewer = (local.updatedAt || '') > remote.updatedAt;
  const { dirty: localDirty, ...localClean } = local;
  const merged = { ...(localIsNewer ? localClean : remote) };

  if (kind === 'words') {
    merged.attempts = union(local.attempts, remote.attempts, (a) => `${a.date}|${a.mode}`)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  if (kind === 'sections') {
    merged.masteredDates = union(local.masteredDates, remote.masteredDates, (d) => d).sort();
    const tested = [local.lastTestedAt, remote.lastTestedAt].filter(Boolean).sort();
    merged.lastTestedAt = tested.length ? tested[tested.length - 1] : null;
  }

  // Birlashgan natija bulutdagidan farq qilsa — yana yuborish kerak
  merged.dirty = contentKey(merged) === contentKey(remote) ? 0 : 1;

  // Mahalliy yozuv o'zgarmagan bo'lsa — saqlashning hojati yo'q
  if (contentKey(merged) === contentKey(local) && merged.dirty === (localDirty || 0)) return null;
  return merged;
}

// ---------------- Sinxronlash ----------------

// Sinxronlash holatini (qaysi vaqtgacha o'qilgani) o'qiydi
async function readState() {
  return storage.getSetting(STATE_KEY, {}) || {};
}

// Bulutdan o'zgarishlarni olib, mahalliy ma'lumot bilan birlashtiradi.
// Qaytaradi: mahalliy ma'lumotda nechta yozuv o'zgargani.
async function pull(state) {
  let changedTotal = 0;
  for (const collection of COLLECTIONS) {
    const lastPulled = state[`${collection}PulledAt`];
    const since = lastPulled
      ? new Date(new Date(lastPulled).getTime() - PULL_OVERLAP_MS).toISOString()
      : '1970-01-01T00:00:00Z';

    let cursor = null;
    let maxServerTime = lastPulled || null;
    do {
      const page = await cloud.fetchChanges(collection, since, cursor);
      page.records.forEach((record) => {
        if (record.serverUpdatedAt && (!maxServerTime || record.serverUpdatedAt > maxServerTime)) {
          maxServerTime = record.serverUpdatedAt;
        }
      });
      changedTotal += await storage.mergeRemoteRecords(
        collection,
        page.records,
        (local, remote) => mergeRecord(collection, local, remote)
      );
      cursor = page.cursor;
    } while (cursor);

    if (maxServerTime) state[`${collection}PulledAt`] = maxServerTime;
    await storage.setSetting(STATE_KEY, state);
  }
  return changedTotal;
}

// Qurilmadagi yuborilmagan o'zgarishlarni bulutga yuboradi
async function push() {
  for (const collection of COLLECTIONS) {
    const dirty = await storage.getDirtyRecords(collection);
    for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
      const batch = dirty.slice(i, i + PUSH_BATCH);
      await cloud.saveRecords(collection, batch);
      await storage.markSynced(collection, batch);
    }
  }
}

// Bir marta to'liq sinxronlash: avval olish, keyin yuborish
async function runSync() {
  const state = await readState();
  const changed = await pull(state);
  await push();
  const lastSyncAt = new Date().toISOString();
  await storage.setSetting(STATE_KEY, { ...(await readState()), lastSyncAt });
  return { changed, lastSyncAt };
}

// Bitta sinxronlashni bajaradi va holatni yangilaydi. Xato bo'lsa — xatoni qaytaradi (throw).
async function runOnce() {
  if (!navigator.onLine) {
    setStatus({ state: 'offline', message: "Internet yo'q" });
    throw new cloud.CloudError('offline');
  }
  setStatus({ state: 'syncing', message: '' });
  try {
    const result = await runSync();
    setStatus({ state: 'synced', lastSyncAt: result.lastSyncAt, message: '' });
    if (result.changed > 0) {
      remoteListeners.forEach((listener) => {
        try { listener(); } catch (error) { console.error(error); }
      });
    }
  } catch (error) {
    console.warn('Sinxronlash xatosi:', error);
    if (error.code === 'auth-expired' || error.code === 'unauthenticated') {
      setStatus({ state: 'error', message: cloud.getErrorMessage({ code: 'auth-expired' }) });
      authListeners.forEach((listener) => {
        try { listener(); } catch (e) { console.error(e); }
      });
    } else if (error.code === 'offline') {
      setStatus({ state: 'offline', message: "Internet yo'q" });
    } else {
      setStatus({ state: 'error', message: cloud.getErrorMessage(error) });
      scheduleSync(RETRY_DELAY_MS);
    }
    throw error;
  }
}

// Sinxronlashni ketma-ket bajaradi: ish paytida yangi so'rov kelsa, tugagach yana bir marta ishlaydi
async function runLoop() {
  let lastError = null;
  do {
    queued = false;
    lastError = null;
    try {
      await runOnce();
    } catch (error) {
      lastError = error;
    }
  } while (queued && started);
  if (lastError) throw lastError;
}

// Hozir sinxronlaydi. Sinxronlash allaqachon ketayotgan bo'lsa — u tugagach yana bir marta ishlaydi.
// throwOnError = true bo'lsa, xato chaqiruvchiga qaytariladi (masalan, akkauntdan chiqishda).
export function syncNow({ throwOnError = false } = {}) {
  clearTimeout(timer);
  if (running) {
    queued = true;
  } else {
    running = runLoop().finally(() => { running = null; });
  }
  return running.then(
    () => undefined,
    (error) => { if (throwOnError) throw error; }
  );
}

// Biroz kutib sinxronlaydi (ketma-ket o'zgarishlar bitta so'rovga yig'iladi)
export function scheduleSync(delay = CHANGE_DELAY_MS) {
  if (!started) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

// Internet qaytganda — darhol sinxronlash
function handleOnline() {
  syncNow();
}

// Internet uzilganda — holatni ko'rsatish
function handleOffline() {
  setStatus({ state: 'offline', message: "Internet yo'q" });
}

// Ilova qayta ochilganda (boshqa oynadan qaytilganda) — sinxronlash
function handleVisibility() {
  if (document.visibilityState === 'visible') syncNow();
}

// Sinxronlashni ishga tushiradi: kuzatuvchilarni ulaydi va birinchi sinxronlashni boshlaydi
export async function start() {
  if (started) return;
  started = true;
  const state = await readState();
  status = { ...status, lastSyncAt: state.lastSyncAt || null };
  unsubscribeLocal = storage.onLocalChange(() => scheduleSync());
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);
  syncNow();
}

// Sinxronlashni to'xtatadi (akkauntdan chiqishda)
export function stop() {
  started = false;
  clearTimeout(timer);
  if (unsubscribeLocal) unsubscribeLocal();
  unsubscribeLocal = null;
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  document.removeEventListener('visibilitychange', handleVisibility);
}
