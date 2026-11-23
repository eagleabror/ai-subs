import { CBU_URL, fxConfig } from '../src/config/fx.js';
import { parseCbu, rateAcceptable } from '../src/services/exchange-rate.service.js';
import { fractionText } from '../src/utils/decimal.js';
try {
  const response = await fetch(CBU_URL, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('CBU_HTTP_ERROR');
  const rate = parseCbu(await response.json());
  console.log(JSON.stringify({ sourceUrl: CBU_URL, ...rate, rubToUzsDisplay: fractionText({ n: BigInt(rate.numerator), d: BigInt(rate.denominator) }), acceptable: rateAcceptable(rate, fxConfig({ FX_RATE_MODE: 'auto' })) }, null, 2));
} catch { console.error('CBU kursi tekshirilmadi: tarmoq, sana yoki javob formatini tekshiring.'); process.exitCode = 1; }
