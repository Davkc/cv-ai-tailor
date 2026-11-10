import { SECTION_KEYS, type JobDescription, type KeywordGap, type MatchResult, type ResumeSection } from './types.js';
import { KNOWN_TERMS } from './keywords.js';

type Resume = Record<ResumeSection['key'], unknown> & { layout?: { sections: ResumeSection[] } };
type Target = Pick<JobDescription, 'title' | 'description'>;

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const aliases: Record<string, string[]> = {
  'Node.js': ['nodejs', 'node js'],
  'Next.js': ['nextjs', 'next js'],
  PostgreSQL: ['postgres'],
  'Microsoft Excel': ['excel'],
  'Problem Solving': ['problem-solving'],
};

const terms = KNOWN_TERMS.map((keyword) => {
  const alternatives = [keyword, ...(aliases[keyword] ?? [])].map((name) => escape(normalize(name))).join('|');
  return { keyword, pattern: new RegExp('(?<![\\p{L}\\p{N}])(?:' + alternatives + ')(?![\\p{L}\\p{N}+#])', 'gu') };
});

function keywords(text: string): Set<string> {
  const normalized = normalize(text);
  const hits = terms.flatMap(({ keyword, pattern }) =>
    Array.from(normalized.matchAll(pattern), (match) => ({
      keyword,
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
  // Prefer the most specific phrase at each position, such as React Native over React.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const found = new Set<string>();
  let end = 0;
  for (const hit of hits) {
    if (hit.start < end) continue;
    found.add(hit.keyword);
    end = hit.end;
  }
  return found;
}

const preferred = /\b(preferred|desirable|optional|nice[- ]to[- ]have|bonus)\b/i;
const required = /\b(required|requirements?|essential|must[- ]have|minimum qualifications)\b/i;
const heading = /^(?:preferred(?: qualifications| skills)?|desirable(?: skills)?|optional|nice[- ]to[- ]have|bonus|(?:minimum |required )?qualifications|required(?: skills)?|requirements?|essential(?: skills)?)\s*(?::|$)/i;

export function extractKeywords(job: Target): KeywordGap[] {
  const weighted = new Map<string, KeywordGap['weight']>();
  const add = (text: string, weight: KeywordGap['weight']) => {
    for (const keyword of keywords(text)) {
      if (weighted.get(keyword) !== 3) weighted.set(keyword, weight);
    }
  };

  add(job.title, 3);
  let sectionWeight: KeywordGap['weight'] = 3;
  for (const line of job.description.split(/\r?\n/)) {
    const label = line.trim().match(heading)?.[0];
    if (label) sectionWeight = preferred.test(label) ? 1 : 3;
    for (const clause of line.split(/;|\.\s+/)) {
      const weight = required.test(clause) ? 3 : preferred.test(clause) ? 1 : sectionWeight;
      add(clause, weight);
    }
  }
  return [...weighted].map(([keyword, weight]) => ({ keyword, weight }));
}

function resumeKeywords(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const keyword of keywords(value)) found.add(keyword);
  } else if (Array.isArray(value)) {
    for (const item of value) resumeKeywords(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!['id', 'link', 'location', 'startDate', 'endDate', 'date'].includes(key)) resumeKeywords(item, found);
    }
  }
}

/** Score the visible CV sections against a fixed set of terms from the job advert. */
export function scoreMatch(job: Target, resume: Resume): MatchResult {
  const wanted = extractKeywords(job);
  if (!wanted.length) return { score: null, matched: [], missing: [] };
  const found = new Set<string>();
  const hidden = new Set(resume.layout?.sections.filter((section) => section.hidden).map((section) => section.key));
  for (const key of SECTION_KEYS) {
    if (!hidden.has(key)) resumeKeywords(resume[key], found);
  }

  const matched = wanted.filter(({ keyword }) => found.has(keyword));
  const missing = wanted.filter(({ keyword }) => !found.has(keyword));
  const weightOf = (items: KeywordGap[]) => items.reduce((sum, item) => sum + item.weight, 0);
  return { score: wanted.length ? Math.round(100 * weightOf(matched) / weightOf(wanted)) : null, matched, missing };
}

