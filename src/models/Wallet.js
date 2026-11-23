import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balanceMinor: nonnegativeInteger({ required: true, default: 0 }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', required: true },
}, { timestamps: true });
export const Wallet = mongoose.model('Wallet', schema);
