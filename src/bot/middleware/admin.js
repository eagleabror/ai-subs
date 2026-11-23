export const adminOnly = (adminTelegramId) => async (ctx, next) => {
  if (!ctx.from || String(ctx.from.id) !== String(adminTelegramId)) {
    return ctx.reply('Bu buyruq faqat administrator uchun.');
  }
  return next();
};
