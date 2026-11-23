# AI Subs — Phase 3: kurs, narxlash va sinov wallet/to‘lovlar

Telegram orqali Light Store raqamli mahsulotlari katalogi. Node.js 22+, Express 5, Telegraf 4, MongoDB/Mongoose 8; JavaScript ES Modules.

Katalog Gemini bilan cheklanmaydi. Phase 2 universal katalogi saqlangan; Phase 3 CBU kursi, Telegram narxlash paneli, alohida sinov wallet, admin tasdiqlaydigan sinov to‘lov so‘rovlari va rezervli sinov buyurtmalarini qo‘shadi. Batafsil: [narxlash](docs/phase3-pricing.md) va [wallet/to‘lov qo‘llanmasi](docs/phase3-wallet-payments.md). Mijoz kategoriyalar → mahsulotlar → variantlar → tafsilot → miqdor yo‘lidan foydalanadi. **Haqiqiy xarid, to‘lov va balansdan pul yechish o‘chirilgan.** `AUTO_PURCHASE_ENABLED=true` ishga tushirishni rad etadi. Kod supplierga faqat hujjatlashtirilgan GET so‘rovlarini yuboradi.

## Tuzilma

```text
src/
  bot/
    commands/       # /start, supplier diagnostikasi, katalog/narx admin buyruqlari
    handlers/       # Bosh menyu, katalog, qidiruv, miqdor
    keyboards/      # Menyu va foydalanuvchiga bog‘langan callback tokenlari
    middleware/     # Admin ID tekshiruvi
  services/
    lightstore.service.js     # GET, Bearer, timeout, kesh, API tezlik chegarasi
    catalog/                  # /catalog va /games/* uchun alohida adapterlar
    catalog.service.js        # MongoDB sync, pagination, qidiruv, admin sozlamalari
    pricing.service.js        # Aniq RUB → UZS hisobi
    exchange-rate.service.js  # CBU kursi, kesh, yangilanish va eskirish
    pricing/                  # Dinamik ustamalar, admin preview va audit
    checkout.service.js       # Sinov hisobi, qayta tasdiq, immutable snapshot
    user.service.js           # Phase 1 ro‘yxatdan o‘tish va hamyon o‘qish
  models/           # Eski 5 model + CatalogCategory/Product/Variant, SyncState, PricingSettings
  config/           # Muhit tekshiruvi, MongoDB ulanishi va indekslar
  routes/health.js  # Maxfiy ma’lumotsiz readiness
  utils/            # Pul formati va xavfsiz xato kodlari
  app.js
  server.js
scripts/            # Sintaksis va GET ulanish tekshiruvi
tests/              # Supplier/Telegram mocklari va lokal MongoDB integratsiya testlari
docs/lightstore-api.md
```

Phase 1 `Product` modeli o‘zgarmadi; u avval bitta supplier variantini ifodalagan. Yangi katalog alohida kolleksiyalarda saqlanadi. `User`, `Wallet`, `WalletTransaction` ma’lumotlari o‘zgartirilmaydi. `Order` eski yozuvlarga mos qoladi va yangi `sandbox_confirmed` turi bilan kengaytiriladi. `/start`, balans, referal, ma’lumot, `/supplier_status` va `/health` saqlangan. `/supplier_status` eski Gemini diagnostikasidir; universal katalog uchun yangi admin buyruqlaridan foydalaning.

## Muhit o‘zgaruvchilari

