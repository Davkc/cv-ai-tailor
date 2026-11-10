import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import { HttpError } from '../errors.js';
import { log } from '../logger.js';
import { hashPassword } from '../middleware/auth.js';
import { PendingSignup } from '../models/PendingSignup.js';
import { User } from '../models/User.js';

const EXPIRY_MS = 30 * 60_000;
const COOLDOWN_MS = 60_000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const duplicate = (err: unknown) => err instanceof Error && 'code' in err && err.code === 11000;

const signupDisabled = () => new HttpError(503, 'Account signup is temporarily unavailable.', 'signup_unavailable');

export async function requestSignup(config: Config, email: string): Promise<void> {
  const mail = config.signupMail;
  if (!mail) throw signupDisabled();
  await PendingSignup.init();
  if (await User.exists({ username: email })) return;

  const token = randomBytes(32).toString('base64url');
  const tokenHash = digest(token);
  const now = Date.now();
  try {
    await PendingSignup.updateOne(
      { email, requestedAt: { $lte: new Date(now - COOLDOWN_MS) } },
      { $set: { tokenHash, requestedAt: new Date(now), expiresAt: new Date(now + EXPIRY_MS) } },
      { upsert: true },
    );
  } catch (err) {
    // A recent request for this email already holds the unique index.
    if (duplicate(err)) return;
    throw err;
  }

  const link = new URL(mail.origin);
  link.hash = 'verify=' + token;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + mail.apiKey, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: mail.from,
        to: [email],
        subject: 'Verify your email for CV Tailor AI',
        text: 'Open this link to verify your email and choose a password for CV Tailor AI. It expires in 30 minutes.\n\n' + link.href + '\n\nIf you did not request an account, ignore this message.',
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Delivery rejected');
  } catch {
    log.warn('Signup email could not be sent');
    await PendingSignup.deleteOne({ email, tokenHash });
    throw new HttpError(503, 'Could not send the verification email. Please try again.', 'verification_delivery_failed');
  }
}

export async function completeSignup(token: string, name: string, password: string) {
  const tokenHash = digest(token);
  const invalid = () => new HttpError(400, 'This verification link is invalid or has expired. Request a new one to continue.', 'invalid_verification');
  if (!(await PendingSignup.exists({ tokenHash, expiresAt: { $gt: new Date() } }))) throw invalid();
  const passwordHash = await hashPassword(password);
  await User.init();
  const pending = await PendingSignup.findOneAndDelete({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
  if (!pending) throw invalid();
  try {
    return await User.create({
      username: pending.email, name, passwordHash, role: 'member', emailVerifiedAt: new Date(), lastLoginAt: new Date(),
    });
  } catch (err) {
    if (duplicate(err)) throw invalid();
    throw err;
  }
}
