import { Markup } from 'telegraf';
export const MENU = Object.freeze({ buy: '🛒 Obuna sotib olish', balance: '💼 Balansim', referral: '👥 Referal', info: "ℹ️ Ma'lumot", back: '⬅️ Bosh menyu' });
export const mainKeyboard = () => Markup.keyboard([[MENU.buy], [MENU.balance, MENU.referral], [MENU.info]]).resize();
export const backKeyboard = () => Markup.keyboard([[MENU.back]]).resize();
