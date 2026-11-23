import { supplierErrorMessage } from '../../utils/errors.js';
import { formatMoney } from '../../utils/money.js';
export const supplierStatusCommand = (supplier) => async (ctx) => {
  let offers;
  try { offers = await supplier.findGeminiSixMonthOffers(); }
  catch (error) { return ctx.reply(supplierErrorMessage(error)); }
  const lines = ['Light Store katalogi o‘qildi (kesh: 30 soniyagacha).', `Gemini AI Plus 6 oylik: ${offers.length} ta mos variant.`];
  for (const offer of offers.slice(0, 10)) {
    lines.push(`Mahsulot ID: ${offer.productId}; variant ID: ${offer.variantId}\n${offer.title.slice(0, 100)}\nYetkazib beruvchi narxi: ${formatMoney(offer.supplierPriceMinor, offer.currency)}\nQoldiq: ${offer.stock}; mavjud: ${offer.available ? 'ha' : 'yo‘q'}`);
  }
  if (offers.length > 10) lines.push('Faqat dastlabki 10 variant ko‘rsatildi.');
  lines.push('Xarid o‘chirilgan. Narx sotuv narxi emas.');
  return ctx.reply(lines.join('\n\n'));
};
