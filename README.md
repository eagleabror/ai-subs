# AI Subs — Phase 1

Telegram orqali raqamli obunalar do‘konining boshlang‘ich backend loyihasi. Node.js 22+ (22 LTS tavsiya etiladi), Express 5, Telegraf 4 va Mongoose 8; JavaScript ES Modules.

**Phase 1 faqat katalogni o‘qiydi.** Xarid, to‘lov, balansni to‘ldirish/yechish, buyurtmani bajarish va referal bonuslar yoqilmagan. `AUTO_PURCHASE_ENABLED=true` ishga tushirishni rad etadi. Supplier xarid metodi va to‘lov endpointi umuman mavjud emas.

## 1. Loyiha tuzilmasi

```text
src/
  bot/
    commands/       # /start va admin /supplier_status
    keyboards/      # O‘zbekcha bosh menyu va qaytish tugmasi
    handlers/       # Menyu bo‘limlari
    middleware/     # Admin ID tekshiruvi
    index.js        # Telegraf yig‘ilishi, shaxsiy chat filtri, xatolar
  services/
    lightstore.service.js # Faqat GET /catalog, parser, Gemini qidiruvi
    user.service.js       # Ro‘yxatdan o‘tish, balansni o‘qish
  models/           # User, Product, Order, Wallet, WalletTransaction
  routes/           # GET /health
  config/           # Muhit validatsiyasi va MongoDB ulanishi
  utils/            # Pul formati va xavfsiz xato xabarlari
  app.js            # Express ilovasini yaratish
  server.js         # Ishga tushirish va SIGINT/SIGTERM bilan yopish
scripts/            # Sintaksis va supplier ulanishini tekshirish
tests/             # Mock testlar va sun’iy katalog namunasi
docs/              # Tekshirilgan Light Store shartnomasi
render.yaml         # Render Blueprint
.github/workflows/  # Node 22 va 24 uchun CI
```

`/start` foydalanuvchini yangilaydi va faqat yangi hamyonni 0 balans bilan yaratadi. Takroriy `/start` mavjud balansni o‘zgartirmaydi. `telegramId` va hamyonning `user` maydoni unique indeksli. Indekslar bot ishga tushishidan oldin tayyorlanadi.

Product bitta supplier variantini ifodalaydi. Product narxi RUB kopekda, Wallet/Order/WalletTransaction summalari UZS tiyinda butun, xavfsiz sonlarda saqlanadi; valyuta konvertatsiyasi yo‘q. Product, Order va WalletTransaction uchun hozircha faqat sxemalar bor: avtomatik katalog sinxronlash, buyurtma yoki ledger yozish mavjud emas.

## 2. Muhit o‘zgaruvchilari

| O‘zgaruvchi | Qiymat va vazifasi |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather bergan maxfiy token; majburiy |
| `MONGODB_URI` | MongoDB/Atlas ulanish URI; majburiy |
| `LIGHTSTORE_API_KEY` | Light Store kabinetidagi maxfiy API kaliti; majburiy |
| `LIGHTSTORE_API_BASE_URL` | `https://api.light-store.net/api/v1`; majburiy |
| `ADMIN_TELEGRAM_ID` | Adminning musbat raqamli Telegram foydalanuvchi IDsi, username yoki chat ID emas; majburiy |
| `AUTO_PURCHASE_ENABLED` | Faqat `false`; berilmasa ham `false` |
| `PORT` | Lokal port, odatda `3000`; Render o‘z `PORT` qiymatini beradi |
| `LIGHTSTORE_TIMEOUT_MS` | Ixtiyoriy, odatda `10000`; 100–60000 ms |

`.env.example` ni `.env` ga nusxalang. Tokenlar va URI ichidagi parolni Gitga joylamang. `.env*` fayllar `.gitignore` da, faqat `.env.example` istisno. Loglarda xato kodi chiqariladi, tokenlar, MongoDB URI yoki supplierning xom javobi chiqarilmaydi.

