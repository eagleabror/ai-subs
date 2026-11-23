# Phase 3: sinov wallet, to‘lov so‘rovlari va rezervli buyurtmalar

Bu kengaytma `main`ga birlashtirilgan Phase 3 narxlash kodining davomi. Mavjud katalog, CBU kursi, admin ustamalari va narx snapshotlari saqlanadi. Yangi to‘lov oqimi **faqat sandbox**: admin tasdig‘i haqiqiy to‘lov olinganini anglatmaydi. Bot karta, chek, parol yoki boshqa to‘lov ma’lumotlarini so‘ramaydi; supplier xaridini bajarmaydi. To‘lov provayderi endpointi taxmin qilinmagan.

## Telegramdan foydalanish

1. `/start`, keyin **💼 Balansim** yoki `/wallet`: haqiqiy balans, alohida sinov balansi, rezerv va foydalanish mumkin bo‘lgan sinov summasini ko‘ring.
2. **➕ Sinov balansini to‘ldirish** yoki `/topup`: 1 000–10 000 000 UZS orasida, ko‘pi bilan 2 kasr xonali summani kiriting. Masalan, `1000,01` yoki `1000.01`. Oldindan ko‘rsatilgan summani **Sinov so‘rovini yuborish** bilan tasdiqlang. **Haqiqiy pul yubormang.**
3. Admin `/admin → 🧪 To‘lov so‘rovlari` yoki `/payments` orqali kutilayotgan so‘rovni tanlaydi. Summa va Telegram IDni ko‘rib, sinov mablag‘ini qo‘shish yoki rad etishni tanlaydi, keyin qarorni alohida tasdiqlaydi.
4. Mijoz **So‘rovlarim** orqali holatni ko‘radi; kutilayotgan so‘rovni bekor qilishi mumkin. **Sinov operatsiyalari** kredit, rezerv va qaytarish tarixini sahifalab ko‘rsatadi.
5. Universal katalogdan mahsulot/variant/miqdor tanlab sinov buyurtmasini yarating. Tasdiq paytida joriy supplier narxi/qoldig‘i, kurs va ustama qayta tekshiriladi. Narx o‘zgarsa qayta tasdiqlash kerak. Sinov balansi yetarli bo‘lmasa order yaratilmaydi.
6. Tasdiqlangan order summasi sinov balansida 30 minut band bo‘ladi. `/orders` orqali order tafsilotini ochib, **Buyurtmani bekor qilish → Bekor qilishni tasdiqlash** bilan rezervni qaytaring. Yetkazish yoki real debit bajarilmaydi.

Vaqtlar Telegramda Toshkent vaqtida ko‘rsatiladi. Callbacklar user IDga bog‘langan, tasodifiy tokenlardan iborat va 5 minut amal qiladi. Eski tugma ishlamasa tegishli buyruqni qayta oching. Admin ruxsati mavjud `ADMIN_TELEGRAM_ID` orqali, har bir servis amali va admin ekranida tekshiriladi. Bot guruh chatlarida bu oqimlarni bajarmaydi.

## Saqlash va hisoblash

- `SandboxWallet`: userga bitta alohida sinov wallet; `balanceMinor` jami kredit, `reservedMinor` band qism. Foydalanish mumkin bo‘lgan miqdor — ularning farqi. Valyuta UZS, birlik tiyin.
- `PaymentRequest`: o‘zgarmas summa, user, `provider=sandbox`, idempotency kaliti; holatlar `pending → approved / rejected / cancelled / expired`. Yakuniy qaror kim va qachon bergani saqlanadi. Bir userga bir paytda faqat bitta kutilayotgan so‘rov; 24 soatda eskiradi.
- `SandboxWalletTransaction`: append-only servis yozuvlari — `credit`, `reserve`, `release`; summa, keyingi balans/rezerv, admin yoki user IDsi, payment/order havolasi va noyob idempotency kaliti. API orqali tahrirlash yoki o‘chirish amali mavjud emas.
- `Order`: oldingi narx snapshoti saqlanadi; `fundingStatus=unreserved / reserved / released`, rezerv muddati va bekor qilish sababi qo‘shilgan. Oldingi sandbox orderlar rezervsiz o‘qiladi va bekor qilinadi. Eski real/legacy orderlar bu oqimga kiritilmaydi.

