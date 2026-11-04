// =============================================================
// config.js — Firebase loyihangiz sozlamalari.
// Bu 3 ta qiymatni Firebase va Google Cloud sahifalaridan ko'chirib,
// qo'shtirnoq ichiga qo'ying (yo'riqnomada qayerdan olinishi yozilgan).
// Bu qiymatlar sir emas: ular har qanday Firebase veb-ilovasida ochiq turadi.
// Ma'lumotlaringizni Firestore xavfsizlik qoidalari himoya qiladi.
// =============================================================

export const FIREBASE_CONFIG = {
  // Firebase → Project settings → General → "Web API Key"
  apiKey: 'AIzaSyDN6-tjTprgY1f23yo5yg6NSGOhpuO4ZQM',

  // Firebase → Project settings → General → "Project ID"
  projectId: 'my-english-project-15943',

  // Firebase → Authentication → Sign-in method → Google → "Web client ID"
  googleClientId: '471997012223-r8lvi735k51giq1sjeg75k8uch2pak1e.apps.googleusercontent.com'
};

// Sozlamalar to'ldirilganmi-yo'qligini tekshiradi
export function isConfigured() {
  return Object.values(FIREBASE_CONFIG).every(
    (value) => typeof value === 'string' && value.trim() !== '' && !value.includes('BU_YERGA')
  );
}
