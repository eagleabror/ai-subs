import { randomUUID } from 'node:crypto';
import { CallbackStore, pageButtons } from '../keyboards/catalog.js';
import { MENU } from '../keyboards/main.js';
import { adminOnly } from '../middleware/admin.js';
import { formatMoney } from '../../utils/money.js';
import { parseTopup, TOPUP_MIN_UZS, TOPUP_MAX_UZS } from '../../services/payment.service.js';

const statuses = { pending: 'kutilmoqda', approved: 'sinov balansi qo‘shilgan', rejected: 'rad etilgan', cancelled: 'bekor qilingan', expired: 'muddati tugagan' };
const errors = { START_REQUIRED: 'Avval /start buyrug‘ini yuboring.', TOPUP_INVALID: `Summani ${TOPUP_MIN_UZS}–${TOPUP_MAX_UZS} UZS oralig‘ida, ko‘pi bilan 2 kasr xonasi bilan kiriting.`,
  ADMIN_ONLY: 'Bu bo‘lim faqat administrator uchun.', PAYMENT_PENDING: 'Sizda kutilayotgan so‘rov bor. “So‘rovlarim” bo‘limida tekshiring yoki bekor qiling.',
  PAYMENT_NOT_FOUND: 'So‘rov topilmadi.', PAYMENT_ALREADY_DECIDED: 'Bu so‘rov bo‘yicha qaror allaqachon qabul qilingan.',
  IDEMPOTENCY_CONFLICT: 'So‘rov o‘zgargan. Yangi so‘rov yarating.', WALLET_LIMIT: 'Sinov balansi limitiga yetildi.' };
