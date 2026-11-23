# Phase 3: CBU kursi, narxlash paneli va sinov buyurtmalari

Bu ish mavjud `main` (Phase 2) ustiga qurilgan. Tekshiruv paytida repozitoriy branchlari va PRlarida alohida Phase 3 wallet/payment implementatsiyasi topilmadi. `User`, `Wallet`, `WalletTransaction`, mavjud order sxemasi va oldingi testlar saqlangan. Noma’lum payment provayderi o‘ylab topilmadi. Order oqimi **sandbox**: haqiqiy mablag‘ yechilmaydi, rezerv qilinmaydi, to‘lov qabul qilinmaydi, supplierga xarid yuborilmaydi.

## Rasmiy kurs manbasi

- Hujjat: https://cbu.uz/uz/arkhiv-kursov-valyut/veb-masteram/
- JSON: https://cbu.uz/uz/arkhiv-kursov-valyut/json/
- `Ccy === "RUB"` bo‘lgan yagona yozuv olinadi; `Rate`, `Nominal`, `Date` tekshiriladi. `Nominal` musbat butun son, `Rate` musbat o‘nlik satr bo‘lishi kerak. `Date` rasmiy `DD.MM.YYYY` formatidan ISO sanaga o‘tkaziladi; mavjud bo‘lmagan/future sanalar rad etiladi.
- `rubToUzs = Rate / Nominal`. Natija aniq surat/maxraj bilan saqlanadi; masalan, nominal bo‘linishi cheksiz kasr bersa ham settlement aniqligi yo‘qolmaydi. Ko‘rsatish uchun 6 kasr xonali qisqartirilgan satr ishlatilishi mumkin; yakuniy hisob doimo aniq kasr bilan bajariladi.
- `ExchangeRateService` startupda MongoDBdagi oxirgi kursni darhol ishlatadi va fonda yangilashni boshlaydi. Takroriy interval 360 minut, jarayon ishlayotgan paytda. Bir jarayondagi parallel refreshlar birlashtiriladi. Free Render uyquda bo‘lsa timer ishlamaydi; uyg‘onish/startupda refresh takrorlanadi.
- Samarali sana O‘zbekiston vaqti (UTC+5) bo‘yicha solishtiriladi. `FX_MAX_AGE_DAYS=7`; oxirgi muvaffaqiyatli fetch uchun `FX_MAX_FETCH_AGE_HOURS=48`. Chegaradan oshgan, nol, null, noto‘g‘ri, kelajak sanali yoki eski sanaga qaytuvchi javob yaroqli cache o‘rniga yozilmaydi.
- Dam olish/bayramda sana o‘zgarmasligi xato emas. Shu kurs yana to‘g‘ri olinganda fetch vaqti yangilanadi; effective date o‘zgarmaydi. API uzoq ishlamasa yaroqli cache limitgacha ishlaydi, keyin yangi hisob/checkout o‘chadi. Eski tasdiqlangan orderlar o‘zgarmaydi.
- Timeout, HTTP, schema va tarmoq xatolari xavfsiz kodlarda saqlanadi. Upstream body yoki maxfiy ma’lumot loglanmaydi. `/admin` kurs ekranida manba, rejim, kurs, amal sanasi, fetch vaqti va xato ko‘rinadi.

Jonli, faqat o‘qish diagnostikasi (MongoDB va token talab qilmaydi):

```bash
npm run fx:check
```

2026-11-23 dagi ishlab chiqish tekshiruvida CBU endpointi `RUB`, `Rate="146.56"`, `Nominal="1"`, `Date="21.11.2026"` qaytardi. Bu README misolidan olinmagan, o‘sha paytdagi rasmiy javob; runtime ichiga doimiy kurs sifatida yozilmagan va production bazasiga kiritilmagan. Codex muhitida native fetch uchun tarmoq proxy sozlamasi kerak bo‘ldi: Node 24’da `NODE_USE_ENV_PROXY=1 npm run fx:check` bilan parser va jonli javob tekshiruvi muvaffaqiyatli o‘tdi. Bu diagnostika bayrog‘i production konfiguratsiyasiga qo‘shilmadi.

