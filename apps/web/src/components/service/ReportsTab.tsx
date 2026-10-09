'use client';

import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, Badge, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, MANAGER_ROLES, parsePartsReplaced } from './serviceHelpers';

interface Props {
  ticket: any;
  role: string;
  onNewReport: () => void;
  onChanged: () => void | Promise<void>;
}

export const ReportsTab: React.FC<Props> = ({ ticket, role, onNewReport, onChanged }) => {
  const [returning, setReturning] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  const status = String(ticket.status);
  const canFile = ['service_team', 'admin'].includes(role) && ['in_progress', 'resolved'].includes(status);
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
      <div className="flex items-center justify-between">
        <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Filed service reports</h5>
        {canFile && (
          <Button size="xs" onClick={onNewReport}>
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
          return (
            <div key={rep.id} className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#14213D]">By {rep.submitted_by_name || 'Service Engineer'}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[#4A5568]">{new Date(rep.created_at).toLocaleDateString('en-IN')}</span>
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
                    {rep.next_visit_date ? ` · next visit ${new Date(rep.next_visit_date).toLocaleDateString('en-IN')}` : ''}
                  </p>
                )}
                {rep.report_url && (
                  <p>
                    <a className="text-[#0F5E63] underline" href={rep.report_url} target="_blank" rel="noreferrer">Signed report document</a>
                  </p>
                )}
                {rep.return_reason && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    <strong>Correction required:</strong> {rep.return_reason}
                  </div>
                )}
              </div>

              {rep.report_status === 'Submitted' && canReview && (
                <div className="space-y-2 border-t border-[#ECE9E2] pt-2">
                  {error?.id === rep.id && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      {error?.msg}
                    </div>
                  )}
                  {returning === rep.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input placeholder="Reason for returning the report (min. 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
                      <div className="flex gap-2">
                        <Button size="xs" variant="danger" isLoading={busy === rep.id} onClick={() => review(rep.id, false)}>
                          Confirm return
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => { setReturning(null); setError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button size="xs" variant="secondary" onClick={() => setReturning(rep.id)}>
                        Return for correction
                      </Button>
                      <Button size="xs" isLoading={busy === rep.id} onClick={() => review(rep.id, true)}>
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
