export interface JobDescription {
  title: string;
  company: string;
  description: string;
  url: string;
  emphasis: string;
  instructions: string;
}

export const SECTION_KEYS = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'volunteer', 'languages'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface ResumeSection {
  key: SectionKey;
  title: string;
  hidden: boolean;
}

export interface KeywordGap {
  keyword: string;
  weight: 1 | 3;
}

export interface MatchResult {
  score: number | null;
  matched: KeywordGap[];
  missing: KeywordGap[];
}