CBU kursi reference kursidir. Supplier uchun amaldagi RUB xarid xarajati farq qilishi mumkin. `FX_COST_BUFFER_PERCENT` va admin panelidagi FX bufer sozlamasi shu farqni qoplash uchun; bu avtomatik ravishda haqiqiy supplier kursini aniqlamaydi.

## Rejimlar va eski sozlamalar

`FX_RATE_MODE=auto` bilan `RUB_TO_UZS_RATE` talab qilinmaydi. `FX_RATE_MODE` umuman berilmagan, ammo eski `RUB_TO_UZS_RATE` mavjud bo‘lsa, u bir marta `legacy` kurs sifatida import qilinadi va auditga yoziladi. Kurs va rejim MongoDBda saqlangach, restart admin tanlovini almashtirmaydi. Qo‘lda/legacy kurs ham freshness limitlariga bo‘ysunadi; eski qiymat restart orqali asossiz yangilanmaydi.

Admin qo‘lda kurs kiritsa, yangi kurs, administrator IDsi, oldingi/yangi holat va vaqt auditga tranzaksiyada yoziladi. Avtomatik refresh bu paytda CBU cache’ini yangilashi mumkin, lekin manual rejimni o‘chirmaydi. **Avtomatik kursga qaytish** tasdiqlansa, eng so‘nggi maqbul CBU kursi ishlatiladi. U bo‘lmasa yangi checkout o‘chiq qoladi. Envdagi rejimni almashtirish mavjud DB override’ni yashirin bekor qilmaydi; paneldagi tugmadan foydalaning.

## Ustama va aniq hisob

Ustuvorlik: **variant → mahsulot → kategoriya → umumiy standart**. Mahalliy sozlamalar MongoDBda. `PRODUCT_MARKUP_OVERRIDE` eski qiymatlari bir marta import qilinadi; reset qilingan mahsulotga eski env override qayta qo‘llanmaydi. Supplier sync kategoriya, mahsulot, variant ustamalarini yoki yashirish holatini almashtirmaydi.

Standartlar: `DEFAULT_MARKUP_PERCENT=20`, `ROUNDING_INCREMENT_UZS=1000`, `FX_COST_BUFFER_PERCENT=0`. Admin ustama chegarasi `MARKUP_MIN_PERCENT=0`, `MARKUP_MAX_PERCENT=1000`; konfiguratsiyadagi maksimal himoya chegarasi 100000%. Noto‘g‘ri default/range yoki yaroqli narx bera olmaydigan summa checkoutni o‘chiradi. Foizlar ko‘pi bilan 6 kasr xonasini qabul qiladi.

Hisob tartibi:

1. Supplier RUB kopek narxi × aniq RUB/UZS kursi = UZS tiyin xarajati.
2. FX xarajat buferi qo‘llanadi.
3. Meroslash orqali topilgan ustama qo‘llanadi.
4. Birlik narxi yaxlitlash qadamigacha yuqoriga yaxlitlanadi.
5. Birlik narxi miqdorga ko‘paytiriladi.

Barcha moliyaviy arifmetika `BigInt` kasrlarda. Faqat xavfsiz butun tiyin summasi `Number`ga o‘tkaziladi. Converted cost ekranda tiyingacha yuqoriga yaxlitlangan ko‘rinishda chiqadi; haqiqiy sotuv hisobi bu ko‘rinishdan emas, aniq kasrdan foydalanadi. Server callback ichidagi hech qanday tayyor mijoz narxiga ishonmaydi.

## Telegram admin paneli

`/admin` → **💰 Narxlarni boshqarish**:

