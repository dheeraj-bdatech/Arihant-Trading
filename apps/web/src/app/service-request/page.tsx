'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Checkbox, Input, Select, Textarea, InfoCallout, Badge } from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { apiMessages, copyText, fmtDateTime } from './shared';

interface Meta {
  enabled: boolean;
  products: { id: string; name: string; category?: string }[];
  problem_categories: string[];
  urgencies: { value: string; label: string }[];
  states: string[];
  limits: {
    organisation: { min: number; max: number };
    person: { min: number; max: number };
    complaint: { min: number; max: number };
    location: { max: number };
    serial: { max: number };
    comment: { min: number; max: number };
  };
  response_targets: { urgency: string; response_hours: number }[];
}

interface Success {
  accepted: boolean;
  duplicate: boolean;
  reference: string;
  tracking_token?: string;
  track_path?: string;
  response_target_hours?: number;
  response_in_business_hours?: boolean;
  response_due_at?: string;
  customer_message?: string;
}

const OTHER = '__other__';

type FormState = {
  organisation_name: string; department: string; city: string; state: string; location: string;
  contact_name: string; contact_designation: string; contact_phone: string; contact_email: string;
  product_id: string; product_text: string; equipment_serial: string;
  problem_category: string; complaint: string; urgency: string;
  preferred_visit_date: string; site_access_notes: string; consent: boolean;
};

