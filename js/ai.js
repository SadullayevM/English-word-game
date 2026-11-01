// =============================================================
// ai.js — Sun'iy intellekt (AI) bilan ishlaydigan YAGONA modul.
// Hozir Google Gemini ishlatiladi. Boshqa xizmatga o'tish kerak
// bo'lsa, faqat shu fayl o'zgartiriladi: ilovaning qolgan qismi
// suggestSpelling() va checkMeanings() funksiyalarini chaqiradi xolos.
// =============================================================

import * as storage from './storage.js';

// Arzon va tez model. Google modelni yangilasa, faqat shu qatorni o'zgartiring.
const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// AI javob bermasa, shuncha vaqtdan keyin kutishni to'xtatamiz (millisekund)
const TIMEOUT_MS = 15000;

// Sozlamalar kalitlari (storage.js orqali saqlanadi)
export const SETTING_ENABLED = 'aiEnabled';
export const SETTING_API_KEY = 'aiApiKey';

// AI xatosi: code — xato turi, ilova shunga qarab xabar ko'rsatadi
export class AiError extends Error {
  constructor(code, details = '') {
    super(details || code);
    this.name = 'AiError';
    this.code = code;
  }
}

// Xato turiga mos qisqa o'zbekcha xabar qaytaradi
export function getErrorMessage(error) {
  const code = error && error.code;
  switch (code) {
    case 'disabled': return "AI o'chirilgan";
    case 'no-key': return 'AI kaliti kiritilmagan';
    case 'offline': return "Internet yo'q";
    case 'auth': return "AI kaliti noto'g'ri";
    case 'quota': return 'AI limiti tugadi, birozdan keyin urinib ko\'ring';
    case 'timeout': return 'AI javob bermadi';
    case 'model': return 'AI modeli topilmadi';
    case 'network': return 'AI bilan aloqa bo\'lmadi';
    default: return 'AI xatosi';
  }
}

// AI holatini qaytaradi: yoqilganmi, kalit bormi, internet bormi
export async function getAiStatus() {
  const enabled = Boolean(await storage.getSetting(SETTING_ENABLED, false));
  const apiKey = String(await storage.getSetting(SETTING_API_KEY, '') || '').trim();
  return { enabled, hasKey: apiKey !== '', online: navigator.onLine };
}

// AI'ga murojaat qilishdan oldin hamma narsa joyidaligini tekshiradi.
// Muammo bo'lsa — AiError chiqaradi, aks holda API kalitini qaytaradi.
async function getReadyKey() {
  const enabled = Boolean(await storage.getSetting(SETTING_ENABLED, false));
  if (!enabled) throw new AiError('disabled');
  const apiKey = String(await storage.getSetting(SETTING_API_KEY, '') || '').trim();
  if (!apiKey) throw new AiError('no-key');
  if (!navigator.onLine) throw new AiError('offline');
  return apiKey;
}

// Gemini'ga so'rov yuboradi va javobni JSON obyekt qilib qaytaradi.
// system — AI'ga doimiy ko'rsatma, userText — aniq savol, schema — kutilgan JSON shakli
async function callGemini(apiKey, system, userText, schema) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens: 1024
        }
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new AiError('timeout');
    throw new AiError(navigator.onLine ? 'network' : 'offline', error.message);
  } finally {
    clearTimeout(timer);
  }

  // Server xato qaytargan bo'lsa — turini aniqlaymiz
  if (!response.ok) {
    let details = '';
    try { details = (await response.json()).error.message || ''; } catch { /* e'tiborsiz */ }
    if (response.status === 401 || response.status === 403 || /api key/i.test(details)) {
      throw new AiError('auth', details);
    }
    if (response.status === 429) throw new AiError('quota', details);
    if (response.status === 404) throw new AiError('model', details);
    throw new AiError('server', `${response.status} ${details}`);
  }

  // Javob matnini ajratib olib, JSON sifatida o'qiymiz
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AiError('bad-response');
  }
  const parts = (data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .replace(/^```(?:json)?\s*|\s*```$/g, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad-response', text);
  }
}