const time = value => new Intl.DateTimeFormat('uz-UZ', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
export function registerWallet(bot, { wallets, payments, checkout, users, adminIds }) {
  const store = new CallbackStore({ prefix: 'wal', ttl: 5 * 60000 }), pending = new Map();
  const button = (ctx, text, route) => ({ text, callback_data: store.put(ctx.from.id, route) });
  const markup = rows => ({ reply_markup: { inline_keyboard: rows } });
  const home = ctx => [button(ctx, '⬅️ Balansga qaytish', { view: 'balance' })];
  const safely = fn => async ctx => { try { return await fn(ctx); } catch (error) { return ctx.reply(errors[error.code] || 'Amalni bajarib bo‘lmadi. Haqiqiy pul bilan operatsiya bajarilmaydi.'); } };
  async function render(ctx, route) {
    const b = (label, next) => button(ctx, label, next);
    if (route.admin) payments.authorize(ctx.from.id);
    if (route.view === 'balance') {
      await checkout?.releaseExpired(ctx.from.id);
      const wallet = await wallets.balance(ctx.from.id), real = await users.getWallet(ctx.from.id);
      return ctx.reply(`💼 Balans\nHaqiqiy balans: ${formatMoney(real?.balanceMinor ?? 0, 'UZS')}\n\n🧪 Sinov balansi: ${formatMoney(wallet.balanceMinor, 'UZS')}\nRezerv: ${formatMoney(wallet.reservedMinor, 'UZS')}\nFoydalanish mumkin: ${formatMoney(wallet.availableMinor, 'UZS')}\n\nSinov mablag‘i haqiqiy pul emas; uni yechib olish yoki mahsulot olish uchun ishlatib bo‘lmaydi.`, markup([
        [b('➕ Sinov balansini to‘ldirish', { view: 'input' })], [b('📋 So‘rovlarim', { view: 'payments' })], [b('📜 Sinov operatsiyalari', { view: 'history' })],
      ]));
    }
    if (route.view === 'input') {
      await wallets.account(ctx.from.id);
      if (pending.size >= 1000) pending.delete(pending.keys().next().value);
      pending.set(ctx.from.id, { expires: Date.now() + 300000, token: randomUUID() });
      return ctx.reply(`🧪 Sinov balansini to‘ldirish\nSummani UZSda kiriting (${TOPUP_MIN_UZS}–${TOPUP_MAX_UZS}).\nPul yubormang. Karta, chek, parol yoki boshqa to‘lov ma’lumoti kerak emas.`, markup([home(ctx)]));
    }
    if (route.view === 'request') {
      const payment = await payments.request(ctx.from.id, route.amount, route.token);
      return render(ctx, { view: 'payment', id: String(payment._id) });
    }
    if (route.view === 'payments') {
      const result = await payments.list(ctx.from.id, route);
      const rows = result.items.map(p => [b(`${formatMoney(p.amountMinor, 'UZS')} · ${statuses[p.status]}${route.admin ? ` · ${p.telegramId}` : ''}`, { view: 'payment', id: String(p._id), admin: route.admin, all: route.all })]);
      rows.push(...pageButtons(result, route, b));
      if (route.admin) rows.push([b(route.all ? '⏳ Kutilayotganlar' : '📜 Barcha so‘rovlar', { view: 'payments', admin: true, all: !route.all })]);
      rows.push(home(ctx));
      return ctx.reply(`🧪 ${route.admin ? 'Admin: sinov to‘lov so‘rovlari' : 'Sinov so‘rovlaringiz'} (${result.page + 1}/${result.pages})\n${result.items.length ? 'So‘rovni tanlang.' : 'So‘rov yo‘q.'}\nHaqiqiy to‘lov tekshirilmaydi yoki qabul qilinmaydi.`, markup(rows));
    }
    if (route.view === 'payment' || route.view === 'decision' || route.view === 'decide') {
      // Re-read stored amount and owner for every screen; callback never supplies a price.
      if (route.view === 'decide') await payments.decide(ctx.from.id, route.id, route.decision);
      const p = await payments.get(ctx.from.id, route.id, { admin: route.admin });
      let text = `🧪 Sinov so‘rovi: ${p._id}\nSumma: ${formatMoney(p.amountMinor, 'UZS')}\nHolat: ${statuses[p.status]}\nMuddati: ${time(p.expiresAt)} (Toshkent)`;
      if (route.admin) text += `\nTelegram ID: ${p.telegramId}`;
      if (p.decidedBy) text += `\nQaror: ${p.decidedBy} · ${time(p.decidedAt)} (Toshkent)`;
      const rows = [];
      if (p.status === 'pending') {
        if (route.view === 'decision') {
          text += route.decision === 'approved' ? '\n\nFaqat ko‘rsatilgan SINOV mablag‘i qo‘shiladi. Haqiqiy to‘lov sifatida qayd qilinmaydi. Tasdiqlaysizmi?' : '\n\nSo‘rov yopiladi, balans o‘zgarmaydi. Tasdiqlaysizmi?';
          rows.push([b('✅ Qarorni tasdiqlash', { ...route, view: 'decide' })]);
        } else if (route.admin) rows.push([b('✅ Sinov mablag‘ini qo‘shish', { ...route, view: 'decision', decision: 'approved' })], [b('❌ Rad etish', { ...route, view: 'decision', decision: 'rejected' })]);
        else rows.push([b('❌ So‘rovni bekor qilish', { ...route, view: 'decision', decision: 'cancelled' })]);
      }
      rows.push([b('⬅️ So‘rovlar', { view: 'payments', admin: route.admin, all: route.all })]);
      return ctx.reply(text, markup(rows));
    }
    if (route.view === 'history') {
      const result = await wallets.history(ctx.from.id, route.page);
      const names = { credit: 'Sinov krediti', reserve: 'Rezerv', release: 'Rezerv qaytarildi' };
      return ctx.reply(`📜 Sinov operatsiyalari (${result.page + 1}/${result.pages})\n${result.items.map(t => `${time(t.createdAt)} (Toshkent) · ${names[t.type]}\n${formatMoney(t.amountMinor, 'UZS')}\nBalans: ${formatMoney(t.balanceAfterMinor, 'UZS')} · rezerv: ${formatMoney(t.reservedAfterMinor, 'UZS')}`).join('\n\n') || 'Hali operatsiya yo‘q.'}`, markup([...pageButtons(result, route, b), home(ctx)]));
    }
  }
  bot.use((ctx, next) => {
    const text = ctx.message?.text;
    if (ctx.callbackQuery || (text && (text.startsWith('/') || Object.values(MENU).includes(text)))) pending.delete(ctx.from.id);
    return next();
  });
  bot.command('wallet', safely(ctx => render(ctx, { view: 'balance' })));
  bot.hears(MENU.balance, safely(ctx => render(ctx, { view: 'balance' })));
  bot.command('topup', safely(ctx => render(ctx, { view: 'input' })));
  bot.command('payments', adminOnly(adminIds), safely(ctx => render(ctx, { view: 'payments', admin: true })));
  bot.action(/^wal:/, safely(async ctx => {
    const route = store.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. /wallet yoki /payments ni qayta oching.');
    if (route) return render(ctx, route);
  }));
  bot.on('text', async (ctx, next) => {
    const entry = pending.get(ctx.from.id);
    if (!entry || entry.expires <= Date.now()) { pending.delete(ctx.from.id); return next(); }
    return safely(async () => {
      const amount = ctx.message.text.trim().replace(',', '.'), minor = parseTopup(amount);
      pending.delete(ctx.from.id);
      return ctx.reply(`🧪 So‘rovni yuborishdan oldin\nSinov summasi: ${formatMoney(minor, 'UZS')}\nAdmin tasdiqlasa sinov balansiga qo‘shiladi. Haqiqiy pul yubormang.`, markup([[button(ctx, '✅ Sinov so‘rovini yuborish', { view: 'request', amount, token: entry.token })], home(ctx)]));
    })(ctx);
  });
  return { adminButton: ctx => button(ctx, '🧪 To‘lov so‘rovlari', { view: 'payments', admin: true }) };
}
