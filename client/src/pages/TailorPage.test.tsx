import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { setToken } from '../api';
import { AppProviders } from '../state';
import { defaultLayout, type TailorResult } from '../types';
import { CvPage } from './CvPage';
import { TailorPage } from './TailorPage';

const description = 'Required: React.\nPreferred: Kubernetes for deployment.';
const result: TailorResult = {
  job: { title: 'Frontend Developer', description, company: '', emphasis: 'General', url: '', instructions: '' },
  content: {
    contact: { fullName: 'Sample Candidate', headline: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '' },
    summary: 'Built interfaces using React.',
    skills: { technical: [], soft: [] },
    experience: [], projects: [], education: [], certifications: [], volunteer: [], languages: [],
    layout: defaultLayout(),
  },
  analysis: { score: 75, matchedSkills: [], missingSkills: [], relevantExperience: [], keywordsIncluded: [], suggestions: [], flags: [] },
  generatedBy: 'ai',
  aiModel: 'mock',
};

function renderFlow() {
  setToken('test-session');
  render(
    <AppProviders>
      <MemoryRouter initialEntries={['/tailor']}>
        <Routes>
          <Route path="/tailor" element={<TailorPage />} />
          <Route path="/cv/:id" element={<CvPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  setToken(null);
  vi.unstubAllGlobals();
});

it('validates, disables duplicate requests, recovers from a provider error and updates the keyword match after editing', async () => {
  let complete: ((response: Response) => void) | undefined;
  let requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/status')) return Response.json({ aiConfigured: true });
    if (path.endsWith('/dashboard')) return Response.json({ profile: { usable: true } });
    if (path.endsWith('/profile')) return Response.json({ profile: null });
    if (path.endsWith('/pages')) return Response.json({ pages: 1 });
    if (path.endsWith('/tailor')) {
      requests++;
      if (requests === 1) return new Promise<Response>((resolve) => { complete = resolve; });
      return Response.json(result);
    }
    throw new Error('Unexpected API call ' + path);
  }));
  const user = userEvent.setup();
  renderFlow();
  const title = await screen.findByRole('textbox', { name: 'Job title' });
  const advert = screen.getByRole('textbox', { name: 'Job description' });
  const submit = screen.getByRole('button', { name: 'Tailor My CV' });
  await user.click(submit);
  expect(title.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(title);
  expect(requests).toBe(0);

  await user.type(title, result.job.title);
  await user.click(advert);
  await user.paste(description);
  await user.click(submit);
  expect(await screen.findByText('Tailoring your CV')).toBeTruthy();
  expect(submit.matches(":disabled")).toBe(true);
  expect(advert.matches(":disabled")).toBe(true);
  await user.click(submit);
  expect(requests).toBe(1);

  complete?.(Response.json({ error: { message: 'The AI provider took too long to respond.' } }, { status: 504 }));
  expect((await screen.findByRole('alert')).textContent).toContain('took too long');
  expect(submit.matches(":disabled")).toBe(false);
  await user.click(submit);
  const match = await screen.findByRole('button', { name: 'Open job match' });
  expect(within(match).getByRole('img', { name: /75 out of 100/ })).toBeTruthy();
  await user.click(match);
  expect(screen.getByRole('heading', { name: 'Matched keywords' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Missing keywords' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Suggested additions' })).toBeTruthy();
  expect(screen.getAllByText('Kubernetes').length).toBeGreaterThan(0);

  screen.getByRole('tab', { name: 'Match' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Edit', selected: true }));
  const summary = screen.getByRole('textbox', { name: 'Summary' });
  await user.type(summary, ' Deployed workloads to Kubernetes.');
  expect(within(match).getByRole('img', { name: /100 out of 100/ })).toBeTruthy();
});

it('explains when the master CV is missing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ profile: { usable: false } })));
  renderFlow();
  expect(await screen.findByRole('heading', { name: 'Add your master CV first' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tailor My CV' })).toBeNull();
});
