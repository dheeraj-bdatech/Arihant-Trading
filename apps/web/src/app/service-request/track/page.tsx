'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Input, Textarea, InfoCallout, Badge } from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { DeadlineChip } from '@/components/tender/Countdown';
import { apiMessages, fmtDate, fmtDateTime } from '../shared';

interface Tracked {
  reference: string;
  status: string;
  status_label: string;
  is_closed: boolean;
  created_at: string;
  complaint: string;
  product?: string | null;
  serial?: string | null;
  location?: string | null;
  engineer_first_name?: string | null;
  planned_visit_date?: string | null;
  sla?: { response_due_at?: string | null; first_response_at?: string | null; resolution_due_at?: string | null; paused?: boolean } | null;
  timeline: { status: string; label: string; at: string }[];
  messages: { from: string; body: string; at: string }[];
  work_summary?: { problem?: string; action?: string; submitted_at?: string } | null;
  can_comment: boolean;
  can_give_feedback: boolean;
}

const NOT_FOUND = 'We could not find a request with that reference and tracking code. Please check both and try again.';

/** Hide internal triage prefix the desk adds for unverified public requests. */
function cleanComplaint(c: string): string {
  return (c || '').replace(/^\s*\[UNVERIFIED CUSTOMER[^\]]*\]\s*/i, '');
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === 'cancelled') return 'bg-[#ECE9E2] text-[#4A5568] border-[#C9C4B8]';
  if (['resolved', 'report_submitted', 'closed'].includes(s)) return 'bg-[#E3F3E6] text-[#1B6B2F] border-[#1B6B2F]/30';
  if (s.startsWith('awaiting')) return 'bg-[#FBEBDD] text-[#7C2D12] border-[#C98A1B]';
  if (['in_progress', 'visit_scheduled'].includes(s)) return 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30';
  return 'bg-[#FBFAF7] text-[#4A5568] border-[#DCD8CE]';
}

function TrackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const ref = (params.get('ref') || '').trim();
  const token = (params.get('token') || '').trim();

  if (!ref || !token) return <LookupForm initialRef={ref} initialToken={token} onGo={(r, t) => router.push(`/service-request/track?ref=${encodeURIComponent(r)}&token=${encodeURIComponent(t)}`)} />;
  return <TrackView key={`${ref}|${token}`} reference={ref} token={token} />;
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Spinner size="lg" /></div>}>
      <TrackInner />
    </Suspense>
  );
}

function LookupForm({ initialRef, initialToken, onGo }: { initialRef: string; initialToken: string; onGo: (r: string, t: string) => void }) {
  const [r, setR] = useState(initialRef);
  const [t, setT] = useState(initialToken);
  const [err, setErr] = useState('');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-bold text-[#14213D] sm:text-3xl">Track your service request</h1>
        <p className="mt-1 text-sm text-[#4A5568]">Enter the reference number and tracking code you were given when you submitted the request.</p>
      </div>
      <Card padding="md">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!r.trim() || !t.trim()) { setErr('Enter both the reference number and the tracking code.'); return; }
            onGo(r.trim().toUpperCase(), t.trim());
          }}
        >
          <Input label="Reference number" required placeholder="TCK-2026-100436" value={r} onChange={(e) => setR(e.target.value)} autoCapitalize="characters" autoComplete="off" className="h-11 font-mono text-sm" />
          <Input label="Tracking code" required value={t} onChange={(e) => setT(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} className="h-11 font-mono text-sm" />
          {err && <p className="text-xs font-medium text-[#881337]">{err}</p>}
          <Button type="submit" size="lg" fullWidth className="min-h-[48px]">Show my request</Button>
        </form>
      </Card>
      <p className="text-center text-sm text-[#4A5568]">
        Need to report a new problem?{' '}
        <Link href="/service-request" className="font-semibold text-[#0F5E63] underline">Raise a service request</Link>
      </p>
    </div>
  );
}

