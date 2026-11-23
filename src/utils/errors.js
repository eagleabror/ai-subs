import { LightStoreError } from '../services/lightstore.service.js';

export function supplierErrorMessage(error) {
  if (!(error instanceof LightStoreError)) return 'Kutilmagan xatolik. Keyinroq qayta urinib ko‘ring.';
  if (error.status === 401 || error.status === 403) return 'Light Store API kaliti yoki kirish huquqini tekshiring.';
  if (error.status === 429) return 'Light Store so‘rovlar limiti tugadi. Birozdan keyin qayta urinib ko‘ring.';
  if (error.code === 'TIMEOUT') return 'Light Store javob berish vaqti tugadi.';
  if (['INVALID_SCHEMA', 'INVALID_JSON'].includes(error.code)) return 'Light Store javobi hujjatdagi formatga mos emas. Integratsiyani tekshirish kerak.';
  return 'Light Store hozircha mavjud emas. Keyinroq qayta urinib ko‘ring.';
}

export function classifyFailure(error, depth = 0) {
  if (!error || depth > 4) return 'INTERNAL_ERROR';
  if (error instanceof LightStoreError) return error.code;
  const codes = {
    ENOTFOUND: 'DNS_LOOKUP_FAILED', EAI_AGAIN: 'DNS_LOOKUP_FAILED',
    ECONNREFUSED: 'CONNECTION_REFUSED', ETIMEDOUT: 'CONNECTION_TIMEOUT',
    ECONNRESET: 'CONNECTION_RESET', EADDRINUSE: 'PORT_IN_USE',
    18: 'DATABASE_AUTH_FAILED', 13: 'DATABASE_PERMISSION_DENIED',
    11000: 'DATABASE_DUPLICATE_KEY',
  };
  if (Object.hasOwn(codes, error.code)) return codes[error.code];
  // Inspect text only to classify; never emit text, stack, hostname or credentials.
  const message = typeof error.message === 'string' ? error.message : '';
  if (/authentication failed|bad auth/i.test(message)) return 'DATABASE_AUTH_FAILED';
  if (/certificate|tlsv1 alert|ssl routines/i.test(message)) return 'TLS_CONNECTION_FAILED';
  if (['MongoParseError', 'MongoInvalidArgumentError'].includes(error.name)) return 'DATABASE_URI_INVALID';
  const causes = [error.cause, error.reason];
  if (error.reason?.servers instanceof Map) {
    for (const server of error.reason.servers.values()) causes.push(server.error);
  }
  for (const cause of causes) {
    const code = classifyFailure(cause, depth + 1);
    if (code !== 'INTERNAL_ERROR') return code;
  }
  if (['MongoServerSelectionError', 'MongooseServerSelectionError'].includes(error.name)) return 'DATABASE_SERVER_UNREACHABLE';
  if (error.name === 'MongoNetworkError') return 'DATABASE_NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

export function logFailure(event, error) {
  console.error(JSON.stringify({ event, code: classifyFailure(error) }));
}
