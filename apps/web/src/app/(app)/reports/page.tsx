'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Download,
  Filter,
  Search,
  Target,
  FileText,
  Calendar,
  Receipt,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Tabs,
  PageContainer,
  PageHeader,
  StatGrid,
  StatCard,
  PageLoader,
  ToolbarBox,
  ToolbarSlot,
  InfoCallout,
  Select,
} from '@/components/ui';
import { formatLakh, formatINR } from '@arihant/shared';

/** Never let a missing field render as "undefined"/"null". */
const txt = (v: unknown, fallback = '—'): string =>
  v === undefined || v === null || v === '' || String(v) === 'undefined' || String(v) === 'null' ? fallback : String(v);
const pretty = (v: unknown, fallback = '—'): string => txt(v, fallback).replace(/_/g, ' ');
const fmtDate = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? txt(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const rows = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.items) ? res.items : []);

const DATASETS = [
  { key: 'tenders', label: 'GeM Bids', url: '/tenders' },
  { key: 'leads', label: 'Sales Pipeline', url: '/leads' },
  { key: 'visits', label: 'Field Itineraries', url: '/visits' },
  { key: 'expenses', label: 'Expense Claims', url: '/expenses' },
  { key: 'service', label: 'Service Desk', url: '/service/tickets' },
] as const;

