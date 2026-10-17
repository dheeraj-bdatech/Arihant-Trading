'use client';

/**
 * "Linked records" panel: everything other modules hold for the record being viewed — a customer, lead,
 * tender, demo, service ticket or proposal — each row deep-linking into its own module.
 * Sections the viewer's role cannot read are not requested at all (see lib/module-access); the API
 * still scopes every list to what the caller may see. Rows only link to pages the role may open
 * (lib/route-access), otherwise they show as plain text.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  FileText,
  ListChecks,
  MonitorPlay,
  Plus,
  Receipt,
  ScrollText,
  Truck,
  Wrench,
} from 'lucide-react';
import { formatINR } from '@arihant/shared';
import { Badge, Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canRead, type ReadableModule } from '@/lib/module-access';
import { canOpen } from '@/lib/route-access';
import { NewTaskButton } from '@/app/(app)/tasks/_lib/NewTaskModal';
import type { TaskFormPrefill } from '@/app/(app)/tasks/_lib/TaskForm';

/** The record the panel is attached to. organisationId is its customer, used for customer-wide sections. */
export type RelatedTo =
  | { kind: 'customer'; id: string }
  | { kind: 'lead' | 'tender' | 'demo' | 'proposal'; id: string; organisationId?: string | null }
  | { kind: 'ticket'; id: string; organisationId?: string | null; serial?: string | null };

export type RelatedSection =
  | 'leads'
  | 'visits'
  | 'demos'
  | 'proposals'
  | 'tenders'
  | 'deliveries'
  | 'service'
  | 'equipment'
  | 'tasks'
  | 'expenses';

type Row = { id: string; title: string; meta?: string; status?: string | null; href?: string | null };
type Loaded = { rows: Row[]; total: number; viewAll?: string | null };
type SectionState = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Loaded);

const LIMIT = 5;
const day = (v: unknown) => {
  if (!v) return '';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const join = (...parts: unknown[]) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');
const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.tickets) ? res.tickets : []);
const totalOf = (res: any, rows: any[]): number => (typeof res?.total === 'number' ? res.total : rows.length);
const customerOf = (to: RelatedTo) => (to.kind === 'customer' ? to.id : to.organisationId || null);

interface SectionDef {
  label: string;
  icon: React.ReactNode;
  module: ReadableModule;
  /** null when the record has nothing to look up for this section (e.g. no customer yet). */
  load: (to: RelatedTo) => Promise<Loaded> | null;
}

