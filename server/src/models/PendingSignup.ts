import { Schema, model } from 'mongoose';

const schema = new Schema({
  email: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  requestedAt: { type: Date, required: true },
});

export const PendingSignup = model('PendingSignup', schema);
