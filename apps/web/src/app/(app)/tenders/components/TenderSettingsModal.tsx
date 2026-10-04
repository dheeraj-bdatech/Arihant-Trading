'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Button,
  Badge,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
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
  const [activeTab, setActiveTab] = useState<
    'categories' | 'portals' | 'loss_reasons' | 'approval_rules' | 'regions' | 'general'
  >('categories');

  const [loading, setLoading] = useState(false);

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

  // Approval rules state
  const [approvalRules, setApprovalRules] = useState<any[]>([]);
  const [newRuleCategory, setNewRuleCategory] = useState('');
  const [newRuleMinVal, setNewRuleMinVal] = useState('');
  const [newRuleMaxVal, setNewRuleMaxVal] = useState('');
  const [newRuleApproverRole, setNewRuleApproverRole] = useState('management');

  // General settings state
  const [generalSettings, setGeneralSettings] = useState<any>({
    approval_sla_hours: 24,
    deadline_warning_days: 7,
    auto_escalation_hours: 24,
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [catRes, portalRes, compRes, lossRes, rulesRes, settRes] =
        await Promise.allSettled([
          api.get('/tenders/categories'),
          api.get('/tenders/portals'),
          api.get('/tenders/competitors'),
          api.get('/tenders/loss-reasons'),
          api.get('/tenders/approval-rules'),
          api.get('/tenders/settings'),
        ]);

      if (catRes.status === 'fulfilled') setCategories(catRes.value.data || []);
      if (portalRes.status === 'fulfilled') setPortals(portalRes.value.data || []);
      if (compRes.status === 'fulfilled') setCompetitors(compRes.value.data || []);
      if (lossRes.status === 'fulfilled') setLossReasons(lossRes.value.data || []);
      if (rulesRes.status === 'fulfilled') setApprovalRules(rulesRes.value.data || []);
      if (settRes.status === 'fulfilled' && settRes.value.data) {
        setGeneralSettings(settRes.value.data);
      }
    } catch (err) {
      console.error('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Handlers
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatCode || !newCatName) return;
    try {
      await api.post('/tenders/categories', {
        code: newCatCode.trim().toLowerCase(),
        name: newCatName.trim(),
        requires_pq: newCatRequiresPq,
      });
      setNewCatCode('');
      setNewCatName('');
      setNewCatRequiresPq(false);
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to create category.');
    }
  };

  const handleAddPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortalCode || !newPortalName) return;
    try {
      await api.post('/tenders/portals', {
        code: newPortalCode.trim().toLowerCase(),
        name: newPortalName.trim(),
        base_url: newPortalUrl.trim() || undefined,
      });
      setNewPortalCode('');
      setNewPortalName('');
      setNewPortalUrl('');
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to create portal.');
    }
  };

  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompName) return;
    try {
      await api.post('/tenders/competitors', {
        name: newCompName.trim(),
      });
      setNewCompName('');
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to add competitor.');
    }
  };

  const handleAddLossReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLossCode || !newLossLabel) return;
    try {
      await api.post('/tenders/loss-reasons', {
        code: newLossCode.trim().toLowerCase(),
        label: newLossLabel.trim(),
      });
      setNewLossCode('');
      setNewLossLabel('');
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to create loss reason.');
    }
  };

  const handleAddApprovalRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/tenders/approval-rules', {
        category: newRuleCategory || undefined,
        min_value: newRuleMinVal ? Number(newRuleMinVal) : 0,
        max_value: newRuleMaxVal ? Number(newRuleMaxVal) : undefined,
        approver_role: newRuleApproverRole,
        approval_order: 1,
      });
      setNewRuleCategory('');
      setNewRuleMinVal('');
      setNewRuleMaxVal('');
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to add approval rule.');
    }
  };

  const handleSaveGeneral = async () => {
    try {
      await api.patch('/tenders/settings', generalSettings);
      alert('General tender settings updated successfully.');
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to update settings.');
    }
  };

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
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#DCD8CE] pb-2">
          {[
            { id: 'categories', label: 'Categories' },
            { id: 'portals', label: 'Portals & Competitors' },
            { id: 'loss_reasons', label: 'Loss Reasons' },
            { id: 'approval_rules', label: 'Approval Rules' },
            { id: 'general', label: 'SLA & Policy' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#0F5E63] text-white shadow-sm'
                  : 'text-[#4A5568] hover:bg-[#FBFAF7] hover:text-[#14213D]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Categories */}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">
                  Tender Categories (PQ, General, MHA)
                </h4>
                <p className="text-[11px] text-[#4A5568]">
                  Controls category-specific checklists, qualification rules, and Vikas KPI metrics.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleAddCategory}
              className="flex flex-wrap items-end gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
            >
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Code *
                </label>
                <Input
                  placeholder="e.g. mha"
                  value={newCatCode}
                  onChange={(e) => setNewCatCode(e.target.value)}
                  required
                />
              </div>
              <div className="flex-2 min-w-[180px]">
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Display Label *
                </label>
                <Input
                  placeholder="e.g. Ministry of Home Affairs"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center gap-1.5 pb-2">
                <input
                  type="checkbox"
                  id="requires_pq"
                  checked={newCatRequiresPq}
                  onChange={(e) => setNewCatRequiresPq(e.target.checked)}
                  className="rounded text-[#0F5E63]"
                />
                <label htmlFor="requires_pq" className="text-xs text-[#14213D]">
                  Requires PQ
                </label>
              </div>
              <Button size="sm" variant="primary" type="submit">
                Add Category
              </Button>
            </form>

            <Table>
              <TableHeader>
                <TableRow className="bg-[#FBFAF7]">
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requires PQ</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-semibold text-[#0F5E63]">
                      {c.code}
                    </TableCell>
                    <TableCell className="font-medium text-[#14213D]">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-[#4A5568]">
                      {c.category_type || 'Standard'}
                    </TableCell>
                    <TableCell>
                      {c.requires_pq ? (
                        <Badge variant="cyber" size="sm">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="success" size="sm">
                        Active
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Portals */}
            <div className="space-y-3">
              <h4 className="font-serif font-bold text-sm text-[#14213D]">
                Procurement Portals
              </h4>
              <form onSubmit={handleAddPortal} className="space-y-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
                <Input
                  placeholder="Code (e.g. gem, cppp)"
                  value={newPortalCode}
                  onChange={(e) => setNewPortalCode(e.target.value)}
                  required
                />
                <Input
                  placeholder="Portal Name (e.g. GeM Portal)"
                  value={newPortalName}
                  onChange={(e) => setNewPortalName(e.target.value)}
                  required
                />
                <Input
                  placeholder="Base URL (e.g. https://mkp.gem.gov.in)"
                  value={newPortalUrl}
                  onChange={(e) => setNewPortalUrl(e.target.value)}
                />
                <Button size="xs" variant="primary" type="submit" fullWidth>
                  Register Portal
                </Button>
              </form>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {portals.map((p) => (
                  <div
                    key={p.id}
                    className="p-2 rounded-lg bg-white border border-[#DCD8CE] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold text-[#14213D]">
                        {p.name}
                      </span>
                      <span className="block font-mono text-[10px] text-[#4A5568]">
                        {p.code}
                      </span>
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
              <h4 className="font-serif font-bold text-sm text-[#14213D]">
                Competitors Master
              </h4>
              <form onSubmit={handleAddCompetitor} className="flex gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
                <Input
                  placeholder="Competitor Name (e.g. Alpha Tech Ltd)"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  required
                />
                <Button size="sm" variant="primary" type="submit">
                  Add
                </Button>
              </form>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {competitors.map((comp) => (
                  <div
                    key={comp.id}
                    className="p-2 rounded-lg bg-white border border-[#DCD8CE] flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-[#14213D]">
                      {comp.name}
                    </span>
                    <Badge variant="outline" size="sm">
                      Master
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Loss Reasons */}
        {activeTab === 'loss_reasons' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-serif font-bold text-sm text-[#14213D]">
                Configurable Win/Loss Reason Taxonomy
              </h4>
              <p className="text-[11px] text-[#4A5568]">
                Enforces root cause analytics when tenders are lost or disqualified.
              </p>
            </div>

            <form
              onSubmit={handleAddLossReason}
              className="flex flex-wrap items-end gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
            >
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Code *
                </label>
                <Input
                  placeholder="e.g. l1_price_gap"
                  value={newLossCode}
                  onChange={(e) => setNewLossCode(e.target.value)}
                  required
                />
              </div>
              <div className="flex-2 min-w-[200px]">
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Description Label *
                </label>
                <Input
                  placeholder="e.g. Uncompetitive L1 Pricing"
                  value={newLossLabel}
                  onChange={(e) => setNewLossLabel(e.target.value)}
                  required
                />
              </div>
              <Button size="sm" variant="primary" type="submit">
                Add Reason
              </Button>
            </form>

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
                    <TableCell className="font-mono text-[#9A3412] font-semibold">
                      {lr.code}
                    </TableCell>
                    <TableCell className="font-medium text-[#14213D]">
                      {lr.label}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        Standard
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
              <h4 className="font-serif font-bold text-sm text-[#14213D]">
                Multi-Level Approval Rules & Value Thresholds
              </h4>
              <p className="text-[11px] text-[#4A5568]">
                Route tender submissions to Regional Managers, Tender Heads, or Management based on value bands.
              </p>
            </div>

            <form
              onSubmit={handleAddApprovalRule}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]"
            >
              <div>
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Category
                </label>
                <Input
                  placeholder="All or General/MHA/PQ"
                  value={newRuleCategory}
                  onChange={(e) => setNewRuleCategory(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Min Value (₹)
                </label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newRuleMinVal}
                  onChange={(e) => setNewRuleMinVal(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Max Value (₹)
                </label>
                <Input
                  type="number"
                  placeholder="Leave empty for unlimited"
                  value={newRuleMaxVal}
                  onChange={(e) => setNewRuleMaxVal(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#14213D] mb-1">
                  Approver Role
                </label>
                <select
                  value={newRuleApproverRole}
                  onChange={(e) => setNewRuleApproverRole(e.target.value)}
                  className="w-full text-xs rounded-lg border border-[#C9C4B8] bg-white px-2 py-1.5 text-[#14213D]"
                >
                  <option value="management">Management / Director</option>
                  <option value="admin">Super Admin</option>
                </select>
              </div>
              <div className="sm:col-span-4 flex justify-end">
                <Button size="xs" variant="primary" type="submit">
                  Save Approval Rule
                </Button>
              </div>
            </form>

            <Table>
              <TableHeader>
                <TableRow className="bg-[#FBFAF7]">
                  <TableHead>Category</TableHead>
                  <TableHead>Value Band</TableHead>
                  <TableHead>Approver Role</TableHead>
                  <TableHead>Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvalRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-[#4A5568]">
                      Default rule applies: All submissions route to Tender Head / Regional Manager.
                    </TableCell>
                  </TableRow>
                ) : (
                  approvalRules.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-semibold text-[#0F5E63]">
                        {r.category || 'All Categories'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        ₹{Number(r.min_value || 0).toLocaleString('en-IN')} -{' '}
                        {r.max_value
                          ? `₹${Number(r.max_value).toLocaleString('en-IN')}`
                          : 'Unlimited'}
                      </TableCell>
                      <TableCell className="capitalize font-medium text-[#14213D]">
                        {r.approver_role?.replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        Round {r.approval_order || 1}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Tab 5: SLA & General */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-serif font-bold text-sm text-[#14213D]">
                Governance SLAs & Automation Timers
              </h4>
              <p className="text-[11px] text-[#4A5568]">
                Configure deadline proximity alert windows and approval turnaround escalation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-[#FBFAF7] rounded-xl border border-[#DCD8CE]">
              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Approval Turnaround SLA (Hours)
                </label>
                <Input
                  type="number"
                  value={generalSettings.approval_sla_hours || 24}
                  onChange={(e) =>
                    setGeneralSettings({
                      ...generalSettings,
                      approval_sla_hours: Number(e.target.value),
                    })
                  }
                />
                <span className="text-[10px] text-[#4A5568]">
                  Default 24h SLA. Triggers escalation when deadline is &lt; 72h away.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Deadline Warning Window (Days)
                </label>
                <Input
                  type="number"
                  value={generalSettings.deadline_warning_days || 7}
                  onChange={(e) =>
                    setGeneralSettings({
                      ...generalSettings,
                      deadline_warning_days: Number(e.target.value),
                    })
                  }
                />
                <span className="text-[10px] text-[#4A5568]">
                  Tenders entering this window are highlighted in the Deadline Centre.
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button size="sm" variant="primary" onClick={handleSaveGeneral}>
                Update SLA Policies
              </Button>
            </div>
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
