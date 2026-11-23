// Synthetic IDs/prices. Shapes follow https://light-store.net/api/; no live inventory.
export const subscriptions = { ok: true, currency: 'RUB', categories: [
  { category_id: 100, title: 'AI obunalar', products: Array.from({ length: 8 }, (_, index) => ({
    product_id: 200 + index, title: index === 0 ? 'Example AI [Plus]' : `Example AI ${index}`,
    variants: [{ variant_id: 300 + index, title: '1 month', price: 12345, in_stock: 7, available: true,
      max_quantity: 5, delivery: 'auto', requires_input: false, input_prompt: '' },
      ...(index === 0 ? [{ variant_id: 400, title: '12 months', price: 50000, in_stock: 0, available: false, max_quantity: 0, requires_input: true, input_prompt: 'Account email' }] : [])],
  })) },
  { category_id: 101, title: 'Design', products: [{ product_id: 220, title: 'Example Design', variants: [{ variant_id: 320, title: 'Pro', price: 7000, in_stock: 2, available: true, requires_input: true, input_prompt: 'Username' }] }] },
] };
export const games = { ok: true, currency: 'RUB', price_unit: 'kopecks',
  steam_games: [{ app_id: 50, title: 'Example Steam Game', price: 17000, gift_available: true, key_available: true }],
  gift_cards: [{ slug: 'example-card', title: 'Example Gift Card', regions_count: 1 }],
  telegram: [{ game_id: 60, title: 'Example Telegram Stars' }],
  mobile_games: [{ game_id: 70, title: 'Example Mobile Game' }],
  steam_refill: { rates: { RUB: 80, KZT: 500, UAH: 42 }, mk: 1.1 },
};
export const steam = { ok: true, game: { app_id: 50, title: 'Example Steam Game',
  editions: [{ package_id: 51, title: 'Standard', regions: [{ region: 'RU', price: 18480 }] }],
  keys: [{ product_id: 40, variant_id: 41, title: 'Standard', region: 'GL', price: 17000 }],
} };
export const gift = { ok: true, title: 'Example Gift Card', products: [{ product_id: 40, region: 'US', variants: [{ variant_id: 41, title: '5 USD', stock: 10, price: 46200 }] }] };
export const telegram = { ok: true, game_id: 60, title: 'Example Telegram Stars', fields: { Input1: 'Username' }, servers: {}, quantity_field: null, positions: [{ position_id: 20, title: '50 Stars', price: 7349 }] };
export const mobile = { ...telegram, game_id: 70, title: 'Example Mobile Game', fields: { Input1: 'Game ID', Input2: 'Region' }, servers: { eu: 'Europe' } };
