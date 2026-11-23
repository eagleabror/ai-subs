import { LightStoreError } from '../services/lightstore.service.js';

export function supplierErrorMessage(error) {
  if (!(error instanceof LightStoreError)) return 'Kutilmagan xatolik. Keyinroq qayta urinib ko‘ring.';
  if (error.status === 401 || error.status === 403) return 'Light Store API kaliti yoki kirish huquqini tekshiring.';
  if (error.status === 429) return 'Light Store so‘rovlar limiti tugadi. Birozdan keyin qayta urinib ko‘ring.';
  if (error.code === 'TIMEOUT') return 'Light Store javob berish vaqti tugadi.';
  if (['INVALID_SCHEMA', 'INVALID_JSON'].includes(error.code)) return 'Light Store javobi hujjatdagi formatga mos emas. Integratsiyani tekshirish kerak.';
  return 'Light Store hozircha mavjud emas. Keyinroq qayta urinib ko‘ring.';
}

export function logFailure(event, error) {
  // Only internal codes are allowed in logs. Never serialize external error objects.
  console.error(JSON.stringify({ event, code: error instanceof LightStoreError ? error.code : 'INTERNAL_ERROR' }));
}
