# Light Store API shartnomasi

Manba: https://light-store.net/api/ — 2026-11-23 kuni rasmiy sahifaning HTML qismidagi `GET /catalog` hujjati o‘qildi. Ayrim matnli brauzer ko‘rinishlarida JSON misoli ko‘rinmaydi; HTML ichida misol mavjud.

Tasdiqlangan ulanish:

- Asosiy manzil: `https://api.light-store.net/api/v1`.
- `Authorization: Bearer <kalit>` bilan `GET /catalog`.
- Javob: `ok`, `currency`, `categories[]`.
- Kategoriya: `category_id`, `title`, `products[]`.
- Mahsulot: `product_id`, `title`, `variants[]`.
- Variant: `variant_id`, `title`, `price`, `price_rub`, `in_stock`, `available`, `max_quantity`, `delivery`, `requires_input`, `input_prompt`.
- `price` — RUB kopeklarda butun son; `price_rub` — rublda. Hisob-kitob uchun `price` ishlatiladi.
- `in_stock` hujjat misolida son, `available` esa boolean.

Kod faqat `GET /catalog` yuboradi; katalog filtrlari, alohida variant, balans va xarid endpointlariga so‘rov yo‘q. API kaliti URLga qo‘shilmaydi. Redirect taqiqlangan. Timeout sarlavha va JSON javobini kutishni qamrab oladi. 401/403, 429, boshqa HTTP xatolari, tarmoq xatosi, timeout, noto‘g‘ri JSON, `ok: false` va sxema mos kelmasligi alohida qayta ishlanadi. Upstream xato matni va maxfiy javoblar foydalanuvchiga yoki logga chiqarilmaydi.

Katalog muvaffaqiyatli o‘qilganda 30 soniyaga jarayon xotirasida saqlanadi; parallel so‘rovlar birlashtiriladi. Avtomatik retry yo‘q. Kesh narxi kafolatlangan sotuv taklifi emas. `/health` supplierga so‘rov yubormaydi.

Gemini qidiruvi mahsulot va variant nomlarini tekshiradi: `Gemini`, `AI Plus` va 6 oylik muddat (`6 months`, `6-month`, `6m`, `6 oy`, `6 oylik`, `6 месяцев`, `6 мес.`). Barcha mos variantlar qaytadi, birinchi variant avtomatik tanlanmaydi. Pro va Plus bir xil mahsulot deb olinmaydi. ID, narx va qoldiq faqat javobdan olinadi.

## Hali tasdiqlanmagan tafsilotlar

Ochiq hujjatda Gemini AI Plus 6 oylik mahsulotining joriy IDsi, aniq nomlanishi, narxi yoki qoldig‘i berilmagan. API kalitisiz ular tekshirilmagan. Nom boshqacha bo‘lsa, qidiruv 0 natija beradi; bu katalogda bunday obuna mutlaqo yo‘q degan kafolat emas.

Ochiq hujjat JSON misolini beradi, lekin mashina o‘qiydigan to‘liq tip shartnomasi, null qiymatlar yoki cheksiz qoldiq uchun maxsus qiymatni aniqlamaydi. Parser noma’lum formatni taxmin qilmaydi: `INVALID_SCHEMA` qaytaradi. Yetkazib beruvchi shartnomani o‘zgartirsa, uning tasdiqlangan javobi asosida parser va testlarni yangilash kerak.

`tests/fixtures/catalog.json` rasmiy tuzilma asosidagi **sun’iy** ma’lumotdir. Undagi ID, nom, narx va qoldiq real katalogdan olinmagan. Testlar haqiqiy supplierga murojaat qilmaydi.
