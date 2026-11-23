export function formatMoney(minor, currency) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('INVALID_MONEY');
  const value = BigInt(minor);
  // Intl accepts decimal strings without first rounding a large amount through Number.
  const decimal = `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  return new Intl.NumberFormat('uz-UZ', { style: 'currency', currency }).format(decimal);
}
