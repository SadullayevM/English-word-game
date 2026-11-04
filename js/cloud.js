// =============================================================
// cloud.js — Bulut (Firebase) bilan ishlaydigan YAGONA modul.
// Google orqali kirish, kirish muddatini yangilash va Firestore
// bazasiga yozish/o'qish shu yerda. Hech qanday kutubxona ishlatilmaydi:
// hammasi oddiy internet so'rovlari (fetch) orqali bajariladi.
// Boshqa xizmatga o'tilsa, faqat shu fayl almashtiriladi.
// =============================================================

import * as storage from './storage.js';
import { FIREBASE_CONFIG, isConfigured } from './config.js';

const SESSION_KEY = 'session';
const PENDING_KEY = 'oauthPending';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const FIRESTORE_URL = 'https://firestore.googleapis.com/v1';

// So'rov shuncha vaqtda javob bermasa, to'xtatiladi (millisekund)
const TIMEOUT_MS = 20000;

// Bulut xatosi: code — xato turi, ilova shunga qarab xabar ko'rsatadi
export class CloudError extends Error {
  constructor(code, details = '') {
    super(details || code);
    this.name = 'CloudError';
    this.code = code;
  }
}

// Xato turiga mos qisqa o'zbekcha xabar qaytaradi
export function getErrorMessage(error) {
  switch (error && error.code) {
    case 'not-configured': return "Firebase sozlamalari kiritilmagan (config.js fayli)";
    case 'offline': return "Internet yo'q";
    case 'cancelled': return 'Kirish bekor qilindi';
    case 'state': return "Kirishda xatolik yuz berdi. Qaytadan urinib ko'ring";
    case 'idp': return "Google orqali kirish amalga oshmadi";
    case 'auth-expired': return 'Kirish muddati tugadi, qaytadan kiring';
    case 'permission': return "Bulutga yozishga ruxsat yo'q (Firestore qoidalarini tekshiring)";
    case 'not-found': return 'Firestore bazasi topilmadi (u yaratilganini tekshiring)';
    case 'quota': return "Bepul limit tugadi, keyinroq urinib ko'ring";
    case 'timeout': return 'Bulut javob bermadi';
    case 'network': return "Bulut bilan aloqa bo'lmadi";
    default: return 'Bulut xatosi';
  }
}

// ---------------- Yordamchi funksiyalar ----------------

// Google qaytaradigan manzil: ilovaning asosiy sahifasi ("index.html"siz, #...siz)
export function getRedirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// Tasodifiy xavfsiz satr yaratadi (so'rovni tekshirish uchun)
function randomString() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Google ID tokenining ichidagi ma'lumotlarni o'qiydi (imzo Firebase tomonida tekshiriladi)
function decodeTokenPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// Vaqt chegarasi bilan so'rov yuboradi; javobni JSON qilib qaytaradi
async function requestJson(url, options = {}) {
  if (!navigator.onLine) throw new CloudError('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new CloudError('timeout');
    throw new CloudError(navigator.onLine ? 'network' : 'offline', error.message);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await response.json(); } catch { /* javob bo'sh bo'lishi mumkin */ }

  if (!response.ok) {
    const errorInfo = (Array.isArray(data) ? data[0] && data[0].error : data && data.error) || {};
    const status = String(errorInfo.status || '');
    const message = String(errorInfo.message || '');
    const err = new CloudError(
      response.status === 401 || status === 'UNAUTHENTICATED' ? 'unauthenticated'
        : response.status === 403 || status === 'PERMISSION_DENIED' ? 'permission'
        : response.status === 404 || status === 'NOT_FOUND' ? 'not-found'
        : response.status === 429 || status === 'RESOURCE_EXHAUSTED' ? 'quota'
        : 'server',
      `${response.status} ${status} ${message}`.trim()
    );
    err.httpStatus = response.status;
    err.serverMessage = message;
    throw err;
  }
  return data;
}

