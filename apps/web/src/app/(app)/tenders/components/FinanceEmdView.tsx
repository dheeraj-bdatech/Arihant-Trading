'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Input,
  Select,
  Textarea,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
  EmptyState, Spinner } from '@/components/ui';
import {
  DollarSign,
  IndianRupee,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Building2,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  Filter,
  FileCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatTaskDate, TENDER_FINANCIAL_INSTRUMENT_STATUSES } from '@arihant/shared';

interface FinanceEmdViewProps {
  currentUser: any;
  onOpenDossier: (tenderId: string) => void;
}

/** Roles allowed to PATCH an instrument (API: management, accounts, admin). Everyone else sees this screen read-only. */
const INSTRUMENT_EDITOR_ROLES = ['management', 'accounts', 'admin'];

/** Extra wording for some statuses in the picker; the values themselves are the shared enum. */
const STATUS_HINTS: Record<string, string> = {
  Submitted: 'Submitted (committed on portal)',
  Refunded: 'Refunded (received back in bank)',
  Released: 'Released (PBG returned)',
};

const errorText = (err: any, fallback: string) => {
  const m = err?.message ?? err?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

export function FinanceEmdView({
  currentUser,
  onOpenDossier,
}: FinanceEmdViewProps) {
  const [data, setData] = useState<{
    total_emd_blocked: number;
    total_refund_due: number;
    refund_due_count: number;
    refund_due_items: any[];
    all_instruments: any[];
    instruments?: any[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<
    'refund_due' | 'blocked' | 'pbg' | 'all'
  >('refund_due');

  const canUpdate = INSTRUMENT_EDITOR_ROLES.includes(currentUser?.role);
  // Accounts can't load a tender (GET /tenders/:id), so the tender number is plain text for them.
  const canOpenDossier = currentUser?.role !== 'accounts';

  // Status update modal
  const [selectedInstrument, setSelectedInstrument] = useState<any | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [statusNotes, setStatusNotes] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // api.get returns the parsed body itself.
      const res = await api.get('/tenders/finance/emd-tracking');
      setData(res && typeof res === 'object' ? res : null);
    } catch (err: any) {
      console.error('Failed to load finance EMD tracking:', err);
      setError(errorText(err, 'Could not load Finance EMD tracking.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenStatusModal = (inst: any) => {
    setSelectedInstrument(inst);
    setUpdateStatus(inst.status || '');
    setStatusNotes('');
    setReferenceNumber(inst.reference_number || '');
    setSaveError(null);
  };

  const closeStatusModal = () => {
    if (isUpdating) return;
    setSelectedInstrument(null);
    setSaveError(null);
  };

  const trimmedReference = referenceNumber.trim();
  const referenceChanged =
    Boolean(selectedInstrument) && trimmedReference !== '' && trimmedReference !== (selectedInstrument?.reference_number || '');
  const hasChanges =
    Boolean(selectedInstrument) &&
    (updateStatus !== selectedInstrument?.status || statusNotes.trim() !== '' || referenceChanged);

  const handleSaveStatus = async () => {
    if (!selectedInstrument || !hasChanges) return;
    try {
      setIsUpdating(true);
      setSaveError(null);
      await api.patch(
        `/tenders/${selectedInstrument.tender_id}/financial-instruments/${selectedInstrument.id}`,
        {
          status: updateStatus,
          // Notes are the instrument's remarks; the bank reference (BG/DD/UTR no.) is only sent when edited.
          remarks: statusNotes.trim() || undefined,
          reference_number: referenceChanged ? trimmedReference : undefined,
        },
      );
      setSelectedInstrument(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to update instrument status:', err);
      setSaveError(errorText(err, 'Failed to update status.'));
    } finally {
      setIsUpdating(false);
    }
  };

  // Refund aging is computed by the server from when the instrument entered Refund Due.
  const refundAgingById = new Map<string, { days_pending?: number; aging_bucket?: string }>(
    (data?.refund_due_items || []).map((i: any) => [i.id, i]),
  );

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const instrumentsList = data?.all_instruments || data?.instruments || [];

  const displayedList = instrumentsList.filter((inst) => {
    if (filterType === 'refund_due') return inst.status === 'Refund Due';
    if (filterType === 'blocked')
      return (
        inst.instrument_type === 'EMD' &&
        ['Issued', 'Submitted'].includes(inst.status)
      );
    if (filterType === 'pbg') return inst.instrument_type === 'PBG';
    return true;
  });


  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-[#E3EFEE] text-[#0F5E63]">
              <IndianRupee className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-serif font-bold text-[#14213D]">
              Finance & Tender Security Repository
            </h2>
          </div>
          <p className="text-xs text-[#4A5568]">
            Bank guarantees, EMD deposit recovery, refund aging schedules, and tender fee accounting.
          </p>
        </div>

      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-white border-[#DCD8CE]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider">
              Total EMD Blocked
            </span>
            <span className="p-1.5 rounded-lg bg-[#E3EFEE] text-[#0F5E63]">
              <IndianRupee className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-serif font-bold font-mono text-[#0F5E63]">
            {formatCurrency(data?.total_emd_blocked || 0)}
          </div>
          <p className="mt-1 text-[11px] text-[#4A5568]">
            Actively committed in submitted tenders
          </p>
        </Card>

        <Card className="p-4 bg-white border-[#DCD8CE]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider">
              Refunds Due
            </span>
            <span className="p-1.5 rounded-lg bg-[#FBEBDD] text-[#9A3412]">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-serif font-bold font-mono text-[#9A3412]">
            {formatCurrency(data?.total_refund_due || 0)}
          </div>
          <p className="mt-1 text-[11px] text-[#4A5568]">
            {data?.refund_due_count || 0} instruments awaiting recovery
          </p>
        </Card>

        <Card className="p-4 bg-white border-[#DCD8CE]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider">
              Aging &gt; 30 Days
            </span>
            <span className="p-1.5 rounded-lg bg-[#FCE8EC] text-[#881337]">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-serif font-bold font-mono text-[#700F2D]">
            {
              (data?.refund_due_items || []).filter(
                (i) => i.days_pending > 30,
              ).length
            }{' '}
            Items
          </div>
          <p className="mt-1 text-[11px] text-[#881337] font-medium">
            Requires immediate buyer escalation
          </p>
        </Card>

        <Card className="p-4 bg-white border-[#DCD8CE]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider">
              Active PBGs
            </span>
            <span className="p-1.5 rounded-lg bg-[#ECE9E2] text-[#14213D]">
              <FileCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-serif font-bold font-mono text-[#14213D]">
            {
              instrumentsList.filter(
                (i) => i.instrument_type === 'PBG' && i.status !== 'Released',
              ).length
            }
          </div>
          <p className="mt-1 text-[11px] text-[#4A5568]">
            Bank guarantees against won contracts
          </p>
        </Card>
      </div>

      {/* Filter Segmented Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center bg-white p-1 rounded-lg border border-[#DCD8CE]">
          <button
            onClick={() => setFilterType('refund_due')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterType === 'refund_due'
                ? 'bg-[#9A3412] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Refunds Due ({data?.refund_due_count || 0})
          </button>
          <button
            onClick={() => setFilterType('blocked')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterType === 'blocked'
                ? 'bg-[#0F5E63] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Active EMDs (Blocked)
          </button>
          <button
            onClick={() => setFilterType('pbg')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterType === 'pbg'
                ? 'bg-[#14213D] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Performance Guarantees (PBG)
          </button>
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterType === 'all'
                ? 'bg-[#14213D] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            All Instruments ({instrumentsList.length})
          </button>
        </div>
      </div>

      {!canUpdate && (
        <InfoCallout variant="neutral" title="Read-only">
          Only Management, Accounts and Admin can update instrument status. You can follow EMD and PBG recovery here.
        </InfoCallout>
      )}

      {/* Instruments Table */}
      <Card className="p-0 overflow-hidden bg-white border-[#DCD8CE]">
        {loading ? (
          <div className="p-12 text-center text-sm text-[#4A5568] flex items-center justify-center gap-2">
            <Spinner size="xs" />
            Loading financial records...
          </div>
        ) : error ? (
          <div className="p-6">
            <InfoCallout variant="danger" title="Error">
              {error}
            </InfoCallout>
          </div>
        ) : displayedList.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#4A5568]">
            No instruments found for this category filter.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-[#FBFAF7]">
                <TableHead>Tender & Buyer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mode / Bank</TableHead>
                <TableHead>Reference No.</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aging / Expiry</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedList.map((inst) => {
                const aging = refundAgingById.get(inst.id);
                const daysPending =
                  typeof aging?.days_pending === 'number' ? aging.days_pending : null;

                return (
                  <TableRow key={inst.id} className="hover:bg-[#FBFAF7]">
                    <TableCell>
                      <div className="space-y-0.5">
                        {canOpenDossier && inst.tender_id ? (
                          <button
                            onClick={() => onOpenDossier(inst.tender_id)}
                            className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline text-left"
                          >
                            {inst.tender_number || inst.tender_no || 'Tender'}
                          </button>
                        ) : (
                          <span className="font-mono text-xs font-semibold text-[#14213D]">
                            {inst.tender_number || inst.tender_no || 'Tender'}
                          </span>
                        )}
                        <div className="text-[11px] text-[#4A5568] truncate max-w-[200px]">
                          {inst.organisation_name || 'Department'}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          inst.instrument_type === 'EMD'
                            ? 'default'
                            : inst.instrument_type === 'PBG'
                              ? 'cyber'
                              : 'outline'
                        }
                        size="sm"
                      >
                        {inst.instrument_type}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs">
                      <div className="font-medium text-[#14213D]">
                        {inst.mode || 'Online'}
                      </div>
                      <div className="text-[10px] text-[#4A5568]">
                        {inst.bank || '—'}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-[#4A5568]">
                      <div className="font-mono">{inst.reference_number || '—'}</div>
                      {inst.remarks && (
                        <div className="text-[10px] text-[#6B7280] truncate max-w-[180px]" title={inst.remarks}>
                          {inst.remarks}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="font-mono text-xs font-semibold text-[#14213D]">
                      {formatCurrency(inst.amount)}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          inst.status === 'Refund Due'
                            ? 'warning'
                            : inst.status === 'Refunded' ||
                                inst.status === 'Released'
                              ? 'success'
                              : inst.status === 'Forfeited'
                                ? 'danger'
                                : 'default'
                        }
                        size="sm"
                      >
                        {inst.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs">
                      {inst.status === 'Refund Due' ? (
                        daysPending !== null ? (
                          <span
                            className={`font-semibold ${
                              daysPending > 30 ? 'text-[#700F2D]' : 'text-[#7C2D12]'
                            }`}
                            title={`Days since this instrument moved to Refund Due${aging?.aging_bucket ? ` (${aging.aging_bucket})` : ''}`}
                          >
                            <span className="font-mono">{daysPending}</span> day{daysPending === 1 ? '' : 's'} pending
                          </span>
                        ) : (
                          <span className="text-[#6B7280]">Refund due</span>
                        )
                      ) : inst.expiry_date ? (
                        <span className="font-mono text-[#4A5568]">
                          Exp: {formatTaskDate(inst.expiry_date)}
                        </span>
                      ) : (
                        <span className="text-[#6B7280]">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {canUpdate && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleOpenStatusModal(inst)}
                          >
                            Update Status
                          </Button>
                        )}
                        {canOpenDossier && inst.tender_id && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onOpenDossier(inst.tender_id)}
                            aria-label="Open tender dossier"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Update Status Modal */}
      <Modal
        isOpen={Boolean(selectedInstrument)}
        onClose={closeStatusModal}
        title="Update Security Instrument Status"
        description={
          selectedInstrument
            ? `Instrument: ${selectedInstrument.instrument_type} • Amount: ${formatCurrency(selectedInstrument.amount)}`
            : undefined
        }
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          {saveError && (
            <InfoCallout variant="danger" title="Not saved" onClose={() => setSaveError(null)}>
              {saveError}
            </InfoCallout>
          )}

          <Select
            label="Status"
            required
            value={updateStatus}
            onChange={(e) => setUpdateStatus(e.target.value)}
            searchable={false}
            options={(
              selectedInstrument?.status &&
              !(TENDER_FINANCIAL_INSTRUMENT_STATUSES as string[]).includes(selectedInstrument.status)
                ? [selectedInstrument.status as string, ...TENDER_FINANCIAL_INSTRUMENT_STATUSES]
                : (TENDER_FINANCIAL_INSTRUMENT_STATUSES as string[])
            ).map((s) => ({
              value: s,
              label: STATUS_HINTS[s] || s,
              hint: s === selectedInstrument?.status ? 'Current' : undefined,
              hintTone: 'neutral' as const,
            }))}
          />

          <Input
            label="Reference No. (BG / DD / UTR)"
            placeholder="Bank guarantee, DD or transaction number"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            helperText="Change only if the bank reference itself has changed."
            className="font-mono"
          />

          <Textarea
            label="Remarks"
            rows={3}
            placeholder="e.g. Refund credited vide UTR …, or reason for forfeiture"
            value={statusNotes}
            onChange={(e) => setStatusNotes(e.target.value)}
          />
          {selectedInstrument?.remarks && (
            <p className="-mt-2 text-[11px] text-[#4A5568]">
              Current remark: <span className="text-[#14213D]">{selectedInstrument.remarks}</span>
              {' '}(kept unless you write a new one)
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button
              variant="outline"
              size="sm"
              onClick={closeStatusModal}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveStatus}
              isLoading={isUpdating}
              disabled={!hasChanges || !updateStatus}
            >
              Save Update
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
