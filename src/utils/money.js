export function formatMoney(minor, currency) {
  return new Intl.NumberFormat('uz-UZ', { style: 'currency', currency }).format(minor / 100);
}