function TrackView({ reference, token }: { reference: string; token: string }) {
  const [data, setData] = useState<Tracked | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'limited' | 'error'>('loading');
  const q = useRef({ ref: reference, token });

  const load = useCallback(async (silent: boolean) => {
    try {
      const d = await api.get<Tracked>('/public/service-requests/track', q.current);
      setData(d);
      setState('ok');
    } catch (err: any) {
      if (silent) return; // keep showing what we have
      if (err instanceof ApiError && err.status === 404) setState('notfound');
      else if (err instanceof ApiError && err.status === 429) setState('limited');
      else setState('error');
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (state !== 'ok') return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 60000);
    return () => clearInterval(id);
  }, [state, load]);

  if (state === 'loading') return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  if (state !== 'ok' || !data) {
    const text = state === 'notfound' ? NOT_FOUND
      : state === 'limited' ? 'Too many lookups from this connection. Please wait a few minutes and try again.'
      : 'We could not load your request right now. Please check your connection and try again.';
    return (
      <Card padding="lg" className="space-y-4 text-center">
        <h1 className="font-serif text-xl font-bold text-[#14213D]">{state === 'notfound' ? 'Request not found' : 'Unable to show your request'}</h1>
        <p className="text-sm text-[#4A5568]">{text}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {state !== 'notfound' && <Button size="lg" onClick={() => { setState('loading'); load(false); }}>Try again</Button>}
          <Link href="/service-request/track" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#C9C4B8] bg-white px-4 text-sm font-semibold text-[#0F5E63]">Enter details again</Link>
        </div>
      </Card>
    );
  }

  return <Details data={data} reference={reference} token={token} reload={() => load(true)} />;
}

