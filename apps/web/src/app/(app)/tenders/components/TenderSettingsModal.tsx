'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Button,
  Badge,
  Input,
  Select,
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
  ScrollStrip,
} from '@/components/ui';
import {
  Settings,
  Plus,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Shield,
  Layers,
  MapPin,
  Building2,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { validateHttpUrl } from '@/lib/safe-url';

/** Roles accepted by the write endpoints (tenders.controller.ts @Roles); everyone else sees the masters read-only. */
const MASTER_WRITE_ROLES = ['management', 'admin']; // POST categories / portals / loss-reasons / approval-rules, PATCH settings
const COMPETITOR_WRITE_ROLES = ['management', 'tender_team', 'admin']; // POST competitors

type SettingsTab = 'categories' | 'portals' | 'loss_reasons' | 'approval_rules' | 'regions' | 'general';

/** The editable fields of UpdateTenderSettingsDto (tender_settings row). */
interface GeneralSettingsForm {
  upcoming_days: string;
  approaching_days: string;
  approval_sla_hours: string;
  result_followup_days: string;
  allow_self_approval: boolean;
  require_won_value: boolean;
}
const DEFAULT_GENERAL: GeneralSettingsForm = {
  upcoming_days: '7',
  approaching_days: '3',
  approval_sla_hours: '24',
  result_followup_days: '15',
  allow_self_approval: false,
  require_won_value: true,
};
const asList = (value: unknown): any[] => (Array.isArray(value) ? value : []);

interface TenderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
}

