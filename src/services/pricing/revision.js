import { PricingRevision } from '../../models/Pricing.js';
export async function ensurePricingRevision() {
  try { await PricingRevision.updateOne({ _id: 'global' }, { $setOnInsert: { revision: 0, fence: 0 } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
}
export async function fencePricing(session, changed = false) {
  return PricingRevision.findOneAndUpdate({ _id: 'global' }, { $inc: changed ? { revision: 1, fence: 1 } : { fence: 1 } }, { new: true, session }).lean();
}