const SECTIONS: Record<RelatedSection, SectionDef> = {
  leads: {
    label: 'Leads',
    icon: <Briefcase className="h-3.5 w-3.5" />,
    module: 'leads',
    load: (to) => {
      const org = customerOf(to);
      if (!org) return null;
      return api.get('/leads', { organisation_id: org, limit: LIMIT }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: `/leads?customer=${org}`,
          rows: r.map((l) => ({
            id: l.id,
            title: l.product_name || 'Lead',
            meta: join(l.value_lakh ? `₹${l.value_lakh} L` : null, l.assignee_name, day(l.created_at)),
            status: l.lead_status,
            href: `/leads?open=${l.id}`,
          })),
        };
      });
    },
  },
  visits: {
    label: 'Field visits',
    icon: <CalendarDays className="h-3.5 w-3.5" />,
    module: 'customerVisits',
    load: (to) => {
      const org = customerOf(to);
      if (!org) return null;
      return api.get(`/visits/organisations/${org}/history`).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: r.length,
          viewAll: `/visits?customer=${org}`,
          rows: r.slice(0, LIMIT).map((v) => ({
            id: v.id,
            title: v.purpose || 'Field visit',
            meta: join(day(v.planned_date), v.employee_name),
            status: v.status,
            href: `/visits?customer=${org}`,
          })),
        };
      });
    },
  },
  demos: {
    label: 'Demos',
    icon: <MonitorPlay className="h-3.5 w-3.5" />,
    module: 'demos',
    load: (to) => {
      const filter =
        to.kind === 'lead' ? { lead_id: to.id }
        : to.kind === 'tender' ? { tender_id: to.id }
        : to.kind === 'ticket' ? { service_ticket_id: to.id } // the demo this ticket was raised from
        : to.kind === 'demo' ? null
        : customerOf(to) ? { organisation_id: customerOf(to)! } : null;
      if (!filter) return null;
      return api.get('/demos', { ...filter, limit: LIMIT }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: '/demos',
          rows: r.map((d) => ({
            id: d.id,
            title: join(d.demo_no, d.product_name),
            meta: join(day(d.confirmed_date || d.requested_date), d.assignee_name),
            status: d.status,
            href: `/demos?open=${d.id}`,
          })),
        };
      });
    },
  },
  proposals: {
    label: 'Proposals',
    icon: <ScrollText className="h-3.5 w-3.5" />,
    module: 'proposals',
    load: (to) => {
      const filter = to.kind === 'lead' ? { lead_id: to.id } : customerOf(to) ? { customer_id: customerOf(to)! } : null;
      if (!filter || to.kind === 'proposal') return null;
      return api.get('/proposals', { ...filter, limit: LIMIT }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: '/proposals',
          rows: r.map((p) => ({
            id: p.id,
            title: join(p.proposal_no || p.proposal_number, p.product_name),
            meta: join(p.responsible_name, day(p.request_date || p.created_at)),
            status: p.status,
            href: `/proposals?open=${p.id}`,
          })),
        };
      });
    },
  },
  tenders: {
    label: 'Tenders',
    icon: <FileText className="h-3.5 w-3.5" />,
    module: 'tenders',
    load: (to) => {
      const org = customerOf(to);
      if (!org || to.kind === 'tender') return null;
      return api.get('/tenders', { organisation_id: org, limit: LIMIT }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: '/tenders',
          rows: r.map((t) => ({
            id: t.id,
            title: join(t.tender_number || t.tender_no, t.product_name),
            meta: join(t.estimated_value ? formatINR(Number(t.estimated_value)) : null, t.bid_closing_date ? `closes ${day(t.bid_closing_date)}` : null),
            status: t.status,
            href: `/tenders?highlight=${t.id}`,
          })),
        };
      });
    },
  },
  deliveries: {
    label: 'Deliveries & sales orders',
    icon: <Truck className="h-3.5 w-3.5" />,
    module: 'deliveries',
    load: (to) => {
      const filter = to.kind === 'tender' ? { tender_id: to.id } : customerOf(to) ? { organisation_id: customerOf(to)! } : null;
      if (!filter) return null;
      return api.get('/deliveries', { ...filter, limit: LIMIT }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: '/deliveries',
          rows: r.map((d) => ({
            id: d.id,
            title: join(d.delivery_no, d.model || d.product_name),
            meta: join(day(d.delivery_date), d.equipment_serial ? `S/N ${d.equipment_serial}` : null),
            status: d.status,
            href: `/deliveries?search=${encodeURIComponent(d.delivery_no)}`,
          })),
        };
      });
    },
  },
  service: {
    label: 'Service tickets',
    icon: <Wrench className="h-3.5 w-3.5" />,
    module: 'service',
    load: (to) => {
      const org = customerOf(to);
      if (!org) return null;
      return api.get(`/service/customer/${org}/history`).then((res: any) => {
        const r = rowsOf(res).filter((t) => !(to.kind === 'ticket' && t.id === to.id));
        return { total: r.length, viewAll: '/service', rows: r.slice(0, LIMIT).map(ticketRow) };
      });
    },
  },
  equipment: {
    label: 'Same machine',
    icon: <Wrench className="h-3.5 w-3.5" />,
    module: 'service',
    load: (to) => {
      if (to.kind !== 'ticket' || !to.serial) return null;
      return api.get(`/service/equipment/${encodeURIComponent(to.serial)}/history`).then((res: any) => {
        const r = rowsOf(res).filter((t) => t.id !== to.id);
        return { total: r.length, viewAll: null, rows: r.slice(0, LIMIT).map(ticketRow) };
      });
    },
  },
  tasks: {
    label: 'Tasks',
    icon: <ListChecks className="h-3.5 w-3.5" />,
    module: 'tasks',
    load: (to) => {
      const filter: Record<string, string> | null =
        to.kind === 'tender' ? { tender_id: to.id }
        : to.kind === 'demo' ? { demo_id: to.id }
        : to.kind === 'ticket' ? { service_ticket_id: to.id }
        : to.kind === 'proposal' ? { related_entity_type: 'proposal', related_entity_id: to.id }
        : customerOf(to) ? { customer_id: customerOf(to)! } : null;
      if (!filter) return null;
      return api.get('/tasks', { ...filter, limit: LIMIT, sort_by: 'deadline' }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: null,
          rows: r.map((t) => ({
            id: t.id,
            title: t.title,
            meta: join(t.assignee_name, t.due_label || (t.deadline ? `due ${day(t.deadline)}` : null)),
            status: t.display_status_label || t.display_status || t.status,
            href: `/tasks/${t.id}`,
          })),
        };
      });
    },
  },
  expenses: {
    label: 'Expense lines',
    icon: <Receipt className="h-3.5 w-3.5" />,
    module: 'expenses',
    load: (to) => {
      const org = customerOf(to);
      if (!org) return null;
      return api.get('/expense-reports', { customer_ids: org, page_size: LIMIT, sort_by: 'expense_date', sort_dir: 'desc' }).then((res: any) => {
        const r = rowsOf(res);
        return {
          total: totalOf(res, r),
          viewAll: `/expenses/reports?customer_ids=${org}`,
          rows: r.map((x) => ({
            id: x.item_id,
            title: join(x.claim_number, x.category_name),
            meta: join(formatINR(Number(x.amount || 0)), x.employee_name, day(x.expense_date)),
            status: x.status_label || x.status,
            href: `/expenses/${x.claim_id}`,
          })),
        };
      });
    },
  },
};

