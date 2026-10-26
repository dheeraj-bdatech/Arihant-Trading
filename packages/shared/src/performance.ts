/**
 * Module 9 — Salesperson & Regional Performance (Scope Blueprint §44).
 * Response of GET /dashboard/sales-performance. Every figure is counted from operational records (leads, follow-ups,
 * visits, interactions, demos, proposals, tenders); rates are null when their denominator is 0 — never a fake 0 / 100.
 */

export type PerformanceGroupBy = 'rep' | 'region';

export interface PerformanceLeadFigures {
  /** Contacts at customer organisations the rep works (holds a lead at, or created) / in the region. Not period-bound. */
  contacts: number;
  /** Fresh leads created in the period. */
  new: number;
  /** Leads currently open (not converted / won / lost / dropped). Snapshot, not period-bound. */
  active: number;
  /** Re-approached leads created in the period. */
  reapproached: number;
  /** Lead follow-ups completed in the period. */
  followups_done: number;
  /** Lead follow-ups still pending and due by the period end (includes overdue carried in). */
  followups_pending: number;
  /** Leads created in the period that are now converted / won. */
  converted: number;
  /** converted ÷ (new + reapproached) × 100; null when no leads were created in the period. */
  conversion_rate: number | null;
}

export interface PerformanceVisitFigures {
  /** Visits planned for a date in the period (any status). */
  planned: number;
  completed: number;
  cancelled: number;
  /** Customer interactions logged with an interaction date in the period. */
  interactions: number;
}

export interface PerformanceDemoFigures {
  /** Demos scheduled (confirmed, else requested date) in the period, excluding cancelled. */
  planned: number;
  completed: number;
  /** Completed demos whose recorded outcome is "success". */
  successful: number;
  /** Failed / partial demo outcomes by failure reason code. */
  failure_reasons: Record<string, number>;
}

export interface PerformanceProposalFigures {
  /** Proposals with a sent date in the period. */
  sent: number;
  /** Proposal follow-ups logged (contact date) in the period. */
  followups: number;
  /** Proposals converted with an outcome date in the period. */
  converted: number;
}

export interface PerformanceTenderFigures {
  /** PQ tenders identified (created) in the period. */
  pq: number;
  /** General / MHA tenders identified (created) in the period. */
  general_mha: number;
  /** Tenders submitted in the period (status at or past submission). */
  submitted: number;
  /** Won / partially won, result in the period. */
  won: number;
  /** Lost / disqualified / PQ not qualified, result in the period. */
  lost: number;
  /** won ÷ (won + lost) × 100; null when nothing was decided in the period. */
  win_rate: number | null;
}

export interface PerformanceFigures {
  lead: PerformanceLeadFigures;
  visit: PerformanceVisitFigures;
  demo: PerformanceDemoFigures;
  proposal: PerformanceProposalFigures;
  tender: PerformanceTenderFigures;
}

export interface SalesPerformanceRow extends PerformanceFigures {
  /** User id (group_by=rep), region id (group_by=region) or 'none' for records with no region. */
  key: string;
  label: string;
  /** Role of the rep (group_by=rep only). */
  role: string | null;
  region_name: string | null;
  zone_name: string | null;
}

export interface SalesPerformanceDto {
  group_by: PerformanceGroupBy;
  period: { from: string; to: string };
  filters: {
    zone_id: string | null;
    region_id: string | null;
    /** management / admin may choose a zone; a regional manager is locked to theirs; sales sees only themself. */
    can_pick_zone: boolean;
    can_pick_region: boolean;
    can_group_by_region: boolean;
    zones: { id: string; name: string; code: string | null }[];
    regions: { id: string; name: string; zone_id: string | null }[];
  };
  rows: SalesPerformanceRow[];
  /** Distinct records across the rows shown (a tender shared by two reps is counted once). */
  totals: PerformanceFigures;
}