**Production `Wallet` va `WalletTransaction` kolleksiyalari yozish uchun ishlatilmaydi.** Mavjud real balans faqat ko‘rsatiladi. `/start`ning avvalgi insert-only wallet yaratishi saqlangan. Yangi sinov kreditlari real walletga ko‘chirilmaydi va ularni yechish/capture/debit yo‘li yo‘q.

Summa o‘nlik satrdan `BigInt` yordamida tiyingacha aniq o‘tkaziladi; keyin faqat xavfsiz butun son saqlanadi. Client yoki callback yuborgan narxga ishonilmaydi: to‘lov qarori DBdagi summa bo‘yicha, order rezervi server hisoblagan va mijoz tasdiqlagan snapshot bo‘yicha bajariladi.

Har bir balans/ledger/payment/order o‘zgarishi MongoDB tranzaksiyasida. Wallet yozuvidagi revision bir userning parallel mutatsiyalarini ketma-ketlashtiradi. Unique indekslar va idempotency kalitlari takroriy tasdiqda ikkinchi kredit/rezerv/qaytarish yaratilishiga yo‘l qo‘ymaydi. Approval/cancel va expiry/cancel poygalari bitta yakuniy holatga keladi. Xato yoki yetarli mablag‘ bo‘lmasa tranzaksiya to‘liq qaytariladi.

## Eskirish va qayta ishga tushish

Server startupda va har 60 soniyada eskirgan payment so‘rovlarini yopadi hamda muddati tugagan sinov rezervlarini bo‘shatadi. Order `cancelled`, rezerv `released` bo‘ladi; narx snapshoti o‘zgarmaydi. Bir siklda 100 tagacha rezerv tekshiriladi, qolganlari keyingi siklda. Balans/buyurtmalar ekranini ochish va yangi tasdiq ham foydalanuvchining eskirgan rezervlarini tekshiradi.

Render Free uxlaganda timer ishlamaydi; qayta ishga tushganda DBdagi muddatlar bo‘yicha davom etadi. Rezervlar xotiradagi timerga bog‘liq emas. Mijoz xohlagan payt faol sandbox orderni o‘zi bekor qilishi mumkin.

## Render va integratsiya

Yangi secret yoki environment variable talab qilinmaydi. Mavjud CBU/narxlash sozlamalari va `AUTO_PURCHASE_ENABLED=false` saqlanadi. Rejim kodda faqat sandbox: real to‘lovni tasodifan yoqadigan flag yo‘q. Yangi xizmat, pullik resurs, deploy yoki restart bu ish doirasida bajarilmaydi.

Keyingi ruxsat berilgan deploy yangi uchta kolleksiya va indekslarni yaratadi; mavjud MongoDB Atlas replica set yetarli. Schema/index initialization tugagach bot polling boshlanadi. Oldingi commitga rollback qilinsa yangi kolleksiyalarni o‘chirmang: u sinov rezervlarini avtomatik bo‘shatmaydi; yangi kodga qaytganda expiry davom etadi. Real wallet migratsiyasi yo‘q.

Jonli to‘lov ulash alohida ish: provayder tanlash, uning rasmiy hujjati va sandbox credentiallari, imzolangan webhook autentifikatsiyasi, provider transaction idempotency, reconciliation hamda refund oqimi talab qilinadi. Supplier fulfillment hujjatlari va ruxsati bo‘lmaguncha haqiqiy mablag‘ debit/capture qilinmaydi. Ushbu botdagi admin sinov tasdig‘ini haqiqiy payment webhook o‘rnida ishlatmang.

## Testlar

`npm run check` va `npm test`. Yangi testlar vaqtinchalik MongoDB replica setida, production credentiallarisiz ishlaydi: aniq summa parsingi, admin/ownership, parallel takroriy request/approval, approval-cancel poygasi, expiry/restart, ledger xatosida rollback, overflow, yetarli bo‘lmagan balans, parallel orderlarda overspend, narx o‘zgarishi, rezerv/cancel/expiry, pagination va real wallet o‘zgarmasligi. Telegram testlari preview/tasdiq, admin menyu, foreign callback, group cheklovi va bekor qilishni qamraydi. Oldingi barcha testlar ham bajariladi.
