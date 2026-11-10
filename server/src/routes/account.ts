import { Router, type RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { Config } from '../config.js';
import { HttpError, notFound } from '../errors.js';
import { hashPassword, issueToken, ownerIdOf, passwordMatches, requireAdmin, verifyPassword } from '../middleware/auth.js';
import { requireDb } from '../middleware/error.js';
import { MasterProfile } from '../models/Profile.js';
import { TailoredCv } from '../models/TailoredCv.js';
import { User } from '../models/User.js';
import { loginSchema, passwordChangeSchema, registerSchema, userUpdateSchema, verifySignupSchema } from '../schemas.js';

import { completeSignup, requestSignup } from '../services/signup.js';

export const OWNER_USERNAME = 'owner';
const BAD_LOGIN = 'Incorrect email or password.';

function idParam(id: unknown): string {
  const value = String(id ?? '');
  if (!mongoose.isValidObjectId(value)) throw notFound();
  return value;
}

/** Remove a person's CV data (and optionally the account itself). */
export async function deleteUserData(userId: string, deleteAccount: boolean) {
  const [versions] = await Promise.all([
    TailoredCv.deleteMany({ ownerId: userId }),
    MasterProfile.deleteOne({ ownerId: userId }),
    deleteAccount ? User.deleteOne({ _id: userId }) : User.updateOne({ _id: userId }, { $unset: { layout: 1 } }),
  ]);
  return versions.deletedCount;
}

/** Routes that need no session: signing in and verifying a new account. */
export function publicAccountRouter(config: Config, limiter: RequestHandler): Router {
  const router = Router();

  router.post('/auth/login', limiter, requireDb, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    if (!email || email === OWNER_USERNAME) {
      // The owner signs in with the password set in the server environment.
      if (!passwordMatches(password, config.appPassword)) throw new HttpError(401, BAD_LOGIN, 'invalid_credentials');
      const owner = await User.findOneAndUpdate(
        { username: OWNER_USERNAME },
        { $set: { lastLoginAt: new Date(), role: 'admin', disabled: false } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      return res.json({ token: issueToken(config, String(owner._id), 'admin') });
    }

    const user = await User.findOne({ username: email });
    // Hash even when the user does not exist, so response time does not reveal which emails are registered.
    const ok = await verifyPassword(password, user?.passwordHash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || !ok || !user.passwordHash) throw new HttpError(401, BAD_LOGIN, 'invalid_credentials');
    if (user.disabled) throw new HttpError(403, 'This account has been switched off by the app owner.', 'account_disabled');
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: issueToken(config, String(user._id), user.role) });
  });

  router.post('/auth/register', limiter, requireDb, async (req, res) => {
    const { email } = registerSchema.parse(req.body);
    await requestSignup(config, email);
    res.status(202).json({ ok: true });
  });

  router.post('/auth/verify-signup', limiter, requireDb, async (req, res) => {
    const { token, name, password } = verifySignupSchema.parse(req.body);
    const user = await completeSignup(token, name, password);
    res.status(201).json({ token: issueToken(config, String(user._id), 'member') });
  });

  return router;
}

/** Routes for a signed-in person: their account, and the owner's admin tools. */
export function accountRouter(config: Config): Router {
  const router = Router();
  router.use(requireDb);

  router.get('/account', async (req, res) => {
    const user = await User.findById(ownerIdOf(req)).select('username name role createdAt').lean();
    if (!user) throw notFound();
    res.json({ account: { name: user.name, email: user.role === 'admin' ? '' : user.username, role: user.role, createdAt: user.createdAt } });
  });

  router.post('/account/password', async (req, res) => {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
    if (req.role === 'admin') throw new HttpError(400, 'The owner password is set on the server (APP_PASSWORD).', 'bad_request');
    const user = await User.findById(ownerIdOf(req));
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, 'Your current password is not correct.', 'invalid_credentials');
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    res.json({ ok: true });
  });

  router.delete('/account', async (req, res) => {
    if (req.role === 'admin') throw new HttpError(400, 'The owner account cannot be deleted. Use "Delete all my data" instead.', 'bad_request');
    const deletedVersions = await deleteUserData(ownerIdOf(req), true);
    res.json({ deletedVersions });
  });

  // ---------- owner only ----------

  router.get('/admin/users', requireAdmin, async (_req, res) => {
    const users = await User.find().sort({ createdAt: 1 }).select('username name role disabled lastLoginAt createdAt aiUsage').lean();
    const counts = await TailoredCv.aggregate<{ _id: unknown; n: number }>([{ $group: { _id: '$ownerId', n: { $sum: 1 } } }]);
    const cvCount = new Map(counts.map((c) => [String(c._id), c.n]));
    const date = new Date().toISOString().slice(0, 10);
    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        name: u.role === 'admin' ? u.name || 'You (owner)' : u.name,
        email: u.role === 'admin' ? '' : u.username,
        role: u.role,
        disabled: u.disabled,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt,
        savedCvs: cvCount.get(String(u._id)) ?? 0,
        aiToday: u.aiUsage?.date === date ? u.aiUsage.count : 0,
      })),
      dailyLimit: config.aiDailyLimit,
    });
  });

  router.patch('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const { disabled } = userUpdateSchema.parse(req.body);
    if (id === ownerIdOf(req)) throw new HttpError(400, 'You cannot switch off your own account.', 'bad_request');
    const result = await User.updateOne({ _id: id, role: 'member' }, { $set: { disabled } });
    if (result.matchedCount === 0) throw notFound('That person was not found.');
    res.json({ ok: true });
  });

  router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    if (id === ownerIdOf(req)) throw new HttpError(400, 'You cannot delete your own account.', 'bad_request');
    const target = await User.findOne({ _id: id, role: 'member' }).select('_id').lean();
    if (!target) throw notFound('That person was not found.');
    await deleteUserData(id, true);
    res.status(204).end();
  });

  return router;
}