const EMPTY: FormState = {
  organisation_name: '', department: '', city: '', state: '', location: '',
  contact_name: '', contact_designation: '', contact_phone: '', contact_email: '',
  product_id: '', product_text: '', equipment_serial: '',
  problem_category: 'Breakdown', complaint: '', urgency: '',
  preferred_visit_date: '', site_access_notes: '', consent: false,
};

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function validate(f: FormState, m: Meta): Record<string, string> {
  const e: Record<string, string> = {};
  const L = m.limits;
  const org = f.organisation_name.trim();
  if (org.length < L.organisation.min) e.organisation_name = `Enter the organisation name (at least ${L.organisation.min} characters).`;
  else if (org.length > L.organisation.max) e.organisation_name = `Keep this under ${L.organisation.max} characters.`;
  if (f.city.trim().length < 2) e.city = 'Enter the city or town.';
  if (!f.state || !m.states.includes(f.state)) e.state = 'Select the state.';
  if (f.location.length > L.location.max) e.location = `Keep this under ${L.location.max} characters.`;
  const name = f.contact_name.trim();
  if (name.length < L.person.min) e.contact_name = 'Enter the contact person\'s name.';
  else if (name.length > L.person.max) e.contact_name = `Keep this under ${L.person.max} characters.`;
  else if (!/^[A-Za-z .'\-]+$/.test(name)) e.contact_name = 'Use letters, spaces and . \' - only.';
  const phone = f.contact_phone.replace(/[\s-]/g, '');
  const mobile = /^(?:\+91|91|0)?[6-9]\d{9}$/.test(phone);
  const landline = /^\d{8,12}$/.test(phone);
  if (!phone) e.contact_phone = 'Enter a phone number we can call.';
  else if (!mobile && !landline) e.contact_phone = 'Enter a 10-digit mobile number (starting 6-9) or a landline of 8-12 digits.';
  if (f.contact_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.contact_email.trim())) e.contact_email = 'Enter a valid email address.';
  if (f.equipment_serial.trim()) {
    if (f.equipment_serial.length > L.serial.max) e.equipment_serial = `Keep this under ${L.serial.max} characters.`;
    else if (!/^[A-Za-z0-9\-_/. ]+$/.test(f.equipment_serial)) e.equipment_serial = 'Use letters, digits and - _ / . only.';
  }
  if (f.product_id === OTHER && !f.product_text.trim()) e.product_text = 'Tell us which equipment this is.';
  const c = f.complaint.trim();
  if (c.length < L.complaint.min) e.complaint = `Please describe the problem in at least ${L.complaint.min} characters (${c.length} so far).`;
  else if (c.length > L.complaint.max) e.complaint = `Keep this under ${L.complaint.max} characters.`;
  else if (c.split(/\s+/).filter(Boolean).length < 3) e.complaint = 'Please write at least 3 words.';
  if (!f.urgency) e.urgency = 'Select how urgent this is.';
  if (f.preferred_visit_date) {
    const today = ymd(new Date());
    const max = ymd(new Date(Date.now() + 90 * 86400000));
    if (f.preferred_visit_date < today || f.preferred_visit_date > max) e.preferred_visit_date = 'Choose a date from today up to 90 days ahead.';
  }
  if (f.site_access_notes.length > 500) e.site_access_notes = 'Keep this under 500 characters.';
  if (!f.consent) e.consent = 'Please confirm to continue.';
  return e;
}

const FIELD_ORDER = [
  'organisation_name', 'city', 'state', 'location', 'contact_name', 'contact_phone', 'contact_email',
  'product_text', 'equipment_serial', 'complaint', 'urgency', 'preferred_visit_date', 'site_access_notes', 'consent',
];

/** Best-effort mapping of a server message to a field. */
function mapMessage(msg: string): string | null {
  const s = msg.toLowerCase();
  const table: [RegExp, string][] = [
    [/organi[sz]ation/, 'organisation_name'], [/\bcity\b/, 'city'], [/\bstate\b/, 'state'],
    [/location|checkpoint/, 'location'], [/contact_?name|contact person|\bname\b/, 'contact_name'],
    [/phone|mobile|landline/, 'contact_phone'], [/email/, 'contact_email'],
    [/serial/, 'equipment_serial'], [/complaint|problem|words/, 'complaint'], [/urgen/, 'urgency'],
    [/visit|date/, 'preferred_visit_date'], [/access/, 'site_access_notes'], [/consent|agree/, 'consent'],
    [/product|equipment/, 'product_text'],
  ];
  for (const [re, key] of table) if (re.test(s)) return key;
  return null;
}

export default function ServiceRequestPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaState, setMetaState] = useState<'loading' | 'ready' | 'disabled' | 'error'>('loading');
  const [f, setF] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ variant: 'warning' | 'danger'; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Success | null>(null);
  const startedAt = useRef<number>(Date.now());
  const inFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api.get<Meta>('/public/service-requests/meta')
      .then((m) => {
        if (!alive) return;
        setMeta(m);
        setMetaState(m.enabled === false ? 'disabled' : 'ready');
        setF((p) => ({ ...p, problem_category: m.problem_categories?.includes(p.problem_category) ? p.problem_category : m.problem_categories?.[0] ?? p.problem_category }));
      })
      .catch((err) => {
        if (!alive) return;
        setMetaState(err instanceof ApiError && err.status === 503 ? 'disabled' : 'error');
      });
    return () => { alive = false; };
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setServerErrors((p) => (p[k as string] ? { ...p, [k]: '' } : p));
  };
  const blur = (k: string) => setTouched((p) => ({ ...p, [k]: true }));

  const clientErrors = meta ? validate(f, meta) : {};
  const errFor = (k: string) => {
    if (serverErrors[k]) return serverErrors[k];
    return touched[k] || submitAttempted ? clientErrors[k] : undefined;
  };

  const submit = useCallback(async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!meta || inFlight.current) return;
    setSubmitAttempted(true);
    setNotice(null);
    const errs = validate(f, meta);
    const keys = Object.keys(errs);
    if (keys.length) {
      setSummary(Object.values(errs));
      setServerErrors({});
      setTimeout(() => {
        const first = FIELD_ORDER.find((k) => errs[k]) ?? keys[0];
        const el = document.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] textarea, [data-field="${first}"] button`);
        summaryRef.current?.scrollIntoView({ block: 'start' });
        el?.focus({ preventScroll: true });
      }, 0);
      return;
    }
    setSummary([]);
    inFlight.current = true;
    setSending(true);
    const body: Record<string, unknown> = {
      organisation_name: f.organisation_name.trim(),
      city: f.city.trim(),
      state: f.state,
      contact_name: f.contact_name.trim(),
      contact_phone: f.contact_phone.trim(),
      problem_category: f.problem_category,
      complaint: f.complaint.trim(),
      urgency: f.urgency,
      consent: true,
      website: '',
      form_started_at: startedAt.current,
    };
    const opt = (k: string, v: string) => { if (v.trim()) body[k] = v.trim(); };
    opt('department', f.department); opt('location', f.location);
    opt('contact_designation', f.contact_designation); opt('contact_email', f.contact_email);
    opt('equipment_serial', f.equipment_serial); opt('preferred_visit_date', f.preferred_visit_date);
    opt('site_access_notes', f.site_access_notes);
    if (f.product_id && f.product_id !== OTHER) body.product_id = f.product_id;
    else if (f.product_id === OTHER) opt('product_text', f.product_text);
    try {
      const res = await api.post<Success>('/public/service-requests', body);
      setDone(res);
      window.scrollTo({ top: 0 });
    } catch (err: any) {
      const status = err?.status;
      if (status === 400) {
        const msgs = apiMessages(err);
        const list = msgs.length ? msgs : ['Some details need correcting. Please review the form.'];
        const mapped: Record<string, string> = {};
        list.forEach((m) => { const k = mapMessage(m); if (k && !mapped[k]) mapped[k] = m; });
        setServerErrors(mapped);
        setSummary(list);
        setTimeout(() => summaryRef.current?.scrollIntoView({ block: 'start' }), 0);
      } else if (status === 429) {
        const secs = Number(err?.data?.retry_after_seconds);
        const wait = secs > 0 ? (secs >= 90 ? `about ${Math.ceil(secs / 60)} minutes` : `${secs} seconds`) : 'a few minutes';
        setNotice({ variant: 'warning', text: `We have received several requests from this connection. Please wait ${wait} and press Submit again. Your details are still filled in.` });
      } else if (status === 503) {
        setNotice({ variant: 'warning', text: 'The online form is temporarily unavailable. Please call the Arihant service desk.' });
      } else {
        setNotice({ variant: 'danger', text: 'We could not send your request. Please check your connection and try again. Your details have been kept.' });
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [f, meta]);

  const reset = () => {
    setF({ ...EMPTY, problem_category: meta?.problem_categories?.[0] ?? 'Breakdown' });
    setTouched({}); setSubmitAttempted(false); setServerErrors({}); setSummary([]); setNotice(null);
    startedAt.current = Date.now();
    setDone(null);
    window.scrollTo({ top: 0 });
  };

  if (metaState === 'loading') {
    return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  }
  if (metaState === 'disabled' || metaState === 'error' || !meta) {
    return (
      <Card padding="lg" className="text-center">
        <h1 className="font-serif text-xl font-bold text-[#14213D]">
          {metaState === 'error' ? 'We could not load the form' : 'Online form temporarily unavailable'}
        </h1>
        <p className="mt-2 text-sm text-[#4A5568]">
          {metaState === 'error'
            ? 'Please check your connection and try again, or call the Arihant service desk.'
            : 'Please call the Arihant service desk to log your request. We apologise for the inconvenience.'}
        </p>
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
          {metaState === 'error' && <Button size="lg" onClick={() => window.location.reload()}>Try again</Button>}
          <Link href="/service-request/track" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#C9C4B8] bg-white px-4 text-sm font-semibold text-[#0F5E63]">
            Track an existing request
          </Link>
        </div>
      </Card>
    );
  }

  if (done) return <SuccessView res={done} onAnother={reset} />;

  const urgencyHours = (u: string) => meta.response_targets.find((t) => t.urgency === u)?.response_hours;
  const selectedUrgencyHours = f.urgency ? urgencyHours(f.urgency) : undefined;
  const L = meta.limits;
  const today = ymd(new Date());
  const maxDate = ymd(new Date(Date.now() + 90 * 86400000));

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-bold text-[#14213D] sm:text-3xl">Raise a service request</h1>
        <p className="mt-1 text-sm text-[#4A5568]">
          Report a fault or ask for service on Arihant-supplied equipment. No login is needed.
          Already raised one?{' '}
          <Link href="/service-request/track" className="font-semibold text-[#0F5E63] underline">Track your request</Link>.
        </p>
      </div>

      {(summary.length > 0 || notice) && (
        <div ref={summaryRef} className="space-y-3" role="alert">
          {notice && <InfoCallout variant={notice.variant}>{notice.text}</InfoCallout>}
          {summary.length > 0 && (
            <InfoCallout variant="danger" title="Please correct the following">
              <ul className="list-disc space-y-0.5 pl-4">
                {summary.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </InfoCallout>
          )}
        </div>
      )}

      <Card padding="md" className="space-y-4">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">1. Your organisation</h2>
        <div data-field="organisation_name">
          <Input label="Organisation / unit name" required maxLength={L.organisation.max + 40} value={f.organisation_name}
            onChange={(e) => set('organisation_name', e.target.value)} onBlur={() => blur('organisation_name')}
            error={errFor('organisation_name')} autoComplete="organization" className="h-11 text-sm" />
        </div>
        <Input label="Department / wing (optional)" value={f.department} onChange={(e) => set('department', e.target.value)} className="h-11 text-sm" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="city">
            <Input label="City / town" required value={f.city} onChange={(e) => set('city', e.target.value)}
              onBlur={() => blur('city')} error={errFor('city')} autoComplete="address-level2" className="h-11 text-sm" />
          </div>
          <div data-field="state">
            <Select label="State / UT" required value={f.state} placeholder="Select state"
              options={meta.states.map((s) => ({ value: s, label: s }))}
              onChange={(e) => set('state', e.target.value)} onBlur={() => blur('state')} error={errFor('state')} className="h-11 text-sm" />
          </div>
        </div>
        <div data-field="location">
          <Input label="Site / checkpoint (optional)" value={f.location} onChange={(e) => set('location', e.target.value)}
            onBlur={() => blur('location')} error={errFor('location')} helperText="Where the equipment is installed, so the engineer can find it." className="h-11 text-sm" />
        </div>
      </Card>

      <Card padding="md" className="space-y-4">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">2. Who should we contact</h2>
        <div data-field="contact_name">
          <Input label="Contact person" required value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)}
            onBlur={() => blur('contact_name')} error={errFor('contact_name')} autoComplete="name" className="h-11 text-sm" />
        </div>
        <Input label="Designation / rank (optional)" value={f.contact_designation} onChange={(e) => set('contact_designation', e.target.value)} className="h-11 text-sm" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="contact_phone">
            <Input label="Phone" required type="tel" inputMode="tel" value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)}
              onBlur={() => blur('contact_phone')} error={errFor('contact_phone')} autoComplete="tel" placeholder="10-digit mobile" className="h-11 text-sm" />
          </div>
          <div data-field="contact_email">
            <Input label="Email (optional)" type="email" inputMode="email" value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)}
              onBlur={() => blur('contact_email')} error={errFor('contact_email')} autoComplete="email" className="h-11 text-sm" />
          </div>
        </div>
      </Card>

      <Card padding="md" className="space-y-4">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">3. The equipment and the problem</h2>
        <Select label="Equipment (optional)" value={f.product_id} placeholder="Select equipment"
          options={[...meta.products.map((p) => ({ value: p.id, label: p.name })), { value: OTHER, label: 'Not listed / other' }]}
          onChange={(e) => set('product_id', e.target.value)} className="h-11 text-sm" />
        {f.product_id === OTHER && (
          <div data-field="product_text">
            <Input label="Equipment name or description" required value={f.product_text} onChange={(e) => set('product_text', e.target.value)}
              onBlur={() => blur('product_text')} error={errFor('product_text')} className="h-11 text-sm" />
          </div>
        )}
        <div data-field="equipment_serial">
          <Input label="Serial number (optional)" value={f.equipment_serial} onChange={(e) => set('equipment_serial', e.target.value)}
            onBlur={() => blur('equipment_serial')} error={errFor('equipment_serial')} helperText="Printed on the equipment label, if you can see it." className="h-11 text-sm" />
        </div>
        <Select label="Type of problem" required value={f.problem_category}
          options={meta.problem_categories.map((c) => ({ value: c, label: c }))}
          onChange={(e) => set('problem_category', e.target.value)} className="h-11 text-sm" />
        <div data-field="complaint">
          <Textarea label="Describe the problem *" rows={5} value={f.complaint} onChange={(e) => set('complaint', e.target.value)}
            onBlur={() => blur('complaint')} error={errFor('complaint')} maxLength={L.complaint.max}
            helperText={`What is happening, since when, and anything already tried. ${f.complaint.trim().length}/${L.complaint.max}`} className="text-sm" />
        </div>
        <div data-field="urgency">
          <fieldset>
            <legend className="mb-1.5 block text-xs font-semibold text-[#14213D]">How urgent is it?<span className="ml-0.5 text-red-500">*</span></legend>
            <div className="grid gap-2">
              {meta.urgencies.map((u) => {
                const hrs = urgencyHours(u.value);
                const on = f.urgency === u.value;
                return (
                  <label key={u.value} className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${on ? 'border-[#0F5E63] bg-[#E3EFEE]' : 'border-[#C9C4B8] bg-white'}`}>
                    <input type="radio" name="urgency" value={u.value} checked={on} className="h-4 w-4 accent-[#0F5E63]"
                      onChange={() => set('urgency', u.value)} onBlur={() => blur('urgency')} />
                    <span className="flex-1 text-[#14213D]">{u.label}</span>
                    {hrs ? <Badge variant="outline" size="sm"><span className="font-mono">reply in ~{hrs}h</span></Badge> : null}
                  </label>
                );
              })}
            </div>
            {errFor('urgency') && <p className="mt-1 text-xs font-medium text-[#881337]">{errFor('urgency')}</p>}
            {selectedUrgencyHours ? <p className="mt-1 text-xs text-[#4A5568]">Our team aims to respond within {selectedUrgencyHours} hours for this level.</p> : null}
          </fieldset>
        </div>
      </Card>

      <Card padding="md" className="space-y-4">
        <h2 className="font-serif text-lg font-bold text-[#14213D]">4. Visit details (optional)</h2>
        <div data-field="preferred_visit_date">
          <Input label="Preferred visit date" type="date" min={today} max={maxDate} value={f.preferred_visit_date}
            onChange={(e) => set('preferred_visit_date', e.target.value)} onBlur={() => blur('preferred_visit_date')}
            error={errFor('preferred_visit_date')} helperText="Up to 90 days ahead. We will confirm the actual date." className="h-11 text-sm" />
        </div>
        <div data-field="site_access_notes">
          <Textarea label="Site access notes" rows={3} value={f.site_access_notes} onChange={(e) => set('site_access_notes', e.target.value)}
            onBlur={() => blur('site_access_notes')} error={errFor('site_access_notes')} maxLength={500}
            helperText="Entry permissions, gate timings, ID needed, escort contact." className="text-sm" />
        </div>
      </Card>

      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>

      <Card padding="md" className="space-y-4">
        <div data-field="consent">
          <Checkbox
            checked={f.consent}
            onChange={(e) => set('consent', e.target.checked)}
            label="I confirm these details are correct and agree that Arihant may contact me about this request."
          />
          {errFor('consent') && <p className="mt-1 text-xs font-medium text-[#881337]">{errFor('consent')}</p>}
        </div>
        <Button type="submit" size="lg" fullWidth isLoading={sending} disabled={sending} className="min-h-[48px]">
          {sending ? 'Sending...' : 'Submit service request'}
        </Button>
      </Card>
    </form>
  );
}

