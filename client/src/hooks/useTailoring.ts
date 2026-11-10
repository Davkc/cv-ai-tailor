import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { askToNotify, notifyIfHidden } from '../notify';
import { useDraft, useToast } from '../state';
import type { Job } from '../types';

export function useTailoring(clearForm: () => void) {
  const navigate = useNavigate();
  const toast = useToast();
  const { draft, setDraft } = useDraft();
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.dashboard()
      .then((data) => { if (!cancelled) setProfileReady(data.profile.usable); })
      .catch(() => { if (!cancelled) setProfileReady(true); }); // the server still checks the profile on submit
    return () => {
      cancelled = true;
      request.current?.abort();
      request.current = null;
    };
  }, []);

  async function generate(job: Job) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure('');
    askToNotify();
    try {
      const result = await api.tailor({ ...job, title: job.title.trim(), company: job.company.trim(), description: job.description.trim(), url: job.url.trim(), instructions: job.instructions.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft({ ...result, dirty: false, fresh: true });
      notifyIfHidden('Your tailored CV is ready', [result.job.title, result.job.company].filter(Boolean).join(' at '));
      clearForm();
      if (result.generatedBy === 'demo') toast('info', 'Demo CV ready (no AI was used).');
      navigate('/cv/new');
    } catch (err) {
      if (!controller.signal.aborted) setFailure(errorMessage(err));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return { draft, profileReady, busy, failure, generate };
}