Ishga tushishda muhit formati tekshiriladi. MongoDB ulanishi yoki Telegram autentifikatsiyasi muvaffaqiyatsiz bo‘lsa jarayon xato bilan tugaydi. Supplierga startup paytida avtomatik so‘rov yuborilmaydi: uni alohida tekshiring.

## 3. Lokal ishga tushirish

```bash
git clone https://github.com/eagleabror/ai-subs.git
cd ai-subs
# Phase 1 PR birlashtirilmagan bo‘lsa:
git switch feat/phase-1
cp .env.example .env
npm ci
```

`.env` qiymatlarini to‘ldiring. Lokal MongoDBni ishga tushiring yoki alohida Atlas bazasining URI sini kiriting. So‘ng:

```bash
npm run check
npm test
npm start
# Kod o‘zgarganda qayta ishga tushirish uchun:
npm run dev
```

`npm start` va `npm run dev` ni bir vaqtda ishga tushirmang. Bot long polling ishlatadi: bitta token uchun faqat bitta faol nusxa bo‘lsin. Telegraf polling boshlanishida shu botning eski webhookini olib tashlaydi. Alohida yangi test botidan foydalaning.

```bash
curl -i http://localhost:3000/health
```

MongoDB ulangan va Telegram `getMe` autentifikatsiyasidan o‘tilganida HTTP 200, aks holda 503 qaytadi. `bot: initialized` Telegram boshlang‘ich autentifikatsiyasini bildiradi; supplierning holati yoki har bir polling so‘rovining muvaffaqiyati uchun kafolat emas. Fatal polling xatosi jarayonni yopadi. Endpoint tokenlarni qaytarmaydi. Server `0.0.0.0:$PORT` da tinglaydi.

## 4. Renderga joylashtirish

1. Phase 1 PRni ko‘rib chiqing; `main` ga birlashtiring yoki sinov uchun Blueprint manbasida `feat/phase-1` ni tanlang.
2. MongoDB Atlasda alohida baza/foydalanuvchi yarating va Render chiqish IP manzillariga ulanish ruxsatini bering.
3. Render Dashboard → **New → Blueprint**, `eagleabror/ai-subs` repozitoriysini tanlang. `render.yaml` bitta Node web service yaratish uchun tayyorlangan.
4. `TELEGRAM_BOT_TOKEN`, `MONGODB_URI`, `LIGHTSTORE_API_KEY`, `ADMIN_TELEGRAM_ID` ni kiriting. `sync: false` ilk yaratilishda so‘raladi; keyingi o‘zgarishlar xizmatning Environment bo‘limida kiritiladi.
5. Compute plan faylda ataylab ko‘rsatilmagan: Render tanlovini va narxini tekshiring. Uzluksiz polling uchun uxlamaydigan pullik xizmat tanlang; free xizmatning uyqu holati bot javoblarini to‘xtatadi.
6. Build: `npm ci && npm run check && npm test`; Start: `npm start`; Health check: `/health`; instance soni: **1**. Avtomatik deploy o‘chirilgan.
7. Deploydan keyin `https://<xizmat>.onrender.com/health`, `/start` va admin `/supplier_status` ni tekshiring.

**Qayta deploy cheklovi:** Render rolling deploy paytida eski va yangi jarayon vaqtincha birga ishlashi mumkin. Long polling bir tokenning ikki nusxasini qo‘llamaydi (Telegram 409). Phase 1da yangilashni qisqa to‘xtash bilan bajaring: eski xizmatni to‘xtating/suspend qiling, keyin yangisini ishga tushiring; lokal bot ham o‘chiq bo‘lsin. Agar suspend/resume oqimi yangi commitni qo‘llamasa, eski xizmat to‘xtagan holda yangi Blueprint xizmatini yarating. Production uchun uzluksiz rolling deploy va ko‘paytirish kerak bo‘lsa, keyingi bosqichda webhook yoki bitta polling egasini ta’minlovchi mexanizm kerak.

