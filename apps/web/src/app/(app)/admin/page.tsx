'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Users,
  Shield,
  Layers,
  Database,
  Search,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  ShieldAlert,
  UserPlus,
  Key,
  Sliders,
  Check,
  Building2,
  Eye,
  FileText,
  Calendar,
  Box,
  Wrench,
  Receipt,
  CheckSquare,
  Lock,
  Compass,
  RefreshCw,
  Database as DatabaseIcon,
  MapPin,
  History,
  LayoutList,
  Pencil,
  Plus,
  UserX,
  UserCheck,
} from 'lucide-react';
import { useAuth, PRESET_ROLE_USERS } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  CardContent,
  PageContainer,
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  PageLoader,
  FilterMenu,
  InfoCallout,
  EmptyState, StatGrid, StatCard, RowMenu,
} from '@/components/ui';
import { ROLE_PROFILES, USER_ROLES, type UserRole, type RolePermissionProfile } from '@arihant/shared';
import {
  ConfirmModal,
  ProductFormModal,
  TemporaryPasswordModal,
  TerritoryFormModal,
  UserFormModal,
  type AdminProduct,
  type AdminRegion,
  type AdminUser,
  type AdminZone,
} from './_components/AdminForms';

const ADMIN_TABS = ['permissions', 'users', 'products', 'zones', 'audit'] as const;
const AUDIT_PAGE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
/** 'manager_manager_approved' → 'Manager approved'; 'tender_stage_changed' → 'Tender stage changed'. */
const humanAction = (a: unknown): string => {
  const words = String(a ?? '')
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w, i, all) => w && w !== all[i - 1]);
  const t = words.join(' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Update';
};
/** Payload values for people: IST dates, names for user ids, no raw ids / hashes. */
const AUDIT_HIDDEN_KEYS = new Set(['id', 'password_hash', 'created_at', 'updated_at', '_actorId', 'actorId']);

const DEPARTMENT_NAMES: Record<UserRole, string> = {
  management: 'Executive Management',
  regional_manager: 'Regional Operations & Sales',
  sales: 'Field Sales & BD',
  tender_team: 'GeM Tender Operations',
  demo_team: 'Field Demonstrations & Fleet',
  service_team: 'Service & Maintenance Depot',
  accounts: 'Finance & Accounts',
  admin: 'IT & System Administration',
};

const CAPABILITY_LABELS: Record<keyof RolePermissionProfile['capabilities'], { label: string; desc: string }> = {
  canViewAllIndia: {
    label: 'All-India National Visibility',
    desc: 'Unrestricted operational visibility across all zones and regions without regional boundary locking.',
  },
  canSwitchZones: {
    label: 'Strategic Zone Switching',
    desc: 'Ability to toggle between North, South, East, and West territorial command views.',
  },
  canApproveTenders: {
    label: 'Tender Go/No-Go Approval',
    desc: 'Authorisation to review internal risk notes and sign off on bidding participation.',
  },
  canSubmitTenderBids: {
    label: 'Bid Envelope Submission',
    desc: 'Direct submission of GeM bids, EMD fee processing, and commercial price uploads.',
  },
  canManageDemos: {
    label: 'Demo Fleet Management',
    desc: 'Reserve equipment from depot matrix, schedule trials, and issue security gate passes.',
  },
  canManageService: {
    label: 'Breakdown Ticket Resolution',
    desc: 'Assign engineers, update diagnostic logs, and officially issue ticket closure certificates.',
  },
  canEndorseExpensesStage1: {
    label: 'Stage 1 Manager Expense Endorsement',
    desc: 'First-level policy and receipt validation under corporate travel & reimbursement rules.',
  },
  canDisburseExpensesStage2: {
    label: 'Stage 2 Finance Disbursement',
    desc: 'Financial audit, GST verification, and payout authorization by corporate accounts.',
  },
  canUnblockTasks: {
    label: 'Task & Blocker Clearance',
    desc: 'Review and approve task blocker removal requests across team milestones.',
  },
  canManageUsersAndMasters: {
    label: 'Master Records & RBAC Administration',
    desc: 'Create and modify system accounts, zones, equipment MHA QRs, and role policies.',
  },
};

const asRows = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.items) ? res.items : []);
const show = (v: unknown, fallback = '—'): string =>
  v === undefined || v === null || v === '' || String(v) === 'undefined' || String(v) === 'null' ? fallback : String(v);
const fmtStamp = (v: unknown): string => {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';
};

