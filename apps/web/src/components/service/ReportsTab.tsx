'use client';

import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, Badge, Input, formatDateIN } from '@/components/ui';
import { api } from '@/lib/api';
import { safeHttpUrl } from '@/lib/safe-url';
import { errMsg, isAssignedEngineer, MANAGER_ROLES, parsePartsReplaced } from './serviceHelpers';

interface Props {
  ticket: any;
  role: string;
  userId: string;
  onNewReport: () => void;
  onChanged: () => void | Promise<void>;
}

export const ReportsTab: React.FC<Props> = ({ ticket, role, userId, onNewReport, onChanged }) => {
  const [returning, setReturning] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  const status = String(ticket.status);
  // the API takes a report only from the assigned (or an additional) engineer, or admin
  const canFile = (role === 'admin' || (role === 'service_team' && isAssignedEngineer(ticket, userId))) && ['in_progress', 'resolved'].includes(status);
  const canReview = MANAGER_ROLES.includes(role) && ['report_submitted', 'revisit_required'].includes(status);
  const reports: any[] = ticket.reports || [];

  const review = async (id: string, approved: boolean) => {
    if (!approved && reason.trim().length < 5) return setError({ id, msg: 'Give a reason of at least 5 characters for returning the report.' });
    setBusy(id);
    setError(null);
    try {
      await api.post(`/service/tickets/${ticket.id}/reports/${id}/review`, {
        approved,
        return_reason: approved ? undefined : reason.trim(),
      });
      setReturning(null);
      setReason('');
      await onChanged();
    } catch (e) {
      setError({ id, msg: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Filed service reports</h5>
        {canFile && (
          <Button size="xs" onClick={onNewReport} className="h-9 shrink-0 sm:h-7">
            <Plus className="mr-1 h-3.5 w-3.5" />
            New report
          </Button>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">
          No service reports filed yet.{' '}
          {!['in_progress', 'resolved'].includes(status) && !['closed', 'cancelled'].includes(status) ? 'A report can be filed once work is in progress.' : ''}
        </div>
      ) : (
        reports.map((rep) => {
          const parts = parsePartsReplaced(rep.parts_replaced);
          // stored links are free text: only an http(s) address is ever rendered as a link
          const reportUrl = safeHttpUrl(rep.report_url);
          return (
            <div key={rep.id} className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3 sm:p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#14213D]">By {rep.submitted_by_name || 'Service Engineer'}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[#4A5568]">{formatDateIN(rep.created_at)}</span>
                  <Badge variant={rep.report_status === 'Approved' ? 'success' : rep.report_status === 'Returned for Correction' ? 'urgent' : 'warning'} size="sm">
                    {rep.report_status || 'Submitted'}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-[#14213D]">
                <p><strong>Problem identified:</strong> {rep.problem_identified}</p>
                {rep.root_cause && <p><strong>Root cause:</strong> {rep.root_cause}</p>}
                <p><strong>Action taken:</strong> {rep.action_taken}</p>
                {parts.text && <p><strong>Parts replaced:</strong> {parts.text}</p>}
                {parts.items && parts.items.length > 0 && (
                  <p>
                    <strong>Parts replaced:</strong>{' '}
                    {parts.items.map((p) => `${p.part_name} × ${p.quantity}`).join(', ')}
                  </p>
                )}
                <p>
                  <strong>Customer confirmation:</strong>{' '}
                  {rep.customer_confirmation === false
                    ? `Not obtained — ${rep.confirmation_not_obtained_reason || 'no reason recorded'}`
                    : `${rep.customer_confirmation_type || 'Obtained'}${rep.customer_name_signed ? ` · ${rep.customer_name_signed}` : ''}`}
                </p>
                {rep.customer_feedback_rating != null && <p><strong>Customer rating:</strong> {rep.customer_feedback_rating} / 5</p>}
                {rep.customer_remarks && <p><strong>Customer remarks:</strong> {rep.customer_remarks}</p>}
                {rep.further_work_required && (
                  <p className="rounded border border-[#F2B872] bg-[#FBEBDD] p-2 text-[#7C2D12]">
                    <strong>Further work:</strong> {rep.further_work_description}
                    {rep.next_visit_date ? ` · next visit ${formatDateIN(rep.next_visit_date)}` : ''}
                  </p>
                )}
                {reportUrl && (
                  <p>
                    <a className="text-[#0F5E63] underline" href={reportUrl} target="_blank" rel="noopener noreferrer">Signed report document</a>
                  </p>
                )}
                {Array.isArray(rep.attachments) && rep.attachments.length > 0 && (
                  <ul className="space-y-0.5">
                    {rep.attachments.map((f: { name?: string; url?: string }, i: number) =>
                      safeHttpUrl(f?.url) ? (
                        <li key={`${f.url}-${i}`}>
                          <a className="text-[#0F5E63] underline" href={safeHttpUrl(f.url) as string} target="_blank" rel="noopener noreferrer">
                            {f.name || `Attachment ${i + 1}`}
                          </a>
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
                {rep.return_reason && (
                  <div className="rounded border border-[#F3C7CF] bg-[#FCE8EC] p-2 text-xs text-[#700F2D]">
                    <strong>Correction required:</strong> {rep.return_reason}
                  </div>
                )}
              </div>

              {rep.report_status === 'Submitted' && canReview && (
                <div className="space-y-2 border-t border-[#ECE9E2] pt-2">
                  {error?.id === rep.id && (
                    <div role="alert" className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-2 text-xs text-[#700F2D]">
                      {error?.msg}
                    </div>
                  )}
                  {returning === rep.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input placeholder="Reason for returning the report (min. 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
                      <div className="flex shrink-0 gap-2">
                        <Button size="xs" variant="danger" isLoading={busy === rep.id} onClick={() => review(rep.id, false)} className="h-10 flex-1 sm:h-7 sm:flex-initial">
                          Confirm return
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => { setReturning(null); setError(null); }} className="h-10 shrink-0 sm:h-7">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // phones: the two review buttons share the row as 40px targets
                    <div className="flex justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-initial">
                      <Button size="xs" variant="secondary" onClick={() => setReturning(rep.id)} className="h-10 sm:h-7">
                        Return for correction
                      </Button>
                      <Button size="xs" isLoading={busy === rep.id} onClick={() => review(rep.id, true)} className="h-10 sm:h-7">
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Approve report
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
