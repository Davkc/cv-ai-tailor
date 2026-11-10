import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db.js';
import { PendingSignup } from '../src/models/PendingSignup.js';
import { z } from 'zod';
import { hashPassword } from '../src/middleware/auth.js';
import { User } from '../src/models/User.js';
import { TEST_PASSWORD, job, mockAi, profile, testConfig, type MockAi } from './helpers.js';

let mongo: MongoMemoryServer;
let ai: MockAi;
let app: ReturnType<typeof createApp>;
let ownerToken = '';
const sent: { email: string; token: string }[] = [];
const outgoing = z.object({ to: z.array(z.email()), text: z.string() });
let rejectDelivery = false;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(testConfig({ MONGODB_URI: mongo.getUri('cv-tailor-accounts') }));
  ai = await mockAi(Array.from({ length: 10 }, () => ({ content: JSON.stringify({ summary: 'A short summary.' }) })));
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (input !== 'https://api.resend.com/emails') return originalFetch(input, init);
    if (rejectDelivery) return Response.json({}, { status: 503 });
    const email = outgoing.parse(JSON.parse(String(init?.body)));
    const token = email.text.match(/#verify=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token || !email.to[0]) throw new Error('Verification email is incomplete');
    sent.push({ email: email.to[0], token });
    return Response.json({ id: 'email-delivered' });
  });
  app = createApp(testConfig({
    AI_API_KEY: 'sk-test', AI_BASE_URL: ai.url, AI_DAILY_LIMIT: '2',
    APP_PUBLIC_URL: 'https://cv.example.com', RESEND_API_KEY: 'test-key', SIGNUP_EMAIL_FROM: 'signup@example.com',
  }));
  ownerToken = (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await ai.close();
  await mongoose.disconnect();
  await mongo.stop();
});

const signup = (email: string) => request(app).post('/api/auth/register').send({ email });
const verify = (token: string, password = 'friend-password') =>
  request(app).post('/api/auth/verify-signup').send({ token, name: 'A Tester', password });

async function join(email: string, password?: string) {
  expect((await signup(email)).status).toBe(202);
  const token = sent.findLast((entry) => entry.email === email.toLowerCase())?.token;
  expect(token).toBeTruthy();
  const response = await verify(token!, password);
  expect(response.status).toBe(201);
  return response;
}

