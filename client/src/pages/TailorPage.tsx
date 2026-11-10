import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ConfirmDialog, EmptyState, Field, LoadingSkeleton, Notice, PageTitle, TextArea } from '../components/ui';
import { WorkingCard } from '../components/WorkingCard';
import { useTailoring } from '../hooks/useTailoring';
import { useSession } from '../state';
import { EMPHASES, type Job } from '../types';

const TAILOR_STEPS = [
  'Reading the job description',
  'Finding your most relevant experience',
  'Rewriting your summary and bullet points',
  'Checking the rewrite against your master CV',
  'Scoring how well you match',
];

const FORM_KEY = 'cvt_job_form';
const MIN_DESCRIPTION = 40;
const MAX_DESCRIPTION = 20_000;

const blankJob = (): Job => ({ title: '', company: '', description: '', url: '', emphasis: 'General', instructions: '' });

function readForm(): Job {
  try {
    const raw = sessionStorage.getItem(FORM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const job = blankJob();
    if (!parsed || typeof parsed !== "object") return job;
    for (const key of Object.keys(job) as (keyof Job)[]) {
      const value: unknown = Reflect.get(parsed, key);
      if (typeof value === "string") job[key] = value;
    }
    return job;
  } catch {
    return blankJob();
  }
}

function clearForm() {
  try {
    sessionStorage.removeItem(FORM_KEY);
  } catch {
    // Storage is optional.
  }
}

export function TailorPage() {
  const navigate = useNavigate();
  const { status } = useSession();
  const { draft, profileReady, busy, failure, generate } = useTailoring(clearForm);
  const emphasisId = useId();

  const [job, setJob] = useState<Job>(readForm);
  const [customField, setCustomField] = useState(() => !(EMPHASES as readonly string[]).includes(job.emphasis));
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Survives switching apps to copy the job advert, which can make Android reload the tab.
  useEffect(() => {
    try {
      sessionStorage.setItem(FORM_KEY, JSON.stringify(job));
    } catch {
      // not critical
    }
  }, [job]);

  const set = (patch: Partial<Job>) => setJob((current) => ({ ...current, ...patch }));
  const length = job.description.trim().length;

  function validate(): boolean {
    const next: typeof errors = {};
    if (!job.title.trim()) next.title = 'Enter the job title.';
    if (length < MIN_DESCRIPTION) next.description = 'Paste the full job description (at least a few sentences).';
    if (length > MAX_DESCRIPTION) next.description = `The description is too long. Keep it under ${MAX_DESCRIPTION.toLocaleString()} characters.`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!validate()) {
      const field = job.title.trim() ? 'description' : 'title';
      const input = event.currentTarget.elements.namedItem(field);
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    if (draft && (!draft.id || draft.dirty)) setConfirmReplace(true);
    else void generate(job);
  }

  if (profileReady === null) return <LoadingSkeleton label="Checking your master CV…" />;
  if (!profileReady) {
    return (
      <EmptyState
        icon="user"
        title="Add your master CV first"
        action={
          <Button variant="primary" className="w-full" onClick={() => navigate('/profile')}>
            Go to Master CV
          </Button>
        }
      >
        A tailored CV is built from your real experience, so your master CV needs at least some experience, skills or education.
      </EmptyState>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PageTitle title="Tailor my CV" subtitle="Paste the job advert. Only facts from your master CV are used." />

      {status && !status.aiConfigured && (
        <Notice kind="warn" title="Demo mode: no AI key configured">
          The CV will be assembled from your master CV by simple keyword matching, without rewriting. Add an AI API key on the server for real tailoring (see Settings).
        </Notice>
      )}

      <Card>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <Field name="title" required label="Job title" value={job.title} onChange={(title) => set({ title })} error={errors.title} placeholder="e.g. Accountant, Nurse, Sales Executive" maxLength={160} />
          <Field label="Company" value={job.company} onChange={(company) => set({ company })} placeholder="e.g. City Hospital" maxLength={160} />
          <div>
            <label htmlFor={emphasisId} className="mb-1.5 block text-sm font-medium text-slate-700">
              Industry or field
            </label>
            {/* A real dropdown: datalist suggestions do not show reliably on Android. */}
            <select
              id={emphasisId}
              value={customField ? '__other__' : job.emphasis}
              onChange={(e) => {
                if (e.target.value === '__other__') {
                  setCustomField(true);
                  set({ emphasis: '' });
                } else {
                  setCustomField(false);
                  set({ emphasis: e.target.value });
                }
              }}
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
            >
              {EMPHASES.map((emphasis) => (
                <option key={emphasis} value={emphasis}>
                  {emphasis}
                </option>
              ))}
              <option value="__other__">Other (type your own)…</option>
            </select>
            {customField && (
              <input
                autoFocus
                aria-label="Your industry or field"
                value={job.emphasis}
                maxLength={80}
                onChange={(e) => set({ emphasis: e.target.value })}
                placeholder="e.g. Aviation, Social work, Mining"
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
              />
            )}
            <p className="mt-1 text-xs text-slate-500">The AI uses the vocabulary and priorities of this field.</p>
          </div>
          <TextArea
            name="description"
            required
            label="Job description"
            rows={10}
            value={job.description}
            onChange={(description) => set({ description })}
            error={errors.description}
            placeholder="Paste the full job description here…"
            hint={`${length.toLocaleString()} / ${MAX_DESCRIPTION.toLocaleString()} characters`}
          />
          <TextArea
            label="Instructions for the AI (optional)"
            rows={3}
            value={job.instructions}
            onChange={(instructions) => set({ instructions })}
            placeholder="e.g. Keep it to one page. Emphasise my customer service. I also trained new staff at my current job."
            hint="Style, emphasis, or true facts about you that are not in your master CV yet."
            maxLength={2000}
          />
          <Field label="Job posting link (optional)" inputMode="url" value={job.url} onChange={(url) => set({ url })} hint="Saved for your reference only. The page is not opened or read." maxLength={600} />
        </fieldset>
      </Card>

      {failure && (
        <Notice kind="error" title="The CV could not be generated">
          {failure}
        </Notice>
      )}

      {busy && (
        <WorkingCard title="Tailoring your CV" steps={TAILOR_STEPS} hint={status?.aiConfigured ? 'usually 15–60 seconds' : undefined} stepSeconds={status?.aiConfigured ? 7 : 1} />
      )}
      <Button type="submit" variant="primary" size="lg" icon="sparkles" className="w-full" disabled={busy}>
        Tailor My CV
      </Button>

      <ConfirmDialog open={confirmReplace} title="Replace your unsaved CV?" confirmLabel="Continue" onCancel={() => setConfirmReplace(false)} onConfirm={() => { setConfirmReplace(false); void generate(job); }}>
        The CV you have open{draft ? ` for “${draft.job.title}”` : ''} has changes that are not saved to your history. Generating a new one will discard them.
      </ConfirmDialog>
    </form>
  );
}
