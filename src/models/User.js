import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, match: /^[1-9]\d*$/ },
  firstName: { type: String, maxlength: 256 },
  username: { type: String, maxlength: 64 },
}, { timestamps: true });
export const User = mongoose.model('User', schema);
