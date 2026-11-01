// =============================================================
// quiz.js — Test mantiqi: matnni bir xil ko'rinishga keltirish
// (normalizatsiya), javobni tekshirish va so'zlarni aralashtirish.
// Bu modul ma'lumotlar bazasi va ekran bilan ishlamaydi.
// =============================================================

// Test turlari
export const MODES = {
  EN_UZ: 'en-uz', // Inglizcha so'z ko'rsatiladi -> o'zbekcha ma'nolar yoziladi
  UZ_EN: 'uz-en'  // O'zbekcha ma'nolar ko'rsatiladi -> inglizcha so'z yoziladi
};

// Test turining o'zbekcha nomini qaytaradi
export function modeLabel(mode) {
  return mode === MODES.UZ_EN ? "O'zbekcha → Inglizcha" : "Inglizcha → O'zbekcha";
}

// O'zbekcha tutuq belgisining barcha turlari: ' ‘ ’ ʻ ʼ `
const APOSTROPHES = /['‘’ʻʼ`]/g;

// Matnni chetidagi bo'sh joylardan tozalaydi va ichidagi
// ketma-ket bo'sh joylarni bittaga qisqartiradi (harflar o'zgarmaydi)
export function cleanText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// Taqqoslash uchun matnni bir xil ko'rinishga keltiradi:
// bo'sh joylar tozalanadi, kichik harfga o'tkaziladi,
// tutuq belgilari bitta belgiga birlashtiriladi (o'/oʻ/o‘ teng bo'ladi)
export function normalize(text) {
  return cleanText(text)
    .replace(APOSTROPHES, "'")
    .toLowerCase();
}

// "o'ynamoq, chalmoq" kabi matnni ma'nolar ro'yxatiga ajratadi.
// Bo'sh qismlar va takrorlanganlar olib tashlanadi, yozilish shakli saqlanadi.
// (So'z qo'shishda ishlatiladi.)
export function parseMeanings(text) {
  const result = [];
  const seen = new Set();
  for (const part of String(text ?? '').split(',')) {
    const meaning = cleanText(part);
    if (!meaning) continue;
    const key = normalize(meaning);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(meaning);
  }
  return result;
}

// Ro'yxatni tasodifiy tartibga aralashtiradi (Fisher–Yates usuli).
// Asl ro'yxat o'zgarmaydi — yangi nusxa qaytariladi.
export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Testda foydalanuvchiga ko'rsatiladigan savol matnini qaytaradi
export function getPrompt(word, mode) {
  return mode === MODES.UZ_EN ? word.meanings.join(', ') : word.english;
}

// Shu test turi uchun to'g'ri javob matnini qaytaradi
export function getCorrectAnswer(word, mode) {
  return mode === MODES.UZ_EN ? word.english : word.meanings.join(', ');
}

// Inglizcha → O'zbekcha tekshiruvi:
// foydalanuvchi yozgan ma'nolar to'plami saqlangan ma'nolar to'plamiga
// AYNAN teng bo'lishi kerak (tartib muhim emas; birorta yetishmasa
// yoki ortiqcha ma'no bo'lsa — noto'g'ri)
function checkEnglishToUzbek(word, answer) {
  const stored = new Set(word.meanings.map(normalize).filter(Boolean));
  const given = new Set(
    String(answer ?? '').split(',').map(normalize).filter(Boolean)
  );
  if (stored.size !== given.size) return false;
  for (const meaning of stored) {
    if (!given.has(meaning)) return false;
  }
  return true;
}

// O'zbekcha → Inglizcha tekshiruvi:
// normalizatsiyadan keyin inglizcha so'z aynan mos kelishi kerak
// (har qanday imlo xatosi — noto'g'ri)
function checkUzbekToEnglish(word, answer) {
  const given = normalize(answer);
  return given !== '' && given === normalize(word.english);
}

// Javobni tekshiradi. Qaytaradi: { correct: true/false, correctAnswer: "..." }
export function checkAnswer(word, mode, answer) {
  const correct = mode === MODES.UZ_EN
    ? checkUzbekToEnglish(word, answer)
    : checkEnglishToUzbek(word, answer);
  return { correct, correctAnswer: getCorrectAnswer(word, mode) };
}
