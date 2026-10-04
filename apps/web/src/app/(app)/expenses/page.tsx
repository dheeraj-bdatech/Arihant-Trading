'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Building,
  Upload,
  Calendar,
  AlertCircle,
  AlertTriangle,
  FileText,
  CreditCard,
  ExternalLink,
  MapPin,
  Download,
  Filter,
  Coins,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Tabs,
  PageContainer,
  PageHeader,
  EmptyState,
  StatCard,
  StatGrid,
} from '@/components/ui';
import { formatINR } from '@arihant/shared';

export default function ExpensesPage() {
  const { user, hasRole } = useAuth();
  const searchParams = useSearchParams();
  const visitIdParam = searchParams.get('visit_id');

  const [expenses, setExpenses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [isManagerModalOpen, setIsManagerModalOpen] = useState(false);
  const [isAccountsModalOpen, setIsAccountsModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);

  // Manager Approval Form
  const [managerAction, setManagerAction] = useState<'manager_approved' | 'rejected'>('manager_approved');
  const [managerRemarks, setManagerRemarks] = useState('');

  // Accounts Process Form
  const [accountsAction, setAccountsAction] = useState<'accounts_processed' | 'rejected'>('accounts_processed');
  const [accountsRemarks, setAccountsRemarks] = useState('');

  // Submit Expense Form
  const [newExpense, setNewExpense] = useState({
    category: 'travel',
    amount: '',
    purpose: '',
    expense_date: new Date().toISOString().split('T')[0],
    receipt_url: '',
    visit_id: visitIdParam || '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [availableVisits, setAvailableVisits] = useState<any[]>([]);

  const fetchExpenses = async () => {
    try {
      setIsLoading(true);
      const [res, summaryRes] = await Promise.all([
        api.get('/expenses', {
          status: activeTab !== 'all' ? activeTab : undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
          search: searchQuery || undefined,
          limit: 50,
        }),
        api
          .get('/expenses/summary', {
            category: categoryFilter !== 'all' ? categoryFilter : undefined,
          })
          .catch(() => null),
      ]);
      setExpenses(res.data || []);
      if (summaryRes) setSummary(summaryRes);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const csvData = await api.get<string>('/expenses/export/csv', {
        status: activeTab !== 'all' ? activeTab : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
      });
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `arihant-expenses-${new Date().toISOString().split('T')[0]}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export expenses for Tally:', err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [activeTab, categoryFilter]);

  useEffect(() => {
    api
      .get('/visits', { limit: 50 })
      .then((res) => setAvailableVisits(res.data || []))
      .catch(() => {});
  }, []);

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post('/expenses', {
        category: newExpense.category,
        amount: Number(newExpense.amount),
        purpose: newExpense.purpose,
        expense_date: newExpense.expense_date,
        receipt_url: newExpense.receipt_url || undefined,
        visit_id: newExpense.visit_id || undefined,
      });

      setIsSubmitOpen(false);
      setNewExpense({
        category: 'travel',
        amount: '',
        purpose: '',
        expense_date: new Date().toISOString().split('T')[0],
        receipt_url: '',
        visit_id: '',
      });
      await fetchExpenses();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit expense claim.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManagerApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExpense) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.patch(`/expenses/${selectedExpense.id}/manager-approve`, {
        decision: managerAction,
        manager_remarks: managerRemarks,
      });

      setIsManagerModalOpen(false);
      setManagerRemarks('');
      await fetchExpenses();
    } catch (err: any) {
      setActionError(err.message || 'Approval action failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAccountsProcessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExpense) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.patch(`/expenses/${selectedExpense.id}/accounts-process`, {
        decision: accountsAction,
        remarks: accountsRemarks,
      });

      setIsAccountsModalOpen(false);
      setAccountsRemarks('');
      await fetchExpenses();
    } catch (err: any) {
      setActionError(err.message || 'Accounts processing failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageContainer>
      {/* Top Header */}
      <PageHeader
        badge="Travel & Reimbursements"
        title="Two-Stage Expense Reimbursements"
        subtitle="Stage 1: Regional Manager verification • Stage 2: Corporate Accounts disbursement."
        icon={<Receipt className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              onClick={handleExportCsv}
              variant="outline"
              disabled={isExporting}
              className="border-[#DCD8CE] hover:border-[#0F5E63] text-[#14213D] shadow-xs"
            >
              <Download className="h-4 w-4 mr-1.5 text-[#0F5E63]" />
              <span>{isExporting ? 'Exporting...' : 'Export for Tally (CSV)'}</span>
            </Button>
            <Button
              onClick={() => setIsSubmitOpen(true)}
              variant="primary"
              className="shadow-xs"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span>Submit Reimbursement</span>
            </Button>
          </div>
        }
      />

      {/* Financial Summary HUD */}
      <StatGrid cols={4}>
        <StatCard
          label="Total Claims Submitted"
          value={formatINR(summary?.metrics?.total_amount || 0)}
          subtext={`${summary?.metrics?.total_count || 0} claims in system`}
          icon={<Coins className="h-5 w-5 text-[#0F5E63]" />}
        />
        <StatCard
          label="Stage 1: Awaiting RM"
          value={formatINR(summary?.metrics?.pending_manager_amount || 0)}
          subtext="Pending field manager review"
          icon={<Clock className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
        />
        <StatCard
          label="Stage 2: In Accounts"
          value={formatINR(summary?.metrics?.pending_accounts_amount || 0)}
          subtext="Ready for finance clearance"
          icon={<ShieldCheck className="h-5 w-5 text-[#0F5E63]" />}
          variant="emerald"
        />
        <StatCard
          label="Settled & Reconciled"
          value={formatINR(summary?.metrics?.approved_amount || 0)}
          subtext="Processed into Tally accounts"
          icon={<CheckCircle2 className="h-5 w-5 text-[#0F5E63]" />}
          variant="primary"
        />
      </StatGrid>

      {/* Category & Search Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between p-3.5 bg-white border border-[#DCD8CE] rounded-[14px]">
        <div className="flex-1 w-full sm:w-auto">
          <Input
            placeholder="Search claims by purpose, employee, or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchExpenses();
            }}
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full sm:w-48 text-xs font-semibold"
          >
            <option value="all">All Categories</option>
            <option value="travel">Travel (Train/Flight/Bus)</option>
            <option value="hotel">Hotel & Lodging</option>
            <option value="local_conveyance">Local Conveyance (Auto/Taxi)</option>
            <option value="food">Food & Daily Allowance</option>
            <option value="demo">Demo Freight / Unit Transit</option>
            <option value="service">Service Spares & Tools</option>
            <option value="other">Other Out-of-Pocket</option>
          </Select>
          <Button
            onClick={() => fetchExpenses()}
            variant="secondary"
            size="sm"
            className="whitespace-nowrap"
          >
            <Filter className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
            Apply Filter
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'all', label: 'All Claims' },
          { id: 'submitted', label: 'Stage 1: Awaiting RM Approval' },
          { id: 'manager_approved', label: 'Stage 2: In Accounts Processing' },
          { id: 'accounts_processed', label: 'Settled & Paid' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Claims Grid */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">Loading claims...</div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expense claims in this stage"
            description="There are currently no reimbursement claims filed or awaiting action."
          />
        ) : (
          expenses.map((exp) => {
            const isSubmitter = user && (exp.employee_id === user.id || exp.user_id === user.id);

            return (
              <Card
                key={exp.id}
                padding="sm"
                className="flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center space-x-2.5">
                    <span className="font-mono text-base font-extrabold text-[#14213D]">
                      {formatINR(exp.amount)}
                    </span>
                    <Badge variant="outline" size="sm" className="uppercase font-bold">
                      {exp.category}
                    </Badge>
                    <Badge
                      variant={
                        exp.status === 'accounts_processed'
                          ? 'success'
                          : exp.status === 'manager_approved'
                          ? 'info'
                          : exp.status === 'rejected'
                          ? 'danger'
                          : 'warning'
                      }
                      size="sm"
                    >
                      {exp.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>

                  <p className="text-xs text-[#14213D] font-medium">{exp.purpose}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4A5568]">
                    <span>Officer: <strong className="text-[#14213D]">{exp.employee_name || exp.user_name || 'Staff'}</strong></span>
                    <span>Date: {new Date(exp.expense_date).toLocaleDateString('en-IN')}</span>
                    {(exp.organisation_name || exp.visit_purpose) && (
                      <span className="flex items-center gap-1 text-[#4A5568]">
                        <MapPin className="h-3 w-3 text-[#0F5E63]" />
                        Tour: <strong className="text-[#14213D]">{exp.organisation_name || exp.visit_purpose}</strong>
                      </span>
                    )}
                    {exp.receipt_url && (
                      <a
                        href={exp.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#0F5E63] hover:underline flex items-center gap-1 font-semibold"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>View Attached Bill Slip</span>
                      </a>
                    )}
                  </div>

                  {/* Stage Notes */}
                  {exp.manager_remarks && (
                    <div className="text-[11px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded border border-amber-200">
                      RM Note: {exp.manager_remarks}
                    </div>
                  )}
                  {exp.accounts_remarks && (
                    <div className="text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                      Accounts Voucher: {exp.accounts_remarks}
                    </div>
                  )}
                </div>

                {/* Workflow Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Stage 1: RM / Management Approval */}
                  {exp.status === 'submitted' &&
                    hasRole(['management', 'regional_manager']) &&
                    (isSubmitter ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-medium" title="Dual-control policy: You cannot approve your own expense claim.">
                        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                        <span>Self-Approval Prohibited</span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSelectedExpense(exp);
                          setIsManagerModalOpen(true);
                        }}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                        <span>Stage-1: RM Signoff</span>
                      </Button>
                    ))}

                  {/* Stage 2: Accounts Processing */}
                  {exp.status === 'manager_approved' &&
                    hasRole(['management', 'accounts']) && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSelectedExpense(exp);
                          setIsAccountsModalOpen(true);
                        }}
                      >
                        <CreditCard className="h-3.5 w-3.5 mr-1" />
                        <span>Stage-2: Settle Claim</span>
                      </Button>
                    )}

                  {isSubmitter && exp.status === 'submitted' && !hasRole(['management', 'regional_manager']) && (
                    <span className="text-[10px] text-[#4A5568] italic">
                      Awaiting Manager Verification
                    </span>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Submit Claim Modal */}
      <Modal
        isOpen={isSubmitOpen}
        onClose={() => setIsSubmitOpen(false)}
        title="Submit Expense Reimbursement Claim"
        description="Enter bill details and upload receipt slips for tour travel or demonstrations."
        maxWidth="md"
      >
        <form onSubmit={handleSubmitExpense} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Expense Category"
              value={newExpense.category}
              onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
              options={[
                { value: 'travel', label: 'Train / Air / Bus Fare' },
                { value: 'local_conveyance', label: 'Local Taxi / Cab Slip' },
                { value: 'hotel', label: 'Hotel & Lodging' },
                { value: 'food', label: 'Food & Meals' },
                { value: 'demo', label: 'Demo / Trial Expenses' },
                { value: 'service', label: 'Service Spares & Hardware Tools' },
                { value: 'other', label: 'Other Sundry / Field Out-of-Pocket' },
              ]}
            />
            <Input
              label="Amount Claimed (₹)"
              type="number"
              min="1"
              required
              value={newExpense.amount}
              onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
              placeholder="2500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Expense Date"
              type="date"
              required
              value={newExpense.expense_date}
              onChange={(e) => setNewExpense({ ...newExpense, expense_date: e.target.value })}
            />
            <Input
              label="Receipt / Slip Image URL"
              value={newExpense.receipt_url}
              onChange={(e) => setNewExpense({ ...newExpense, receipt_url: e.target.value })}
              placeholder="https://res.cloudinary.com/..."
            />
          </div>

          <Select
            label="Linked Client Tour / Field Visit"
            value={newExpense.visit_id}
            onChange={(e) => setNewExpense({ ...newExpense, visit_id: e.target.value })}
            options={[
              { value: '', label: '-- General Office / Non-Tour Claim --' },
              ...availableVisits.map((v) => ({
                value: v.id,
                label: `${v.organisation_name || 'Client Agency'} (${new Date(v.planned_date).toLocaleDateString('en-IN')}) - ${v.purpose || 'Field Tour'}`,
              })),
            ]}
          />

          <Input
            label="Purpose & Route Details"
            required
            value={newExpense.purpose}
            onChange={(e) => setNewExpense({ ...newExpense, purpose: e.target.value })}
            placeholder="e.g. Taxi fare from Chandigarh Station to ITBP Camp"
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsSubmitOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Submit for Approval
            </Button>
          </div>
        </form>
      </Modal>

      {/* Stage 1: RM Approval Modal */}
      <Modal
        isOpen={isManagerModalOpen}
        onClose={() => setIsManagerModalOpen(false)}
        title="Stage-1: Regional Manager Approval"
        description="Verify that the claimed expenditure corresponds to an authorized client visit."
        maxWidth="md"
      >
        <form onSubmit={handleManagerApproveSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Claimed By:</span>
              <span className="font-bold text-[#14213D]">{selectedExpense?.employee_name || selectedExpense?.user_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Total Amount:</span>
              <span className="font-bold text-[#0F5E63]">{formatINR(selectedExpense?.amount || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Purpose:</span>
              <span className="text-gray-700">{selectedExpense?.purpose}</span>
            </div>
          </div>

          <Select
            label="Manager Action"
            value={managerAction}
            onChange={(e) => setManagerAction(e.target.value as any)}
            options={[
              { value: 'manager_approved', label: 'APPROVE - Forward to Accounts for Payment' },
              { value: 'rejected', label: 'REJECT - Disallow Claim' },
            ]}
          />

          <Input
            label="Manager Verification Remarks"
            value={managerRemarks}
            onChange={(e) => setManagerRemarks(e.target.value)}
            placeholder="e.g. Slips verified against Chandigarh tour itinerary."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsManagerModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Commit Stage-1 Signoff
            </Button>
          </div>
        </form>
      </Modal>

      {/* Stage 2: Accounts Process Modal */}
      <Modal
        isOpen={isAccountsModalOpen}
        onClose={() => setIsAccountsModalOpen(false)}
        title="Stage-2: Accounts Settlement & Disbursement"
        description="Release reimbursement payment or NEFT transfer voucher."
        maxWidth="md"
      >
        <form onSubmit={handleAccountsProcessSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Select
            label="Accounts Action"
            value={accountsAction}
            onChange={(e) => setAccountsAction(e.target.value as any)}
            options={[
              { value: 'accounts_processed', label: 'DISBURSED - Settle Voucher & Reconcile' },
              { value: 'rejected', label: 'REJECT - Return to Submitter' },
            ]}
          />

          <Input
            label="Payment Voucher / UTR Reference"
            value={accountsRemarks}
            onChange={(e) => setAccountsRemarks(e.target.value)}
            placeholder="e.g. NEFT ref #CMS2918239 / Petty cash paid"
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAccountsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Mark Disbursed
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
