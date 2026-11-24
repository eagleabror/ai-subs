# Phase 4 — Light Store buyurtma integratsiyasi

Mavjud universal katalog, CBU kursi/ustamalar, sandbox wallet/payment va order oqimlari saqlangan. Phase 4 yangi supplier hisobi, durable lifecycle, status reconciliation va himoyalangan yetkazish qatlamini qo‘shadi. **Productionda haqiqiy xarid, Light Store balansidan yechish va real payment yo‘q.** Botdagi mablag‘ sinov krediti bo‘lib qoladi.

Rasmiy manba: [Light Store API](https://light-store.net/api/), 2026-11-23 kuni tekshirilgan. Ushbu ishda jonli API kaliti yoki supplier purchase ishlatilmadi; endpoint kontraktlari rasmiy hujjatdan, E2E javoblari sintetik mocklardan.

## Endpointlar va amaldagi cheklov

| Endpoint | Implementatsiya |
| --- | --- |
| `GET /catalog`, `GET /catalog/{variant_id}` | Standard mahsulotning joriy maydonlari, narxi va qoldig‘i |
| `GET /balance` | API kaliti egasining RUB kopek balansi; faqat admin ko‘radi |
| `POST /order` | Rasmiy request builder va mock E2E; real transportda qat’iy bloklangan |
| `GET /order/{order_id}` | Standard status va `delivered_data` |
| `GET /orders?limit=100&offset=0` | Yo‘qolgan javobdan keyin avval tekshirish; narx/nom orqali taxminiy matching yo‘q |
| `GET /games/catalog`, `/games/game/{app_id}`, `/games/brand/{slug}`, `/games/mobile/{game_id}` | Avvalgi alohida katalog adapterlari va fresh tafsilotlar |
| `GET /games/steam/check?login=…` | Steam refill login tekshiruvi |
| `POST /games/quote` | Mablag‘ yechmaydigan supplier hisobi; rasmiy quote ID va amal muddati |
| `POST /games/order` | Rasmiy request builder va mock E2E; real transportda qat’iy bloklangan |
| `GET /games/order/{order_id}`, `GET /games/orders` | Games status/delivery va oxirgi buyurtmalar |

Bearer auth, header/body timeout, redirectsni rad etish va xavfsiz xato kodlari saqlanadi. Runtime transport faqat GET va **aniq `/games/quote` POST**ga ruxsat beradi. `createSupplierOrder()` har doim `REAL_PURCHASE_DISABLED` qaytaradi. `AUTO_PURCHASE_ENABLED=true` startupni rad etadi. Admin panelda bu himoyani chetlab o‘tadigan tugma/flag yo‘q.

Standard obunalar uchun rasmiy alohida quote endpointi/quote IDsi yo‘q. Ularning hisobi fresh katalog, bitta variant va balans GETlaridan olinadi, mahalliy **60 soniya** amal qiladi; `supplierQuoteId=null`. Bu supplierning narxni band qilish va’dasi emas. `/order` uchun expected-price/conditional-debit maydoni ham hujjatlashtirilmagan. Shu sabab standard xaridni kelajakda yoqishdan oldin supplier bilan narx o‘zgarishiga qarshi kafolat aniqlanishi kerak.

Games quote rasmiy javobidagi `expires_in` (ko‘pi bilan 180 soniya) bilan ishlaydi. Muddati so‘rov boshlanishidan konservativ hisoblanadi. `enabled`, joriy total narx va balans tekshiriladi; qoldiqni games quote supplier tomonda qayta tekshiradi. Games katalogida qoldiq yo‘qligi sun’iy stockka aylantirilmaydi.

## Mahsulot adapterlari

| Tur | Request / yetkazish |
| --- | --- |
| Digital subscription / standard mahsulot | `variant_id`, `quantity`, kerak bo‘lsa `user_input`; `delivered_data` oddiy matn/ko‘rsatma sifatida |
| License key | Games `kind=key`, `root=product_id`, `var=variant_id`; key natijasi |
| Gift card | `kind=voucher`, `root`, `var`, `qty`; region variantdan, kod natijasi |
| Steam game gift | `kind=gift`, `app_id`, `pkg`, `region`, `profile`; HTTPS Steam profil va fresh region; supplier ko‘rsatmalari |
| Steam refill | `kind=refill`, `login`, `cur`, `amount`; RUB/KZT/UAH, musbat butun amount; completed refill tasdig‘i |
| Telegram / mobil top-up | `kind=mobile`, `gid`, `pos`, `fields`; maydon nomlari o‘zgartirilmaydi, quantity-field chegaralari saqlanadi |

UI brendlarni yoki product IDlarni tarjima qilmaydi. `subscription`/`voucher`da miqdor qo‘llanadi; boshqa kindlar uchun bodydagi alohida buyurtma soni hujjatlashtirilmagan, shuning uchun bitta quote = bitta order. Paket ichidagi quantity-field alohida tekshiriladi. Refill uchun kasr amount hozir qabul qilinmaydi.

Server tanlash maydonining request nomi aniq hujjatlashtirilmagan mobile mahsulotlari, to‘liq bo‘lmagan input metadata, parol/secret/token talab qiluvchi mahsulotlar va noma’lum adapter kindlari avtomatik oqimga o‘tmaydi. Mavjud katalog yozuvlari yashirilmaydi; mijoz cheklov sababini ko‘radi. Butunlay yangi upstream schema kelganda mavjud Phase 2 parser fail-closed ishlaydi va `unsupportedTypes` diagnostikasini saqlaydi; noma’lum response tuzilmasi o‘ylab topilmaydi.

`activation_link`, `license_key`, `gift_card`, `instructions`, `recharge`, `manual` uchun alohida delivery formatlovchilar tayyor. Standard katalog `auto/manual`dan tashqari aniq delivery turini bermaydi, shuning uchun erkin matndan link yoki key taxmin qilinmaydi. Typed activation-link mapping qo‘shilsa HTTPS URL tekshiruvi ishlaydi; hozir standard payload umumiy ko‘rsatma sifatida beriladi. Recharge `completed` bo‘lsa xizmat bajarilgan deb olinadi; key/card/standard/giftda bo‘sh payload `manual_review`ga olib boradi.

## Saqlash, narx va lifecycle

Yangi `SupplierOrder` kolleksiyasi ichki UUID, user, source (`lightstore` yoki `mock`), sandbox rejim, product/variant/quote/order IDlari, idempotency identity, quantity/region, required field nomlari, price snapshot, expected profit, retry/lease/backoff, delivery va holatlar tarixini saqlaydi. Mijoz inputlari va tayyor request/delivery **AES-256-GCM** bilan shifrlanadi. Quote/GET javoblarining erkin matnli `details` yoki error bodylari logga yozilmaydi.

Holatlar: `pending_payment → supplier_quote_pending → supplier_quoted`; mock tasdiqda `payment_confirmed → supplier_ordering → supplier_processing → completed`. Xatolar `manual_review`, `failed`, zarur sandbox rezerv qaytarilishi `refunded`ga olib keladi. Bu oqimda quote to‘lovdan oldin olinadi. `payment_confirmed` **faqat sinov rezervi**, real payment isboti emas.

Transitionlar expected-state CAS bilan, version/history bilan atomik yoziladi. Sandbox tasdiq narxlash revision locki va wallet tranzaksiyasida amalga oshadi; parent `Order`ning narxi immutable qoladi. Ustama variant → mahsulot → kategoriya → global; joriy CBU kursi, freshness va FX buferi tekshiriladi. Games quote `price` butun buyurtma totalidir: Phase 4 uni bitta lot sifatida konvertatsiya qilib, ustama va yaxlitlashni bir marta qo‘llaydi (`priceBasis=supplier_total`, `ai-subs-supplier-v4.1`). Paket soniga qayta ko‘paytirilmaydi. Kutilgan foyda sotuv narxi minus FX buferli xarajat bo‘lib, bu haqiqiy RUB xarid kursi kafolati emas.

Mock tasdiqdan oldin fresh quote va narx qayta olinadi. Supplier narxi, kurs, ustama yoki region o‘zgarsa yangi fingerprint qaytariladi, rezerv yaratilmaydi; yangi hisobni qayta tasdiqlash kerak. Eski quote eskirgan bo‘lsa yangisini alohida olish kerak. Client tayyor narx yubora olmaydi. Keyingi o‘zgarishlar tasdiqlangan parent order narxini almashtirmaydi.

## Idempotency, recovery va limitlar

Supplier request IDsi birinchi purchase urinishidan oldin DBga yoziladi. Games quote ID va standard request body saqlanadi. Parallel submit CAS lease bilan bitta urinishga tushadi. Known supplier ID bo‘lsa faqat GET status qilinadi. Javob yo‘qolib ID bo‘lmasa avval rasmiy orders ro‘yxati tekshiriladi; bu listlar quote/idempotency identity qaytarmagani uchun price/title bo‘yicha matching qilinmaydi. **Faqat mock muhitda** o‘sha body/quote ID va `Idempotency-Key` bilan replay bajariladi. Yangi quote yoki yangi purchase identity avtomatik yaratilmaydi. Noma’lum ID bilan 3 submit urinishidan so‘ng manual review; production replay ham purchase guard tomonidan bloklangan.

401/403/404/409 va noto‘g‘ri schema qo‘lda tekshiruvga olib keladi. Tasdiqlangan purchase rad javobi 402 bo‘lsa sinov rezervi qaytariladi; status GETdagi 402 noaniqligi yangi refund/purchase sifatida talqin qilinmaydi. 429/503/network/timeout exponential backoff bilan saqlanadi. Poll kamida 10 soniyada. Worker lease 120 soniya; restartdan keyin saqlangan ID, deadline va retry metadata ishlatiladi. Quote bosqichida uzilgan yozuv `failed` qilinadi. Refunddan keyin local release xato bersa worker uni idempotent qaytarib tugatadi.

`SupplierBudget` kalit qiymatining o‘zini emas, hashini saqlaydi. Barcha app katalog/quote/status o‘qishlari bir umumiy MongoDB budget orqali, kamida 1.1 soniya oraliqda ketadi; limit 60/min dan past. Purchase budget primitive kamida 6.1 soniya, 10/min dan past; production xarid soni amalda nol. 429 `Retry-After` cooldown MongoDBda ham saqlanadi. Boshqa bot yoki CLI shu API kalitidan mustaqil foydalansa uning so‘rovlari bu budgetga kirmaydi: umumiy limiter yoki alohida kalit talab qilinadi.

## Yetkazish maxfiyligi

Statusni ko‘rish huquqi payloadni olish huquqi emas. Administrator faqat delivery holatini ko‘radi. Tayyor ma’lumot faqat `telegramId` order egasiga, private chatda, `protect_content` va o‘chirilgan link preview bilan yuboriladi. `sealed*` maydonlari odatiy DB select va servis public javoblaridan chiqarilgan. GCM context order IDga bog‘langan; ciphertext boshqa orderga ko‘chirilsa ochilmaydi. Kalit qiymati hech qayerda loglanmaydi.

Outbox holatlari: `ready → sending → sent`; Telegram javobi yo‘qolsa yoki worker yuborish paytida to‘xtasa `uncertain`. Telegram uchun exactly-once idempotency kafolati yo‘q: `uncertain` avtomatik qayta yuborilmaydi. Egasi **Natijani shaxsiy olish** orqali natijani ataylab yana ochishi mumkin. Mock natija doim “MOCK — haqiqiy mahsulot emas” deb belgilanadi. Telegramning kontent himoyasi foydalanuvchining qo‘lda ko‘chirib olishiga qarshi mutlaq kafolat emas.

## Telegram menyusi

Katalogdagi mahsulot/variant yoki Steam refill ekranida **Supplier hisobini tekshirish** → faqat supplier-defined maydonlar → yuborish oldidan izoh → **Supplier hisobini olish**. Quote talab qiluvchi o‘yinlar ham shu yo‘ldan tekshiriladi. Mijoz `/supplier_orders` bilan o‘z hisoblarini ko‘radi. Runtime’da bu ekran haqiqiy buyurtma yaratmaydi va sandbox mablag‘ ham rezerv qilmaydi; Phase 3ning alohida sinov checkouti saqlangan.

`/admin`: **Buyurtmalar**, **Supplier holati**, **Yetkazib berish**, **Muammoli buyurtmalar**, **Savdo statistikasi**, **Avtomatik xarid sozlamalari**. Holatni tekshirish tugmasi backoff/lease/idempotency qoidalarini saqlaydi. Settings xaridni yoqa olmaydi. Statistikada real tushum 0, mock va lightstore hisoblari alohida sanaladi.

## Muhit va Render

Yagona yangi secret: `FULFILLMENT_ENCRYPTION_KEY` — tasodifiy 32 baytning base64 qiymati. Lokal yordamchi:

```bash
npm run fulfillment:keygen
```

Kalit konsolga chiqarilmaydi; git-ignore qilingan `.fulfillment-key` fayliga `0600`, create-only bilan yoziladi. Uni `.env` yoki tasdiqlangan Render Environment o‘zgarishida xavfsiz sozlang. Mavjud kalitni almashtirish eski ciphertextni ocholmay qolishga olib keladi: backup/rotation/key-version migratsiyasi keyingi production tayyorgarligining qismi. Kalit chat, GitHub, log yoki PRga yuborilmasin.

Kalit yo‘q bo‘lsa mavjud bot, katalog, CBU, wallet ishlaydi; yangi input/quote/delivery bloklanadi. Noto‘g‘ri format startup validationda qiymatini ko‘rsatmasdan rad etiladi. Avvalgi barcha env nomlari va `AUTO_PURCHASE_ENABLED=false` saqlanadi. **Render secretlari o‘qilmadi/o‘zgartirilmadi, deploy/restart yoki yangi xizmat yaratilmagan.**

Kelajakdagi ruxsatli deploy `SupplierOrder`/`SupplierBudget` kolleksiya va indekslarini yaratadi; mavjud Atlas replica set yetarli. Free xizmat uyquda timerlarni bajarmaydi; uyg‘onganda DB deadline/lease bilan davom etadi. Production xaridni yoqish uchun alohida tasdiq, tekshirilgan real payment/reconciliation/refund tizimi, kalit boshqaruvi, jonli read-only kontrakt tekshiruvi, supplierning standard conditional-price/idempotency retention kafolatlari va monitoring kerak. Bu PRni env orqali live-purchase rejimiga aylantirib bo‘lmaydi.

## Xavfsiz test

```bash
npm ci
npm run check
npm run test:supplier
npm test
```

`test:supplier` faqat sintetik supplier va Telegram javoblari hamda vaqtinchalik MongoDB replica set bilan ishlaydi. `.env` o‘qilmaydi; production API key/Telegram/MongoDB kerak emas. Test MongoDB binarini birinchi marta yuklash uchun internet/lokal port kerak bo‘lishi mumkin. Mock gatewayda `fetch` yoki tashqi tarmoq transporti yo‘q va u runtime source’dan import qilinmaydi. Eski wallet/payment/katalog/kurs testlari to‘liq saqlangan.