| O‘zgaruvchi | Vazifasi |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Mavjud BotFather tokeni; majburiy, maxfiy |
| `MONGODB_URI` | MongoDB Atlas yoki replica set URI; majburiy, maxfiy |
| `LIGHTSTORE_API_KEY` | Mavjud supplier kaliti; majburiy, maxfiy |
| `LIGHTSTORE_API_BASE_URL` | `https://api.light-store.net/api/v1` |
| `ADMIN_TELEGRAM_ID` | Mavjud musbat foydalanuvchi ID; bir nechta admin uchun vergul bilan ajratish mumkin |
| `AUTO_PURCHASE_ENABLED` | Faqat `false` |
| `LIGHTSTORE_TIMEOUT_MS` | Odatda `10000`, chegarasi 100–60000 ms |
| `PORT` | Lokal `3000`; Render bergan qiymat ishlatiladi |
| `FX_RATE_MODE` | `auto`; bazada saqlangan admin rejimi restartdan keyin saqlanadi |
| `FX_CBU_URL` | `https://cbu.uz/uz/arkhiv-kursov-valyut/json/` |
| `FX_REFRESH_INTERVAL_MINUTES` | `360` |
| `FX_MAX_AGE_DAYS` | Kursning amal qilish sanasi uchun limit: `7` kun |
| `FX_MAX_FETCH_AGE_HOURS` | Oxirgi muvaffaqiyatli fetch limiti: `48` soat |
| `FX_TIMEOUT_MS` | CBU header/body timeout: `10000` ms |
| `FX_COST_BUFFER_PERCENT` | FX xarajat buferi: `0`; admin orqali o‘zgartiriladi |
| `MARKUP_MIN_PERCENT`, `MARKUP_MAX_PERCENT` | Admin ustamasining xavfsiz oralig‘i: `0`–`1000` |
| `RUB_TO_UZS_RATE` | Eski sozlama mosligi; `FX_RATE_MODE` ko‘rsatilmaganida bir martalik legacy import. `auto`da kerak emas |
| `DEFAULT_MARKUP_PERCENT` | Standart ustama, odatda `20`; 0–1000, ko‘pi bilan 6 kasr xonasi |
| `PRODUCT_MARKUP_OVERRIDE` | Eski mahsulot ustamalarini MongoDBga bir marta import qiladi; yangi sozlamalar `/admin`da |
| `ROUNDING_INCREMENT_UZS` | Yuqoriga yaxlitlash qadami, odatda `1000` UZS; musbat, tiyin aniqligida |

Mavjud muhit nomlari o‘zgarmadi. `.env.example` nusxasini `.env` qilib, maxfiy qiymatlarni o‘sha yerda saqlang. Ularni Gitga yoki chatga yubormang. Avtomatik rejimda kurs rasmiy CBU JSON manbasidan har 6 soatda olinadi; samarali sana va fetch vaqti bo‘yicha eskirish tekshiriladi. Administrator qo‘lda override yoki avtomatik rejimni tanlashi mumkin. Supplierning `steam_refill.rates` maydoni UZS kursi sifatida ishlatilmaydi.

Ustama ustuvorligi: variant → mahsulot → kategoriya → umumiy. Asosiy sozlamalar MongoDBda, env faqat boshlang‘ich standart va legacy import uchun. FX xarajat buferi ustamadan oldin qo‘llanadi. Hisob `BigInt` va o‘nlik satrlardan foydalanadi: RUB kopek × kurs × (1 + FX bufer/100) × (1 + ustama/100) = UZS tiyin. Har bir birlik narxi ko‘rsatilgan qadamgacha yuqoriga yaxlitlanib, keyin miqdorga ko‘paytiriladi. Supplier va sotuv narxi alohida saqlanadi; ko‘rishda joriy sozlamalar bilan qayta hisoblanadi. Noto‘g‘ri narx sozlamasi botni yiqitmaydi, narxlashni o‘chiradi.

## Lokal ishga tushirish

```bash
git clone https://github.com/eagleabror/ai-subs.git
cd ai-subs
# PR ko‘rib chiqilayotganda:
git switch feat/phase-3-pricing
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

Sinov uchun alohida Telegram bot va alohida baza ishlating. **MongoDB replica set talab qilinadi**: Atlas mos keladi; oddiy standalone `mongod` katalog tranzaksiyalarini bajara olmaydi. Lokal muhitda replica setni sozlang. Testlar o‘zining bir tugunli vaqtinchalik replica setini yaratadi; `.env` dagi bazaga ulanmaydi. Dastlabki test MongoDB 7.0.24 binarini yuklaydi, internet va lokal port ochishga ruxsat kerak. Keyingi testlar `/tmp/ai-subs-test-mongodb` keshidan foydalanadi.

`npm run dev` avtomatik qayta ishga tushiradi. Bitta token uchun bir vaqtning o‘zida faqat bitta polling jarayoni ishlasin. `curl -i http://localhost:3000/health`: MongoDB ulangan va Telegram autentifikatsiyasi bajarilganida 200, aks holda 503. Supplier holati readinessga kiritilmagan; katalog vaqtincha ishlamasa ham qolgan menyu ishlaydi.

## Sinxronlash va saqlash