export function TenderSettingsModal({
  isOpen,
  onClose,
  currentUser,
}: TenderSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('categories');

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Result of the last save on the open tab (inline, never a browser alert). */
  const [notice, setNotice] = useState<{ tab: SettingsTab; type: 'success' | 'danger'; text: string } | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const role = currentUser?.role;
  const canEditMasters = MASTER_WRITE_ROLES.includes(role);
  const canAddCompetitor = COMPETITOR_WRITE_ROLES.includes(role);

  // Categories state
  const [categories, setCategories] = useState<any[]>([]);
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatRequiresPq, setNewCatRequiresPq] = useState(false);

  // Portals state
  const [portals, setPortals] = useState<any[]>([]);
  const [newPortalCode, setNewPortalCode] = useState('');
  const [newPortalName, setNewPortalName] = useState('');
  const [newPortalUrl, setNewPortalUrl] = useState('');

  // Competitors state
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [newCompName, setNewCompName] = useState('');

  // Loss reasons state
  const [lossReasons, setLossReasons] = useState<any[]>([]);
  const [newLossCode, setNewLossCode] = useState('');
  const [newLossLabel, setNewLossLabel] = useState('');

  // Approval rules state (CreateApprovalRuleDto: category_id UUID, value band, approver_role, level)
  const [approvalRules, setApprovalRules] = useState<any[]>([]);
  const [newRuleCategoryId, setNewRuleCategoryId] = useState('');
  const [newRuleMinVal, setNewRuleMinVal] = useState('');
  const [newRuleMaxVal, setNewRuleMaxVal] = useState('');
  const [newRuleApproverRole, setNewRuleApproverRole] = useState('management');
  const [newRuleLevel, setNewRuleLevel] = useState('1');

  // General settings state (tender_settings; the deadline reminder job reads upcoming_days / approaching_days)
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsForm>(DEFAULT_GENERAL);
  const [settingsAvailable, setSettingsAvailable] = useState(false);
  const [rulesAvailable, setRulesAvailable] = useState(false);
  const [portalUrlError, setPortalUrlError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // api.get returns the parsed body: the masters are arrays, settings is the tender_settings row.
    const [catRes, portalRes, compRes, lossRes, rulesRes, settRes] = await Promise.allSettled([
      api.get<any[]>('/tenders/categories'),
      api.get<any[]>('/tenders/portals'),
      api.get<any[]>('/tenders/competitors'),
      api.get<any[]>('/tenders/loss-reasons'),
      api.get<any[]>('/tenders/approval-rules'),
      api.get<any>('/tenders/settings'),
    ]);

    if (catRes.status === 'fulfilled') setCategories(asList(catRes.value));
    if (portalRes.status === 'fulfilled') setPortals(asList(portalRes.value));
    if (compRes.status === 'fulfilled') setCompetitors(asList(compRes.value));
    if (lossRes.status === 'fulfilled') setLossReasons(asList(lossRes.value));
    setRulesAvailable(rulesRes.status === 'fulfilled');
    if (rulesRes.status === 'fulfilled') setApprovalRules(asList(rulesRes.value));
    setSettingsAvailable(settRes.status === 'fulfilled' && Boolean(settRes.value));
    if (settRes.status === 'fulfilled' && settRes.value) {
      const v = settRes.value;
      const num = (x: unknown, fallback: string) => (x === null || x === undefined ? fallback : String(x));
      setGeneralSettings({
        upcoming_days: num(v.upcoming_days, DEFAULT_GENERAL.upcoming_days),
        approaching_days: num(v.approaching_days, DEFAULT_GENERAL.approaching_days),
        approval_sla_hours: num(v.approval_sla_hours, DEFAULT_GENERAL.approval_sla_hours),
        result_followup_days: num(v.result_followup_days, DEFAULT_GENERAL.result_followup_days),
        allow_self_approval: Boolean(v.allow_self_approval),
        require_won_value: v.require_won_value === undefined ? DEFAULT_GENERAL.require_won_value : Boolean(v.require_won_value),
      });
    }

    // A 403 only means this role cannot read that master (settings / approval rules are not open to Sales).
    const failures = [catRes, portalRes, compRes, lossRes, rulesRes, settRes].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected' && (r.reason as any)?.status !== 403,
    );
    if (failures.length > 0) {
      setLoadError((failures[0].reason as any)?.message || 'Some configuration could not be loaded.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setNotice(null);
      loadData();
    }
  }, [isOpen, loadData]);

  /** Runs one save with a double-submit guard; errors (ApiError.message) are shown inline on the tab. */
  const runSave = async (section: string, tab: SettingsTab, action: () => Promise<void>, successText: string) => {
    if (savingSection) return;
    setSavingSection(section);
    setNotice(null);
    try {
      await action();
      setNotice({ tab, type: 'success', text: successText });
      await loadData();
    } catch (err: any) {
      setNotice({ tab, type: 'danger', text: err?.message || 'Could not save the change.' });
    } finally {
      setSavingSection(null);
    }
  };

  // Handlers
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMasters || !newCatCode.trim() || !newCatName.trim()) return;
    await runSave(
      'category',
      'categories',
      async () => {
        await api.post('/tenders/categories', {
          code: newCatCode.trim().toLowerCase(),
          name: newCatName.trim(),
          requires_pq: newCatRequiresPq,
        });
        setNewCatCode('');
        setNewCatName('');
        setNewCatRequiresPq(false);
      },
      'Category added.',
    );
  };

  const handleAddPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMasters || !newPortalCode.trim() || !newPortalName.trim()) return;
    const urlError = validateHttpUrl(newPortalUrl, 'Base URL');
    setPortalUrlError(urlError);
    if (urlError) return;
    await runSave(
      'portal',
      'portals',
      async () => {
        await api.post('/tenders/portals', {
          code: newPortalCode.trim().toLowerCase(),
          name: newPortalName.trim(),
          base_url: newPortalUrl.trim() || undefined,
        });
        setNewPortalCode('');
        setNewPortalName('');
        setNewPortalUrl('');
      },
      'Portal registered.',
    );
  };

  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddCompetitor || !newCompName.trim()) return;
    await runSave(
      'competitor',
      'portals',
      async () => {
        await api.post('/tenders/competitors', { name: newCompName.trim() });
        setNewCompName('');
      },
      'Competitor added.',
    );
  };

  const handleAddLossReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMasters || !newLossCode.trim() || !newLossLabel.trim()) return;
    await runSave(
      'loss_reason',
      'loss_reasons',
      async () => {
        // The API stores loss-reason codes upper-case (they are matched case-insensitively on a lost result).
        await api.post('/tenders/loss-reasons', {
          code: newLossCode.trim().toUpperCase(),
          label: newLossLabel.trim(),
        });
        setNewLossCode('');
        setNewLossLabel('');
      },
      'Loss reason added.',
    );
  };

  const handleAddApprovalRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMasters) return;
    const min = newRuleMinVal.trim() === '' ? 0 : Number(newRuleMinVal);
    const max = newRuleMaxVal.trim() === '' ? undefined : Number(newRuleMaxVal);
    const level = Number(newRuleLevel);
    if (!Number.isFinite(min) || min < 0) {
      setNotice({ tab: 'approval_rules', type: 'danger', text: 'Min value cannot be negative.' });
      return;
    }
    if (max !== undefined && (!Number.isFinite(max) || max <= min)) {
      setNotice({ tab: 'approval_rules', type: 'danger', text: 'Max value must be greater than the min value (or left empty).' });
      return;
    }
    if (!Number.isInteger(level) || level < 1) {
      setNotice({ tab: 'approval_rules', type: 'danger', text: 'Approval level must be a whole number of 1 or more.' });
      return;
    }
    await runSave(
      'approval_rule',
      'approval_rules',
      async () => {
        await api.post('/tenders/approval-rules', {
          category_id: newRuleCategoryId || undefined, // empty = all categories
          min_value: min,
          max_value: max,
          approver_role: newRuleApproverRole,
          level,
        });
        setNewRuleCategoryId('');
        setNewRuleMinVal('');
        setNewRuleMaxVal('');
        setNewRuleLevel('1');
      },
      'Approval rule saved.',
    );
  };

  const handleSaveGeneral = async () => {
    if (!canEditMasters) return;
    const fields: [keyof GeneralSettingsForm, string, number][] = [
      ['upcoming_days', 'Upcoming deadline window', 1],
      ['approaching_days', 'Urgent deadline window', 1],
      ['approval_sla_hours', 'Approval SLA', 1],
      ['result_followup_days', 'Result follow-up', 1],
    ];
    const values: Record<string, number> = {};
    for (const [key, label, min] of fields) {
      const n = Number(generalSettings[key]);
      if (String(generalSettings[key]).trim() === '' || !Number.isInteger(n) || n < min) {
        setNotice({ tab: 'general', type: 'danger', text: `${label} must be a whole number of ${min} or more.` });
        return;
      }
      values[key] = n;
    }
    if (values.approaching_days > values.upcoming_days) {
      setNotice({ tab: 'general', type: 'danger', text: 'The urgent window cannot be longer than the upcoming window.' });
      return;
    }
    await runSave(
      'general',
      'general',
      async () => {
        // Only UpdateTenderSettingsDto fields: anything else is stripped by the API's validation pipe.
        await api.patch('/tenders/settings', {
          upcoming_days: values.upcoming_days,
          approaching_days: values.approaching_days,
          approval_sla_hours: values.approval_sla_hours,
          result_followup_days: values.result_followup_days,
          allow_self_approval: generalSettings.allow_self_approval,
          require_won_value: generalSettings.require_won_value,
        });
      },
      'Tender SLA and policy settings updated.',
    );
  };

  const tabNotice =
    notice && notice.tab === activeTab ? (
      <InfoCallout
        variant={notice.type}
        title={notice.type === 'success' ? 'Saved' : 'Not saved'}
        onClose={() => setNotice(null)}
      >
        {notice.text}
      </InfoCallout>
    ) : null;
  const readOnlyNote = (
    <InfoCallout variant="neutral" title="Read only">
      Only Management and Admin can change tender masters and policies.
    </InfoCallout>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Tender Master Configuration & Governance"
      description="Administer categories, approval thresholds, external portals, competitors, and SLA rules."
      maxWidth="4xl"
    >
      <div className="space-y-6 text-xs">
        {/* Subtabs */}
        <ScrollStrip role="tablist" aria-label="Settings sections" activeKey={activeTab} wrapperClassName="border-b border-[#DCD8CE]" className="items-center gap-1.5 pb-2">
          {[
            { id: 'categories', label: 'Categories' },
            { id: 'portals', label: 'Portals & Competitors' },
            { id: 'loss_reasons', label: 'Loss Reasons' },
            { id: 'approval_rules', label: 'Approval Rules' },
            { id: 'general', label: 'SLA & Policy' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#0F5E63] text-white shadow-sm'
                  : 'text-[#4A5568] hover:bg-[#FBFAF7] hover:text-[#14213D]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </ScrollStrip>

        {loading && <p className="text-[11px] text-[#6B7280]">Loading configuration…</p>}
        {loadError && (
          <InfoCallout variant="danger" title="Could not load everything" onClose={() => setLoadError(null)}>
            {loadError}
          </InfoCallout>
        )}

        {/* Tab 1: Categories */}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">
                  Tender Categories (PQ, General, MHA)
                </h4>
                <p className="text-[11px] text-[#4A5568]">
                  Controls category-specific checklists, qualification rules, and category KPI metrics.
                </p>
              </div>
            </div>

            {tabNotice}
            {canEditMasters ? (
              <form
                onSubmit={handleAddCategory}
                className="flex flex-wrap items-end gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
              >
                <div className="flex-1 min-w-[120px]">
                  <Input label="Code" placeholder="e.g. mha" value={newCatCode} onChange={(e) => setNewCatCode(e.target.value)} required />
                </div>
                <div className="flex-[2] min-w-[180px]">
                  <Input
                    label="Display Label"
                    placeholder="e.g. Ministry of Home Affairs"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    required
                  />
                </div>
                <div className="pb-2.5">
                  <Checkbox
                    id="requires_pq"
                    checked={newCatRequiresPq}
                    onChange={(e) => setNewCatRequiresPq(e.target.checked)}
                    label="Requires PQ"
                  />
                </div>
                <Button size="sm" variant="primary" type="submit" isLoading={savingSection === 'category'}>
                  Add Category
                </Button>
              </form>
            ) : (
              readOnlyNote
            )}

            <Table>
              <TableHeader>
                <TableRow className="bg-[#FBFAF7]">
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Requires PQ</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-semibold text-[#0F5E63]">{c.code}</TableCell>
                    <TableCell className="font-medium text-[#14213D]">{c.name}</TableCell>
                    <TableCell className="text-[#4A5568]">{c.description || '—'}</TableCell>
                    <TableCell>
                      {c.requires_pq ? (
                        <Badge variant="cyber" size="sm">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-[#6B7280]">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.is_active === false ? 'default' : 'success'} size="sm">
                        {c.is_active === false ? 'Inactive' : 'Active'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Tab 2: Portals & Competitors */}
        {activeTab === 'portals' && (
          <div className="space-y-4">
            {tabNotice}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Portals */}
              <div className="space-y-3">
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Procurement Portals</h4>
                {canEditMasters ? (
                  <form onSubmit={handleAddPortal} className="space-y-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
                    <Input
                      placeholder="Code (e.g. gem, cppp)"
                      aria-label="Portal code"
                      value={newPortalCode}
                      onChange={(e) => setNewPortalCode(e.target.value)}
                      required
                    />
                    <Input
                      placeholder="Portal Name (e.g. GeM Portal)"
                      aria-label="Portal name"
                      value={newPortalName}
                      onChange={(e) => setNewPortalName(e.target.value)}
                      required
                    />
                    <Input
                      type="url"
                      placeholder="Base URL (e.g. https://mkp.gem.gov.in)"
                      aria-label="Portal base URL"
                      value={newPortalUrl}
                      onChange={(e) => {
                        setNewPortalUrl(e.target.value);
                        setPortalUrlError(null);
                      }}
                      error={portalUrlError || undefined}
                    />
                    <Button size="xs" variant="primary" type="submit" fullWidth isLoading={savingSection === 'portal'}>
                      Register Portal
                    </Button>
                  </form>
                ) : (
                  readOnlyNote
                )}

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {portals.map((p) => (
                    <div
                      key={p.id}
                      className="p-2 rounded-lg bg-white border border-[#DCD8CE] flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[#14213D]">{p.name}</span>
                        <span className="block font-mono text-[10px] text-[#4A5568]">{p.code}</span>
                        {p.base_url && <span className="block truncate font-mono text-[10px] text-[#6B7280]">{p.base_url}</span>}
                      </div>
                      <Badge variant="outline" size="sm">
                        Active
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Competitors */}
              <div className="space-y-3">
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Competitors Master</h4>
                {canAddCompetitor ? (
                  <form onSubmit={handleAddCompetitor} className="flex gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
                    <Input
                      placeholder="Competitor Name (e.g. Alpha Tech Ltd)"
                      aria-label="Competitor name"
                      value={newCompName}
                      onChange={(e) => setNewCompName(e.target.value)}
                      required
                    />
                    <Button size="sm" variant="primary" type="submit" isLoading={savingSection === 'competitor'}>
                      Add
                    </Button>
                  </form>
                ) : (
                  <InfoCallout variant="neutral" title="Read only">
                    Management, the Tender Team and Admin can add competitors.
                  </InfoCallout>
                )}

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {competitors.map((comp) => (
                    <div
                      key={comp.id}
                      className="p-2 rounded-lg bg-white border border-[#DCD8CE] flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-[#14213D]">{comp.name}</span>
                      <Badge variant="outline" size="sm">
                        Master
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Loss Reasons */}
        {activeTab === 'loss_reasons' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-serif font-bold text-sm text-[#14213D]">Configurable Win/Loss Reason Taxonomy</h4>
              <p className="text-[11px] text-[#4A5568]">Enforces root cause analytics when tenders are lost or disqualified.</p>
            </div>

            {tabNotice}
            {canEditMasters ? (
              <form
                onSubmit={handleAddLossReason}
                className="flex flex-wrap items-end gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
              >
                <div className="flex-1 min-w-[140px]">
                  <Input
                    label="Code"
                    placeholder="e.g. L1_PRICE_GAP"
                    className="font-mono"
                    value={newLossCode}
                    onChange={(e) => setNewLossCode(e.target.value)}
                    required
                  />
                </div>
                <div className="flex-[2] min-w-[200px]">
                  <Input
                    label="Description Label"
                    placeholder="e.g. Uncompetitive L1 Pricing"
                    value={newLossLabel}
                    onChange={(e) => setNewLossLabel(e.target.value)}
                    required
                  />
                </div>
                <Button size="sm" variant="primary" type="submit" isLoading={savingSection === 'loss_reason'}>
                  Add Reason
                </Button>
              </form>
            ) : (
              readOnlyNote
            )}

            <Table>
              <TableHeader>
                <TableRow className="bg-[#FBFAF7]">
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lossReasons.map((lr) => (
                  <TableRow key={lr.id || lr.code}>
                    <TableCell className="font-mono text-[#9A3412] font-semibold">{lr.code}</TableCell>
                    <TableCell className="font-medium text-[#14213D]">{lr.label}</TableCell>
                    <TableCell>
                      <Badge variant={lr.active === false ? 'default' : 'success'} size="sm">
                        {lr.active === false ? 'Inactive' : 'Active'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Tab 4: Approval Rules */}
        {activeTab === 'approval_rules' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-serif font-bold text-sm text-[#14213D]">Multi-Level Approval Rules & Value Thresholds</h4>
              <p className="text-[11px] text-[#4A5568]">
                Route tender submissions to Regional Managers, Tender Heads, or Management based on value bands.
              </p>
            </div>

            {tabNotice}
            {canEditMasters ? (
              <form
                onSubmit={handleAddApprovalRule}
                className="grid grid-cols-1 sm:grid-cols-5 gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
              >
                <Select
                  label="Category"
                  value={newRuleCategoryId}
                  onChange={(e) => setNewRuleCategoryId(e.target.value)}
                  options={[
                    { value: '', label: 'All categories' },
                    ...categories.map((c) => ({ value: c.id, label: c.name || c.code })),
                  ]}
                />
                <Input
                  label="Min Value (₹)"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newRuleMinVal}
                  onChange={(e) => setNewRuleMinVal(e.target.value)}
                />
                <Input
                  label="Max Value (₹)"
                  type="number"
                  min="0"
                  placeholder="Empty = unlimited"
                  value={newRuleMaxVal}
                  onChange={(e) => setNewRuleMaxVal(e.target.value)}
                />
                <Select
                  label="Approver Role"
                  value={newRuleApproverRole}
                  onChange={(e) => setNewRuleApproverRole(e.target.value)}
                  options={[
                    { value: 'management', label: 'Management / Director' },
                    { value: 'admin', label: 'Super Admin' },
                  ]}
                />
                <Input
                  label="Level"
                  type="number"
                  min="1"
                  step="1"
                  value={newRuleLevel}
                  onChange={(e) => setNewRuleLevel(e.target.value)}
                  required
                />
                <div className="sm:col-span-5 flex justify-end">
                  <Button size="xs" variant="primary" type="submit" isLoading={savingSection === 'approval_rule'}>
                    Save Approval Rule
                  </Button>
                </div>
              </form>
            ) : (
              readOnlyNote
            )}

            {!rulesAvailable && !loading ? (
              <p className="text-[11px] text-[#6B7280]">Approval rules are visible to Management, Regional Managers, the Tender Team and Admin.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#FBFAF7]">
                    <TableHead>Category</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Value Band</TableHead>
                    <TableHead>Approver</TableHead>
                    <TableHead>Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvalRules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-[#4A5568]">
                        No approval rules configured: internal review goes to Management / Admin.
                      </TableCell>
                    </TableRow>
                  ) : (
                    approvalRules.map((r, i) => (
                      <TableRow key={r.id || i}>
                        <TableCell className="font-semibold text-[#0F5E63]">{r.category_name || 'All Categories'}</TableCell>
                        <TableCell className="text-[#4A5568]">{r.zone_name || 'All zones'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          ₹{Number(r.min_value || 0).toLocaleString('en-IN')} –{' '}
                          {r.max_value !== null && r.max_value !== undefined && r.max_value !== ''
                            ? `₹${Number(r.max_value).toLocaleString('en-IN')}`
                            : 'Unlimited'}
                        </TableCell>
                        <TableCell className="font-medium text-[#14213D]">
                          <span className="capitalize">{String(r.approver_role || '').replace(/_/g, ' ') || '—'}</span>
                          {r.approver_name && <span className="block text-[11px] text-[#4A5568]">{r.approver_name}</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          Level {r.level || 1}
                          {r.is_active === false && (
                            <Badge variant="default" size="sm" className="ml-1.5">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* Tab 5: SLA & General (tender_settings) */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-serif font-bold text-sm text-[#14213D]">Governance SLAs & Automation Timers</h4>
              <p className="text-[11px] text-[#4A5568]">
                Configure deadline proximity alert windows and approval turnaround escalation.
              </p>
            </div>

            {tabNotice}
            {!settingsAvailable && !loading ? (
              <p className="text-[11px] text-[#6B7280]">These policies are visible to Management, Regional Managers, the Tender Team and Admin.</p>
            ) : (
              <>
                {!canEditMasters && readOnlyNote}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
                  <Input
                    label="Upcoming Deadline Window (Days)"
                    type="number"
                    min="1"
                    step="1"
                    value={generalSettings.upcoming_days}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, upcoming_days: e.target.value })}
                    helperText="Deadline reminders and the Deadline Centre flag bids closing within this many days."
                    disabled={!canEditMasters}
                  />
                  <Input
                    label="Urgent Deadline Window (Days)"
                    type="number"
                    min="1"
                    step="1"
                    value={generalSettings.approaching_days}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, approaching_days: e.target.value })}
                    helperText="Bids closing within this many days get the urgent reminder."
                    disabled={!canEditMasters}
                  />
                  <Input
                    label="Approval Turnaround SLA (Hours)"
                    type="number"
                    min="1"
                    step="1"
                    value={generalSettings.approval_sla_hours}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, approval_sla_hours: e.target.value })}
                    helperText="A tender waiting for internal approval longer than this is escalated."
                    disabled={!canEditMasters}
                  />
                  <Input
                    label="Result Follow-up (Days)"
                    type="number"
                    min="1"
                    step="1"
                    value={generalSettings.result_followup_days}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, result_followup_days: e.target.value })}
                    helperText="Days after submission before a missing result is followed up."
                    disabled={!canEditMasters}
                  />
                  <Checkbox
                    id="allow_self_approval"
                    checked={generalSettings.allow_self_approval}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, allow_self_approval: e.target.checked })}
                    label="Allow self-approval"
                    description="When off, the person who requested internal review cannot approve it."
                    disabled={!canEditMasters}
                  />
                  <Checkbox
                    id="require_won_value"
                    checked={generalSettings.require_won_value}
                    onChange={(e) => setGeneralSettings({ ...generalSettings, require_won_value: e.target.checked })}
                    label="Require a value on Won results"
                    description="A Won result must carry an awarded value greater than zero."
                    disabled={!canEditMasters}
                  />
                </div>

                {canEditMasters && (
                  <div className="flex justify-end pt-3">
                    <Button size="sm" variant="primary" onClick={handleSaveGeneral} isLoading={savingSection === 'general'}>
                      Update SLA Policies
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-[#ECE9E2]">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close Settings
          </Button>
        </div>
      </div>
    </Modal>
  );
}
