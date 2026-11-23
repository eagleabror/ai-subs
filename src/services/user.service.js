import { User, Wallet } from '../models/index.js';

export const userService = {
  async register(from) {
    const telegramId = String(from.id);
    let user;
    try {
      user = await User.findOneAndUpdate({ telegramId }, {
        $set: { firstName: from.first_name ?? '', username: from.username ?? '' },
        $setOnInsert: { telegramId },
      }, { upsert: true, new: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ telegramId });
      if (!user) throw error;
    }
    try {
      // Never overwrite an existing balance, including on repeated /start.
      await Wallet.updateOne({ user: user._id }, {
        $setOnInsert: { user: user._id, balanceMinor: 0, currency: 'UZS' },
      }, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return user;
  },
  async getWallet(telegramId) {
    const user = await User.findOne({ telegramId: String(telegramId) }).lean();
    return user ? Wallet.findOne({ user: user._id }).lean() : null;
  },
};