// ---------------- Kirish (Google) ----------------

// Saqlangan sessiyani qaytaradi: { uid, email, name, idToken, refreshToken, expiresAt } yoki null
export async function getSession() {
  return storage.getSetting(SESSION_KEY, null);
}

// Google kirish sahifasiga yuboradi. Kirgandan keyin Google ilovaga qaytaradi.
export async function startSignIn() {
  if (!isConfigured()) throw new CloudError('not-configured');
  if (!navigator.onLine) throw new CloudError('offline');

  const state = randomString();
  const nonce = randomString();
  await storage.setSetting(PENDING_KEY, { state, nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: FIREBASE_CONFIG.googleClientId,
    redirect_uri: getRedirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account'
  });
  location.assign(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}

// Ilova ochilganda chaqiriladi: Google'dan qaytilgan bo'lsa, kirishni yakunlaydi.
// Qaytaradi: yangi sessiya, yoki null (Google'dan qaytilmagan bo'lsa).
// Xato bo'lsa — CloudError chiqaradi.
export async function completeSignInFromRedirect() {
  const hash = location.hash.replace(/^#/, '');
  if (!/(^|&)(id_token|error)=/.test(hash)) return null;

  // Manzildagi maxfiy ma'lumotlarni darhol tozalaymiz
  history.replaceState(null, '', location.pathname + location.search);

  const params = new URLSearchParams(hash);
  const pending = await storage.getSetting(PENDING_KEY, null);
  await storage.deleteSetting(PENDING_KEY);

  if (params.get('error')) {
    throw new CloudError(params.get('error') === 'access_denied' ? 'cancelled' : 'idp', params.get('error'));
  }
  if (!pending || params.get('state') !== pending.state) throw new CloudError('state');

  const googleIdToken = params.get('id_token');
  const payload = decodeTokenPayload(googleIdToken);
  if (!payload || payload.nonce !== pending.nonce) throw new CloudError('state');

  // Google tokenini Firebase sessiyasiga almashtiramiz
  let data;
  try {
    data = await requestJson(`${IDENTITY_URL}/accounts:signInWithIdp?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri: getRedirectUri(),
        returnIdpCredential: true,
        returnSecureToken: true
      })
    });
  } catch (error) {
    if (error.code === 'offline' || error.code === 'timeout' || error.code === 'network') throw error;
    throw new CloudError('idp', error.message);
  }

  const session = {
    uid: data.localId,
    email: data.email || payload.email || '',
    name: data.displayName || payload.name || '',
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000
  };
  await storage.setSetting(SESSION_KEY, session);
  return session;
}

// Sessiyani shu qurilmadan o'chiradi (ma'lumotlarni o'chirish app.js'da bajariladi)
export async function signOut() {
  await storage.deleteSetting(SESSION_KEY);
}

// Kirish tokenini yangilaydi (bir vaqtda faqat bitta yangilash ketadi)
let refreshPromise = null;
async function refreshSession(session) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const data = await requestJson(`${TOKEN_URL}?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }).toString()
      });
      const updated = {
        ...session,
        idToken: data.id_token,
        refreshToken: data.refresh_token || session.refreshToken,
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
      };
      await storage.setSetting(SESSION_KEY, updated);
      return updated;
    } catch (error) {
      // Server tokenni qabul qilmadi — qaytadan kirish kerak
      if (error.httpStatus === 400 || error.httpStatus === 401 || error.httpStatus === 403) {
        throw new CloudError('auth-expired', error.message);
      }
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// Amal qiladigan kirish tokenini qaytaradi (muddati tugayotgan bo'lsa — yangilaydi)
async function getValidSession(forceRefresh = false) {
  const session = await getSession();
  if (!session) throw new CloudError('auth-expired', 'no session');
  if (!forceRefresh && session.expiresAt - Date.now() > 5 * 60 * 1000) return session;
  return refreshSession(session);
}

// Kirish tokeni bilan Firestore'ga so'rov yuboradi (token eskirgan bo'lsa — bir marta yangilab qayta urinadi)
async function firestoreRequest(url, body) {
  let session = await getValidSession();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await requestJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.idToken}`
        },
        body: JSON.stringify(body)
      });
      return { data, session };
    } catch (error) {
      if (error.code === 'unauthenticated' && attempt === 0) {
        session = await getValidSession(true);
        continue;
      }
      throw error;
    }
  }
  throw new CloudError('auth-expired');
}

// ---------------- Firestore: ma'lumot formatini o'girish ----------------

// Oddiy JavaScript qiymatini Firestore formatiga o'giradi
function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } };
  return { stringValue: String(value) };
}

// Obyektni Firestore "fields" ko'rinishiga o'giradi
function toFields(object) {
  const fields = {};
  Object.entries(object).forEach(([key, value]) => {
    if (value !== undefined) fields[key] = toValue(value);
  });
  return fields;
}

// Firestore qiymatini oddiy JavaScript qiymatiga o'giradi
function fromValue(value) {
  if (!value || 'nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return null;
}

// Firestore "fields" ko'rinishini oddiy obyektga o'giradi
function fromFields(fields) {
  const object = {};
  Object.entries(fields || {}).forEach(([key, value]) => { object[key] = fromValue(value); });
  return object;
}

// Firestore'dagi joylashuv: projects/.../documents
function documentsRoot() {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
}

// ---------------- Firestore: yozish va o'qish ----------------

// Yozuvlarni bulutga yozadi: users/{uid}/{collection}/{id}.
// Har bir yozuvga server vaqti (serverUpdatedAt) qo'shiladi.
// Bitta so'rovda ko'pi bilan 500 ta yozuv yuboriladi.
export async function saveRecords(collection, records) {
  if (!records.length) return;
  const session = await getValidSession();
  const writes = records.map((record) => {
    const { dirty, serverUpdatedAt, ...clean } = record;
    return {
      update: {
        name: `${documentsRoot()}/users/${session.uid}/${collection}/${record.id}`,
        fields: toFields(clean)
      },
      updateTransforms: [{ fieldPath: 'serverUpdatedAt', setToServerValue: 'REQUEST_TIME' }]
    };
  });
  await firestoreRequest(`${FIRESTORE_URL}/${documentsRoot()}:commit`, { writes });
}

// Berilgan vaqtdan keyin bulutda o'zgargan yozuvlarni bir sahifa qilib o'qiydi.
// since — shu vaqtdan (ISO) boshlab; cursor — oldingi sahifaning oxirgi yozuvi.
// Qaytaradi: { records: [...], cursor: keyingi sahifa uchun yoki null }
export async function fetchChanges(collection, since, cursor = null, pageSize = 300) {
  const session = await getValidSession();
  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'serverUpdatedAt' },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { timestampValue: since }
      }
    },
    orderBy: [
      { field: { fieldPath: 'serverUpdatedAt' }, direction: 'ASCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }
    ],
    limit: pageSize
  };
  if (cursor) {
    structuredQuery.startAt = {
      values: [{ timestampValue: cursor.serverUpdatedAt }, { referenceValue: cursor.name }],
      before: false
    };
  }

  const { data } = await firestoreRequest(
    `${FIRESTORE_URL}/${documentsRoot()}/users/${session.uid}:runQuery`,
    { structuredQuery }
  );

  const documents = (Array.isArray(data) ? data : [])
    .map((item) => item.document)
    .filter(Boolean);

  const records = documents.map((doc) => {
    const record = fromFields(doc.fields);
    record.id = record.id || doc.name.split('/').pop();
    return record;
  });

  const last = documents[documents.length - 1];
  const nextCursor = documents.length === pageSize && last
    ? { serverUpdatedAt: fromValue(last.fields.serverUpdatedAt), name: last.name }
    : null;

  return { records, cursor: nextCursor };
}
