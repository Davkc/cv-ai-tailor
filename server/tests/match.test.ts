import { describe, expect, it } from 'vitest';
import { extractKeywords, scoreMatch } from '../src/shared/match.js';
import { sampleContent } from './helpers.js';

describe('keyword match', () => {
  it('weights required terms three to one and counts each term once', () => {
    const job = { title: 'Developer', description: 'Required: Node.js, Node.js\nPreferred:\n- Kubernetes' };
    const resume = { ...sampleContent(), summary: 'Experience building NodeJS applications.' };
    expect(scoreMatch(job, resume)).toEqual({
      score: 75,
      matched: [{ keyword: 'Node.js', weight: 3 }],
      missing: [{ keyword: 'Kubernetes', weight: 1 }],
    });
  });

  it('handles punctuation, whole terms and overlapping phrases', () => {
    expect(extractKeywords({ title: '', description: 'JavaScript, C++, C#, React Native, Postgres and MySQL.' }).map(({ keyword }) => keyword))
      .toEqual(['JavaScript', 'C++', 'C#', 'React Native', 'PostgreSQL', 'MySQL']);
  });

  it('distinguishes an empty vocabulary from zero coverage and skips hidden sections', () => {
    const resume = { ...sampleContent(), summary: 'Welding', layout: { sections: [{ key: 'summary' as const, title: 'Summary', hidden: true }] } };
    expect(scoreMatch({ title: '', description: 'A specialist role' }, resume).score).toBeNull();
    expect(scoreMatch({ title: '', description: 'Welding' }, resume).score).toBe(0);
    expect(scoreMatch({ title: '', description: 'Welding' }, { ...resume, layout: undefined }).score).toBe(100);
  });
});
