'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, ClipboardList, Package, Paperclip, Plus, Trash2, UserCheck } from 'lucide-react';
import { Modal, Button, Input, Select, Textarea, InfoCallout, FormSteps } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict, todayLocal } from './serviceHelpers';

const CONFIRMATION_TYPES = ['Signature', 'OTP', 'Email Confirmation', 'Photo of Signed Job Sheet'];
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface Attachment {
  name: string;
  url: string;
}

/** Signed direct upload through the shared uploads API (POST /uploads/sign → Cloudinary); returns the stored URL. */
async function uploadReportFile(file: File): Promise<Attachment> {
  const sig = await api.post<{ timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string; allowedFormats: string }>('/uploads/sign', {
    folder: 'service-reports',
  });
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('allowed_formats', sig.allowedFormats); // signed by the API — must be sent exactly as returned
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/auto/upload`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.secure_url) throw new Error(data?.error?.message || 'Upload failed');
  return { name: file.name, url: data.secure_url as string };
}

interface PartRow {
  name: string;
  qty: string;
}

const blank = (ticket: any) => ({
  problem: ticket?.complaint || '',
  rootCause: '',
  action: '',
  parts: [] as PartRow[],
  warranty: ticket?.warranty_status || 'in_warranty',
  obtained: true,
  confirmationType: 'Signature',
  officer: '',
  notObtainedReason: '',
  rating: '',
  customerRemarks: '',
  furtherWork: false,
  furtherDesc: '',
  nextVisit: '',
  reportUrl: '',
  attachments: [] as Attachment[],
});

interface Props {
  ticket: any | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onStale: () => void | Promise<void>;
}

export const ReportFormModal: React.FC<Props> = ({ ticket, onClose, onDone, onStale }) => {
  const [f, setF] = useState(() => blank(ticket));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setF(blank(ticket));
    setErrors({});
    setError(null);
    setBusy(false);
    setUploading(false);
    setUploadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  if (!ticket) return null;
  const status = String(ticket.status);
  const wrongStatus = !['in_progress', 'resolved'].includes(status);
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setUploadError(null);
    const room = MAX_ATTACHMENTS - f.attachments.length;
    if (files.length > room) return setUploadError(`A report can carry at most ${MAX_ATTACHMENTS} attachments.`);
    const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooBig) return setUploadError(`${tooBig.name} is larger than 10 MB.`);
    setUploading(true);
    const failures: string[] = [];
    for (const file of files) {
      try {
        const att = await uploadReportFile(file);
        setF((s) => ({ ...s, attachments: [...s.attachments, att] }));
      } catch (err) {
        failures.push(`${file.name}: ${errMsg(err, 'upload failed')}`);
      }
    }
    setUploading(false);
    if (failures.length) setUploadError(`Could not upload ${failures.join('; ')}`);
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (f.problem.trim().length < 5) e.problem = 'Describe the problem identified (at least 5 characters).';
    if (f.action.trim().length < 5) e.action = 'Describe the action taken (at least 5 characters).';
    f.parts.forEach((p, i) => {
      const hasName = p.name.trim().length > 0;
      const q = Number(p.qty);
      if (!hasName && p.qty) e[`part_${i}`] = 'Enter the part name.';
      else if (hasName && (!Number.isInteger(q) || q < 1)) e[`part_${i}`] = 'Quantity must be a whole number of 1 or more.';
    });
    if (f.obtained) {
      if (f.officer.trim().length < 2) e.officer = 'Customer officer name (and designation) is required when sign-off is obtained.';
    } else if (f.notObtainedReason.trim().length < 5) {
      e.notObtainedReason = 'Explain why customer confirmation could not be obtained (at least 5 characters).';
    }
    if (f.rating) {
      const r = Number(f.rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) e.rating = 'Rating must be a whole number from 1 to 5.';
    }
    if (f.furtherWork) {
      if (f.furtherDesc.trim().length < 5) e.furtherDesc = 'Describe the further work needed (at least 5 characters).';
      if (!f.nextVisit) e.nextVisit = 'Pick the next visit date.';
      else if (f.nextVisit < todayLocal()) e.nextVisit = 'The next visit date cannot be in the past.';
    }
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (wrongStatus) return setError('A report can only be filed while the ticket is in progress (or resolved). Start work first.');
    if (uploading) return setError('Wait for the attachments to finish uploading.');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return setError('Please fix the highlighted fields.');
    setError(null);
    setBusy(true);
    const parts = f.parts
      .filter((p) => p.name.trim())
      .map((p) => ({ part_name: p.name.trim(), quantity: Number(p.qty) || 1 }));
    try {
      await api.post(`/service/tickets/${ticket.id}/report`, {
        problem_identified: f.problem.trim(),
        root_cause: f.rootCause.trim() || undefined,
        action_taken: f.action.trim(),
        parts_replaced: parts.length ? parts : undefined,
        warranty_status: f.warranty,
        customer_confirmation: f.obtained,
        customer_confirmation_type: f.obtained ? f.confirmationType : 'Not Obtained',
        customer_name_signed: f.obtained ? f.officer.trim() : undefined,
        confirmation_not_obtained_reason: f.obtained ? undefined : f.notObtainedReason.trim(),
        customer_feedback_rating: f.rating ? Number(f.rating) : undefined,
        customer_remarks: f.customerRemarks.trim() || undefined,
        further_work_required: f.furtherWork,
        further_work_description: f.furtherWork ? f.furtherDesc.trim() : undefined,
        next_visit_date: f.furtherWork ? f.nextVisit : undefined,
        report_url: f.reportUrl.trim() || undefined,
        attachments: f.attachments.length ? f.attachments : undefined,
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
      if (isConflict(err)) await onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="File Service Report"
      description="Diagnostic findings, rectification, spares used and customer confirmation. Filing moves the ticket to Service Report Submitted."
      maxWidth="lg"
      zIndex={80}
    >
      <form onSubmit={submit}>
        <FormSteps
          onCancel={onClose}
          banner={
            (error || wrongStatus) && (
              <>
                {error && (
                  <div role="alert" className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-3 text-xs text-[#700F2D]">
                    {error}
                  </div>
                )}
                {wrongStatus && (
                  <InfoCallout variant="warning">
                    This ticket is "{status.replace(/_/g, ' ')}". A report can be filed once work has started — check in on the visit or move the ticket to In Progress first.
                  </InfoCallout>
                )}
              </>
            )
          }
          submit={
            // phones: same 40px height as the Back button beside it in the shared footer
            <Button type="submit" size="sm" isLoading={busy} disabled={wrongStatus || uploading} className="h-10 sm:h-8">
              File service report
            </Button>
          }
          steps={[
            {
              title: 'Findings',
              icon: <ClipboardList />,
              description: 'What was wrong with the machine and what you did to fix it.',
              content: (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3 text-xs">
                    <div>
                      <span className="text-[#4A5568]">Ticket:</span> <strong className="font-mono text-[#0F5E63]">{ticket.ticket_no}</strong>
                    </div>
                    <div>
                      <span className="text-[#4A5568]">Customer:</span> <strong className="text-[#14213D]">{ticket.organisation_name}</strong>
                    </div>
                    {ticket.equipment_serial && (
                      <div className="sm:col-span-2">
                        <span className="text-[#4A5568]">Machine S/N:</span> <strong className="font-mono text-[#14213D]">{ticket.equipment_serial}</strong>
                      </div>
                    )}
                  </div>

                  <Textarea label="Problem identified" required rows={2} value={f.problem} error={errors.problem} onChange={(e) => set({ problem: e.target.value })} placeholder="e.g. Diode array board shorted after a power surge." />
                  <Input label="Root cause (optional)" value={f.rootCause} onChange={(e) => set({ rootCause: e.target.value })} />
                  <Textarea label="Action taken / rectification steps" required rows={3} value={f.action} error={errors.action} onChange={(e) => set({ action: e.target.value })} placeholder="e.g. Replaced PCB #DA-200, cleaned collimator, recalibrated generator." />
                </div>
              ),
            },
            {
              title: 'Parts',
              icon: <Package />,
              description: 'Spares you replaced, and whether this visit is covered or billable.',
              content: (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#14213D]">Spare parts replaced</span>
                      <Button type="button" size="xs" variant="secondary" onClick={() => set({ parts: [...f.parts, { name: '', qty: '1' }] })}>
                        <Plus className="mr-1 h-3 w-3" /> Add part
                      </Button>
                    </div>
                    {f.parts.length === 0 && <p className="text-[11px] text-[#4A5568]">No parts replaced.</p>}
                    {f.parts.map((p, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Input placeholder="Part name / number" aria-label={`Part ${i + 1} name`} value={p.name} onChange={(e) => set({ parts: f.parts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                          </div>
                          <div className="w-20 shrink-0 sm:w-24">
                            <Input type="number" min={1} step={1} aria-label={`Part ${i + 1} quantity`} value={p.qty} onChange={(e) => set({ parts: f.parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
                          </div>
                          <Button type="button" size="sm" variant="ghost" aria-label="Remove part" className="h-10 w-10 shrink-0 px-0 sm:h-8 sm:w-auto sm:px-2.5" onClick={() => set({ parts: f.parts.filter((_, j) => j !== i) })}>
                            <Trash2 className="h-3.5 w-3.5 text-[#9A3412]" />
                          </Button>
                        </div>
                        {errors[`part_${i}`] && <p className="text-xs font-medium text-[#881337]">{errors[`part_${i}`]}</p>}
                      </div>
                    ))}
                  </div>

                  <Select
                    label="Warranty / billable status"
                    value={f.warranty}
                    onChange={(e) => set({ warranty: e.target.value })}
                    options={[
                      { value: 'in_warranty', label: 'Warranty covered (FOC spares)' },
                      { value: 'amc', label: 'Covered under AMC' },
                      { value: 'out_of_warranty', label: 'Out of warranty — billable' },
                    ]}
                  />
                </div>
              ),
            },
            {
              title: 'Sign-off',
              icon: <UserCheck />,
              description: 'Did the customer confirm the work? Record who signed, or why not.',
              content: (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-[#14213D]">
                    <label className="flex min-h-10 cursor-pointer items-center gap-1.5 sm:min-h-0">
                      <input type="radio" name="confirm" checked={f.obtained} onChange={() => set({ obtained: true })} /> Obtained
                    </label>
                    <label className="flex min-h-10 cursor-pointer items-center gap-1.5 sm:min-h-0">
                      <input type="radio" name="confirm" checked={!f.obtained} onChange={() => set({ obtained: false })} /> Not obtained
                    </label>
                  </div>
                  {f.obtained ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Select label="How was it confirmed?" value={f.confirmationType} onChange={(e) => set({ confirmationType: e.target.value })} options={CONFIRMATION_TYPES.map((t) => ({ value: t, label: t }))} />
                      <Input label="Customer officer name & designation" required value={f.officer} error={errors.officer} onChange={(e) => set({ officer: e.target.value })} placeholder="e.g. ACP Rajiv Kumar, Security Head" />
                    </div>
                  ) : (
                    <Textarea label="Why was confirmation not obtained?" required rows={2} value={f.notObtainedReason} error={errors.notObtainedReason} onChange={(e) => set({ notObtainedReason: e.target.value })} />
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Select
                      label="Customer feedback rating (optional)"
                      value={f.rating}
                      error={errors.rating}
                      onChange={(e) => set({ rating: e.target.value })}
                      options={[{ value: '', label: 'No rating' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))]}
                    />
                    <Input label="Customer remarks (optional)" value={f.customerRemarks} onChange={(e) => set({ customerRemarks: e.target.value })} />
                  </div>
                </div>
              ),
            },
            {
              title: 'Follow-up',
              icon: <CalendarClock />,
              description: 'Attach the signed report and flag any revisit that is still needed.',
              content: (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#14213D]">Signed job sheet, photos &amp; documents</span>
                      <label className={`inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs font-semibold text-[#0F5E63] hover:bg-[#E3EFEE] sm:min-h-8 ${uploading || f.attachments.length >= MAX_ATTACHMENTS ? 'pointer-events-none opacity-50' : ''}`}>
                        <Paperclip className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Attach files'}
                        <input
                          type="file"
                          multiple
                          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                          className="hidden"
                          disabled={uploading || f.attachments.length >= MAX_ATTACHMENTS}
                          onChange={(e) => {
                            void addFiles(e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                    {f.attachments.length === 0 ? (
                      <p className="text-[11px] text-[#4A5568]">No files attached. PDF, Word, Excel or photos · up to 10 MB each, {MAX_ATTACHMENTS} files.</p>
                    ) : (
                      <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#DCD8CE]">
                        {f.attachments.map((a, i) => (
                          <li key={a.url} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                            <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[#0F5E63] underline">
                              {a.name}
                            </a>
                            <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${a.name}`} className="h-10 w-10 shrink-0 px-0 sm:h-8 sm:w-8" onClick={() => set({ attachments: f.attachments.filter((_, j) => j !== i) })}>
                              <Trash2 className="h-3.5 w-3.5 text-[#9A3412]" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {uploadError && <p className="text-xs font-medium text-[#881337]">{uploadError}</p>}
                  </div>

                  <Input label="Signed report document URL (optional)" value={f.reportUrl} onChange={(e) => set({ reportUrl: e.target.value })} placeholder="https://…" />

                  <div className="space-y-2">
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs font-semibold text-[#14213D] sm:min-h-0">
                      <input type="checkbox" checked={f.furtherWork} onChange={(e) => set({ furtherWork: e.target.checked })} className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63]" />
                      Further work / revisit required
                    </label>
                    {f.furtherWork && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Textarea label="Further work needed" required rows={2} value={f.furtherDesc} error={errors.furtherDesc} onChange={(e) => set({ furtherDesc: e.target.value })} />
                        <Input label="Next visit date" type="date" required min={todayLocal()} value={f.nextVisit} error={errors.nextVisit} onChange={(e) => set({ nextVisit: e.target.value })} />
                      </div>
                    )}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </form>
    </Modal>
  );
};
