# Light Store: Phase 2 API shartnomasi

Manba: https://light-store.net/api/ — 2026-11-23 kuni rasmiy sahifaning HTMLidagi GET hujjatlari va JSON misollari o‘qildi. Misollardagi raqamlar joriy inventar emas.

Asosiy URL `https://api.light-store.net/api/v1`; autentifikatsiya `Authorization: Bearer <kalit>`. Hujjatdagi limit: bitta kalit uchun 60 so‘rov/minut. Faqat quyidagi GET yo‘llari kodda bor; POST, xarid, buyurtma yoki balans operatsiyalari qo‘shilmadi.

| Yo‘l | Javob shartnomasi va adapter |
| --- | --- |
| `/catalog` | `ok`, `currency:RUB`, `categories[]`: `category_id,title,products[]`; mahsulot: `product_id,title,variants[]`; variant: `variant_id,title,price,in_stock,available,max_quantity,delivery,requires_input,input_prompt`. `subscriptions.adapter.js` |
| `/games/catalog` | `ok,currency:RUB,price_unit:kopecks`; `steam_games[]` (`app_id,title,price,gift_available,key_available`), `gift_cards[]` (`slug,title,regions_count`), `telegram[]`/`mobile_games[]` (`game_id,title`), `steam_refill` (`rates,mk`). `games.adapter.js` |
| `/games/game/{app_id}` | `ok,game`: `app_id,title,editions[]` (`package_id,title,regions[]:{region,price}`), `keys[]` (`product_id,variant_id,title,region,price`) |
| `/games/brand/{slug}` | `ok,title,products[]`: `product_id,region,variants[]:{variant_id,title,stock,price}` |
| `/games/mobile/{game_id}` | `ok,game_id,title,fields` nom→label obyekti, `servers` key→label obyekti, `quantity_field`, `positions[]:{position_id,title,price}`; erkin miqdorda `quantity_min/quantity_max` |

`price` butun RUB kopekda; `price_rub` faqat tushuntirish uchun, pul hisobida ishlatilmaydi. Games narxi supplierning o‘z ustamasini allaqachon o‘z ichiga oladi. AI Subs faqat konfiguratsiyadagi mahalliy ustamani qo‘shadi; supplier ustamasi qayta qo‘shilmaydi.

Supplier category/product/variant ID va title saqlanadi. Games bo‘limlarida category ID yo‘q; mahalliy kategoriya va `null` supplierCategoryId ishlatiladi. Steam game `app_id`, gift card `slug`, mobile/Telegram `game_id` mahsulot kalitiga kiradi. Steam gift variantida `package_id + region`, key/card variantida `product_id + variant_id`, mobile variantida `position_id` ishlatiladi. Tur/source prefiksi kolliziyalarni ajratadi. Asl variant nomi va region alohida saqlanadi. Bir xil takroriy qatorlar birlashtiriladi; zid ma’lumotli bir xil ID butun snapshotni rad etadi.

## Input va hali to‘liq bo‘lmagan shartnomalar

- `/catalog`dagi `requires_input=true` uchun hujjatdagi kelajak buyurtma maydoni **`user_input`**, label esa `input_prompt`. Metadata yo‘q bo‘lsa miqdor tanlash bloklanadi. Parol yoki boshqa qo‘shimcha maydon o‘zimizdan yaratilmaydi.
- Steam gift uchun `profile` (Steam profil havolasi) hujjatlashtirilgan; region variantdan olinadi. Key/card uchun ortiqcha input yo‘q.
- Mobile/Telegram `fields` kalitlari aynan saqlanadi: masalan `Input1` `Username` labeliga ega bo‘lishi mumkin. U avtomatik `email` yoki boshqa nomga aylantirilmaydi.
- `servers` variantlari saqlanadi. Hujjat misolida server qiymati qaysi `fields` kalitiga tegishli ekanini aniq ko‘rsatuvchi mapping yo‘q; serverli mahsulot input sxemasi to‘liq deb belgilanmaydi, miqdor tanlash o‘chadi.
- Erkin Stars/TON miqdori uchun `quantity_field`, `quantity_min/max` saqlanadi. Hujjat yakuniy narx uchun `/games/quote`ni talab qiladi; Phase 2 bu POSTni chaqirmaydi va bunday variantga hisoblangan sotuv narxini bermaydi.
- Steam refill uchun `login,cur,amount` hujjatlashtirilgan input metadatasi, `rates/mk` saqlanadi. Sobit narx/variant ID mavjud emas; refill ko‘rinadi, ammo miqdor tanlash yo‘q. Uning rates maydonlari UZS kursi emas.
- Steam gift/key hamda mobile/Telegram tafsilotlarida aniq stock yo‘q: `null` saqlanadi. Steam mavjudlik bayroqlari root katalogdagi `gift_available/key_available`dan olinadi, mobile/Telegram availability esa `null` qoladi va UI “ko‘rsatilmagan” deydi. `null`ni cheksiz yoki nol qoldiq deb talqin qilmaymiz. Mavjud paketning miqdori faqat ko‘rish uchun; kelajak checkout supplier quote orqali qayta tasdiqlashi kerak.
- `/games/catalog`da yangi, noma’lum yuqori darajadagi kalitlar statusda `unsupportedTypes` sifatida ko‘rsatiladi. Ularga taxminiy endpoint yoki parser qo‘shilmaydi; yangi metadata kaliti bo‘lsa ham tekshirish talab etiladi.

Hujjat to‘liq OpenAPI sxemasini, barcha null/tip variantlarini yoki cheksiz qoldiq belgisini bermaydi. Parser hujjatdagi shaklni talab qiladi; mos kelmagan javob `INVALID_SCHEMA`. Tasdiqlangan yangi supplier javobi asosidagina adapter va fixture kengaytirilishi kerak.

Kesh 30 soniya, GET navbati 1.1 soniya oralig‘ida; 429 uchun `Retry-After` yoki 60 soniya. Redirect yo‘q, timeout header/body o‘qishni qamraydi. HTTP 401/403/429, tarmoq, timeout, JSON, API `ok:false` va sxema xatolari xavfsiz kod bilan qaytariladi. Log yoki UIga kalit, HTTP body, stack yoki xom upstream error chiqmaydi.

`tests/fixtures/catalog.json` Phase 1, `tests/fixtures/universal.js` Phase 2 uchun **sun’iy** fixturelar. To‘liq ikkinchi fixture 7 kategoriya, 14 mahsulot, 15 variantdan iborat. Ular real supplier inventari yoki jonli kursni isbotlamaydi. Real sonlar credentials mavjud muhitda `supplier:check` va to‘liq `/catalog_sync`dan keyin aniqlanadi.