// Matnni taqqoslash uchun soddalashtiradi (katta-kichik harf va bo'sh joylar)
function simplify(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------- 1-vazifa: inglizcha so'z imlosini tekshirish ----------------

const SPELLING_SYSTEM =
  'You check the spelling of an English word or phrase that a learner adds to a vocabulary list. ' +
  'Uzbek meanings are given only as context. ' +
  'If the English text is spelled correctly (British or American spelling, proper nouns and phrases are fine), ' +
  'return misspelled=false and an empty suggestion. ' +
  'If it has a spelling mistake, return misspelled=true and the corrected English text as suggestion. ' +
  'Never replace a correct word with a synonym. Reply with JSON only.';

const SPELLING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    misspelled: { type: 'BOOLEAN' },
    suggestion: { type: 'STRING' }
  },
  required: ['misspelled', 'suggestion']
};

// Inglizcha so'z imlosini tekshiradi.
// Qaytaradi: { suggestion: "to'g'ri yozilishi" } yoki { suggestion: null } (xato topilmasa).
// Muammo bo'lsa — AiError chiqaradi.
export async function suggestSpelling(english, meanings = []) {
  const apiKey = await getReadyKey();
  const userText =
    `English: ${JSON.stringify(english)}\n` +
    `Uzbek meanings: ${JSON.stringify(meanings.join(', '))}`;

  const result = await callGemini(apiKey, SPELLING_SYSTEM, userText, SPELLING_SCHEMA);
  if (!result || typeof result.misspelled !== 'boolean') throw new AiError('bad-response');

  const suggestion = typeof result.suggestion === 'string' ? result.suggestion.trim() : '';
  // Taklif bo'sh yoki asl so'zning o'zi bo'lsa — xato yo'q deb hisoblaymiz
  if (!result.misspelled || !suggestion || simplify(suggestion) === simplify(english)) {
    return { suggestion: null };
  }
  return { suggestion };
}

// ---------------- 2-vazifa: o'zbekcha ma'nolarni tekshirish ----------------

const MEANINGS_SYSTEM =
  'You grade one answer in an English-to-Uzbek vocabulary test. ' +
  'Input: an English word, its reference Uzbek meanings, and the learner\'s answer (Uzbek, comma-separated). ' +
  'For each reference meaning, decide whether the answer expresses the same meaning; ' +
  'other word forms, synonyms and paraphrases count (e.g. "o\'ynash" = "o\'ynamoq", "ovqatlanmoq" = "ovqat yemoq"). ' +
  'Apostrophe variants (o\' oʻ o‘ g\' gʻ g‘) are equal. ' +
  'Put every reference meaning that the answer does not express into missingMeanings, copied exactly. ' +
  'Put every part of the answer that is not a correct translation of the English word into wrongMeanings, copied exactly. ' +
  'correct is true only if both lists are empty. Reply with JSON only.';

const MEANINGS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    correct: { type: 'BOOLEAN' },
    missingMeanings: { type: 'ARRAY', items: { type: 'STRING' } },
    wrongMeanings: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['correct', 'missingMeanings', 'wrongMeanings']
};

// Javobdagi o'zbekcha ma'nolarni mazmun bo'yicha tekshiradi.
// Qaytaradi: { correct, missingMeanings: [...], wrongMeanings: [...] }
// Qoida: birorta ma'no yetishmasa yoki noto'g'ri ma'no qo'shilgan bo'lsa — javob noto'g'ri.
// Muammo bo'lsa — AiError chiqaradi.
export async function checkMeanings(english, meanings, answer) {
  const apiKey = await getReadyKey();
  const userText =
    `English: ${JSON.stringify(english)}\n` +
    `Reference meanings: ${JSON.stringify(meanings)}\n` +
    `Answer: ${JSON.stringify(String(answer ?? ''))}`;

  const result = await callGemini(apiKey, MEANINGS_SYSTEM, userText, MEANINGS_SCHEMA);
  if (!result || typeof result.correct !== 'boolean') throw new AiError('bad-response');

  const cleanList = (list) => (Array.isArray(list) ? list : [])
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());

  const missingMeanings = cleanList(result.missingMeanings);
  const wrongMeanings = cleanList(result.wrongMeanings);

  return {
    // Ehtiyot uchun: AI "to'g'ri" desa ham, ro'yxatlarda nimadir bo'lsa — noto'g'ri
    correct: result.correct === true && missingMeanings.length === 0 && wrongMeanings.length === 0,
    missingMeanings,
    wrongMeanings
  };
}