export default function ConsolidatedReportsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('tenders');
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);

  // Data sets
  const [tenders, setTenders] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);

  // Search & filter (shared by every tab)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchAllReportData = useCallback(async () => {
    setIsLoading(true);
    const bad: string[] = [];
    const load = (ds: (typeof DATASETS)[number]) =>
      api.get(ds.url, { limit: 100 }).catch((err: any) => {
        console.error(`Reports: ${ds.url} failed`, err);
        bad.push(ds.label);
        return null;
      });
    const [tendersRes, leadsRes, visitsRes, expensesRes, serviceRes] = await Promise.all(DATASETS.map(load));
    setTenders(rows(tendersRes));
    setLeads(rows(leadsRes));
    setVisits(rows(visitsRes));
    setExpenses(rows(expensesRes));
    setTickets(rows(serviceRes));
    setFailed(bad);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAllReportData();
  }, [fetchAllReportData]);

  // Search + status filtering, applied to the active tab's rows
  const matches = (r: any) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return Object.values(r).some((v) => typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase().includes(q) : false);
  };
  const byStatus = (r: any) => statusFilter === 'all' || String(r.status || '').toLowerCase() === statusFilter;
  const vTenders = tenders.filter((r) => matches(r) && byStatus(r));
  const vLeads = leads.filter((r) => matches(r) && byStatus(r));
  const vVisits = visits.filter((r) => matches(r) && byStatus(r));
  const vExpenses = expenses.filter((r) => matches(r) && byStatus(r));
  const vTickets = tickets.filter((r) => matches(r) && byStatus(r));

  const activeRows: any[] = { tenders, leads, visits, expenses, service: tickets }[activeTab] || [];
  const statusOptions = Array.from(new Set(activeRows.map((r) => String(r.status || '').toLowerCase()).filter(Boolean))).sort();

  // Generic CSV Exporter
  const exportToCsv = (filename: string, rows: Record<string, any>[]) => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const val = row[header];
            if (val === null || val === undefined) return '""';
            const escaped = String(val).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportTenders = () => {
    const exportData = tenders.map((t) => ({
      'Tender No': t.tender_no,
      'Organisation': t.organisation_name || t.department || 'N/A',
      'Category': t.category?.toUpperCase() || 'GENERAL',
      'Quantity': t.quantity || 0,
      'EMD Fee (INR)': t.emd_fee || 0,
      'Bid Closing': t.bid_closing_date || 'N/A',
      'Status': t.status?.toUpperCase() || 'IDENTIFIED',
      'Zone': t.zone_name || t.zone_code || 'N/A',
      'City': t.city || 'N/A',
    }));
    exportToCsv('Arihant_GeM_Tenders_Report', exportData);
  };

  const handleExportLeads = () => {
    const exportData = leads.map((l) => ({
      'Organisation': l.organisation_name || 'N/A',
      'Product': l.product_name || 'N/A',
      'Category': l.category?.toUpperCase() || 'FOLLOW_UP',
      'Probability': l.probability?.toUpperCase() || 'MEDIUM',
      'Deal Value (Lakh)': l.value_lakh || 0,
      'Status': l.status?.toUpperCase() || 'OPEN',
      'Assigned To': l.assigned_to_name || 'N/A',
      'Next Follow-Up': l.next_followup_date || 'N/A',
    }));
    exportToCsv('Arihant_Sales_Funnel_Report', exportData);
  };

  const handleExportVisits = () => {
    const exportData = visits.map((v) => ({
      'Organisation': v.organisation_name || 'N/A',
      'Location': v.location || v.city || 'N/A',
      'Planned Date': v.planned_date,
      'Status': v.status?.toUpperCase() || 'PLANNED',
      'Representative': v.assignee_name || 'N/A',
      'Purpose': v.purpose || 'N/A',
      'Manager Intervention': v.manager_name ? `Directive by ${v.manager_name}` : 'None',
    }));
    exportToCsv('Arihant_Field_Visits_Report', exportData);
  };

  const handleExportExpenses = () => {
    const exportData = expenses.map((e) => ({
      'Employee': e.employee_name || 'N/A',
      'Date': e.expense_date,
      'Category': e.category?.toUpperCase() || 'TRAVEL',
      'Amount (INR)': e.amount,
      'Status': e.status?.toUpperCase(),
      'Purpose': e.purpose || 'N/A',
      'Manager': e.manager_name || 'N/A',
      'Manager Remarks': e.manager_remarks || 'N/A',
    }));
    exportToCsv('Arihant_Expenses_Audit_Report', exportData);
  };

  const handleExportService = () => {
    const exportData = tickets.map((s) => ({
      'Ticket No': s.ticket_no,
      'Customer': s.organisation_name || 'N/A',
      'Equipment Serial': s.equipment_serial || 'N/A',
      'Priority': s.priority?.toUpperCase(),
      'Warranty Status': s.warranty_status?.toUpperCase() || 'IN_WARRANTY',
      'Status': s.status?.toUpperCase(),
      'Engineer': s.assigned_to_name || 'N/A',
      'Complaint': s.complaint || 'N/A',
    }));
    exportToCsv('Arihant_Service_Desk_Report', exportData);
  };

  return (
    <PageContainer>
      {/* Top Banner */}
      <PageHeader
        title="Consolidated Operational Reports"
        icon={<FileText className="w-5 h-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={fetchAllReportData} isLoading={isLoading} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Reload
            </Button>
            {activeTab === 'tenders' && (
              <Button variant="outline" onClick={handleExportTenders}>
                <Download className="h-4 w-4 mr-2" />
                Export Tenders CSV
              </Button>
            )}
            {activeTab === 'leads' && (
              <Button variant="outline" onClick={handleExportLeads}>
                <Download className="h-4 w-4 mr-2" />
                Export Funnel CSV
              </Button>
            )}
            {activeTab === 'visits' && (
              <Button variant="outline" onClick={handleExportVisits}>
                <Download className="h-4 w-4 mr-2" />
                Export Visits CSV
              </Button>
            )}
            {activeTab === 'expenses' && (
              <Button variant="outline" onClick={handleExportExpenses}>
                <Download className="h-4 w-4 mr-2" />
                Export Expenses CSV
              </Button>
            )}
            {activeTab === 'service' && (
              <Button variant="outline" onClick={handleExportService}>
                <Download className="h-4 w-4 mr-2" />
                Export Service CSV
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Highlights Bar */}
      <StatGrid cols={5}>
        <StatCard
          title="Live GeM Bids"
          value={tenders.length}
          icon={<FileText className="h-4 w-4" />}
          variant="primary"
        />
        <StatCard
          title="Active Leads"
          value={leads.length}
          icon={<Target className="h-4 w-4" />}
          variant="primary"
        />
        <StatCard
          title="Field Visits"
          value={visits.length}
          icon={<Calendar className="h-4 w-4" />}
          variant="primary"
        />
        <StatCard
          title="Expense Claims"
          value={expenses.length}
          icon={<Receipt className="h-4 w-4" />}
          variant="amber"
        />
        <StatCard
          title="Service Tickets"
          value={tickets.length}
          icon={<Wrench className="h-4 w-4" />}
          variant="emerald"
        />
      </StatGrid>

      {/* Tabs + search + filter: one box */}
      <ToolbarBox>
        <Tabs
          tabs={[
            { id: 'tenders', label: 'GeM Bids', count: tenders.length },
            { id: 'leads', label: 'Sales Pipeline', count: leads.length },
            { id: 'visits', label: 'Field Itineraries', count: visits.length },
            { id: 'expenses', label: 'Expense Claims', count: expenses.length },
            { id: 'service', label: 'Service Desk', count: tickets.length },
          ]}
          activeTab={activeTab}
          onChange={(id) => {
            setActiveTab(id);
            setStatusFilter('all');
          }}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#4A5568]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search this report — number, organisation, person, status…"
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder-[#4A5568]/70"
            />
          </div>
        </div>
        <ToolbarSlot>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#4A5568]">Status</span>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-44 text-xs font-semibold"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((st) => (
              <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
            ))}
          </Select>
          </div>
        </ToolbarSlot>
      </ToolbarBox>

      {failed.length > 0 && (
        <InfoCallout variant="danger" title="Some report data could not be loaded">
          {failed.join(', ')} did not respond. Check that the API is reachable (NEXT_PUBLIC_API_URL / API_INTERNAL_URL) and that your role can view these modules, then reload.
        </InfoCallout>
      )}

      {/* Content Body */}
      {isLoading ? (
        <PageLoader label="Loading consolidated records" />
      ) : (
        <div className="bg-white border border-[#DCD8CE] rounded-2xl shadow-xs overflow-hidden">
          {activeTab === 'tenders' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3.5">Bid Number</th>
                    <th className="p-3.5">Department / Org</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5 text-right">Qty</th>
                    <th className="p-3.5 text-right">EMD Fee</th>
                    <th className="p-3.5">Bid Closing</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vTenders.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-semibold text-[#0F5E63]">{t.tender_no}</td>
                      <td className="p-3.5 text-[#14213D]">{txt(t.organisation_name || t.organisation || t.department)}</td>
                      <td className="p-3.5">
                        <Badge variant={t.category === 'pq' ? 'urgent' : 'outline'}>
                          {t.category?.toUpperCase() || 'GENERAL'}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right font-medium">{t.quantity || '-'}</td>
                      <td className="p-3.5 text-right font-medium text-emerald-700">
                        {t.emd_fee ? formatINR(t.emd_fee) : 'Exempt'}
                      </td>
                      <td className="p-3.5 text-[#4A5568]">{fmtDate(t.bid_closing_date || t.submission_deadline)}</td>
                      <td className="p-3.5">
                        <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">
                          {pretty(t.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'leads' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3.5">Customer Organisation</th>
                    <th className="p-3.5">Product</th>
                    <th className="p-3.5">Classification</th>
                    <th className="p-3.5">Probability</th>
                    <th className="p-3.5 text-right">Value (Lakh)</th>
                    <th className="p-3.5">Assigned Rep</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vLeads.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-medium text-[#14213D]">{txt(l.organisation_name)}</td>
                      <td className="p-3.5 text-[#4A5568]">{txt(l.product_name)}</td>
                      <td className="p-3.5">
                        <Badge variant="outline">{txt(l.category).toUpperCase()}</Badge>
                      </td>
                      <td className="p-3.5 capitalize">{txt(l.probability)}</td>
                      <td className="p-3.5 text-right font-bold text-[#14213D]">
                        {l.value_lakh || l.estimated_value_lakh ? `₹ ${l.value_lakh || l.estimated_value_lakh} L` : '—'}
                      </td>
                      <td className="p-3.5 text-[#4A5568]">{l.assigned_to_name || 'Unassigned'}</td>
                      <td className="p-3.5">
                        <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">
                          {pretty(l.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'visits' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3.5">Client & Destination</th>
                    <th className="p-3.5">Planned Date</th>
                    <th className="p-3.5">Sales Engineer</th>
                    <th className="p-3.5">Purpose</th>
                    <th className="p-3.5">Manager Also-Meet Directive</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vVisits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5">
                        <p className="font-semibold text-[#14213D]">{txt(v.organisation_name)}</p>
                        <p className="text-[11px] text-[#4A5568]">{txt(v.location || v.city)}</p>
                      </td>
                      <td className="p-3.5 text-[#4A5568]">{fmtDate(v.planned_date)}</td>
                      <td className="p-3.5 text-[#14213D] font-medium">{txt(v.assignee_name || v.assigned_to_name || v.planned_by_name)}</td>
                      <td className="p-3.5 text-[#4A5568]">{v.purpose || 'Client meeting'}</td>
                      <td className="p-3.5">
                        {v.manager_name ? (
                          <span className="text-[11px] font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                            Directive by {v.manager_name}
                          </span>
                        ) : (
                          <span className="text-[#A1B3D3]">—</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">
                          {pretty(v.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'expenses' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3.5">Employee</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5 text-right">Amount</th>
                    <th className="p-3.5">Purpose</th>
                    <th className="p-3.5">Stage Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vExpenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-medium text-[#14213D]">{txt(e.employee_name)}</td>
                      <td className="p-3.5 text-[#4A5568]">{fmtDate(e.expense_date)}</td>
                      <td className="p-3.5 capitalize">{pretty(e.category)}</td>
                      <td className="p-3.5 text-right font-bold text-[#14213D]">{formatINR(e.amount)}</td>
                      <td className="p-3.5 text-[#4A5568]">{e.purpose || 'Travel expense'}</td>
                      <td className="p-3.5">
                        <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800">
                          {pretty(e.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'service' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3.5">Ticket No</th>
                    <th className="p-3.5">Customer & Asset</th>
                    <th className="p-3.5">Priority</th>
                    <th className="p-3.5">Warranty SLA</th>
                    <th className="p-3.5">Assigned Engineer</th>
                    <th className="p-3.5">Complaint Summary</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vTickets.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-semibold text-[#0F5E63]">{txt(s.ticket_no || s.ticket_number)}</td>
                      <td className="p-3.5">
                        <p className="font-medium text-[#14213D]">{txt(s.organisation_name)}</p>
                        <p className="text-[11px] text-[#4A5568]">S/N: {s.equipment_serial || 'N/A'}</p>
                      </td>
                      <td className="p-3.5">
                        <Badge variant={s.priority === 'critical' ? 'urgent' : 'outline'}>
                          {txt(s.priority).toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-3.5 capitalize text-[#4A5568]">{pretty(s.warranty_status)}</td>
                      <td className="p-3.5 text-[#14213D] font-medium">{s.assigned_to_name || 'Unassigned'}</td>
                      <td className="p-3.5 text-[#4A5568] max-w-xs truncate">{txt(s.complaint || s.complaint_description)}</td>
                      <td className="p-3.5">
                        <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-50 text-cyan-800">
                          {pretty(s.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