function SuccessView({ res, onAnother }: { res: Success; onAnother: () => void }) {
  const [copied, setCopied] = useState<string>('');
  const link = res.track_path && typeof window !== 'undefined' ? `${window.location.origin}${res.track_path}` : '';
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) { setCopied(key); setTimeout(() => setCopied(''), 2000); }
  };

  if (res.duplicate || !res.tracking_token) {
    return (
      <Card padding="lg" className="space-y-4">
        <h1 className="font-serif text-2xl font-bold text-[#14213D]">We already have this request</h1>
        <InfoCallout variant="info">
          {res.customer_message || 'This looks like a request we have already received.'} Please use the tracking link you received when you first submitted it.
        </InfoCallout>
        <div>
          <p className="text-xs font-semibold text-[#4A5568]">Reference</p>
          <p className="font-mono text-2xl font-bold text-[#14213D]">{res.reference}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/service-request/track" className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#0F5E63] px-4 text-sm font-semibold text-white">Track a request</Link>
          <Button variant="secondary" size="lg" onClick={onAnother}>Submit another request</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card padding="lg" className="space-y-5">
        <div>
          <Badge variant="success">Request received</Badge>
          <h1 className="mt-2 font-serif text-2xl font-bold text-[#14213D] sm:text-3xl">Thank you. Your request is logged.</h1>
        </div>
        <div className="rounded-lg border border-[#DCD8CE] bg-[#FBFAF7] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A5568]">Reference number</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="break-all font-mono text-3xl font-bold text-[#14213D]">{res.reference}</p>
            <Button size="md" variant="secondary" onClick={() => copy('ref', res.reference)}>{copied === 'ref' ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
        {res.response_target_hours ? (
          <p className="text-sm text-[#14213D]">
            Our team aims to respond within <strong className="font-mono">{res.response_target_hours} {res.response_in_business_hours ? 'working hours' : 'hours'}</strong>
            {res.response_in_business_hours ? <> (Mon–Sat, 9:00–18:00 IST)</> : null}
            {res.response_due_at ? <>, by {fmtDateTime(res.response_due_at)} IST</> : null}.
          </p>
        ) : null}
        {res.customer_message && <p className="text-sm text-[#4A5568]">{res.customer_message}</p>}
        <div className="rounded-lg border border-[#9A3412]/30 bg-[#FBEBDD] p-4">
          <p className="text-sm font-semibold text-[#7C2D12]">
            Save this link and code. It is the only way to see your request. We do not have a login for customers.
          </p>
          <p className="mt-3 text-xs font-semibold text-[#4A5568]">Your private tracking link</p>
          <p className="mt-1 break-all rounded border border-[#DCD8CE] bg-white p-2 font-mono text-xs text-[#14213D]">{link}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" size="lg" onClick={() => copy('link', link)}>{copied === 'link' ? 'Link copied' : 'Copy link'}</Button>
            <a href={res.track_path} className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#0F5E63] px-4 text-sm font-semibold text-white hover:bg-[#0B4A4E]">Open tracking page</a>
          </div>
          <p className="mt-3 text-xs text-[#4A5568]">Tracking code: <span className="break-all font-mono">{res.tracking_token}</span></p>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#ECE9E2] pt-4 print:hidden sm:flex-row">
          <Button variant="outline" size="lg" onClick={() => window.print()}>Print</Button>
          <Button variant="ghost" size="lg" onClick={onAnother}>Submit another request</Button>
        </div>
      </Card>
    </div>
  );
}
