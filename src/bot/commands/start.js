import { mainKeyboard } from '../keyboards/main.js';
export const startCommand = (users) => async (ctx) => {
  await users.register(ctx.from);
  return ctx.reply('Assalomu alaykum! AI Subs do‘koniga xush kelibsiz! 🤖\nAI obunalarini shu yerda ko‘rishingiz mumkin.\nHozir sinov bosqichi: xarid va to‘lovlar hali yoqilmagan.\nQuyidagi menyudan bo‘lim tanlang:', mainKeyboard());
};
