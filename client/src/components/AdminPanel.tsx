import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { useToast } from '../state';
import type { AdminUser } from '../types';
import { Button, Card, ConfirmDialog, LoadingBlock, Notice, formatDate } from './ui';

export function AdminPanel() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [dailyLimit, setDailyLimit] = useState(0);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.users().then((data) => {
      if (cancelled) return;
      setUsers(data.users);
      setDailyLimit(data.dailyLimit);
    }).catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, []);

  async function toggle(user: AdminUser) {
    try {
      await api.setUserDisabled(user.id, !user.disabled);
      setUsers((list) => list?.map((u) => (u.id === user.id ? { ...u, disabled: !u.disabled } : u)) ?? null);
      toast('success', user.disabled ? `${user.name} can use the app again.` : `${user.name} has been switched off.`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteUser(toDelete.id);
      setUsers((list) => list?.filter((u) => u.id !== toDelete.id) ?? null);
      toast('success', `${toDelete.name}'s account and CVs were deleted.`);
      setToDelete(null);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!users) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold text-slate-900">People using the app</h2>
        <p className="mt-1 text-sm text-slate-600">Daily AI allowance per member: {dailyLimit || 'unlimited'}.</p>
        <ul className="mt-2 divide-y divide-slate-100">
          {users.map((user) => (
            <li key={user.id} className="py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    {user.name || 'Unnamed'}
                    {user.role === 'admin' && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">Owner</span>}
                    {user.disabled && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">Switched off</span>}
                  </p>
                  {user.email && <p className="truncate text-xs text-slate-500">{user.email}</p>}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {user.savedCvs} saved CVs · {user.aiToday} AI requests today
                    {user.lastLoginAt ? ` · last seen ${formatDate(user.lastLoginAt)}` : ''}
                  </p>
                </div>
                {user.role !== 'admin' && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => toggle(user)}>
                      {user.disabled ? 'Switch on' : 'Switch off'}
                    </Button>
                    <Button size="sm" variant="danger" icon="trash" aria-label={`Delete ${user.name}`} onClick={() => setToDelete(user)} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog open={toDelete !== null} title={`Delete ${toDelete?.name ?? 'this person'}?`} confirmLabel="Delete" danger busy={deleting} onCancel={() => setToDelete(null)} onConfirm={confirmDelete}>
        Their account, master CV and every saved CV will be permanently deleted. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
