'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  ShieldAlert,
  UserPlus,
  KeyRound,
  Check,
  Building2,
  Box,
  Lock,
  MapPin,
  Map as MapIcon,
  Pencil,
  Plus,
  UserX,
  UserCheck,
  Trash2,
  Power,
  Eye,
  ListChecks,
  LayoutList,
  Settings,
  Layers,
  Tags,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { usePagedList } from '@/lib/use-paged-list';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  PageContainer,
  PageHeader,
  SectionHeader,
  StatGrid,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  PageLoader,
  InfoCallout,
  EmptyState,
  RowMenu,
  Spinner,
  FilterMenu,
  Input,
  Pagination,
} from '@/components/ui';
import { ROLE_PROFILES, USER_ROLES, isLockedModule, type UserRole, type RolePermissionProfile } from '@arihant/shared';
import { roleCanReach } from '@/lib/route-access';
import { clearSectorOptions } from '@/app/(app)/leads/_lib/sectors';
import {
  BulkInviteModal,
  ClientCategoryFormModal,
  ConfirmModal,
  DepartmentFormModal,
  ModuleSwitchOffModal,
  ProductFormModal,
  TemporaryPasswordModal,
  TerritoryFormModal,
  UserFormModal,
  type AdminClientCategory,
  type AdminDepartment,
  type AdminProduct,
  type AdminRegion,
  type AdminUser,
  type AdminZone,
} from './_components/AdminForms';

/** The panel's views; the id is also the ?tab= deep link (dashboard cards link to users, products and zones). */
const SECTIONS = ['users', 'departments', 'products', 'zones', 'regions', 'categories', 'permissions'] as const;
type Section = (typeof SECTIONS)[number];
/** Rows per page on every admin list (the API caps a page at 100). */
const PAGE_SIZE = 20;
/** A list card: the table runs edge to edge, the pager is its footer. */
const LIST_CARD = 'overflow-hidden [&_.ui-table-wrap]:rounded-none [&_.ui-table-wrap]:border-0 [&_.ui-table-wrap]:shadow-none';
/** The last menu in the filter row opens to the left on wide screens, to the right where the row stacks. */
const END_MENU = 'max-lg:[&_.filter-menu-panel]:left-0 max-lg:[&_.filter-menu-panel]:right-auto [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto';

const SCOPE: Record<RolePermissionProfile['territorialScope'], { label: string; variant: 'info' | 'default' | 'outline' }> = {
  all_india: { label: 'All India', variant: 'info' },
  regional: { label: 'Own region', variant: 'default' },
  assigned_accounts: { label: 'Assigned accounts', variant: 'outline' },
};

const CAPABILITY_LABELS: Record<keyof RolePermissionProfile['capabilities'], { label: string; desc: string }> = {
  canViewAllIndia: { label: 'See all of India', desc: 'Sees records from every zone and region, not only their own.' },
  canSwitchZones: { label: 'Switch between zones', desc: 'Can change the view between the North, South, East and West zones.' },
  canApproveTenders: { label: 'Approve tender bids', desc: 'Reviews the risk notes and decides go or no-go on a tender.' },
  canSubmitTenderBids: { label: 'Submit bids on GeM', desc: 'Uploads bids and prices on GeM and handles EMD payments.' },
  canManageDemos: { label: 'Run demos', desc: 'Books demo units, schedules trials and issues gate passes.' },
  canManageService: { label: 'Resolve service tickets', desc: 'Assigns engineers, updates diagnostics and closes tickets.' },
  canEndorseExpensesStage1: { label: 'Approve expenses (stage 1)', desc: 'Checks claims and receipts against the travel policy, as the manager.' },
  canDisburseExpensesStage2: { label: 'Pay expenses (stage 2)', desc: 'Verifies GST and releases the payment, as Accounts.' },
  canUnblockTasks: { label: 'Clear task blockers', desc: 'Approves requests to remove blockers on team tasks.' },
  canManageUsersAndMasters: { label: 'Manage accounts and master lists', desc: 'Creates accounts and edits zones, equipment and role access.' },
};

const MATRIX_COLUMNS: { key: keyof RolePermissionProfile['capabilities']; label: string }[] = [
  { key: 'canViewAllIndia', label: 'All India' },
  { key: 'canApproveTenders', label: 'Tender approval' },
  { key: 'canSubmitTenderBids', label: 'Bid submission' },
  { key: 'canManageDemos', label: 'Demos' },
  { key: 'canManageService', label: 'Service' },
  { key: 'canEndorseExpensesStage1', label: 'Expenses stage 1' },
  { key: 'canDisburseExpensesStage2', label: 'Expenses stage 2' },
  { key: 'canManageUsersAndMasters', label: 'Admin' },
];

const asRows = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.items) ? res.items : []);
const totalOf = (res: any): number => Number(res?.total ?? res?.meta?.total ?? asRows(res).length) || 0;
const show = (v: unknown, fallback = '—'): string =>
  v === undefined || v === null || v === '' || String(v) === 'undefined' || String(v) === 'null' ? fallback : String(v);
const fmtStamp = (v: unknown): string => {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';
};

/** The value 300 ms after it stops changing (search boxes). */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 pl-9 text-xs" />
    </div>
  );
}

