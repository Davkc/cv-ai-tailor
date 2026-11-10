import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { scoreMatch } from '../../server/src/shared/match';
import type { KeywordGap, MatchResult } from '../../server/src/shared/types';
import { ScoreRing } from './components/ScoreRing';
import { Button, Card, Chips, Field, TextArea } from './components/ui';
import '../demo/styles.css';

const SAMPLE_JOB = 'Requirements: React, TypeScript and Git.\nPreferred: Docker and PostgreSQL.';
const SAMPLE_CV = 'Frontend developer who built React apps with TypeScript and used Git for code reviews. Maintained a PostgreSQL database for a reporting project.';

function KeywordList({ title, items, tone, empty }: { title: string; items: KeywordGap[]; tone: "good" | "bad"; empty: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? <Chips items={items.map(({ keyword }) => keyword)} tone={tone} /> : <p className="text-sm text-slate-600">{empty}</p>}
    </div>
  );
}

function Demo() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cv, setCv] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);
  const canCompare = Boolean(description.trim() && cv.trim());

  function compare(event: FormEvent) {
    event.preventDefault();
    if (!canCompare) return;
    setResult(scoreMatch({ title, description }, {
      summary: cv, skills: [], experience: [], projects: [], education: [], certifications: [], volunteer: [], languages: [],
    }));
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-3">
          <div aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 font-bold text-white shadow-md">CV</div>
          <p className="text-sm font-semibold text-brand-700">CV Tailor AI · Public demo</p>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">How does your CV match the job?</h1>
        <p className="mt-2 max-w-xl text-slate-600">Compare the job description with your CV to see which skills appear in both and which you might address.</p>
      </header>
      <form onSubmit={compare} className="space-y-4">
        <div className="grid items-stretch gap-4 md:grid-cols-2">
          <Card className="space-y-3">
            <Field label="Job title (optional)" value={title} onChange={(value) => { setTitle(value); setResult(null); }} maxLength={160} />
            <TextArea label="Job description" value={description} onChange={(value) => { setDescription(value); setResult(null); }} rows={10} maxLength={20_000} placeholder="Paste the job description here" required />
          </Card>
          <Card className="space-y-3">
            <TextArea label="CV text" value={cv} onChange={(value) => { setCv(value); setResult(null); }} rows={13} maxLength={50_000} placeholder="Paste your CV here" required />
            <p className="text-sm text-slate-500">Your text stays in this browser tab.</p>
          </Card>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!canCompare}>Compare CV</Button>
          <Button type="button" onClick={() => { setTitle("Frontend developer"); setDescription(SAMPLE_JOB); setCv(SAMPLE_CV); setResult(null); }}>Load example</Button>
        </div>
      </form>
      <div aria-live="polite" className="mt-6">
        {result && (
          <Card className="space-y-5">
            <div className="flex items-center gap-4">
              <ScoreRing score={result.score} />
              <div>
                <h2 className="text-lg font-semibold">Keyword match</h2>
                <p className="text-sm text-slate-600">{result.score === null ? "No recognized keywords in this job description." : "Required terms carry more weight than preferred terms."}</p>
              </div>
            </div>
            {result.score !== null && (
              <div className="grid gap-4 sm:grid-cols-2">
                <KeywordList title="Found in your CV" items={result.matched} tone="good" empty="No matches found." />
                <KeywordList title="Missing from your CV" items={result.missing} tone="bad" empty="All recognized terms matched." />
              </div>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