function Details({ data, reference, token, reload }: { data: Tracked; reference: string; token: string; reload: () => void }) {
  const sla = data.sla || {};
  const showResponse = sla.response_due_at && !sla.first_response_at;
  const showResolution = sla.resolution_due_at && !data.is_closed;
  const timeline = data.timeline || [];
  const messages = data.messages || [];

  return (
    <div className="space-y-5">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#4A5568]">Service request</p>
            <h1 className="break-all font-mono text-2xl font-bold text-[#14213D] sm:text-3xl">{data.reference}</h1>
            <p className="mt-1 text-xs text-[#4A5568]">Raised {fmtDateTime(data.created_at)} IST</p>
          </div>
          <span className={`inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-bold ${statusTone(data.status)}`}>{data.status_label}</span>
        </div>
        {(data.product || data.serial || data.location) && (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {data.product && <div><dt className="text-xs text-[#4A5568]">Equipment</dt><dd className="text-[#14213D]">{data.product}</dd></div>}
            {data.serial && <div><dt className="text-xs text-[#4A5568]">Serial</dt><dd className="break-all font-mono text-[#14213D]">{data.serial}</dd></div>}
            {data.location && <div><dt className="text-xs text-[#4A5568]">Site</dt><dd className="text-[#14213D]">{data.location}</dd></div>}
          </dl>
        )}
      </Card>

      {(data.engineer_first_name || data.planned_visit_date || showResponse || showResolution) && (
        <Card padding="md" className="space-y-3">
          <h2 className="font-serif text-lg font-bold text-[#14213D]">What to expect</h2>
          {sla.paused && !data.is_closed && (
            <InfoCallout variant="warning">Our timer is paused while we wait for something. We will resume as soon as it is sorted.</InfoCallout>
          )}
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {data.engineer_first_name && <div><p className="text-xs text-[#4A5568]">Your engineer</p><p className="font-semibold text-[#14213D]">{data.engineer_first_name}</p></div>}
            {data.planned_visit_date && <div><p className="text-xs text-[#4A5568]">Planned visit</p><p className="font-semibold text-[#14213D]">{fmtDate(data.planned_visit_date)}</p></div>}
            {showResponse && (
              <div>
                <p className="text-xs text-[#4A5568]">First response due in</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {sla.paused ? <Badge variant="warning" size="sm">Paused</Badge> : <DeadlineChip deadline={sla.response_due_at} />}
                  <span className="text-xs text-[#4A5568]">by {fmtDateTime(sla.response_due_at)}</span>
                </div>
              </div>
            )}
            {showResolution && (
              <div>
                <p className="text-xs text-[#4A5568]">Target resolution in</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {sla.paused ? <Badge variant="warning" size="sm">Paused</Badge> : <DeadlineChip deadline={sla.resolution_due_at} />}
                  <span className="text-xs text-[#4A5568]">by {fmtDateTime(sla.resolution_due_at)}</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card padding="md" className="space-y-3">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">Progress</h2>
        {timeline.length === 0 ? <p className="text-sm text-[#4A5568]">No updates yet.</p> : (
          <ol className="relative ml-2 border-l-2 border-[#DCD8CE]">
            {timeline.map((t, i) => {
              const last = i === timeline.length - 1;
              return (
                <li key={`${t.status}-${i}`} className="relative pb-4 pl-5 last:pb-0">
                  <span className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 ${last ? 'border-[#0F5E63] bg-[#0F5E63]' : 'border-[#C9C4B8] bg-white'}`} />
                  <p className={`text-sm ${last ? 'font-bold text-[#14213D]' : 'font-medium text-[#4A5568]'}`}>{t.label}</p>
                  <p className="font-mono text-[11px] text-[#4A5568]">{fmtDateTime(t.at)} IST</p>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card padding="md" className="space-y-2">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">Your complaint</h2>
        <p className="whitespace-pre-wrap break-words text-sm text-[#14213D]">{cleanComplaint(data.complaint)}</p>
      </Card>

      {data.work_summary && (data.work_summary.problem || data.work_summary.action) && (
        <Card padding="md" className="space-y-3">
          <h2 className="font-serif text-lg font-bold text-[#14213D]">Work done</h2>
          {data.work_summary.problem && <div><p className="text-xs font-semibold text-[#4A5568]">Problem found</p><p className="whitespace-pre-wrap break-words text-sm text-[#14213D]">{data.work_summary.problem}</p></div>}
          {data.work_summary.action && <div><p className="text-xs font-semibold text-[#4A5568]">Action taken</p><p className="whitespace-pre-wrap break-words text-sm text-[#14213D]">{data.work_summary.action}</p></div>}
          {data.work_summary.submitted_at && <p className="font-mono text-[11px] text-[#4A5568]">{fmtDateTime(data.work_summary.submitted_at)} IST</p>}
        </Card>
      )}

      {data.can_give_feedback && <FeedbackPanel reference={reference} token={token} onDone={reload} />}

      <Card padding="md" className="space-y-3">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">Messages</h2>
        {messages.length === 0 ? <p className="text-sm text-[#4A5568]">No messages yet.</p> : (
          <ul className="space-y-3">
            {messages.map((m, i) => {
              const mine = m.from === 'You';
              return (
                <li key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] rounded-[14px] border px-3 py-2 ${mine ? 'border-[#0F5E63]/30 bg-[#E3EFEE]' : 'border-[#DCD8CE] bg-[#FBFAF7]'}`}>
                    <p className="text-[11px] font-semibold text-[#4A5568]">{m.from}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-[#14213D]">{m.body}</p>
                    <p className="mt-1 font-mono text-[10px] text-[#4A5568]">{fmtDateTime(m.at)} IST</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data.can_comment && <MessageBox reference={reference} token={token} onSent={reload} />}
      </Card>

      <p className="text-center text-xs text-[#4A5568]">This page refreshes automatically. <Link href="/service-request" className="font-semibold text-[#0F5E63] underline">Raise another request</Link></p>
    </div>
  );
}

function MessageBox({ reference, token, onSent }: { reference: string; token: string; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [ok, setOk] = useState('');
  const lock = useRef(false);
  const len = body.trim().length;

  const send = async () => {
    if (lock.current) return;
    setOk('');
    if (len < 3) { setErr(['Write at least 3 characters.']); return; }
    if (len > 1500) { setErr(['Keep your message under 1500 characters.']); return; }
    lock.current = true; setSending(true); setErr([]);
    try {
      const res = await api.post<{ ok: boolean; message?: string }>('/public/service-requests/track/comment', { ref: reference, token, body: body.trim() });
      setOk(res.message || 'Your message has been sent to the service desk.');
      setBody('');
      onSent();
    } catch (e: any) {
      if (e?.status === 429) setErr(['You are sending messages too quickly. Please wait a few minutes.']);
      else if (e?.status === 400) setErr(apiMessages(e).length ? apiMessages(e) : ['Your message could not be sent.']);
      else setErr(['We could not send your message. Please try again.']);
    } finally { lock.current = false; setSending(false); }
  };

  return (
    <div className="space-y-2 border-t border-[#ECE9E2] pt-3">
      <Textarea label="Send a message to the service desk" rows={3} maxLength={1500} value={body} onChange={(e) => { setBody(e.target.value); setOk(''); }}
        disabled={sending} className="text-sm" helperText={`${len}/1500`} />
      {err.length > 0 && <div role="alert" className="text-xs font-medium text-[#881337]">{err.map((m, i) => <p key={i}>{m}</p>)}</div>}
      {ok && <p role="status" className="text-xs font-medium text-[#0F5E63]">{ok}</p>}
      <Button size="lg" onClick={send} isLoading={sending} disabled={sending || len < 3} className="min-h-[44px]">Send message</Button>
    </div>
  );
}

function FeedbackPanel({ reference, token, onDone }: { reference: string; token: string; onDone: () => void }) {
  const [choice, setChoice] = useState<'confirm_resolved' | 'not_resolved' | null>(null);
  const [rating, setRating] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const lock = useRef(false);

  const review = () => {
    if (choice === 'not_resolved' && remarks.trim().length < 5) { setErr(['Please tell us what is still wrong (at least 5 characters).']); return; }
    setErr([]); setConfirming(true);
  };

  const send = async () => {
    if (lock.current || !choice) return;
    lock.current = true; setSending(true); setErr([]);
    const body: Record<string, unknown> = { ref: reference, token, action: choice };
    if (choice === 'confirm_resolved' && rating) body.rating = rating;
    if (remarks.trim()) body.remarks = remarks.trim();
    try {
      const res = await api.post<{ ok: boolean; message?: string }>('/public/service-requests/track/feedback', body);
      setResult(res.message || 'Thank you for your feedback.');
      setConfirming(false);
      onDone();
    } catch (e: any) {
      setConfirming(false);
      if (e?.status === 429) setErr(['Too many attempts. Please wait a few minutes.']);
      else if (e?.status === 400) setErr(apiMessages(e).length ? apiMessages(e) : ['Your feedback could not be sent.']);
      else setErr(['We could not send your feedback. Please try again.']);
    } finally { lock.current = false; setSending(false); }
  };

  if (result) return <InfoCallout variant="success" title="Thank you">{result}</InfoCallout>;

  return (
    <Card padding="md" className="space-y-3">
      <h2 className="font-serif text-lg font-bold text-[#14213D]">Has the problem been fixed?</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {([['confirm_resolved', "Yes, it's fixed"], ['not_resolved', 'No, the problem is still there']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setChoice(k); setConfirming(false); setErr([]); }}
            className={`min-h-[48px] rounded-lg border px-3 text-sm font-semibold ${choice === k ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]' : 'border-[#C9C4B8] bg-white text-[#14213D]'}`}>
            {label}
          </button>
        ))}
      </div>

      {choice === 'confirm_resolved' && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-[#14213D]">How would you rate our service? (optional)</p>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => { setRating(rating === n ? 0 : n); setConfirming(false); }}
                  className="flex h-11 w-11 items-center justify-center text-3xl leading-none">
                  <span className={n <= rating ? 'text-[#C98A1B]' : 'text-[#C9C4B8]'}>&#9733;</span>
                </button>
              ))}
            </div>
          </div>
          <Textarea label="Remarks (optional)" rows={2} maxLength={1000} value={remarks} onChange={(e) => { setRemarks(e.target.value); setConfirming(false); }} className="text-sm" />
        </div>
      )}
      {choice === 'not_resolved' && (
        <Textarea label="What is still wrong?" required rows={3} maxLength={1000} value={remarks} onChange={(e) => { setRemarks(e.target.value); setConfirming(false); }} className="text-sm" />
      )}

      {err.length > 0 && <div role="alert" className="text-xs font-medium text-[#881337]">{err.map((m, i) => <p key={i}>{m}</p>)}</div>}

      {choice && !confirming && <Button size="lg" onClick={review} className="min-h-[44px]">Continue</Button>}
      {choice && confirming && (
        <div className="space-y-2 rounded-lg border border-[#C98A1B] bg-[#FFF6E6] p-3">
          <p className="text-sm text-[#14213D]">
            {choice === 'confirm_resolved'
              ? 'You are confirming the problem is fixed. We will close this request.'
              : 'You are telling us the problem is still there. We will reopen this request and escalate it.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" onClick={send} isLoading={sending} disabled={sending}>Confirm and send</Button>
            <Button size="lg" variant="ghost" onClick={() => setConfirming(false)} disabled={sending}>Go back</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