function ticketRow(t: any): Row {
  return {
    id: t.id,
    title: join(t.ticket_no || t.ticket_number, t.product_name),
    meta: join(day(t.received_date || t.created_at), t.assignee_name, t.equipment_serial ? `S/N ${t.equipment_serial}` : null),
    status: t.status,
    href: `/service?open=${t.id}`,
  };
}

/** New-task prefill: the server derives the customer from a tender / demo / ticket link. */
function taskPrefill(to: RelatedTo, title?: string): TaskFormPrefill {
  if (to.kind === 'tender') return { tender_id: to.id, title };
  if (to.kind === 'demo') return { demo_id: to.id, title };
  if (to.kind === 'ticket') return { service_ticket_id: to.id, title };
  return { customer_id: customerOf(to) || null, title };
}

export interface RelatedRecordsProps {
  to: RelatedTo;
  sections: RelatedSection[];
  title?: string;
  description?: string;
  /** Show an "Add task" action prefilled with this record's link (optionally with a title). */
  addTask?: boolean | { title?: string };
  /** Change it to reload the sections after this page creates a linked record (e.g. a sales order). */
  refreshKey?: string | number;
  className?: string;
}

export function RelatedRecords({ to, sections, title = 'Linked records', description, addTask = true, refreshKey, className = '' }: RelatedRecordsProps) {
  const { user } = useAuth();
  const role = user?.role;
  const key = JSON.stringify(to);
  const visible = sections.filter((s) => canRead(role, SECTIONS[s].module));
  const [state, setState] = useState<Partial<Record<RelatedSection, SectionState>>>({});

  useEffect(() => {
    let alive = true;
    const next: Partial<Record<RelatedSection, SectionState>> = {};
    const jobs: [RelatedSection, Promise<Loaded>][] = [];
    for (const s of visible) {
      const p = SECTIONS[s].load(to);
      if (!p) continue;
      next[s] = { status: 'loading' };
      jobs.push([s, p]);
    }
    setState(next);
    for (const [s, p] of jobs) {
      p.then((loaded) => alive && setState((prev) => ({ ...prev, [s]: { status: 'ready', ...loaded } })))
        .catch(() => alive && setState((prev) => ({ ...prev, [s]: { status: 'error' } })));
    }
    return () => {
      alive = false;
    };
    // `to` is compared by value through `key`; `visible` follows role + sections.
  }, [key, role, sections.join(','), refreshKey]);

  const shown = visible.filter((s) => state[s]);
  if (!user) return null;

  return (
    <section className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-serif font-bold text-sm text-[#14213D]">{title}</h4>
          {description && <p className="text-[11px] text-[#4A5568]">{description}</p>}
        </div>
        {addTask && canOpen(role, '/tasks/new') && (
          <NewTaskButton size="sm" variant="secondary" prefill={taskPrefill(to, typeof addTask === 'object' ? addTask.title : undefined)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
            Add task
          </NewTaskButton>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-[11px] text-[#4A5568] italic">Nothing linked yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shown.map((s) => (
            <SectionCard key={s} def={SECTIONS[s]} state={state[s]!} canFollow={(href) => canOpen(role, href)} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionCard({ def, state, canFollow }: { def: SectionDef; state: SectionState; canFollow: (href: string) => boolean }) {
  return (
    <div className="rounded-[14px] border border-[#DCD8CE] bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#FBFAF7] border-b border-[#ECE9E2]">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#14213D]">
          <span className="text-[#0F5E63]">{def.icon}</span>
          {def.label}
          {state.status === 'ready' && <span className="font-mono text-[#4A5568]">({state.total})</span>}
        </span>
        {state.status === 'ready' && state.viewAll && state.total > 0 && canFollow(state.viewAll) && (
          <Link href={state.viewAll} className="text-[11px] font-semibold text-[#0F5E63] hover:underline flex items-center gap-0.5">
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="divide-y divide-[#ECE9E2]">
        {state.status === 'loading' && (
          <div className="px-3 py-3 flex items-center gap-2 text-[11px] text-[#4A5568]">
            <Spinner size="sm" /> Loading…
          </div>
        )}
        {state.status === 'error' && <div className="px-3 py-3 text-[11px] text-[#9A3412]">Could not load.</div>}
        {state.status === 'ready' && state.rows.length === 0 && <div className="px-3 py-3 text-[11px] text-[#4A5568]">None yet.</div>}
        {state.status === 'ready' &&
          state.rows.map((r) => {
            const body = (
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#14213D] truncate">{r.title}</div>
                  {r.meta && <div className="text-[11px] text-[#4A5568] truncate">{r.meta}</div>}
                </div>
                {r.status && (
                  <Badge size="sm" variant="outline" className="shrink-0 capitalize">
                    {String(r.status).replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                )}
              </div>
            );
            return r.href && canFollow(r.href) ? (
              <Link key={r.id} href={r.href} className="block hover:bg-[#F6F5F1] transition-colors">
                {body}
              </Link>
            ) : (
              <div key={r.id}>{body}</div>
            );
          })}
      </div>
    </div>
  );
}

