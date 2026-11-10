import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Button, Field, Notice } from '../components/ui';
import { useSession } from '../state';

type Mode = 'signin' | 'signup' | 'verify';

export function LoginPage() {
  const { signIn, verifySignup } = useSession();
  const token = new URLSearchParams(window.location.hash.slice(1)).get('verify');
  const [mode, setMode] = useState<Mode>(token ? 'verify' : 'signin');
  const [ownerMode, setOwnerMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await api.requestSignup(email.trim());
        setSentTo(email.trim());
      } else if (mode === 'verify' && token) {
        await verifySignup({ token, name: name.trim(), password });
      } else if (mode === 'signin') {
        await signIn(ownerMode ? '' : email.trim(), password);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'signin' | 'signup') {
    if (mode === 'verify') window.history.replaceState(null, '', '/');
    setMode(next);
    setError('');
    setPassword('');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="animate-rise mb-7 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-500 text-xl font-extrabold text-white shadow-lg shadow-brand-600/30">CV</span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">
          CV Tailor <span className="bg-gradient-to-r from-brand-600 to-fuchsia-600 bg-clip-text text-transparent">AI</span>
        </h1>
        <p className="mt-1 text-[15px] text-slate-600">A CV written for every job you apply to.</p>
      </div>

      <div role="group" aria-label="Account options" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-white/80 p-1 shadow-sm">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={busy}
            onClick={() => switchMode(m)}
            className={`min-h-11 rounded-xl text-sm font-bold transition ${mode === m ? 'bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow' : 'text-slate-600'}`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/70 bg-white/90 p-5 shadow-xl shadow-brand-600/10 backdrop-blur">
        {mode === 'verify' && (
          <>
            <h2 className="font-bold text-slate-900">Finish creating your account</h2>
            <Field label="Your name" value={name} onChange={setName} autoComplete="name" maxLength={120} required />
          </>
        )}
        {(mode === 'signup' || (mode === 'signin' && !ownerMode)) && (
          <Field label="Email" type="email" inputMode="email" value={email} onChange={setEmail} autoComplete="email" maxLength={160} required />
        )}
        {mode !== 'signup' && (
          <Field
            label={mode === 'verify' ? 'Choose a password' : ownerMode ? 'Owner password' : 'Password'}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'verify' ? 'new-password' : 'current-password'}
            hint={mode === 'verify' ? 'At least 8 characters.' : undefined}
            maxLength={200}
            required
          />
        )}
        {mode === 'signup' && sentTo && (
          <div role="status">
            <Notice title="Check your inbox">
              If {sentTo} can be registered, we’ll send a verification link. Check spam or request a new link after one minute.
            </Notice>
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {busy ? 'Please wait…' : mode === 'verify' ? 'Create my account' : mode === 'signup' ? (sentTo === email.trim() ? 'Resend verification link' : 'Send verification link') : 'Sign in'}
        </Button>
        {mode === 'signin' && (
          <button type="button" onClick={() => setOwnerMode(!ownerMode)} className="w-full text-center text-xs font-semibold text-brand-700">
            {ownerMode ? 'Sign in with email instead' : 'I am the app owner'}
          </button>
        )}
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
        {mode === 'signup' ? 'Verify your email to create a private account.' : 'Each person’s CVs are private to them.'}
      </p>
    </main>
  );
}