- Startup va har 5 daqiqada `/catalog` hamda `/games/catalog` yangilanadi. Bot starti supplier javobini kutmaydi.
- `/catalog_sync` barcha topilgan games mahsulotlarining tafsilotlarini ham ketma-ket yuklaydi. Katta katalog bir necha daqiqa olishi mumkin; `/catalog_status` holatni ko‘rsatadi. Buyruq pollingni uzoq bloklamaydi. Jarayon qayta ishga tushsa, buyruqni qayta yuboring; upsertlar takrorlanishga chidamli.
- Games mahsuloti ochilganda ham tafsilotlari yuklanadi/yangilanadi. Shu sabab to‘liq sync tugamaguncha variantlar soni qisman bo‘lishi mumkin. Yashirilgan mahsulotlar to‘liq sync’da yangilanadi, mijozga chiqmaydi.
- IDlar `source + tur + supplier ID` bilan nomlanadi, unique indekslar dublikatga yo‘l qo‘ymaydi. Games bo‘limlari uchun supplier category ID bermaydi: mahalliy bo‘lim kaliti ishlatiladi, supplier ID `null` qoladi. Steam refill uchun ham sun’iy supplier product/variant ID yaratilmaydi.
- Har bir manba va games mahsuloti muvaffaqiyatli, to‘liq tekshirilgan snapshotdan keyin tranzaksiyada yangilanadi. Oldingi qoldiq/narx yangilanadi; yo‘qolgan yozuvlar `present=false` bo‘ladi. Jismoniy o‘chirish yo‘q. API/schema/DB xatosida oldingi snapshot saqlanadi. Ikki manbaning holati mustaqil.
- MongoDB lease va tranzaksiya eski worker yozuvlarini to‘sadi. Mahalliy `hidden`, `enabled`, `markupOverride` supplier sync bilan almashtirilmaydi.
- HTTP kesh 30 soniya, eng ko‘pi 200 javob; parallel bir xil GET birlashtiriladi. Umumiy navbatda so‘rov oralig‘i kamida 1.1 soniya (hujjatdagi 60/min chegarasidan past), 20 ta kutilayotgan yo‘l chegarasi bor. 429 da `Retry-After` hurmat qilinadi; bo‘lmasa 60 soniya tanaffus. Tanaffus paytida yangi so‘rov tezda xavfsiz xato qaytaradi, APIga bormaydi.
- 15 daqiqadan eski variant, yo‘q narx, tugagan qoldiq, to‘liq bo‘lmagan input sxema yoki quote talab qiluvchi variantda miqdor tanlash o‘chadi. UI miqdori 1–99, supplier `stock`/`max_quantity` chegarasidan oshmaydi. Bu faqat ko‘rish hisobidir; haqiqiy checkout yo‘q, faqat alohida tasdiqlanadigan sinov buyurtmasi bor.

## Telegram va admin tekshiruvi

`/admin` → **Narxlarni boshqarish** orqali kurs, global/kategoriya/mahsulot/variant ustamasi, yaxlitlash va tarixni oching. O‘zgarishni kiriting, oldindan hisobni ko‘ring, so‘ng tasdiqlang. `/wallet` va `/topup` sinov balansini boshqaradi; `/admin → To‘lov so‘rovlari` yoki `/payments` admin tasdig‘i uchun. `/orders` sinov buyurtmalarini sahifalab ko‘rsatadi va bekor qilish imkonini beradi. Buyurtma summasi faqat sinov balansida 30 minut band bo‘ladi; bekor qilish/expiry rezervni qaytaradi. Pul yubormang.

Botga shaxsiy chatda `/start` yuboring. `🛒 Obuna sotib olish` endi barcha kategoriyalarni ochadi. Sahifa 6 ta elementdan iborat; keyingi/oldingi/orqaga tugmalari bor. `🔎 Mahsulot qidirish` yoki `/search` orqali nom bo‘yicha qidiring. Brendlar o‘zgartirilmaydi; qidiruv regex belgilarini oddiy matn sifatida oladi. Qidiruv holati 5 daqiqa, callbacklar 15 daqiqa yashaydi; restartdan keyin katalogni qayta ochish kerak. Callbacklar qisqa, taxmin qilib bo‘lmaydigan va foydalanuvchi IDga bog‘langan.

| Admin buyrug‘i | Natija |
| --- | --- |
| `/catalog_sync` | Ikkala katalog va barcha games tafsilotlarini sinxronlash |
| `/catalog_status` | Sonlar, oxirgi muvaffaqiyat, xavfsiz API/schema xato kodlari, noma’lum bo‘limlar |
| `/products_count` | Kategoriya, mahsulot, saqlangan variant va yuklangan games tafsilotlari soni |
| `/pricing_settings` | Kurs, umumiy ustama, yaxlitlash va xato sozlamalari |
| `/product_settings <nom yoki kalit>` | Dastlabki 6 mos mahsulotning boshqaruv kaliti, holati, ustamasi va tafsilot xatosi; yashirilganlar ham ko‘rinadi |
| `/set_markup <foiz>` | Umumiy ustama preview va tasdiqlash oynasi |
| `/set_markup <foiz> <kalit>` | Bitta mahsulot ustamasi uchun preview va auditli tasdiq |
| `/hide_product <kalit>` | Mahsulotni yashirish va o‘chirish |
| `/enable_product <kalit>` | Mahsulotni qayta ko‘rsatish; supplierda yo‘q mahsulotni mavjud qilib qo‘ymaydi |
| `/supplier_status` | Phase 1 Gemini diagnostikasi, o‘zgarmagan |

