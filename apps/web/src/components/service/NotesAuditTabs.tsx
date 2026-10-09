'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, UserPlus, Globe2 } from 'lucide-react';
import { Button, Badge, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, statusLabel } from './serviceHelpers';

export const NotesTab: React.FC<{ ticket: any; onChanged: () => void | Promise<void> }> = ({ ticket, onChanged }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comments: any[] = ticket.comments || [];

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/service/tickets/${ticket.id}/comments`, { body: text.trim(), is_internal: true });
      setText('');
      await onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Team notes & customer messages</h5>
      {comments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">No comments yet.</div>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {comments.map((c) => {
            const fromCustomer = !c.author_id && c.is_internal === false;
            return (
              <div key={c.id} className={`space-y-1 rounded-xl border p-2.5 text-xs ${fromCustomer ? 'border-[#0F5E63]/40 bg-[#E3EFEE]' : 'border-[#DCD8CE] bg-white'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-[#14213D]">
                    {fromCustomer ? (
                      <>
                        <Globe2 className="h-3 w-3 text-[#0F5E63]" /> Customer <Badge variant="info" size="sm">via portal</Badge>
                      </>
                    ) : (
                      c.author_name || 'Team member'
                    )}
                    {!fromCustomer && c.is_internal === false && <Badge variant="outline" size="sm">visible to customer</Badge>}
                  </span>
                  <span className="text-[10px] text-[#4A5568]">{new Date(c.created_at).toLocaleString('en-IN')}</span>
                </div>
                <p className="whitespace-pre-wrap text-[#14213D]">{c.body}</p>
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={post} className="flex gap-2">
        <Input placeholder="Type an internal note for engineers or coordinators…" value={text} onChange={(e) => setText(e.target.value)} className="flex-1" />
        <Button type="submit" size="sm" isLoading={busy}>
          Post note
        </Button>
      </form>
    </div>
  );
};

type Row = { key: string; at: string; kind: 'status' | 'assign'; data: any };

export const AuditTab: React.FC<{ ticket: any; engineerNames: Record<string, string> }> = ({ ticket, engineerNames }) => {
  const rows = useMemo<Row[]>(() => {
    const s: Row[] = (ticket.status_history || []).map((h: any) => ({ key: `s${h.id}`, at: h.changed_at, kind: 'status' as const, data: h }));
    const a: Row[] = (ticket.assignment_history || []).map((h: any) => ({ key: `a${h.id}`, at: h.changed_at, kind: 'assign' as const, data: h }));
    return [...s, ...a].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [ticket.status_history, ticket.assignment_history]);

  const who = (id?: string | null) => (id ? engineerNames[id] || `engineer …${id.slice(-4)}` : 'nobody');

  return (
    <div className="space-y-4">
      <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Status progression, assignments & SLA audit trail</h5>
      {ticket.reopened_count > 0 && (
        <p className="text-xs text-[#7C2D12]">This ticket has been reopened {ticket.reopened_count} time{ticket.reopened_count > 1 ? 's' : ''}.</p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">No audit records yet.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) =>
            r.kind === 'status' ? (
              <div key={r.key} className="flex items-start justify-between gap-4 rounded-xl border border-[#DCD8CE] bg-white p-3 text-xs">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold uppercase text-[#4A5568]">{r.data.from_status ? statusLabel(r.data.from_status) : 'Initial'}</span>
                    <ChevronRight className="h-3 w-3 text-[#4A5568]" />
                    <span className="font-mono font-bold uppercase text-[#0F5E63]">{statusLabel(r.data.to_status)}</span>
                    {r.data.sla_impact && r.data.sla_impact !== 'none' && <Badge variant="warning" size="sm">SLA {String(r.data.sla_impact).toUpperCase()}</Badge>}
                  </div>
                  {r.data.reason && <p className="italic text-[#14213D]">“{r.data.reason}”</p>}
                  <span className="block text-[10px] text-[#4A5568]">By {r.data.changed_by_name || 'System / customer portal'}</span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[#4A5568]">{new Date(r.at).toLocaleString('en-IN')}</span>
              </div>
            ) : (
              <div key={r.key} className="flex items-start justify-between gap-4 rounded-xl border border-[#0F5E63]/25 bg-[#E3EFEE]/50 p-3 text-xs">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[#14213D]">
                    <UserPlus className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <strong>Assignment:</strong> {who(r.data.from_engineer)}
                    <ChevronRight className="h-3 w-3 text-[#4A5568]" />
                    <strong className="text-[#0F5E63]">{who(r.data.to_engineer)}</strong>
                  </div>
                  {r.data.reason && <p className="italic text-[#14213D]">“{r.data.reason}”</p>}
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[#4A5568]">{new Date(r.at).toLocaleString('en-IN')}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
};