export default function AdminPage() {
  const { user, hasRole } = useAuth();
  const [activeTab, setActiveTabState] = useState<string>('permissions');
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    } catch {}
  };
  const [isLoading, setIsLoading] = useState(true);

  // Data states
  const [usersList, setUsersList] = useState<any[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);
  const [zonesList, setZonesList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [regionsList, setRegionsList] = useState<AdminRegion[]>([]);
  const [userForm, setUserForm] = useState<{ open: boolean; editing: AdminUser | null }>({ open: false, editing: null });
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [productForm, setProductForm] = useState<{ open: boolean; editing: AdminProduct | null }>({ open: false, editing: null });
  const [territoryForm, setTerritoryForm] = useState<{ open: boolean; kind: 'zone' | 'region'; editing: AdminZone | AdminRegion | null; zoneId?: string }>({
    open: false,
    kind: 'zone',
    editing: null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');

  // RBAC permissions state
  const [selectedRoleForConfig, setSelectedRoleForConfig] = useState<UserRole>('regional_manager');
  const [permissionsState, setPermissionsState] = useState<Record<UserRole, RolePermissionProfile['capabilities']>>(() => {
    const initial: any = {};
    for (const role of USER_ROLES) {
      initial[role] = { ...ROLE_PROFILES[role].capabilities };
    }
    return initial;
  });
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchAdminData = async () => {
    setIsLoading(true);
    const bad: string[] = [];
    const load = (label: string, call: Promise<any>) =>
      call.catch((err: any) => {
        console.error(`Admin: ${label} failed`, err);
        bad.push(label);
        return null;
      });
    const [usersRes, productsRes, zonesRes, regionsRes, auditRes] = await Promise.all([
      load('Users', api.get('/users', { limit: 100 })),
      load('Equipment masters', api.get('/masters/products')),
      load('Zones', api.get('/masters/zones')),
      load('Regions', api.get('/masters/regions')),
      load('Audit log', api.get('/audit', { limit: AUDIT_PAGE, page: 1 })),
    ]);
    setUsersList(asRows(usersRes));
    setProductsList(asRows(productsRes));
    setZonesList(asRows(zonesRes));
    setRegionsList(asRows(regionsRes));
    setAuditLogs(asRows(auditRes));
    setAuditTotal(Number(auditRes?.total ?? auditRes?.meta?.total ?? asRows(auditRes).length) || 0);
    setAuditPage(1);
    setFailed(bad);
    setIsLoading(false);
  };

  const loadOlderAudit = async () => {
    setAuditLoading(true);
    try {
      const next = auditPage + 1;
      const res = await api.get('/audit', { limit: AUDIT_PAGE, page: next });
      const rows = asRows(res);
      setAuditLogs((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setAuditTotal(Number(res?.total ?? res?.meta?.total ?? auditTotal) || auditTotal);
      setAuditPage(next);
    } catch (err: any) {
      setActionError(err?.message || 'Could not load older audit entries');
    } finally {
      setAuditLoading(false);
    }
  };

  const reloadMasters = async () => {
    const [productsRes, zonesRes, regionsRes] = await Promise.all([
      api.get('/masters/products').catch(() => null),
      api.get('/masters/zones').catch(() => null),
      api.get('/masters/regions').catch(() => null),
    ]);
    if (productsRes) setProductsList(asRows(productsRes));
    if (zonesRes) setZonesList(asRows(zonesRes));
    if (regionsRes) setRegionsList(asRows(regionsRes));
  };

  const reloadUsers = async () => {
    const res = await api.get('/users', { limit: 100 }).catch(() => null);
    if (res) setUsersList(asRows(res));
  };

  useEffect(() => {
    // deep links: /admin?tab=audit, /admin?tab=users&open=<user id>
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && (ADMIN_TABS as readonly string[]).includes(tab)) setActiveTabState(tab);
    if (hasRole(['management', 'admin'])) {
      fetchAdminData();
    }
  }, []);

  // ?open=<user id> opens that user's edit form once the directory is loaded
  const openedFromLink = React.useRef(false);
  useEffect(() => {
    if (openedFromLink.current || usersList.length === 0) return;
    const id = new URLSearchParams(window.location.search).get('open');
    if (!id) return;
    openedFromLink.current = true;
    const target = usersList.find((u) => u.id === id);
    if (target) {
      setActiveTabState('users');
      setUserForm({ open: true, editing: target });
    }
  }, [usersList]);

  const userName = (id: unknown) => (typeof id === 'string' ? usersList.find((u) => u.id === id)?.full_name : undefined);
  const formatAuditValue = (key: string, v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : null;
    const str = String(v);
    if (UUID_RE.test(str)) return userName(str) ?? null; // raw ids mean nothing to a reader
    if (ISO_RE.test(str)) {
      // calendar days ('2026-10-19' or midnight UTC) are dates, not instants — never show them as "5:30 am"
      if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?(Z|\+00:?00)?)?$/.test(str)) {
        return new Date(`${str.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      }
      return fmtStamp(str);
    }
    if (/status|stage|role|action/i.test(key)) return humanAction(str);
    return str.length > 80 ? `${str.slice(0, 77)}…` : str;
  };
  const getEntityLabel = (log: any) => {
    const val = log.new_value || log.previous_value || log.details || {};
    const name =
      val.name ||
      val.full_name ||
      val.organisation_name ||
      val.title ||
      val.tender_no ||
      val.quotation_no ||
      val.ticket_no ||
      val.remarks ||
      val.product_name ||
      val.file_name ||
      val.purpose;

    const entityTypeFormatted = (log.entity_type || 'Record').replace(/_/g, ' ').toUpperCase();
    if (name) {
      return (
        <div className="max-w-[300px] truncate font-sans" title={`${entityTypeFormatted}: ${name}`}>
          <span className="font-semibold text-[#14213D] capitalize">{entityTypeFormatted}: </span>
          <span className="text-[#0F5E63] font-medium">{name}</span>
        </div>
      );
    }
    return (
      <span className="font-sans font-semibold text-[#14213D] capitalize">
        {entityTypeFormatted} Record
      </span>
    );
  };

  const getPayloadSummary = (log: any) => {
    const val = log.new_value || log.details || log.previous_value;
    if (!val || (typeof val === 'object' && Object.keys(val).length === 0)) {
      return <span className="text-[#6B7280] font-sans italic">No payload parameters</span>;
    }
    if (typeof val === 'object') {
      const prev = log.previous_value && typeof log.previous_value === 'object' ? log.previous_value : {};
      const parts = Object.keys(val)
        .filter((k) => !AUDIT_HIDDEN_KEYS.has(k))
        .map((k) => {
          const shown = formatAuditValue(k, val[k]);
          if (shown === null) return null;
          const label = k.replace(/_id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
          const before = k in prev && prev[k] !== val[k] ? formatAuditValue(k, prev[k]) : null;
          return before ? `${label}: ${before} → ${shown}` : `${label}: ${shown}`;
        })
        .filter((x): x is string => !!x)
        .slice(0, 4);
      return (
        <span
          className="font-sans text-[11px] text-[#14213D] line-clamp-2 max-w-[280px] sm:line-clamp-none sm:truncate"
          title={parts.join(' · ')}
        >
          {parts.join(' · ') || 'Updated record attributes'}
        </span>
      );
    }
    return <span className="font-sans text-[11px] text-[#14213D]">{String(val)}</span>;
  };

  /** Called after the confirmation dialog; the API also refuses self-deactivation and orphaning direct reports. */
  const setUserActive = async (target: AdminUser, active: boolean) => {
    setActionError(null);
    await api.patch(`/users/${target.id}`, { is_active: active });
    setUsersList((prev) => prev.map((u) => (u.id === target.id ? { ...u, is_active: active } : u)));
    setNotice(`${target.full_name} ${active ? 're-activated' : 'deactivated'}.`);
  };

  // The capability matrix documents what the server enforces (ROLE_PROFILES + @Roles guards); it is read-only
  // here because toggling it cannot change live access — that needs a code / policy change.
  void setPermissionsState;
  void saveFeedback;
  void setSaveFeedback;

  const filteredUsers = usersList.filter((u) => {
    const matchesSearch =
      !search ||
      (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.role || '').toLowerCase().includes(search.toLowerCase());
    const matchesDept = selectedDept === 'all' || u.role === selectedDept;
    return matchesSearch && matchesDept;
  });





  if (!hasRole(['management', 'admin'])) {
    return (
      <div className="mx-auto my-12 max-w-xl p-6 text-center text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl space-y-3 shadow-xs sm:p-8">
        <ShieldAlert className="h-12 w-12 text-[#9A3412] mx-auto" />
        <h2 className="text-lg font-bold text-[#14213D]">Access Restricted</h2>
        <p className="text-xs">
          Only Top Management and System Administrators have permission to access master configurations, user administration, and role security policies.
        </p>
      </div>
    );
  }

  const canManage = hasRole(['management', 'admin']);
  const regionsByZone = (zoneId: string) => regionsList.filter((r) => r.zone_id === zoneId);
  const activeRoleProfile = ROLE_PROFILES[selectedRoleForConfig];
  const activeRoleCaps = permissionsState[selectedRoleForConfig];

  if (isLoading && usersList.length === 0) {
    return (
      <PageContainer>
        <PageLoader label="Loading administration data" rows={4} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* ── HEADER (title hidden by design; actions dock into the toolbar) ── */}
      <PageHeader
        title="Enterprise Administration & System Masters"
        icon={<Settings className="h-5 w-5 text-[#0F5E63]" />}
      />

      <StatGrid cols={4} className="gap-3">
        <StatCard title="Personnel" value={usersList.length} icon={<Users size={16} />} variant="primary" subtext={`${usersList.filter((u) => u.is_active).length} active`} />
        <StatCard title="Roles" value={USER_ROLES.length} icon={<Shield size={16} />} variant="emerald" subtext="RBAC personas" />
        <StatCard title="Zones" value={zonesList.length} icon={<MapPin size={16} />} variant="amber" subtext={`${productsList.length} equipment masters`} />
        <StatCard title="Audit Entries" value={auditTotal} icon={<History size={16} />} variant="rose" subtext={`${auditLogs.length} loaded · newest first`} />
      </StatGrid>

      {/* One filter row on every section: View first; the Users section adds its search + Department menu. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu
            label="View"
            icon={<LayoutList />}
            neutralKeys={[]}
            className="shrink-0"
            options={[
              { key: 'permissions', label: 'Role Permissions', icon: <Key /> },
              { key: 'users', label: 'Users & Departments', icon: <Users />, count: usersList.length },
              { key: 'products', label: 'Equipment & MHA QRs', icon: <Box />, count: productsList.length },
              { key: 'zones', label: 'Zones & Regions', icon: <MapPin />, count: zonesList.length },
              { key: 'audit', label: 'Security Audit Logs', icon: <History />, count: auditTotal },
            ].map((v) => ({ ...v, active: activeTab === v.key, onSelect: () => setActiveTab(v.key) }))}
          />
          {activeTab === 'users' && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search personnel"
                  placeholder="Search by name, email, role…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <FilterMenu
                  label="Department"
                  icon={<Building2 />}
                  align="right"
                  className="flex-1 lg:flex-none [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  options={[
                    { key: 'all', label: 'All departments', count: usersList.length, active: selectedDept === 'all', onSelect: () => setSelectedDept('all') },
                    ...USER_ROLES.map((r) => ({
                      key: r,
                      label: DEPARTMENT_NAMES[r],
                      count: usersList.filter((u) => u.role === r).length,
                      active: selectedDept === r,
                      onSelect: () => setSelectedDept(r),
                    })),
                  ]}
                />
                {canManage && (
                  <Button size="sm" leftIcon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setUserForm({ open: true, editing: null })} className="shrink-0">
                    Add user
                  </Button>
                )}
                {(search || selectedDept !== 'all') && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setSearch('');
                      setSelectedDept('all');
                    }}
                    className="text-xs text-[#4A5568] hover:text-[#881337]"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      {failed.length > 0 && (
        <InfoCallout variant="danger" title="Some administration data could not be loaded">
          {failed.join(', ')} did not respond. Your role may not be allowed to read them, or the API is unreachable. Use Reload to retry.
        </InfoCallout>
      )}
      {actionError && (
        <InfoCallout variant="danger" title="Action failed" onClose={() => setActionError(null)}>
          {actionError}
        </InfoCallout>
      )}
      {notice && (
        <InfoCallout variant="success" title="Saved" onClose={() => setNotice(null)}>
          {notice}
        </InfoCallout>
      )}

      {/* ── TAB 1: ROLE PERMISSIONS & SCOPE MATRIX ── */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          {/* Status Alert Banner */}
          <div className="rounded-xl border border-[#0F5E63]/30 bg-gradient-to-r from-[#0F5E63]/5 via-white to-[#E3EFEE]/40 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#0F5E63] text-white flex items-center justify-center shrink-0 shadow-sm">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-bold text-[#14213D]">Enterprise Role & Access Control Policy</h3>
                  <Badge variant="cyber" size="sm">Active Baseline</Badge>
                </div>
                <p className="text-xs text-[#4A5568] mt-0.5 max-w-3xl">
                  <strong>Enterprise Security:</strong> Baseline policies and role scopes are enforced across all operational departments and territorial regions.
                </p>
              </div>
            </div>
            {saveFeedback && (
              <div className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3] animate-in fade-in">
                {saveFeedback}
              </div>
            )}
          </div>

          {/* 8 Persona Selector Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {USER_ROLES.map((r) => {
              const profile = ROLE_PROFILES[r];
              const isSelected = selectedRoleForConfig === r;
              return (
                <Card
                  key={r}
                  variant="interactive"
                  selected={isSelected}
                  padding="xs"
                  onClick={() => setSelectedRoleForConfig(r)}
                  className="text-left flex flex-col justify-between cursor-pointer"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568] line-clamp-2 sm:line-clamp-none sm:truncate">
                    {DEPARTMENT_NAMES[r]}
                  </div>
                  <div className={`text-xs font-bold mt-1 truncate ${isSelected ? 'text-[#0F5E63]' : 'text-[#14213D]'}`}>
                    {profile.title}
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        profile.territorialScope === 'all_india'
                          ? 'bg-[#0F5E63]'
                          : profile.territorialScope === 'regional'
                          ? 'bg-[#1F2E52]'
                          : 'bg-[#0F5E63]'
                      }`}
                    />
                    <span className="text-[9px] font-bold text-[#4A5568] uppercase">
                      {profile.territorialScope.replace('_', ' ')}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Selected Role Detail & Interactive Permission Configuration */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Col: Scope & Functional Responsibilities */}
            <div className="lg:col-span-1 space-y-4">
              <div className="rounded-xl border border-[#DCD8CE] bg-white p-4 shadow-xs space-y-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DCD8CE]">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568]">
                      Role Definition
                    </span>
                    <h3 className="text-base font-black text-[#14213D]">{activeRoleProfile.title}</h3>
                  </div>
                  <Badge variant="outline" size="sm" className="uppercase font-mono shrink-0">
                    {activeRoleProfile.role}
                  </Badge>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase text-[#4A5568]">Department</span>
                  <div className="text-xs font-semibold text-[#14213D] mt-0.5">
                    {activeRoleProfile.department}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase text-[#4A5568]">Territorial Visibility Scope</span>
                  <div className="mt-1">
                    <Badge
                      variant={
                        activeRoleProfile.territorialScope === 'all_india'
                          ? 'cyber'
                          : activeRoleProfile.territorialScope === 'regional'
                          ? 'urgent'
                          : 'success'
                      }
                      size="sm"
                    >
                      {activeRoleProfile.territorialScope.toUpperCase().replace('_', ' ')}
                    </Badge>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase text-[#4A5568]">Mandated Scope Summary</span>
                  <blockquote className="mt-1 p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs font-medium text-[#0F5E63] leading-relaxed italic">
                    &ldquo;{activeRoleProfile.scopeSummary}&rdquo;
                  </blockquote>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase text-[#4A5568]">Core Operational Responsibilities</span>
                  <ul className="mt-2 space-y-1.5 text-xs text-[#14213D]">
                    {activeRoleProfile.responsibilities.map((resp, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-[#0F5E63] shrink-0 mt-0.5" />
                        <span>{resp}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-3 border-t border-[#DCD8CE]">
                  <span className="text-[11px] font-bold uppercase text-[#4A5568]">Allowed Modules in Sidebar</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {activeRoleProfile.allowedModules.map((mod) => (
                      <span
                        key={mod}
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#E3EFEE] text-[#0F5E63] border border-[#DCD8CE]"
                      >
                        /{mod}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right 2 Cols: Configurable Capabilities Matrix */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-[#DCD8CE] bg-white overflow-hidden shadow-xs">
                <div className="p-4 sm:p-5 border-b border-[#DCD8CE] bg-[#FBFAF7] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#14213D] flex items-start gap-2 sm:items-center">
                      <Sliders className="w-4 h-4 text-[#0F5E63] mt-0.5 shrink-0 sm:mt-0" />
                      <span>Configurable Capabilities Matrix: {activeRoleProfile.title}</span>
                    </h3>
                    <p className="text-xs text-[#4A5568] mt-0.5">
                      The capabilities this role has today, as enforced by the server&apos;s RBAC guards. Read-only: changing a role&apos;s
                      access is a policy change made in code and the RBAC specification, not from this screen.
                    </p>
                  </div>
                  <Badge variant="outline" size="sm" className="shrink-0 gap-1">
                    <Lock className="h-3 w-3" /> Read-only
                  </Badge>
                </div>

                <div className="divide-y divide-[#DCD8CE]">
                  {(Object.keys(CAPABILITY_LABELS) as Array<keyof RolePermissionProfile['capabilities']>).map((capKey) => {
                    const isEnabled = activeRoleCaps[capKey];
                    const info = CAPABILITY_LABELS[capKey];
                    return (
                      <div
                        key={capKey}
                        className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                          isEnabled ? 'bg-white' : 'bg-[#FBFAF7]/50'
                        }`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs font-bold text-[#14213D]">{info.label}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                isEnabled
                                  ? 'bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]'
                                  : 'bg-[#ECE9E2] text-[#4A5568] border border-[#DCD8CE]'
                              }`}
                            >
                              {isEnabled ? 'PERMITTED' : 'RESTRICTED'}
                            </span>
                          </div>
                          <p className="text-xs text-[#4A5568] max-w-xl">{info.desc}</p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!isEnabled}
                          aria-readonly
                          disabled
                          title="Enforced by the server — read-only"
                          aria-label={`${info.label}: ${isEnabled ? 'permitted' : 'restricted'} (read-only)`}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed opacity-80 rounded-full max-sm:before:absolute max-sm:before:-inset-2.5 border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isEnabled ? 'bg-[#0F5E63]' : 'bg-[#C9C4B8]'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* Comparative Matrix Table across all 8 Roles */}
          <Card padding="none" className="overflow-hidden border-[#DCD8CE] [&_.ui-table-wrap]:rounded-none [&_.ui-table-wrap]:border-0 [&_.ui-table-wrap]:shadow-none">
            <div className="p-4 border-b border-[#DCD8CE] bg-[#FBFAF7]">
              <h4 className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                Enterprise Role Governance Matrix
              </h4>
            </div>
            <Table className="table-fixed !min-w-0 max-sm:[&_tbody_tr]:!grid-cols-2 [&_td]:px-2.5 [&_th]:h-auto [&_th]:px-2.5 [&_th]:py-2.5 [&_th]:text-[10px] [&_th]:leading-tight">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[240px]">Enterprise Role</TableHead>
                  <TableHead className="text-center">All-India</TableHead>
                  <TableHead className="text-center">Tender Signoff</TableHead>
                  <TableHead className="text-center">Bid Submit</TableHead>
                  <TableHead className="text-center">Demos</TableHead>
                  <TableHead className="text-center">Service</TableHead>
                  <TableHead className="text-center">Stage 1 Exp</TableHead>
                  <TableHead className="text-center">Stage 2 Payout</TableHead>
                  <TableHead className="text-center">RBAC Admin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {USER_ROLES.map((r) => {
                  const caps = permissionsState[r];
                  const prof = ROLE_PROFILES[r];
                  return (
                    <TableRow key={r}>
                      <TableCell className="font-bold text-[#14213D]">
                        <div className="truncate" title={prof.title}>{prof.title}</div>
                        <div className="truncate text-[11px] text-[#4A5568] font-normal" title={DEPARTMENT_NAMES[r]}>{DEPARTMENT_NAMES[r]}</div>
                        <div className="text-[10px] font-bold uppercase text-[#4A5568]">{prof.territorialScope.replace('_', ' ')}</div>
                      </TableCell>
                      <TableCell className="text-center">{caps.canViewAllIndia ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canApproveTenders ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canSubmitTenderBids ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canManageDemos ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canManageService ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canEndorseExpensesStage1 ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canDisburseExpensesStage2 ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                      <TableCell className="text-center">{caps.canManageUsersAndMasters ? <Check className="w-4 h-4 text-[#0F5E63] inline" /> : <span className="text-[#C9C4B8]">-</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* ── TAB 2: USERS & DEPARTMENTS ── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <Card padding="none" className="overflow-hidden border-[#DCD8CE] [&_.ui-table-wrap]:rounded-none [&_.ui-table-wrap]:border-0 [&_.ui-table-wrap]:shadow-none">
            <div className="flex items-center justify-between gap-2 border-b border-[#ECE9E2] px-4 py-3">
              <h2 className="font-serif text-sm font-bold text-[#14213D]">Personnel directory</h2>
              <span className="font-mono text-xs text-[#4A5568]">
                {filteredUsers.length} of {usersList.length}
              </span>
            </div>

            <Table className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Name & Contact</TableHead>
                  <TableHead>Department & Role</TableHead>
                  <TableHead>Territory & Manager</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-xs text-[#4A5568]">
                      {usersList.length === 0 ? 'No personnel records were returned.' : 'No personnel match this filter.'}
                    </TableCell>
                  </TableRow>
                )}
                {filteredUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-bold text-[#14213D]">
                      <div className="max-w-[280px] truncate" title={show(u.full_name)}>{show(u.full_name)}</div>
                      <div className="max-w-[280px] truncate text-[11px] text-[#4A5568] font-mono font-normal" title={show(u.email)}>
                        {show(u.email)}
                      </div>
                      {u.phone && <div className="text-[11px] text-[#4A5568] font-mono font-normal">{u.phone}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-medium text-[#14213D]">{DEPARTMENT_NAMES[u.role as UserRole] || 'General'}</div>
                      <div className="text-[11px] uppercase text-[#4A5568]">{show(u.role).replace(/_/g, ' ')}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate text-[#14213D]">
                        {u.zone_name || 'All India'}
                        {u.region_name ? <span className="text-[#4A5568]"> · {u.region_name}</span> : null}
                      </div>
                      <div className="max-w-[220px] truncate text-[11px] text-[#4A5568]" title={u.reporting_manager_name || 'No reporting manager'}>
                        {u.reporting_manager_name ? `Reports to ${u.reporting_manager_name}` : 'No reporting manager'}
                      </div>
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <Badge
                        variant={u.is_active ? 'success' : 'danger'}
                        size="sm"
                      >
                        {u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canManage ? (
                        <RowMenu
                          label={`Actions for ${u.full_name}`}
                          items={[
                            { key: 'edit', label: 'Edit role, manager & territory', icon: <Pencil />, onSelect: () => setUserForm({ open: true, editing: u }) },
                            u.is_active
                              ? {
                                  key: 'deactivate',
                                  label: u.id === user?.id ? 'Deactivate (not allowed for your own account)' : 'Deactivate…',
                                  icon: <UserX />,
                                  danger: true,
                                  disabled: u.id === user?.id,
                                  onSelect: () => setConfirmUser(u),
                                }
                              : { key: 'activate', label: 'Re-activate…', icon: <UserCheck />, onSelect: () => setConfirmUser(u) },
                          ]}
                        />
                      ) : (
                        <span className="text-[11px] text-[#4A5568]">View only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* ── TAB 3: PRODUCTS & MHA QRs ── */}
      {activeTab === 'products' && canManage && (
        <div className="flex justify-end">
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setProductForm({ open: true, editing: null })}>
            Add equipment
          </Button>
        </div>
      )}
      {activeTab === 'products' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productsList.map((p) => (
            <Card
              key={p.id}
              padding="md"
              className="flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-[#14213D] text-xs leading-tight">
                    {show(p.name)}
                  </span>
                  {p.is_mha_qr && (
                    <Badge variant="urgent" size="sm" className="text-[10px] shrink-0">
                      MHA QR
                    </Badge>
                  )}
                </div>
                <div className="mt-2 text-xs text-[#4A5568]">
                  Category: <strong className="text-[#14213D]">{show(p.category)}</strong>
                </div>
                <div className="text-xs text-[#4A5568]">
                  Make / OEM: <strong className="text-[#14213D]">{p.make || 'Arihant Partner'}</strong>
                </div>
              </div>

              {p.spec_ref && (
                <div className="pt-2 border-t border-[#DCD8CE] text-[10px] font-mono text-[#4A5568] break-words">
                  QR Ref: {p.spec_ref}
                </div>
              )}
              {canManage && (
                <div className="flex justify-end">
                  <Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => setProductForm({ open: true, editing: p })}>
                    Edit
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── TAB 4: ZONES & REGIONS ── */}
      {activeTab === 'zones' && canManage && (
        <div className="flex justify-end">
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setTerritoryForm({ open: true, kind: 'zone', editing: null })}>
            Add zone
          </Button>
        </div>
      )}
      {activeTab === 'zones' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {zonesList.map((z) => {
            const regs = regionsByZone(z.id);
            const people = usersList.filter((u) => u.zone_id === z.id && u.is_active).length;
            return (
              <Card key={z.id} padding="md" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 font-serif font-bold text-[#14213D] text-sm">{show(z.name)} Zone</span>
                  <span className="font-mono text-xs text-[#0F5E63] uppercase font-bold">{show(z.code)}</span>
                </div>
                <p className="text-xs text-[#4A5568]">
                  {regs.length} region{regs.length === 1 ? '' : 's'} · {people} active user{people === 1 ? '' : 's'}
                </p>
                <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#ECE9E2]">
                  {regs.length === 0 && <li className="px-3 py-2 text-[11px] text-[#4A5568]">No regions yet</li>}
                  {regs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-[#14213D]">
                      <span className="truncate">{r.name}</span>
                      {canManage && (
                        <Button size="xs" variant="ghost" aria-label={`Edit region ${r.name}`} onClick={() => setTerritoryForm({ open: true, kind: 'region', editing: r })}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => setTerritoryForm({ open: true, kind: 'zone', editing: z })}>
                      Edit zone
                    </Button>
                    <Button size="xs" variant="secondary" leftIcon={<Plus className="h-3 w-3" />} onClick={() => setTerritoryForm({ open: true, kind: 'region', editing: null, zoneId: z.id })}>
                      Add region
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── TAB 5: SECURITY AUDIT LOG ── */}
      {activeTab === 'audit' && (
        <Card>
          <div className="p-4 border-b border-[#DCD8CE] bg-[#FBFAF7]">
            <span className="text-xs font-bold text-[#14213D]">
              Immutable PostgreSQL Security Audit Trail
            </span>
            <span className="ml-2 font-mono text-[11px] text-[#4A5568]">
              {auditLogs.length.toLocaleString('en-IN')} of {auditTotal.toLocaleString('en-IN')} entries, newest first
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <EmptyState icon={History} title="No audit entries" description="The security audit trail returned no records for your role." />
          ) : (
          <div className="sm:max-h-[600px] sm:overflow-y-auto">
            <Table className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp (IST) & Actor</TableHead>
                  <TableHead>Action Code</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Audit Payload Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="text-[#14213D] font-sans font-semibold">{log.actor_name || 'System Engine'}</div>
                      <div className="text-[#4A5568] font-mono text-[11px]">{fmtStamp(log.created_at)}</div>
                    </TableCell>
                    <TableCell className="text-[#0F5E63] font-semibold">
                      <div className="max-w-[200px] truncate" title={log.action}>{humanAction(log.action)}</div>
                      <div className="max-w-[200px] truncate font-mono text-[10px] font-normal text-[#4A5568]">{log.action}</div>
                    </TableCell>
                    <TableCell className="text-[#4A5568]">
                      {getEntityLabel(log)}
                    </TableCell>
                    <TableCell className="text-[#4A5568] font-sans">
                      {getPayloadSummary(log)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {auditLogs.length < auditTotal && (
              <div className="flex justify-center border-t border-[#ECE9E2] p-3">
                <Button size="sm" variant="secondary" isLoading={auditLoading} onClick={loadOlderAudit}>
                  Load {Math.min(AUDIT_PAGE, auditTotal - auditLogs.length)} older entries
                </Button>
              </div>
            )}
          </div>
          )}
        </Card>
      )}

      <UserFormModal
        isOpen={userForm.open}
        onClose={() => setUserForm({ open: false, editing: null })}
        editing={userForm.editing}
        users={usersList as AdminUser[]}
        zones={zonesList as AdminZone[]}
        regions={regionsList}
        currentUserId={user?.id}
        onSaved={async (saved, temporaryPassword) => {
          const wasEdit = !!userForm.editing;
          setUserForm({ open: false, editing: null });
          await reloadUsers();
          if (temporaryPassword) setTempPassword({ email: saved.email, password: temporaryPassword });
          setNotice(`${saved.full_name} ${wasEdit ? 'updated' : 'created'}.`);
        }}
      />
      <TemporaryPasswordModal value={tempPassword} onClose={() => setTempPassword(null)} />
      <ConfirmModal
        isOpen={!!confirmUser}
        onClose={() => setConfirmUser(null)}
        danger={!!confirmUser?.is_active}
        title={confirmUser?.is_active ? `Deactivate ${confirmUser?.full_name}?` : `Re-activate ${confirmUser?.full_name}?`}
        confirmLabel={confirmUser?.is_active ? 'Deactivate account' : 'Re-activate account'}
        message={
          confirmUser?.is_active ? (
            <>
              <p>They will be signed out and can no longer sign in. Their records, approvals and audit history stay intact.</p>
              <p>Anyone who reports to them must be moved to another manager first.</p>
            </>
          ) : (
            <p>They will be able to sign in again with their existing credentials.</p>
          )
        }
        onConfirm={async () => {
          if (confirmUser) await setUserActive(confirmUser, !confirmUser.is_active);
        }}
      />
      <ProductFormModal
        isOpen={productForm.open}
        onClose={() => setProductForm({ open: false, editing: null })}
        editing={productForm.editing}
        onSaved={async (p) => {
          setProductForm({ open: false, editing: null });
          await reloadMasters();
          setNotice(`${p.name} saved.`);
        }}
      />
      <TerritoryFormModal
        isOpen={territoryForm.open}
        onClose={() => setTerritoryForm((f) => ({ ...f, open: false, editing: null }))}
        kind={territoryForm.kind}
        editing={territoryForm.editing}
        zones={zonesList as AdminZone[]}
        defaultZoneId={territoryForm.zoneId}
        onSaved={async () => {
          const kind = territoryForm.kind;
          setTerritoryForm((f) => ({ ...f, open: false, editing: null }));
          await Promise.all([reloadMasters(), reloadUsers()]);
          setNotice(`${kind === 'zone' ? 'Zone' : 'Region'} saved.`);
        }}
      />

    </PageContainer>
  );
}
