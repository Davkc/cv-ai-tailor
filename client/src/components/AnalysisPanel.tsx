import { useState, type ReactNode } from 'react';
import type { Analysis, KeywordGap, MatchResult } from '../types';
import { ScoreRing } from './ScoreRing';
import { Button, Card, Chips, Icon, Notice } from './ui';

function Block({ title, empty, children }: { title: string; empty: string; children: ReactNode | null }) {
  return (
    <Card>
      <h3 className="mb-2.5 text-sm font-bold text-slate-900">{title}</h3>
      {children ?? <p className="text-sm text-slate-500">{empty}</p>}
    </Card>
  );
}

const bullets = (items: string[]) =>
  items.length ? (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ) : null;

/**
 * The truthful way to a higher score: the user confirms which requirements they really meet
 * and says where, and the AI adds it to the CV.
 */
function BoostForm({ gaps, onBoost, busy }: { gaps: KeywordGap[]; onBoost(instruction: string): void; busy: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const filled = gaps.filter((g) => open[g.keyword] && (answers[g.keyword] ?? '').trim().length >= 3);

  function submit() {
    const lines = filled.map((g) => `- ${g.keyword}: ${answers[g.keyword]!.trim()}`);
    onBoost(`These are true facts about my experience. Add them to my CV where they fit best, in natural wording, without exaggerating:\n${lines.join('\n')}`);
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 p-[1.5px] shadow-lg shadow-brand-600/15">
      <div className="rounded-[15px] bg-white p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white">
            <Icon name="up" className="h-5 w-5" />
          </span>
          <h3 className="font-bold text-slate-900">Suggested additions</h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Done any of these, even at school, in a project, a volunteer role or a part-time job? Tap it and say where. The AI adds it to this CV and re-scores. Only add what is true: you may be asked about it in an interview.
        </p>
        <ul className="mt-3 space-y-2">
          {gaps.map((gap) => {
            const isOpen = Boolean(open[gap.keyword]);
            return (
              <li key={gap.keyword} className={`rounded-xl border p-2.5 transition-colors ${isOpen ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200'}`}>
                <button type="button" disabled={busy} onClick={() => setOpen({ ...open, [gap.keyword]: !isOpen })} aria-expanded={isOpen} className="flex min-h-9 w-full items-center gap-2.5 text-left">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${isOpen ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>
                    {isOpen && <Icon name="check" className="h-4 w-4" />}
                  </span>
                  <span className="flex-1 text-sm font-medium text-slate-800">
                    {gap.keyword}
                    <span className="ml-1.5 text-xs text-slate-600">({gap.weight === 3 ? 'required' : 'preferred'})</span>
                  </span>
                </button>
                {isOpen && (
                  <textarea
                    rows={2}
                    aria-label={'Where you used ' + gap.keyword}
                    disabled={busy}
                    autoFocus
                    value={answers[gap.keyword] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [gap.keyword]: e.target.value })}
                    maxLength={500}
                    placeholder="Where and how? e.g. At my internship I…"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
                  />
                )}
              </li>
            );
          })}
        </ul>
        <Button variant="primary" icon="sparkles" className="mt-3 w-full" disabled={filled.length === 0 || busy} loading={busy} onClick={submit}>
          {filled.length ? `Add ${filled.length} to my CV and re-score` : 'Tick what you have done and say where'}
        </Button>
      </div>
    </div>
  );
}

interface Props {
  analysis: Analysis;
  match: MatchResult;
  /** When given, gaps can be filled in by telling the AI about real experience. */
  onBoost?(instruction: string): void;
  boosting?: boolean;
}

export function AnalysisPanel({ analysis, match, onBoost, boosting = false }: Props) {
  const { matched, missing, score } = match;
  const gaps = [...missing].sort((a, b) => b.weight - a.weight);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-4">
          <ScoreRing score={score} />
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900">Job match</h3>
            <p className="mt-1 text-sm text-slate-600">
              {score === null ? 'No recognized keywords in this job description.' : matched.length + ' matched · ' + missing.length + ' missing'}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          This score measures keyword coverage in visible CV sections. Required terms count three times as much as preferred terms.
        </p>
      </Card>

      {analysis.flags.length > 0 && (
        <Notice kind="warn" title="Check before sending">
          <ul className="list-disc space-y-1.5 pl-4">
            {analysis.flags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </Notice>
      )}

      {score !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Block title="Matched keywords" empty="No job keywords appear in the visible CV.">
            {matched.length ? <Chips items={matched.map(({ keyword }) => keyword)} tone="good" /> : null}
          </Block>
          <Block title="Missing keywords" empty="All recognized job keywords appear in the visible CV.">
            {gaps.length ? <Chips items={gaps.map(({ keyword }) => keyword)} tone="bad" /> : null}
          </Block>
        </div>
      )}

      {gaps.length > 0 && (onBoost ? (
        <BoostForm gaps={gaps} onBoost={onBoost} busy={boosting} />
      ) : (
        <Block title="Suggested additions" empty="">
          <p className="text-sm text-slate-600">If you have experience with a missing keyword, describe where you used it in the Edit tab.</p>
        </Block>
      ))}

      <Block title="Your strongest selling points" empty="No specific experience was highlighted.">
        {bullets(analysis.relevantExperience)}
      </Block>

      <Block title="Tips for this application" empty="No suggestions.">
        {bullets(analysis.suggestions)}
      </Block>
    </div>
  );
}
