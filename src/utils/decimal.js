// Financial values stay decimal strings or BigInt fractions until a bounded minor-unit integer.
export function decimal(value, { positive = false } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('INVALID_DECIMAL');
  const s = String(value);
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(s)) throw new Error('INVALID_DECIMAL');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole + fraction), d = 10n ** BigInt(fraction.length);
  if (positive && n === 0n) throw new Error('INVALID_DECIMAL');
  return { n, d };
}
export function fraction(n, d) {
  if (d <= 0n || n < 0n) throw new Error('INVALID_FRACTION');
  let a = n, b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}
export function fractionText({ n, d }, places = 6) {
  const scale = 10n ** BigInt(places), scaled = n * scale / d;
  return `${scaled / scale}.${String(scaled % scale).padStart(places, '0')}`.replace(/\.?0+$/, '') || '0';
}
export function inRange(value, min = '0', max = '1000') {
  try {
    const v = decimal(value), lo = decimal(min), hi = decimal(max);
    return v.n * lo.d >= lo.n * v.d && v.n * hi.d <= hi.n * v.d;
  } catch { return false; }
}
export function minorInteger(n) {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MONEY_OVERFLOW');
  return Number(n);
}