Oddiy foydalanuvchi bu buyruqlar bilan supplierga yoki boshqaruv yozuvlariga kira olmaydi. Mahsulot sahifasi zarur email/username/region/game ID va boshqa supplier maydonlarini faqat **tavsiflaydi**. Phase 3 sinov checkout ham shaxsiy ma’lumot, parol yoki karta ma’lumotlarini yig‘maydi; yetkazish activation link deb taxmin qilinmaydi.

## Light Store ulanishini tekshirish

Rasmiy hujjat: https://light-store.net/api/. Tekshirilgan yo‘llar va cheklovlar: [API shartnomasi](docs/lightstore-api.md).

```bash
npm run supplier:check
```

Bu buyruq faqat ikki asosiy katalogni GET qiladi, kategoriya nomlari va sonlarini chiqaradi. MongoDB/Telegram kerak emas; `LIGHTSTORE_API_KEY` va bazaviy URL kerak. Games tafsilotlarini olmagani uchun uning variantlar soni yakuniy emas; buni chiqishdagi `variantsComplete` bildiradi. To‘liq sonlar uchun botda `/catalog_sync`, keyin `/products_count` ishlating. Kalit va xom xato javoblari chiqarilmaydi. Ulangan bot ishlayotganda diagnostikani ko‘p marta parallel ishga tushirmang: 60/min limit API kaliti bo‘yicha umumiy.

Test fixturelarida **7 kategoriya, 14 mahsulot, barcha detail javoblari yuklangach 15 variant** bor. Bu jonli katalog statistikasi emas. Ushbu ishlab chiqish muhitida supplier kaliti yo‘q; real kategoriya/mahsulot/variant soni tasdiqlanmagan. Fixturelar asosiy katalogning 2 kategoriyasi va games’ning 5 hujjatlashtirilgan bo‘limini qoplaydi.

## Render va deployment ta’siri

Bu PR amaldagi Render xizmatini o‘zgartirmaydi va deploy qilmaydi. Keyingi tasdiqlangan deploy uchun mavjud **ai-subs-bot / Free** xizmatidan foydalaning; yangi resurs yoki pullik Blueprint kerak emas.

1. PRni ko‘rib chiqib `main`ga birlashtiring. Mavjud Environment qiymatlarini saqlang; `FX_RATE_MODE=auto` va [Phase 3 muhit qiymatlarini](docs/render-phase3-variables.json) faqat kerakli kalitlar bo‘yicha qo‘shing. `AUTO_PURCHASE_ENABLED=false` qolsin.
2. Mavjud Build `npm ci`, Start `npm start`, health check `/health`, branch `main`, instance **1** bo‘lsin. Testlar CI’da bajariladi; production ishga tushishi test MongoDBsini talab qilmaydi. Repositorydagi oldingi Phase 1 Blueprintni qayta qo‘llash shart emas.
3. Deploy yangi katalog kolleksiyalari/indekslarini yaratadi. Eski balans, order va to‘lov yozuvlari o‘zgarmaydi. Yaroqli avtomatik yoki qo‘lda kurs yo‘q bo‘lsa bot ishlaydi, yangi checkout bloklanadi.
4. Build/startup loglari, `database_indexes_ready`, `telegram_initialized`, `/health`, `/catalog_status` va `/pricing_settings` ni tekshiring. `/catalog_sync`ni ishga tushirib so‘ng katalog oqimini tekshiring.
5. Free xizmat uxlaganda polling va davriy sync ham to‘xtaydi. Uyg‘onganda root katalog yangilanadi. Rolling deployda eski va yangi polling jarayonlari vaqtincha to‘qnashishi mumkin (Telegram 409); bitta tokenning faqat bir faol nusxasi bo‘lishini ta’minlang.

Orqaga qaytishda oldingi commitni deploy qilish mumkin: Phase 1 kolleksiyalari o‘zgarmagan. Yangi kolleksiyalarni o‘chirish talab qilinmaydi. Haqiqiy to‘lov, real wallet debit/reservation, supplier quote va yetkazish ulanmagan. Sinov rezervlarini boshqarish uchun yangi kod kerak; eski commit expiry workerini ishga tushirmaydi. Batafsil rollback va xavfsizlik qoidalari [wallet/to‘lov qo‘llanmasida](docs/phase3-wallet-payments.md).
