import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { setToken } from '../api';
import { AppProviders, useSession } from '../state';
import { LoginPage } from './LoginPage';

function AccountScreen() {
  const { signedIn } = useSession();
  return signedIn ? <p>Signed in</p> : <LoginPage />;
}

function renderAccount() {
  render(<AppProviders><AccountScreen /></AppProviders>);
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  setToken(null);
  vi.unstubAllGlobals();
});

it('requests verification using only the email address', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  renderAccount();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.type(screen.getByRole('textbox', { name: 'Email' }), 'tester@example.com');
  expect(screen.queryByLabelText(/invite code|choose a password/i)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Send verification link' }));
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
    body: JSON.stringify({ email: 'tester@example.com' }),
  }));
});

it('creates the account from a verification link and clears the token from the URL', async () => {
  const token = 'a'.repeat(43);
  window.history.replaceState(null, '', '/#verify=' + token);
  const fetchMock = vi.fn(async () => Response.json({ token: 'test-session' }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  renderAccount();
  await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'A Tester');
  await user.type(screen.getByLabelText('Choose a password'), 'a-strong-password');
  await user.click(screen.getByRole('button', { name: 'Create my account' }));
  expect(await screen.findByText('Signed in')).toBeTruthy();
  expect(window.location.hash).toBe('');
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-signup', expect.objectContaining({
    body: JSON.stringify({ token, name: 'A Tester', password: 'a-strong-password' }),
  }));
});