- **💱 RUB/UZS kursi**: manba/freshness, qo‘lda kurs, auto rejimga qaytish, FX buferi.
- **📊 Umumiy ustama**: barcha meros oluvchi mahsulotlar uchun.
- **📁 Kategoriya ustamasi**: istalgan katalog kategoriyasi.
- **📦 Mahsulot ustamasi**: kategoriya → mahsulot; pagination va barcha kategoriyalarda nom bo‘yicha qidiruv.
- **🎯 Variant ustamasi**: kategoriya → mahsulot → variant.
- **⚙️ Yaxlitlash sozlamalari**: UZS qadami.
- **🔄 Kursni yangilash**: rasmiy CBU GET; to‘lov amali emas.
- **📜 Narx o‘zgarishlari tarixi**: admin ID, vaqt, oldingi/yangi qiymat; sahifalangan.

Mahsulot/variant ekrani supplier RUB narxi, kurs, UZS xarajat, FX buferli xarajat, joriy ustama manbasi va sotuv narxini ko‘rsatadi. Mahsulot/kategoriya uchun dastlabki 3 variant narxi namuna sifatida olinadi; to‘liq variantlar alohida variant menyusida tanlanadi. Mahsulotlar qattiq ro‘yxatga bog‘lanmagan; yashirilgan/olib tashlangan yozuvlar boshqaruvda saqlanadi.

**Ustamani o‘zgartirish** → foiz kiriting → oldindan hisob → **Tasdiqlash va saqlash**. **Standart ustamaga qaytish** individual override’ni olib, yuqori darajadan meros olishni tiklaydi. Mahsulotni yashirish/yoqish ham tasdiq va auditdan o‘tadi. Eski `/set_markup`, `/hide_product`, `/enable_product` buyruqlari productionda shu preview/audit oqimiga yo‘naltiriladi.

Admin faqat `ADMIN_TELEGRAM_ID` (bitta yoki vergulli IDlar) bo‘yicha aniqlanadi. Komanda, callback va servis mutatsiyalarining hammasida ruxsat tekshiriladi. Callbacklar tasodifiy server tokeni, admin IDga bog‘langan; input va preview 5 minut amal qiladi. Boshqa admin narxni o‘zgartirsa, supplier sync yoki kurs yangilanishi bajarilsa, eski preview saqlanmaydi — yangi hisobni qayta tasdiqlash kerak.

## Buyurtma xavfsizligi

Mijoz katalog tafsilotidagi **🧪 Sinov buyurtmasi** tugmasidan foydalanadi. Supplier cache chetlab o‘tilib GET orqali narx va qoldiq yangidan tekshiriladi, joriy kurs va ustamalar bilan serverda quote tuziladi. Mijozga jami va **pul yechilmasligi, mahsulot yetkazilmasligi** aniq ko‘rsatiladi.

Tasdiqda yana fresh supplier GET, mavjudlik/qoldiq/miqdor limiti, FX freshness, mahsulot holati va ustama tekshiriladi. Natija o‘zgarsa yangi quote qaytariladi va yangi callback bilan qayta tasdiq kerak. Eskirgan quote yoki eski tugma yangi narxni yashirin qabul qila olmaydi. Takroriy/parallel tasdiqlar bitta idempotent orderga olib keladi.

`PricingRevision` yozuvi admin/FX mutatsiyalari va order confirmation tranzaksiyalarini ketma-ketlashtiradi. Quote o‘zgarganini aniqlashda faqat o‘sha effective rate’ning fetch vaqti yoki yetarli qoldiq sonining almashishi yangi narx deb olinmaydi; freshness va stock baribir tekshiriladi.

Orderga supplier narxi, UZS summa, quantity, rate/nominal/surat/maxraj, manba, sana, fetch vaqti, FX buferi, ustama/manbasi, yaxlitlash va `ai-subs-pricing-v3.1` hisob versiyasi snapshot qilinadi. Tasdiqlangan summa va snapshot immutable. Keyingi rate/ustama o‘zgarishi eski orderga ta’sir qilmaydi. `/orders` oxirgi 10 ta sinov buyurtmasini ko‘rsatadi.

