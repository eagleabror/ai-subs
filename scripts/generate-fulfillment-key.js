import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
try {
  writeFileSync('.fulfillment-key', randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  console.log('Kalit .fulfillment-key fayliga saqlandi. Uni FULFILLMENT_ENCRYPTION_KEY sifatida xavfsiz sozlang; chat yoki Gitga yubormang.');
} catch {
  console.error('Kalit fayli yaratilmadi. Mavjud kalit ustiga yozilmaydi; fayl va ruxsatlarni tekshiring.'); process.exitCode = 1;
}
