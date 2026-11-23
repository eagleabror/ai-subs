import { User, SandboxWallet, SandboxWalletTransaction } from '../models/index.js';
import { minorInteger } from '../utils/decimal.js';
export class WalletError extends Error { constructor(code) { super(code); this.code = code; this.name = 'WalletError'; } }
export const pageIndex = page => Number.isSafeInteger(page) && page >= 0 ? Math.min(page, 100000) : 0;
export const validObjectId = id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
export class SandboxWalletService {
  async init() { await SandboxWallet.init(); await SandboxWalletTransaction.init(); }
  async account(telegramId) {
    const user = await User.findOne({ telegramId: String(telegramId) }).lean();
    if (!user) throw new WalletError('START_REQUIRED');
    try { await SandboxWallet.updateOne({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    return user;
  }
  async balance(telegramId) {
    const user = await this.account(telegramId), wallet = await SandboxWallet.findOne({ user: user._id }).lean();
    return { ...wallet, availableMinor: wallet.balanceMinor - wallet.reservedMinor };
  }
  async history(telegramId, page = 0) {
    const wallet = await this.balance(telegramId), filter = { wallet: wallet._id };
    const total = await SandboxWalletTransaction.countDocuments(filter), pages = Math.max(1, Math.ceil(total / 5)), current = Math.min(pageIndex(page), pages - 1);
    return { items: await SandboxWalletTransaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip(current * 5).limit(5).lean(), page: current, pages, total };
  }
  // Every mutation must be in its caller's MongoDB transaction. The wallet is the per-user lock.
  async lock(user, session) {
    if (!session?.inTransaction()) throw new WalletError('TRANSACTION_REQUIRED');
    const wallet = await SandboxWallet.findOneAndUpdate({ user }, { $inc: { revision: 1 } }, { new: true, session }).lean();
    if (!wallet || !Number.isSafeInteger(wallet.balanceMinor) || !Number.isSafeInteger(wallet.reservedMinor) || wallet.reservedMinor < 0 || wallet.balanceMinor < wallet.reservedMinor) throw new WalletError('WALLET_INVALID');
    return wallet;
  }
  async apply(wallet, { type, amountMinor, actorId, reason, payment, order, idempotencyKey }, session) {
    if (!session?.inTransaction()) throw new WalletError('TRANSACTION_REQUIRED');
    if (!['credit', 'reserve', 'release'].includes(type) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new WalletError('AMOUNT_INVALID');
    const previous = await SandboxWalletTransaction.findOne({ idempotencyKey }).session(session).lean();
    if (previous) {
      if (String(previous.wallet) !== String(wallet._id) || previous.type !== type || previous.amountMinor !== amountMinor) throw new WalletError('IDEMPOTENCY_CONFLICT');
      return previous;
    }
    let balance = BigInt(wallet.balanceMinor), reserved = BigInt(wallet.reservedMinor), amount = BigInt(amountMinor);
    if (type === 'credit') balance += amount;
    if (type === 'reserve') { if (balance - reserved < amount) throw new WalletError('INSUFFICIENT_SANDBOX_BALANCE'); reserved += amount; }
    if (type === 'release') { if (reserved < amount) throw new WalletError('WALLET_INVALID'); reserved -= amount; }
    let balanceMinor, reservedMinor;
    try { balanceMinor = minorInteger(balance); reservedMinor = minorInteger(reserved); } catch { throw new WalletError('WALLET_LIMIT'); }
    await SandboxWallet.updateOne({ _id: wallet._id }, { $set: { balanceMinor, reservedMinor } }, { session });
    const [entry] = await SandboxWalletTransaction.create([{ wallet: wallet._id, type, amountMinor, actorId: String(actorId), reason, payment, order,
      idempotencyKey, balanceAfterMinor: balanceMinor, reservedAfterMinor: reservedMinor }], { session });
    return entry.toObject();
  }
}