Aniq stock/availability bermaydigan yoki supplier quote talab qiladigan Steam/mobile/Telegram turlari universal katalogda qoladi, ammo sandbox tasdiqqa ham majburan o‘tkazilmaydi. Supplier quote/input mapping keyingi integratsiyada hujjat asosida yakunlanishi kerak. Production `Wallet` va `WalletTransaction`ga checkout yozmaydi.

## Render: amaldagi xizmat saqlangan

Xizmat: https://dashboard.render.com/web/srv-dc2508u8bjmc739kl5j0 (`ai-subs-bot`, Free, main, autoDeploy off, /health). Yangi xizmat/Blueprint yaratilmagan, restart/deploy bajarilmagan.

Render MCP ulanishi tekshirildi. `update_environment_variables` kalitlarni merge qiladi, lekin [rasmiy MCP implementatsiyasi](https://github.com/render-oss/render-mcp-server/blob/main/pkg/service/tools.go) qiymatlarni yozgach `TriggerDeploy` chaqiradi. Unda `save only` parametri yo‘q. Shu sabab ushbu vosita ishlatilmadi. Cloud Browser’dagi Render Dashboard sign-in talab qildi; sessiya yo‘q. CLI mavjud emas. Secretlar olinmadi va chiqarilmadi.

[Kerakli non-secret qiymatlar](render-phase3-variables.json) tayyorlangan, lekin **Renderga hali yozilmagan**. Dashboard’ning Environment bo‘limida faqat shu 8 kalitni qo‘shing/yangilang va **Save only** ni tanlang. `TELEGRAM_BOT_TOKEN`, `MONGODB_URI`, `LIGHTSTORE_API_KEY`, `LIGHTSTORE_API_BASE_URL`, `ADMIN_TELEGRAM_ID` saqlansin. To‘liq `.env.example`ni production ustiga import qilmang: unda bo‘sh secret placeholderlari bor.

Qo‘shimcha ixtiyoriy standartlar: `FX_MAX_FETCH_AGE_HOURS=48`, `FX_TIMEOUT_MS=10000`, `MARKUP_MIN_PERCENT=0`, `MARKUP_MAX_PERCENT=1000`. Cache/overrides/audit/quote kolleksiyalari uchun mavjud MongoDB Atlas replica set yetarli; real wallet migratsiyasi yo‘q. App defaultlari yangi env kiritilmaganda ham xavfsiz ishlaydi; explicit auto eski legacy rate rejimini chetlash uchun kerak bo‘lishi mumkin.

PRni merge yoki deploy qilish uchun alohida ruxsat kerak. Keyingi tasdiqlangan deploydan so‘ng `/health`, `/admin` kurs ekrani, barcha ustama darajalari, `/catalog_sync` va sandbox qayta tasdiq oqimini tekshiring. Free xizmat uyqusi kurs/sync timerlarini to‘xtatishini hisobga oling.

## Tekshiruvlar va qolgan integratsiya

```bash
npm run check
npm test
npm run fx:check
```

Testlar CBU parser/nominal, aniq kasrlar, bayram/stale holati, API/timeout, cache/restart, manual/auto va audit, 6 soat timer, ustama meroslash/reset, yaxlitlash, Telegram admin authorization, supplier sync, o‘zgargan quote, idempotent confirm va real wallet o‘zgarmasligini qamraydi. Barcha Phase 1/2 testlari ham bajariladi. Integratsiya testlari o‘z vaqtinchalik MongoDB replica setida; production bazaga ulanmaydi.

Qolganlari: Render non-secret qiymatlarini Save only bilan kiritish; keyin alohida tasdiqlangan deploy va jonli smoke test; agar boshqa Phase 3 branchdagi payment/wallet kodi mavjud bo‘lsa, uni aniqlash va shu snapshot shartnomasi bilan birlashtirish. Real payment provayderi, supplier purchase/quote va fulfillment bu PRda yoqilmaydi.
