export const adminOnly = (adminTelegramId) => async (ctx, next) => {
  if (!ctx.from || !String(adminTelegramId).split(',').map(id => id.trim()).includes(String(ctx.from.id))) {
    return ctx.reply('Bu buyruq faqat administrator uchun.');
  }
  return next();
};