Bu o‘zgarishlar Render xizmatini avtomatik yaratmaydi va deploy qilmaydi. Konfiguratsiya rasmiy [Blueprint hujjati](https://render.com/docs/blueprint-spec) asosida tayyorlangan; [JSON sxema](https://render.com/schema/render.yaml.json) orqali tekshirilgan.

## 5. Telegram botini tekshirish

Botga **shaxsiy chatda** yozing; guruhlardagi xabarlar e’tiborsiz qoldiriladi.

1. `/start`: o‘zbekcha salomlashuv va to‘rtta menyu tugmasi chiqadi; user/hamyon yaratiladi.
2. `🛒 Obuna sotib olish`: Gemini AI Plus 6 oylik variant bor-yo‘qligini ko‘rsatadi; xarid qilmaydi.
3. `💼 Balansim`: mavjud balansni ko‘rsatadi; o‘zgartirmaydi.
4. `👥 Referal`: dastur hali yoqilmaganligi xabari.
5. `ℹ️ Ma'lumot`: loyiha va sinov bosqichi haqida ma’lumot.
6. `⬅️ Bosh menyu`: asosiy menyuga qaytadi.
7. Admin `/supplier_status`: mos variantlarning product/variant IDsi, supplier narxi va qoldig‘i. Oddiy foydalanuvchi uchun taqiqlanadi va API chaqirilmaydi.
8. `/start` ni qayta yuboring: balans o‘zgarmasligini tekshiring.

Avtomatik testlar Telegram xabarlarini Telegraf middleware orqali mock qilib o‘tkazadi. Haqiqiy Telegramga xabar yuborilmaydi.

## 6. Light Store ulanishini tekshirish

Rasmiy hujjat: https://light-store.net/api/. Parser va cheklovlar: [docs/lightstore-api.md](docs/lightstore-api.md).

Tarmoq va credentials talab qilmaydigan supplier testlari:

```bash
node --test tests/lightstore.test.js
```

Kalit kiritilgandan keyin jonli **faqat o‘qish** tekshiruvi:

```bash
npm run supplier:check
```

Bu buyruq uchun faqat `LIGHTSTORE_API_KEY`, `LIGHTSTORE_API_BASE_URL` kerak; `AUTO_PURCHASE_ENABLED` false bo‘lishi shart. Telegram va MongoDBga ulanmaydi. Katalog mahsulotlari soni va mos Gemini variantlarini chiqaradi. Narx `supplierPriceMinor` maydonida RUB kopekda keladi. Kalitni konsolga chiqarmaydi. Botdagi `/supplier_status` ham shu servisni ishlatadi.

Mock testlar Bearer sarlavhasi, yagona GET yo‘li, parser, ID/narx/qoldiq, 6 oylik qidiruv, bo‘sh katalog, parallel so‘rovlarni birlashtirish, kesh, HTTP/tarmoq/JSON/sxema xatolari va timeoutni tekshiradi. Health test lokal vaqtinchalik HTTP port ochadi, tashqi servisga bormaydi. Mongoose testlari bazasiz validatsiya va mock orqali insert-only hamyon yaratishni tekshiradi; ular haqiqiy MongoDB integratsiya testi emas.

## Integratsiya holati va keyingi ishlar

- Kod hujjatdagi katalog tuzilmasiga mos; test fixturelari sun’iy, real narx va ID emas.
- Haqiqiy Telegram/Atlas/Light Store ulanishi credentials bo‘lmagani uchun tekshirilmagan.
- Ishga tushirish uchun token, MongoDB URI, supplier kaliti va admin IDni to‘ldirish kerak.
- Keyingi bosqich: haqiqiy katalog bilan nomlarni tasdiqlash, zarur bo‘lsa Product sinxronlash, sotuv narxi/valyuta siyosati, to‘lovlar, atomik wallet ledger, idempotent buyurtma va yetkazish, referal qoidalari, webhook. Bular Phase 1ga kiritilmagan.