describe('self-service accounts', () => {
  it('requires the emailed token before creating an account and consumes it once', async () => {
    const response = await signup('Friend.One@Example.com');
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true });
    expect(await User.exists({ username: 'friend.one@example.com' })).toBeNull();
    const token = sent.at(-1)!.token;
    expect((await verify(token, 'short')).status).toBe(400);
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    expect(results.find((result) => result.status === 201)?.body.token).toBeTruthy();
    expect((await verify(token)).status).toBe(400);
    expect(await User.countDocuments({ username: 'friend.one@example.com' })).toBe(1);
  });

  it('rejects expired links and rate limits repeat sends to the same address', async () => {
    await signup('stale@example.com');
    const previous = sent.at(-1)!.token;
    expect((await signup('STALE@example.com')).status).toBe(202);
    expect(sent.filter(({ email }) => email === 'stale@example.com')).toHaveLength(1);
    await PendingSignup.updateOne({ email: 'stale@example.com' }, { $set: { expiresAt: new Date(0), requestedAt: new Date(0) } });
    expect((await verify(previous)).status).toBe(400);
    await join('stale@example.com');
    expect((await signup('stale@example.com')).status).toBe(202);
    expect(sent.filter(({ email }) => email === 'stale@example.com')).toHaveLength(2);
    expect((await signup('not-an-email')).status).toBe(400);
  });

  it('can retry after a delivery failure', async () => {
    rejectDelivery = true;
    try {
      expect((await signup('retry@example.com')).status).toBe(503);
    } finally {
      rejectDelivery = false;
    }
    await join('retry@example.com');
  });

  it('keeps legacy accounts and owner sign-in usable without email configuration', async () => {
    const standalone = createApp(testConfig());
    await User.create({ username: 'legacy@example.com', passwordHash: await hashPassword('legacy-password') });
    expect((await request(standalone).post('/api/auth/login').send({ email: 'legacy@example.com', password: 'legacy-password' })).status).toBe(200);
    expect((await request(standalone).post('/api/auth/login').send({ password: TEST_PASSWORD })).status).toBe(200);
    expect((await request(standalone).post('/api/auth/register').send({ email: 'new@example.com' })).status).toBe(503);
  });

  it('members sign in with email and password; wrong details get one generic message', async () => {
    await join('login@example.com', 'correct-password');
    const ok = await request(app).post('/api/auth/login').send({ email: 'LOGIN@example.com', password: 'correct-password' });
    expect(ok.status).toBe(200);
    const wrong = await request(app).post('/api/auth/login').send({ email: 'login@example.com', password: 'nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    // the owner password does not open a member account
    expect((await request(app).post('/api/auth/login').send({ email: 'login@example.com', password: TEST_PASSWORD })).status).toBe(401);
  });

  it("each person's data is private to them", async () => {
    await request(app).put('/api/profile').set(as(ownerToken)).send(profile);
    const member = (await join('private@example.com')).body.token;
    expect((await request(app).get('/api/profile').set(as(member))).body.profile).toBeNull();

    const created = await request(app)
      .post('/api/versions')
      .set(as(ownerToken))
      .send({ job, content: { contact: profile.contact }, generatedBy: 'demo' });
    const id = created.body.version.id;
    expect((await request(app).get(`/api/versions/${id}`).set(as(member))).status).toBe(404);
    expect((await request(app).delete(`/api/versions/${id}`).set(as(member))).status).toBe(404);
    expect((await request(app).get('/api/versions').set(as(member))).body.versions).toEqual([]);
    expect((await request(app).get(`/api/versions/${id}`).set(as(ownerToken))).status).toBe(200);
  });

  it('members cannot use the admin tools', async () => {
    const member = (await join('nosy@example.com')).body.token;
    expect((await request(app).get('/api/admin/users').set(as(member))).status).toBe(403);
  });

  it('the owner can switch a member off, which ends their access at once, and delete them', async () => {
    const member = (await join('switch@example.com')).body.token;
    const users = (await request(app).get('/api/admin/users').set(as(ownerToken))).body.users as { id: string; email: string }[];
    const target = users.find((u) => u.email === 'switch@example.com')!;
    expect((await request(app).patch(`/api/admin/users/${target.id}`).set(as(ownerToken)).send({ disabled: true })).status).toBe(200);
    expect((await request(app).get('/api/profile').set(as(member))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'switch@example.com', password: 'friend-password' })).status).toBe(403);
    expect((await request(app).delete(`/api/admin/users/${target.id}`).set(as(ownerToken))).status).toBe(204);
    expect(await User.exists({ username: 'switch@example.com' })).toBeNull();
  });

  it('members can change their password and delete their own account', async () => {
    const member = (await join('self@example.com', 'first-password')).body.token;
    expect((await request(app).post('/api/account/password').set(as(member)).send({ currentPassword: 'wrong-one', newPassword: 'second-password' })).status).toBe(400);
    expect((await request(app).post('/api/account/password').set(as(member)).send({ currentPassword: 'first-password', newPassword: 'second-password' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'self@example.com', password: 'second-password' })).status).toBe(200);
    expect((await request(app).delete('/api/account').set(as(member))).status).toBe(200);
    expect((await request(app).get('/api/profile').set(as(member))).status).toBe(401);
    expect((await request(app).delete('/api/account').set(as(ownerToken))).status).toBe(400);
  });

});

describe('daily AI allowance', () => {
  it('limits each member, shows usage, and leaves the owner unlimited', async () => {
    const member = (await join('busy@example.com')).body.token;
    await request(app).put('/api/profile').set(as(member)).send(profile);
    const ask = (token: string) => request(app).post('/api/tailor/summary').set(as(token)).send({ job, currentSummary: '' });

    expect((await ask(member)).status).toBe(200);
    expect((await ask(member)).status).toBe(200);
    const third = await ask(member);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('ai_daily_limit');
    expect((await request(app).get('/api/status').set(as(member))).body.aiUsage).toEqual({ used: 2, limit: 2 });

    for (let i = 0; i < 3; i++) expect((await ask(ownerToken)).status).toBe(200);
    expect((await request(app).get('/api/status').set(as(ownerToken))).body.aiUsage.limit).toBe(0);
  });
});