/** Loading, failure and empty rows for a paged table body; renders nothing once rows are in. */
function ListState({
  loading,
  error,
  empty,
  colSpan,
  emptyText,
  action,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  colSpan: number;
  emptyText: string;
  action?: React.ReactNode;
  onRetry: () => void;
}) {
  if (!loading && !error && !empty) return null;
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-xs text-[#4A5568]">
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Spinner size="sm" /> Loading…
          </span>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-[#881337]">This list didn&rsquo;t load. {error}</p>
            <Button size="xs" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p>{emptyText}</p>
            {action}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ page -- */

export default function AdminPage() {
  const router = useRouter();
  const { user, hasRole } = useAuth();
  const canView = hasRole(['management', 'admin']);
  /** Blueprint §2: user onboarding, master data CRUD and role provisioning belong to the System Administrator alone. */
  const isAdmin = hasRole('admin');
  /** RBAC spec §6: management governs module access too (a switch never grants, and never locks the administrator out). */
  const canSwitchModules = hasRole(['management', 'admin']);

  const [section, setSectionState] = useState<Section>('users');
  const setSection = (id: Section) => {
    setSectionState(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      url.searchParams.delete('open');
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    } catch {}
  };
  const [isLoading, setIsLoading] = useState(true);

  // Lookups for the forms and the headline counts (not the lists on screen — those are paged).
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [zonesList, setZonesList] = useState<AdminZone[]>([]);
  const [regionsList, setRegionsList] = useState<AdminRegion[]>([]);
  const [departmentsList, setDepartmentsList] = useState<AdminDepartment[]>([]);
  const [counts, setCounts] = useState({ users: 0, activeUsers: 0, products: 0, categories: 0 });
  const [access, setAccess] = useState<{ modules: { key: string; label: string; paths: string[] }[]; blocks: any[] } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  const [userForm, setUserForm] = useState<{ open: boolean; editing: AdminUser | null }>({ open: false, editing: null });
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string; title?: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState<AdminUser | null>(null);
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [productForm, setProductForm] = useState<{ open: boolean; editing: AdminProduct | null }>({ open: false, editing: null });
  const [territoryForm, setTerritoryForm] = useState<{ open: boolean; kind: 'zone' | 'region'; editing: AdminZone | AdminRegion | null; zoneId?: string }>({
    open: false,
    kind: 'zone',
    editing: null,
  });
  const [deptForm, setDeptForm] = useState<{ open: boolean; editing: AdminDepartment | null }>({ open: false, editing: null });
  const [catForm, setCatForm] = useState<{ open: boolean; editing: AdminClientCategory | null }>({ open: false, editing: null });
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'department' | 'zone' | 'region' | 'client category'; id: string; name: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [switchOff, setSwitchOff] = useState<{ role: UserRole; module: string; label: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('regional_manager');
  const [compareOpen, setCompareOpen] = useState(false);

  // Filters per list
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('');
  const [userStatus, setUserStatus] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [zoneSearch, setZoneSearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [regionZone, setRegionZone] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const dUserSearch = useDebounced(userSearch.trim());
  const dDeptSearch = useDebounced(deptSearch.trim());
  const dProductSearch = useDebounced(productSearch.trim());
  const dZoneSearch = useDebounced(zoneSearch.trim());
  const dRegionSearch = useDebounced(regionSearch.trim());
  const dCatSearch = useDebounced(catSearch.trim());

  // Paged lists: each reads its page only while its view is open.
  const usersPage = usePagedList<AdminUser & Record<string, any>>(
    useCallback(
      (page: number) =>
        api.get('/users', {
          page,
          limit: PAGE_SIZE,
          search: dUserSearch || undefined,
          role: userRole || undefined,
          is_active: userStatus || undefined,
        }),
      [dUserSearch, userRole, userStatus],
    ),
    { enabled: canView && section === 'users' },
  );
  const deptPage = usePagedList<AdminDepartment>(
    useCallback((page: number) => api.get('/masters/departments', { page, limit: PAGE_SIZE, search: dDeptSearch || undefined }), [dDeptSearch]),
    { enabled: canView && section === 'departments' },
  );
  const productPage = usePagedList<AdminProduct>(
    useCallback((page: number) => api.get('/masters/products', { page, limit: PAGE_SIZE, search: dProductSearch || undefined }), [dProductSearch]),
    { enabled: canView && section === 'products' },
  );
  const zonePage = usePagedList<AdminZone>(
    useCallback((page: number) => api.get('/masters/zones', { page, limit: PAGE_SIZE, search: dZoneSearch || undefined }), [dZoneSearch]),
    { enabled: canView && section === 'zones' },
  );
  const regionPage = usePagedList<AdminRegion>(
    useCallback(
      (page: number) => api.get('/masters/regions', { page, limit: PAGE_SIZE, search: dRegionSearch || undefined, zone_id: regionZone || undefined }),
      [dRegionSearch, regionZone],
    ),
    { enabled: canView && section === 'regions' },
  );
  const catPage = usePagedList<AdminClientCategory>(
    useCallback(
      (page: number) => api.get('/masters/client-categories', { page, limit: PAGE_SIZE, include_inactive: 'true', search: dCatSearch || undefined }),
      [dCatSearch],
    ),
    { enabled: canView && section === 'categories' },
  );

  const fetchLookups = async () => {
    const bad: string[] = [];
    const load = (label: string, call: Promise<any>) =>
      call.catch((err: any) => {
        console.error(`Admin: ${label} failed`, err);
        bad.push(label);
        return null;
      });
    const [usersRes, activeRes, productsRes, zonesRes, regionsRes, departmentsRes, accessRes, categoriesRes] = await Promise.all([
      load('People', api.get('/users', { limit: 100 })),
      load('People', api.get('/users', { limit: 1, is_active: 'true' })),
      load('Equipment', api.get('/masters/products', { page: 1, limit: 1 })),
      load('Zones', api.get('/masters/zones')),
      load('Regions', api.get('/masters/regions')),
      load('Departments', api.get('/masters/departments')),
      load('Module access', api.get('/admin/access')),
      load('Client categories', api.get('/masters/client-categories', { page: 1, limit: 1, include_inactive: 'true' })),
    ]);
    setUsersList(asRows(usersRes));
    setZonesList(asRows(zonesRes));
    setRegionsList(asRows(regionsRes));
    setDepartmentsList(asRows(departmentsRes));
    setAccess(accessRes);
    setCounts({ users: totalOf(usersRes), activeUsers: totalOf(activeRes), products: totalOf(productsRes), categories: totalOf(categoriesRes) });
    setFailed([...new Set(bad)]);
  };

  useEffect(() => {
    // deep links: /admin?tab=products, /admin?tab=users&open=<user id>; the audit log has its own page
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'audit') {
      router.replace('/audit');
      return;
    }
    if (tab && (SECTIONS as readonly string[]).includes(tab)) setSectionState(tab as Section);
    if (!canView) return;
    fetchLookups().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?open=<user id> opens that user's edit form (admin only — it is an edit form)
  const openedFromLink = React.useRef(false);
  useEffect(() => {
    if (openedFromLink.current || isLoading || !isAdmin) return;
    const id = new URLSearchParams(window.location.search).get('open');
    if (!id) return;
    openedFromLink.current = true;
    const known = usersList.find((u) => u.id === id);
    (known ? Promise.resolve(known) : api.get(`/users/${id}`))
      .then((target: AdminUser) => {
        if (!target) return;
        setSectionState('users');
        setUserForm({ open: true, editing: target });
      })
      .catch(() => setActionError('That person’s account could not be opened. It may have been removed.'));
  }, [isLoading, isAdmin, usersList]);

  const reloadUsers = async () => {
    await Promise.all([usersPage.refresh(), fetchLookups()]);
  };
  const reloadMasters = async () => {
    clearSectorOptions();
    await Promise.all([productPage.refresh(), zonePage.refresh(), regionPage.refresh(), deptPage.refresh(), catPage.refresh(), fetchLookups()]);
  };
  const reloadAccess = async () => {
    const res = await api.get('/admin/access').catch(() => null);
    if (res) setAccess(res);
  };

  /** Module switch for the selected role: off asks for a reason first; on takes effect straight away. */
  const switchModule = async (role: UserRole, module: string, label: string, on: boolean) => {
    if (!on) return setSwitchOff({ role, module, label });
    setActionError(null);
    setSwitching(`${role}:${module}`);
    try {
      await api.patch(`/admin/access/${role}/${module}`, { blocked: false });
      await reloadAccess();
      setNotice(`${label} is back on for ${ROLE_PROFILES[role].title}.`);
    } catch (err: any) {
      setActionError(err?.message || `${label} could not be switched back on. Try again.`);
    } finally {
      setSwitching(null);
    }
  };

  /** Hidden categories stay on their customers but are no longer offered when a customer is added. */
  const setCategoryActive = async (c: AdminClientCategory, active: boolean) => {
    setActionError(null);
    try {
      await api.patch(`/masters/client-categories/${c.id}`, { is_active: active });
      clearSectorOptions();
      await catPage.refresh();
      setNotice(active ? `${c.name} is offered in pickers again.` : `${c.name} is hidden from pickers. Its customers keep it.`);
    } catch (err: any) {
      setActionError(err?.message || `${c.name} could not be updated. Try again.`);
    }
  };

  /** Called after the confirmation dialog; the API also refuses self-deactivation and orphaning direct reports. */
  const setUserActive = async (target: AdminUser, active: boolean) => {
    setActionError(null);
    await api.patch(`/users/${target.id}`, { is_active: active });
    await reloadUsers();
    setNotice(`${target.full_name} ${active ? 'can sign in again' : 'is deactivated'}.`);
  };

  const regionCountByZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of regionsList) if (r.zone_id) m.set(r.zone_id, (m.get(r.zone_id) ?? 0) + 1);
    return m;
  }, [regionsList]);
  const offByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of access?.blocks || []) m.set(b.role, (m.get(b.role) ?? 0) + 1);
    return m;
  }, [access]);

  if (!canView) {
    return (
      <PageContainer>
        <EmptyState
          icon={ShieldAlert}
          title="You don’t have access to Administration"
          description="Administration is open to management and the System Administrator. Ask the System Administrator if an account or master list needs changing."
        />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer>
        <PageLoader label="Loading administration" rows={4} />
      </PageContainer>
    );
  }

  const profile = ROLE_PROFILES[selectedRole];
  const blockedCount = access?.blocks.length ?? 0;
  const deactivated = Math.max(0, counts.users - counts.activeUsers);
  const noHead = departmentsList.filter((d) => !d.head_user_id && !d.head_name).length;
  const userFiltered = Boolean(userSearch || userRole || userStatus);
  const clearUserFilters = () => {
    setUserSearch('');
    setUserRole('');
    setUserStatus('');
  };
  const cols = (n: number) => n + (isAdmin ? 1 : 0);
  const actionsHead = isAdmin && (
    <TableHead className="w-12 text-right">
      <span className="sr-only">Actions</span>
    </TableHead>
  );

  // Headline cards: one per master list; a click opens that list (like the Leads cards).
  const headline: { key: string; label: string; value: number; subtext: string; icon: React.ReactNode; variant: 'primary' | 'emerald' | 'amber' | 'default'; open: Section; active: boolean }[] = [
    {
      key: 'people',
      label: 'People',
      value: counts.users,
      subtext: deactivated ? `${counts.activeUsers} active · ${deactivated} deactivated` : `${counts.activeUsers} active`,
      icon: <Users size={16} />,
      variant: 'primary',
      open: 'users',
      active: section === 'users',
    },
    {
      key: 'departments',
      label: 'Departments',
      value: departmentsList.length,
      subtext: noHead ? `${noHead} without a head` : 'Every department has a head',
      icon: <Building2 size={16} />,
      variant: noHead ? 'amber' : 'emerald',
      open: 'departments',
      active: section === 'departments',
    },
    {
      key: 'equipment',
      label: 'Equipment',
      value: counts.products,
      subtext: 'Used by tenders, demos and service',
      icon: <Box size={16} />,
      variant: 'default',
      open: 'products',
      active: section === 'products',
    },
    {
      key: 'territory',
      label: 'Zones',
      value: zonesList.length,
      subtext: `${regionsList.length} regions`,
      icon: <MapPin size={16} />,
      variant: 'default',
      open: 'zones',
      active: section === 'zones' || section === 'regions',
    },
  ];

  const viewOptions: { key: Section; label: string; icon: React.ReactNode; count?: number | string; urgent?: boolean }[] = [
    { key: 'users', label: 'People', icon: <Users className="h-4 w-4" />, count: counts.users },
    { key: 'departments', label: 'Departments', icon: <Building2 className="h-4 w-4" />, count: departmentsList.length },
    { key: 'products', label: 'Equipment', icon: <Box className="h-4 w-4" />, count: counts.products },
    { key: 'zones', label: 'Zones', icon: <MapIcon className="h-4 w-4" />, count: zonesList.length },
    { key: 'regions', label: 'Regions', icon: <MapPin className="h-4 w-4" />, count: regionsList.length },
    { key: 'categories', label: 'Client categories', icon: <Tags className="h-4 w-4" />, count: counts.categories },
    { key: 'permissions', label: 'Roles & access', icon: <KeyRound className="h-4 w-4" />, count: blockedCount ? `${blockedCount} off` : USER_ROLES.length, urgent: blockedCount > 0 },
  ];

  // Page actions dock beside the View menu, as on every other module page.
  const actions: Partial<Record<Section, React.ReactNode>> = {
    users: (
      <>
        <Button size="sm" variant="secondary" leftIcon={<Users className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
          Invite people
        </Button>
        <Button size="sm" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setUserForm({ open: true, editing: null })}>
          Add person
        </Button>
      </>
    ),
    departments: (
      <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setDeptForm({ open: true, editing: null })}>
        Add department
      </Button>
    ),
    products: (
      <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setProductForm({ open: true, editing: null })}>
        Add equipment
      </Button>
    ),
    zones: (
      <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setTerritoryForm({ open: true, kind: 'zone', editing: null })}>
        Add zone
      </Button>
    ),
    regions: (
      <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setTerritoryForm({ open: true, kind: 'region', editing: null, zoneId: regionZone || undefined })}>
        Add region
      </Button>
    ),
    categories: (
      <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCatForm({ open: true, editing: null })}>
        Add category
      </Button>
    ),
  };

  return (
    <PageContainer>
      <PageHeader
        title="Administration"
        icon={<Settings className="h-7 w-7 text-[#0F5E63]" />}
        actions={isAdmin && actions[section] ? <div className="flex items-center gap-2">{actions[section]}</div> : undefined}
      />

      <StatGrid cols={4} className="gap-3">
        {headline.map((c) => (
          <StatCard
            key={c.key}
            label={c.label}
            value={c.value}
            subtext={c.subtext}
            icon={c.icon}
            variant={c.variant}
            className={c.active ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
            onClick={() => setSection(c.open)}
          />
        ))}
      </StatGrid>

      {/* One filter row: the View menu picks the list, then that list's search and dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu
            label="View"
            icon={<LayoutList />}
            neutralKeys={[]}
            className="shrink-0"
            options={viewOptions.map((o) => ({ ...o, active: section === o.key, onSelect: () => setSection(o.key) }))}
          />

          {section === 'users' && (
            <>
              <SearchBox value={userSearch} onChange={setUserSearch} label="Search people" placeholder="Search name, email or phone" />
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <FilterMenu
                  label="Role"
                  icon={<Layers />}
                  options={[
                    { key: 'all', label: 'All roles', active: !userRole, onSelect: () => setUserRole('') },
                    ...USER_ROLES.map((r) => ({ key: r, label: ROLE_PROFILES[r].title, active: userRole === r, onSelect: () => setUserRole(r) })),
                  ]}
                />
                <FilterMenu
                  label="Status"
                  icon={<UserCheck />}
                  align="right"
                  className={END_MENU}
                  options={[
                    { key: 'all', label: 'Any status', active: !userStatus, onSelect: () => setUserStatus('') },
                    { key: 'true', label: 'Active', active: userStatus === 'true', onSelect: () => setUserStatus('true') },
                    { key: 'false', label: 'Deactivated', active: userStatus === 'false', onSelect: () => setUserStatus('false') },
                  ]}
                />
                {userFiltered && (
                  <Button variant="ghost" size="xs" onClick={clearUserFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}
          {section === 'departments' && <SearchBox value={deptSearch} onChange={setDeptSearch} label="Search departments" placeholder="Search name or code" />}
          {section === 'products' && <SearchBox value={productSearch} onChange={setProductSearch} label="Search equipment" placeholder="Search name, category or make" />}
          {section === 'zones' && <SearchBox value={zoneSearch} onChange={setZoneSearch} label="Search zones" placeholder="Search zone name or code" />}
          {section === 'categories' && <SearchBox value={catSearch} onChange={setCatSearch} label="Search client categories" placeholder="Search category name" />}
          {section === 'regions' && (
            <>
              <SearchBox value={regionSearch} onChange={setRegionSearch} label="Search regions" placeholder="Search region or zone" />
              <FilterMenu
                label="Zone"
                icon={<MapIcon />}
                align="right"
                className={END_MENU}
                options={[
                  { key: 'all', label: 'All zones', active: !regionZone, onSelect: () => setRegionZone('') },
                  ...zonesList.map((z) => ({ key: z.id, label: `${z.name} (${z.code})`, count: regionCountByZone.get(z.id) ?? 0, active: regionZone === z.id, onSelect: () => setRegionZone(z.id) })),
                ]}
              />
            </>
          )}
          {section === 'permissions' && (
            <FilterMenu
              label="Role"
              icon={<KeyRound />}
              neutralKeys={[]}
              options={USER_ROLES.map((r) => {
                const off = offByRole.get(r);
                return { key: r, label: ROLE_PROFILES[r].title, count: off ? `${off} off` : undefined, urgent: !!off, active: selectedRole === r, onSelect: () => setSelectedRole(r) };
              })}
            />
          )}
        </div>
      </Card>

      {!isAdmin && (
        <InfoCallout variant="info" title="View only">
          You can see everything here, and switch modules on or off for a role under Roles &amp; access. Only the System Administrator can invite people or change
          accounts and master lists.
        </InfoCallout>
      )}
      {failed.length > 0 && (
        <InfoCallout variant="danger" title="Some admin data didn’t load">
          {failed.join(', ')} didn’t respond, so some counts and form options may be missing. Reload the page to try again.
        </InfoCallout>
      )}
      {actionError && (
        <InfoCallout variant="danger" title="That didn’t work" onClose={() => setActionError(null)}>
          {actionError}
        </InfoCallout>
      )}
      {notice && (
        <InfoCallout variant="success" title="Done" onClose={() => setNotice(null)}>
          {notice}
        </InfoCallout>
      )}

      {/* ── PEOPLE ── */}
      {section === 'users' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role & department</TableHead>
                <TableHead>Territory & manager</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={usersPage.loading}
                error={usersPage.error}
                empty={usersPage.rows.length === 0}
                colSpan={cols(4)}
                onRetry={usersPage.refresh}
                emptyText={userFiltered ? 'No one matches these filters.' : isAdmin ? 'No people yet. Invite your team to get started.' : 'No people yet.'}
                action={
                  userFiltered && (
                    <Button size="xs" variant="secondary" onClick={clearUserFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
              {!usersPage.loading &&
                usersPage.rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-bold text-[#14213D]">
                      <div className="max-w-[280px] truncate" title={show(u.full_name)}>{show(u.full_name)}</div>
                      <div className="max-w-[280px] truncate font-mono text-[11px] font-normal text-[#4A5568]" title={show(u.email)}>{show(u.email)}</div>
                      {u.phone && <div className="font-mono text-[11px] font-normal text-[#4A5568]">{u.phone}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-medium text-[#14213D]">{ROLE_PROFILES[u.role as UserRole]?.title || show(u.role).replace(/_/g, ' ')}</div>
                      <div className="text-[11px] text-[#4A5568]">{departmentsList.find((d) => d.id === u.department_id)?.name || 'No department'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate text-[#14213D]">
                        {u.zone_name || 'All India'}
                        {u.region_name ? <span className="text-[#4A5568]"> · {u.region_name}</span> : null}
                      </div>
                      <div className="max-w-[220px] truncate text-[11px] text-[#4A5568]" title={u.reporting_manager_name || 'No manager'}>
                        {u.reporting_manager_name ? `Reports to ${u.reporting_manager_name}` : 'No manager'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <Badge variant={u.is_active ? 'success' : 'danger'} size="sm">
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu
                          label={`Actions for ${u.full_name}`}
                          items={[
                            { key: 'edit', label: 'Edit details', icon: <Pencil />, onSelect: () => setUserForm({ open: true, editing: u }) },
                            { key: 'reset', label: 'Reset password…', icon: <KeyRound />, onSelect: () => setConfirmReset(u) },
                            u.is_active
                              ? {
                                  key: 'deactivate',
                                  label: u.id === user?.id ? 'You can’t deactivate yourself' : 'Deactivate…',
                                  icon: <UserX />,
                                  danger: true,
                                  disabled: u.id === user?.id,
                                  onSelect: () => setConfirmUser(u),
                                }
                              : { key: 'activate', label: 'Re-activate…', icon: <UserCheck />, onSelect: () => setConfirmUser(u) },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={usersPage.page} totalPages={usersPage.totalPages} total={usersPage.total} limit={PAGE_SIZE} onPage={usersPage.setPage} disabled={usersPage.loading} noun="people" />
        </Card>
      )}

      {/* ── DEPARTMENTS ── */}
      {section === 'departments' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Head</TableHead>
                <TableHead className="text-center">Active people</TableHead>
                <TableHead>Description</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={deptPage.loading}
                error={deptPage.error}
                empty={deptPage.rows.length === 0}
                colSpan={cols(4)}
                onRetry={deptPage.refresh}
                emptyText={dDeptSearch ? `No departments match “${dDeptSearch}”.` : 'No departments yet. Add one to group people and route escalations.'}
              />
              {!deptPage.loading &&
                deptPage.rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-bold text-[#14213D]">
                      <div className="max-w-[240px] truncate">{d.name}</div>
                      <div className="font-mono text-[11px] font-normal text-[#4A5568]">{d.code}</div>
                    </TableCell>
                    <TableCell className="text-[#14213D]">{d.head_name || <span className="text-[#9A3412]">No head set</span>}</TableCell>
                    <TableCell className="text-center font-mono">{d.member_count ?? 0}</TableCell>
                    <TableCell className="text-[#4A5568]">
                      <div className="max-w-[320px] truncate" title={d.description || ''}>{d.description || '—'}</div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu
                          label={`Actions for ${d.name}`}
                          items={[
                            { key: 'edit', label: 'Edit department', icon: <Pencil />, onSelect: () => setDeptForm({ open: true, editing: d }) },
                            { key: 'delete', label: 'Delete department…', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete({ kind: 'department', id: d.id, name: d.name }) },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={deptPage.page} totalPages={deptPage.totalPages} total={deptPage.total} limit={PAGE_SIZE} onPage={deptPage.setPage} disabled={deptPage.loading} noun="departments" />
        </Card>
      )}

      {/* ── EQUIPMENT ── */}
      {section === 'products' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Equipment</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Make</TableHead>
                <TableHead>MHA QR / spec reference</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={productPage.loading}
                error={productPage.error}
                empty={productPage.rows.length === 0}
                colSpan={cols(4)}
                onRetry={productPage.refresh}
                emptyText={dProductSearch ? `No equipment matches “${dProductSearch}”.` : 'No equipment yet. Add the first item so tenders and demos can use it.'}
              />
              {!productPage.loading &&
                productPage.rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-bold text-[#14213D]">
                      <div className="flex items-center gap-2">
                        <span className="max-w-[280px] truncate" title={show(p.name)}>{show(p.name)}</span>
                        {p.is_mha_qr && (
                          <Badge variant="urgent" size="sm" className="shrink-0">
                            MHA QR
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-[#14213D]">{show(p.category)}</TableCell>
                    <TableCell className="text-[#14213D]">{show(p.make)}</TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate font-mono text-[11px] text-[#4A5568]" title={p.spec_ref || ''}>{show(p.spec_ref)}</div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu label={`Actions for ${p.name}`} items={[{ key: 'edit', label: 'Edit equipment', icon: <Pencil />, onSelect: () => setProductForm({ open: true, editing: p }) }]} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={productPage.page} totalPages={productPage.totalPages} total={productPage.total} limit={PAGE_SIZE} onPage={productPage.setPage} disabled={productPage.loading} noun="items" />
        </Card>
      )}

      {/* ── ZONES ── */}
      {section === 'zones' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Zone</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-center">Regions</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={zonePage.loading}
                error={zonePage.error}
                empty={zonePage.rows.length === 0}
                colSpan={cols(3)}
                onRetry={zonePage.refresh}
                emptyText={dZoneSearch ? `No zones match “${dZoneSearch}”.` : 'No zones yet. Add a zone before adding its regions.'}
              />
              {!zonePage.loading &&
                zonePage.rows.map((z) => (
                  <TableRow key={z.id}>
                    <TableCell className="font-bold text-[#14213D]">{show(z.name)} Zone</TableCell>
                    <TableCell className="font-mono font-bold uppercase text-[#0F5E63]">{show(z.code)}</TableCell>
                    <TableCell className="text-center font-mono">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="font-mono"
                        onClick={() => {
                          setRegionZone(z.id);
                          setSection('regions');
                        }}
                      >
                        {regionCountByZone.get(z.id) ?? 0}
                      </Button>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu
                          label={`Actions for ${z.name} zone`}
                          items={[
                            { key: 'region', label: 'Add a region here', icon: <Plus />, onSelect: () => setTerritoryForm({ open: true, kind: 'region', editing: null, zoneId: z.id }) },
                            { key: 'edit', label: 'Edit zone', icon: <Pencil />, onSelect: () => setTerritoryForm({ open: true, kind: 'zone', editing: z }) },
                            { key: 'delete', label: 'Delete zone…', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete({ kind: 'zone', id: z.id, name: z.name }) },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={zonePage.page} totalPages={zonePage.totalPages} total={zonePage.total} limit={PAGE_SIZE} onPage={zonePage.setPage} disabled={zonePage.loading} noun="zones" />
        </Card>
      )}

      {/* ── REGIONS ── */}
      {section === 'regions' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Zone</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={regionPage.loading}
                error={regionPage.error}
                empty={regionPage.rows.length === 0}
                colSpan={cols(2)}
                onRetry={regionPage.refresh}
                emptyText={dRegionSearch || regionZone ? 'No regions match these filters.' : 'No regions yet. Add one inside a zone.'}
              />
              {!regionPage.loading &&
                regionPage.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-bold text-[#14213D]">{r.name}</TableCell>
                    <TableCell className="text-[#14213D]">{r.zone_name ? `${r.zone_name} Zone` : <span className="text-[#6B7280]">No zone</span>}</TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu
                          label={`Actions for region ${r.name}`}
                          items={[
                            { key: 'edit', label: 'Edit region', icon: <Pencil />, onSelect: () => setTerritoryForm({ open: true, kind: 'region', editing: r }) },
                            { key: 'delete', label: 'Delete region…', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete({ kind: 'region', id: r.id, name: r.name }) },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={regionPage.page} totalPages={regionPage.totalPages} total={regionPage.total} limit={PAGE_SIZE} onPage={regionPage.setPage} disabled={regionPage.loading} noun="regions" />
        </Card>
      )}

      {/* ── CLIENT CATEGORIES ── */}
      {section === 'categories' && (
        <Card padding="none" className={LIST_CARD}>
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Shown in pickers as</TableHead>
                <TableHead className="text-center">Customers</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {actionsHead}
              </TableRow>
            </TableHeader>
            <TableBody>
              <ListState
                loading={catPage.loading}
                error={catPage.error}
                empty={catPage.rows.length === 0}
                colSpan={cols(4)}
                onRetry={catPage.refresh}
                emptyText={dCatSearch ? `No client categories match “${dCatSearch}”.` : 'No client categories yet. Add one so new customers can be filed under it.'}
              />
              {!catPage.loading &&
                catPage.rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-bold text-[#14213D]">{c.name}</TableCell>
                    <TableCell className="text-[#4A5568]">
                      <div className="max-w-[320px] truncate" title={c.label || ''}>{c.label || '—'}</div>
                    </TableCell>
                    <TableCell className="text-center font-mono">{c.customer_count ?? 0}</TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <Badge variant={c.is_active ? 'success' : 'outline'} size="sm">
                        {c.is_active ? 'Active' : 'Hidden'}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-right">
                        <RowMenu
                          label={`Actions for ${c.name}`}
                          items={[
                            { key: 'edit', label: 'Edit category', icon: <Pencil />, onSelect: () => setCatForm({ open: true, editing: c }) },
                            {
                              key: 'active',
                              label: c.is_active ? 'Hide from pickers' : 'Show in pickers again',
                              icon: c.is_active ? <Eye /> : <Check />,
                              onSelect: () => setCategoryActive(c, !c.is_active),
                            },
                            {
                              key: 'delete',
                              label: c.customer_count ? 'Delete (in use — hide it instead)' : 'Delete category…',
                              icon: <Trash2 />,
                              danger: true,
                              disabled: !!c.customer_count,
                              onSelect: () => setConfirmDelete({ kind: 'client category', id: c.id, name: c.name }),
                            },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={catPage.page} totalPages={catPage.totalPages} total={catPage.total} limit={PAGE_SIZE} onPage={catPage.setPage} disabled={catPage.loading} noun="categories" />
        </Card>
      )}

      {/* ── ROLES & ACCESS ── */}
      {section === 'permissions' && (
        <div className="space-y-6">
          <Card padding="md">
            <SectionHeader
              title={profile.title}
              icon={<KeyRound className="h-4 w-4" />}
              badge={
                <Badge variant={SCOPE[profile.territorialScope].variant} size="sm">
                  {SCOPE[profile.territorialScope].label}
                </Badge>
              }
              description={profile.department}
              className="border-b-0 pb-0"
            />
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#4A5568]">{profile.scopeSummary}</p>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card padding="none" className="overflow-hidden">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>
                    <Power className="h-4 w-4 text-[#0F5E63]" /> Modules
                  </CardTitle>
                  <CardDescription>Switch a module off to hide it from everyone in this role. It stops working for them at once.</CardDescription>
                </div>
                {!canSwitchModules && (
                  <Badge variant="outline" size="sm" className="shrink-0 gap-1">
                    <Eye className="h-3 w-3" /> View only
                  </Badge>
                )}
              </CardHeader>
              <div className="divide-y divide-[#ECE9E2]">
                {!access && <div className="p-4 text-xs text-[#881337]">Module access didn’t load. Reload the page to try again.</div>}
                {(access?.modules || []).map((m) => {
                  const reach = roleCanReach(selectedRole, m.paths[0]);
                  const locked = isLockedModule(selectedRole, m.key);
                  const block = access?.blocks.find((b) => b.role === selectedRole && b.module === m.key);
                  const on = reach && !block;
                  const busy = switching === `${selectedRole}:${m.key}`;
                  return (
                    <div key={m.key} className={`flex items-start justify-between gap-4 px-5 py-3 ${reach ? '' : 'bg-[#FBFAF7]'}`}>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-bold text-[#14213D]">{m.label}</span>
                          {!reach ? (
                            <Badge variant="outline" size="sm">Not in this role</Badge>
                          ) : locked ? (
                            <Badge variant="info" size="sm">Always on</Badge>
                          ) : block ? (
                            <Badge variant="danger" size="sm">Off</Badge>
                          ) : (
                            <Badge variant="success" size="sm">On</Badge>
                          )}
                        </div>
                        {block && (
                          <p className="text-xs text-[#4A5568]">
                            Off since {fmtStamp(block.blocked_at)}
                            {block.blocked_by_name ? `, by ${block.blocked_by_name}` : ''}. Reason: {block.reason}
                          </p>
                        )}
                        {locked && <p className="text-xs text-[#4A5568]">The administrator always keeps this panel, so no one gets locked out.</p>}
                      </div>
                      {reach && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          disabled={!canSwitchModules || locked || busy}
                          title={!canSwitchModules ? 'Only management and the System Administrator can switch modules' : undefined}
                          aria-label={`${m.label} for ${profile.title}: ${on ? 'on' : 'off'}`}
                          onClick={() => switchModule(selectedRole, m.key, m.label, !on)}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30 max-sm:before:absolute max-sm:before:-inset-2.5 ${on ? 'bg-[#0F5E63]' : 'bg-[#C9C4B8]'} ${!canSwitchModules || locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-5' : 'translate-x-0'}`}
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>
                    <ListChecks className="h-4 w-4 text-[#0F5E63]" /> Approvals & sign-offs
                  </CardTitle>
                  <CardDescription>Set by the access policy in code, so they can’t be changed here.</CardDescription>
                </div>
                <Badge variant="outline" size="sm" className="shrink-0 gap-1">
                  <Lock className="h-3 w-3" /> Fixed
                </Badge>
              </CardHeader>
              <div className="divide-y divide-[#ECE9E2]">
                {(Object.keys(CAPABILITY_LABELS) as Array<keyof RolePermissionProfile['capabilities']>).map((capKey) => {
                  const allowed = profile.capabilities[capKey];
                  const info = CAPABILITY_LABELS[capKey];
                  return (
                    <div key={capKey} className={`flex items-start justify-between gap-4 px-5 py-3 ${allowed ? '' : 'bg-[#FBFAF7]'}`}>
                      <div className="min-w-0 space-y-0.5">
                        <span className={`text-xs font-bold ${allowed ? 'text-[#14213D]' : 'text-[#4A5568]'}`}>{info.label}</span>
                        <p className="text-xs text-[#4A5568]">{info.desc}</p>
                      </div>
                      <Badge variant={allowed ? 'success' : 'outline'} size="sm" className="shrink-0">
                        {allowed ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div>
            <Button variant="ghost" size="sm" aria-expanded={compareOpen} onClick={() => setCompareOpen((v) => !v)}>
              {compareOpen ? 'Hide the role comparison' : 'Compare all roles side by side'}
            </Button>
          </div>
          {compareOpen && (
            <Card padding="none" className={LIST_CARD}>
              <Table className="table-fixed !min-w-0 max-sm:[&_tbody_tr]:!grid-cols-2 [&_td]:px-2.5 [&_th]:h-auto [&_th]:px-2.5 [&_th]:py-2.5 [&_th]:text-[10px] [&_th]:leading-tight">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Role</TableHead>
                    {MATRIX_COLUMNS.map((c) => (
                      <TableHead key={c.key} className="text-center">
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {USER_ROLES.map((r) => {
                    const prof = ROLE_PROFILES[r];
                    return (
                      <TableRow key={r} className={r === selectedRole ? 'bg-[#E3EFEE]/40' : undefined}>
                        <TableCell className="font-bold text-[#14213D]">
                          <div className="truncate" title={prof.title}>{prof.title}</div>
                          <div className="text-[11px] font-normal text-[#4A5568]">{SCOPE[prof.territorialScope].label}</div>
                        </TableCell>
                        {MATRIX_COLUMNS.map((c) => (
                          <TableCell key={c.key} className="text-center">
                            {prof.capabilities[c.key] ? <Check className="inline h-4 w-4 text-[#0F5E63]" aria-label="Yes" /> : <span className="text-[#C9C4B8]" aria-label="No">–</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {isAdmin && (
        <>
          <UserFormModal
            isOpen={userForm.open}
            onClose={() => setUserForm({ open: false, editing: null })}
            editing={userForm.editing}
            users={usersList}
            zones={zonesList}
            regions={regionsList}
            departments={departmentsList}
            currentUserId={user?.id}
            onSaved={async (saved, temporaryPassword) => {
              const wasEdit = !!userForm.editing;
              setUserForm({ open: false, editing: null });
              await reloadUsers();
              if (temporaryPassword) setTempPassword({ email: saved.email, password: temporaryPassword });
              setNotice(`${saved.full_name} ${wasEdit ? 'updated' : 'added'}.`);
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
                  <p>They’ll be signed out and can’t sign in until you re-activate them. Their records, approvals and history stay as they are.</p>
                  <p>Move anyone who reports to them to another manager first.</p>
                </>
              ) : (
                <p>They’ll be able to sign in again with their existing password.</p>
              )
            }
            onConfirm={async () => {
              if (confirmUser) await setUserActive(confirmUser, !confirmUser.is_active);
            }}
          />
          <ConfirmModal
            isOpen={!!confirmReset}
            onClose={() => setConfirmReset(null)}
            title={`Reset ${confirmReset?.full_name}’s password?`}
            confirmLabel="Reset password"
            message={
              <>
                <p>Their current password stops working straight away. You’ll get a one-time password to hand over.</p>
                <p>Anyone already signed in as them stays signed in until that session ends.</p>
              </>
            }
            onConfirm={async () => {
              if (!confirmReset) return;
              const res = await api.post<{ email: string; temporary_password: string }>(`/users/${confirmReset.id}/reset-password`);
              setTempPassword({ email: res.email, password: res.temporary_password, title: 'Password reset' });
              setNotice(`${confirmReset.full_name}’s password was reset.`);
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
            zones={zonesList}
            defaultZoneId={territoryForm.zoneId}
            onSaved={async () => {
              const kind = territoryForm.kind;
              setTerritoryForm((f) => ({ ...f, open: false, editing: null }));
              await Promise.all([reloadMasters(), usersPage.refresh()]);
              setNotice(`${kind === 'zone' ? 'Zone' : 'Region'} saved.`);
            }}
          />
          <DepartmentFormModal
            isOpen={deptForm.open}
            onClose={() => setDeptForm({ open: false, editing: null })}
            editing={deptForm.editing}
            users={usersList}
            onSaved={async () => {
              const wasEdit = !!deptForm.editing;
              setDeptForm({ open: false, editing: null });
              await reloadMasters();
              setNotice(`Department ${wasEdit ? 'updated' : 'added'}.`);
            }}
          />
          <ClientCategoryFormModal
            isOpen={catForm.open}
            onClose={() => setCatForm({ open: false, editing: null })}
            editing={catForm.editing}
            onSaved={async (saved) => {
              const wasEdit = !!catForm.editing;
              setCatForm({ open: false, editing: null });
              await reloadMasters();
              setNotice(`${saved.name} ${wasEdit ? 'updated' : 'added'}.`);
            }}
          />
          <BulkInviteModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} users={usersList} regions={regionsList} onInvited={reloadUsers} />
          <ConfirmModal
            isOpen={!!confirmDelete}
            onClose={() => setConfirmDelete(null)}
            danger
            title={`Delete the ${confirmDelete?.name} ${confirmDelete?.kind}?`}
            confirmLabel={`Delete ${confirmDelete?.kind}`}
            message={<p>This can’t be undone. If people or records still use this {confirmDelete?.kind}, it won’t be deleted and you’ll see why.</p>}
            onConfirm={async () => {
              if (!confirmDelete) return;
              const path = {
                department: '/masters/departments',
                zone: '/masters/zones',
                region: '/masters/regions',
                'client category': '/masters/client-categories',
              }[confirmDelete.kind];
              await api.delete(`${path}/${confirmDelete.id}`);
              await reloadMasters();
              setNotice(`${confirmDelete.name} deleted.`);
            }}
          />
        </>
      )}
      {canSwitchModules && (
        <ModuleSwitchOffModal
          target={switchOff}
          onClose={() => setSwitchOff(null)}
          onDone={async () => {
            const t = switchOff;
            setSwitchOff(null);
            await reloadAccess();
            if (t) setNotice(`${t.label} is off for ${ROLE_PROFILES[t.role].title}.`);
          }}
        />
      )}
    </PageContainer>
  );
}
