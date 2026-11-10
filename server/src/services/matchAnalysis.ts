import type { Analysis, CvContent, Job } from '../schemas.js';
import { scoreMatch } from '../shared/match.js';

export function withMatchScore(job: Job, content: CvContent, analysis: Analysis): Analysis {
  const { score, matched, missing } = scoreMatch(job, content);
  return { ...analysis, score: score ?? 0, keywordCount: matched.length + missing.length };
}
