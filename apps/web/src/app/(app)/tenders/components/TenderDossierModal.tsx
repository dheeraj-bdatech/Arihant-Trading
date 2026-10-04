'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Badge,
  Card,
  Input,
  Select,
  Textarea,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
  EmptyState,
} from '@/components/ui';
import {
  FileText,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  DollarSign,
  Paperclip,
  MessageSquare,
  ShieldAlert,
  ArrowRight,
  Plus,
  RefreshCw,
  ExternalLink,
  Layers,
  ShoppingBag,
  Send,
  UserCheck,
} from 'lucide-react';
import { api } from '@/lib/api';

interface TenderDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenderId: string | null;
  currentUser: any;
  onTenderUpdated?: () => void;
}

export function TenderDossierModal({
  isOpen,
  onClose,
  tenderId,
  currentUser,
  onTenderUpdated,
}: TenderDossierModalProps) {
  const [tender, setTender] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'line_items'
    | 'approvals'
    | 'documents'
    | 'corrigenda'
    | 'finance'
    | 'portal_issues'
    | 'discussion'
    | 'result'
    | 'linked'
    | 'timeline'
  >('overview');

  // Sub-action modal states
  const [isAddLineItemOpen, setIsAddLineItemOpen] = useState(false);
  const [newLineItem, setNewLineItem] = useState({
    product_description: '',
    quantity: 1,
    unit: 'Nos',
    specification_summary: '',
    quoted_unit_price: '',
    is_compliant: 'Not Checked',
  });

  const [isCorrigendumOpen, setIsCorrigendumOpen] = useState(false);
  const [newCorrigendum, setNewCorrigendum] = useState({
    corrigendum_number: '',
    new_deadline: '',
    summary: '',
  });

  const [isInstrumentOpen, setIsInstrumentOpen] = useState(false);
  const [newInstrument, setNewInstrument] = useState({
    instrument_type: 'EMD',
    amount: '',
    mode: 'DD',
    bank: '',
    reference_number: '',
    status: 'Requested',
  });

  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [commentText, setCommentText] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen && tenderId) {
      loadTender();
    } else {
      setTender(null);
      setFeedbackMsg(null);
    }
  }, [isOpen, tenderId]);

  const loadTender = async () => {
    if (!tenderId) return;
    setLoading(true);
    try {
      const res = await api.get<any>(`/tenders/${tenderId}`);
      setTender(res);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to load tender specifications' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddLineItem = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/line-items`, {
        ...newLineItem,
        quantity: Number(newLineItem.quantity),
        quoted_unit_price: newLineItem.quoted_unit_price ? Number(newLineItem.quoted_unit_price) : undefined,
      });
      setIsAddLineItemOpen(false);
      setNewLineItem({
        product_description: '',
        quantity: 1,
        unit: 'Nos',
        specification_summary: '',
        quoted_unit_price: '',
        is_compliant: 'Not Checked',
      });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Product line item added successfully' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to add line item' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitChecklist = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/documents/init-checklist`, {});
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Standard category document checklist initialized' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to initialize checklist' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateDocStatus = async (docId: string, status: string) => {
    if (!tenderId) return;
    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, { status });
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to update document status' });
    }
  };

  const handleAddCorrigendum = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/corrigenda`, newCorrigendum);
      setIsCorrigendumOpen(false);
      setNewCorrigendum({ corrigendum_number: '', new_deadline: '', summary: '' });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Corrigendum recorded and deadline updated' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to record corrigendum' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddInstrument = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/financial-instruments`, {
        ...newInstrument,
        amount: Number(newInstrument.amount),
      });
      setIsInstrumentOpen(false);
      setNewInstrument({
        instrument_type: 'EMD',
        amount: '',
        mode: 'DD',
        bank: '',
        reference_number: '',
        status: 'Requested',
      });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Financial instrument request registered' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to request financial instrument' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!tenderId || !commentText.trim()) return;
    setIsCommentSubmitting(true);
    try {
      await api.post(`/tenders/${tenderId}/comments`, {
        body: commentText.trim(),
        is_internal: true,
      });
      setCommentText('');
      await loadTender();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to post note' });
    } finally {
      setIsCommentSubmitting(false);
    }
  };

  const handleCreateLinkedTender = async () => {
    if (!tenderId || !tender) return;
    setActionLoading(true);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-linked-tender`, {
        tender_number: `${tender.tender_number || tender.tender_no}-GEN`,
        tender_title: `${tender.tender_title || 'Tender'} (Main General Bid)`,
      });
      setFeedbackMsg({
        type: 'success',
        text: `General Bid created successfully: Ref ${res.internal_ref || res.tender_number}`,
      });
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to generate linked General tender' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateSalesOrder = async () => {
    if (!tenderId || !tender) return;
    setActionLoading(true);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-sales-order`, {
        order_number: `SO-${tender.tender_number || tender.tender_no}`,
        delivery_terms: 'F.O.R Destination within 60 days',
      });
      setFeedbackMsg({
        type: 'success',
        text: `Sales Order registered in Deliveries pipeline: Ref ${res.sales_order?.delivery_no || res.order_number}`,
      });
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to create sales order' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tender?.tender_title || tender?.tender_number || 'Tender Dossier & Lifecycle'}
      description={`Reference: ${tender?.internal_ref || 'TND-2026-00000'} • Portal: ${tender?.portal || 'GeM'} • Buyer: ${tender?.organisation_name || tender?.organisation || 'Direct Government Department'}`}
      maxWidth="4xl"
    >
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="h-8 w-8 text-[#0F5E63] animate-spin" />
          <p className="text-sm font-medium text-[#4A5568]">Loading comprehensive tender dossier...</p>
        </div>
      ) : tender ? (
        <div className="space-y-5 text-xs text-[#14213D]">
          {/* Feedback alerts */}
          {feedbackMsg && (
            <InfoCallout
              variant={feedbackMsg.type === 'success' ? 'success' : 'danger'}
              title={feedbackMsg.type === 'success' ? 'Action Completed' : 'Operation Alert'}
              onClose={() => setFeedbackMsg(null)}
            >
              {feedbackMsg.text}
            </InfoCallout>
          )}

          {/* Dossier Header Strip */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#14213D] to-[#1F2E52] text-white flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-bold text-[#F2B872]">
                  {tender.internal_ref || 'TND-2026-00000'}
                </span>
                <span className="text-white/40">•</span>
                <span className="font-semibold text-white/90">{tender.tender_number || tender.tender_no}</span>
                <Badge
                  variant={
                    tender.category === 'pq' ? 'cyber' : tender.category === 'mha' ? 'warning' : 'default'
                  }
                  size="sm"
                >
                  {tender.category ? tender.category.toUpperCase() : 'GENERAL'}
                </Badge>
                <Badge
                  variant={
                    tender.priority === 'High' ? 'danger' : tender.priority === 'Low' ? 'default' : 'warning'
                  }
                  size="sm"
                >
                  {tender.priority || 'Medium'} Priority
                </Badge>
              </div>
              <p className="text-xs text-white/70 line-clamp-1">{tender.tender_title || tender.requirement_text || 'Standard Tender Supply Specification'}</p>
            </div>

            <div className="flex items-center space-x-3">
              <div className="text-right">
                <span className="text-[10px] text-white/60 block uppercase font-bold tracking-wider">Current Stage</span>
                <Badge
                  variant={
                    tender.status === 'won' || tender.status === 'WON'
                      ? 'success'
                      : ['lost', 'LOST', 'cancelled', 'CANCELLED'].includes(tender.status)
                      ? 'danger'
                      : 'info'
                  }
                  size="md"
                >
                  {(tender.status || 'IDENTIFIED').replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>

              {tender.days_left !== null && tender.days_left !== undefined && (
                <div className="p-2 rounded-lg bg-white/10 text-center min-w-[70px] border border-white/15">
                  <span className="text-[10px] text-white/70 block uppercase font-bold">Deadline</span>
                  <span
                    className={`font-mono text-xs font-bold ${
                      tender.days_left <= 2 ? 'text-red-300 animate-pulse' : 'text-[#F2B872]'
                    }`}
                  >
                    {tender.days_left < 0 ? 'Overdue' : `${tender.days_left}d left`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 11 Dossier Tabs Strip */}
          <div className="flex border-b border-[#DCD8CE] overflow-x-auto gap-1 pb-1 scrollbar-none select-none">
            {[
              { id: 'overview', label: 'Overview', icon: <FileText className="h-3.5 w-3.5" /> },
              {
                id: 'line_items',
                label: `Line Items (${tender.line_items?.length || 0})`,
                icon: <ShoppingBag className="h-3.5 w-3.5" />,
              },
              {
                id: 'approvals',
                label: 'Approvals',
                icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                badge: tender.approvals?.length || null,
              },
              {
                id: 'documents',
                label: `Documents (${tender.document_completion_percentage ?? 0}%)`,
                icon: <Paperclip className="h-3.5 w-3.5" />,
              },
              {
                id: 'corrigenda',
                label: `Corrigenda (${tender.corrigenda?.length || 0})`,
                icon: <Clock className="h-3.5 w-3.5" />,
              },
              {
                id: 'finance',
                label: 'EMD / PBG',
                icon: <DollarSign className="h-3.5 w-3.5" />,
              },
              {
                id: 'portal_issues',
                label: `Portal Issues (${tender.portal_issues?.length || 0})`,
                icon: <AlertTriangle className="h-3.5 w-3.5" />,
              },
              {
                id: 'discussion',
                label: `Discussion (${tender.comments?.length || 0})`,
                icon: <MessageSquare className="h-3.5 w-3.5" />,
              },
              { id: 'result', label: 'Win / Loss', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
              { id: 'linked', label: 'Linked Records', icon: <Layers className="h-3.5 w-3.5" /> },
              { id: 'timeline', label: 'Audit Timeline', icon: <Calendar className="h-3.5 w-3.5" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-white shadow-xs'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D] hover:bg-white/50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Authority & Location</span>
                  <div className="space-y-1">
                    <p className="font-semibold text-xs text-[#14213D]">{tender.organisation_name || tender.organisation}</p>
                    <p className="text-[11px] text-[#4A5568]">{tender.department || 'General Administration'}</p>
                    <p className="text-[11px] text-[#4A5568]">
                      {tender.city || 'Delhi'}, {tender.state || 'Delhi'} • Region: {tender.region_name || 'North'}
                    </p>
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Key Milestones</span>
                  <div className="space-y-1 font-mono text-[11px]">
                    <p className="text-[#4A5568]">
                      Published: <span className="font-bold text-[#14213D]">{tender.publication_date || 'N/A'}</span>
                    </p>
                    <p className="text-[#4A5568]">
                      Deadline:{' '}
                      <span className="font-bold text-[#9A3412]">
                        {tender.submission_deadline ? new Date(tender.submission_deadline).toLocaleString('en-IN') : 'N/A'}
                      </span>
                    </p>
                    {tender.pre_bid_meeting_date && (
                      <p className="text-[#4A5568]">
                        Pre-Bid: <span className="font-medium text-[#14213D]">{new Date(tender.pre_bid_meeting_date).toLocaleString('en-IN')}</span>
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Financials & Team</span>
                  <div className="space-y-1">
                    <p className="text-[11px] text-[#4A5568]">
                      Est. Value:{' '}
                      <span className="font-bold font-mono text-[#0F5E63]">
                        {tender.estimated_value ? `₹ ${(tender.estimated_value / 100000).toFixed(2)} Lakh` : 'Not Specified'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#4A5568]">
                      EMD:{' '}
                      <span className="font-medium font-mono text-[#14213D]">
                        {tender.emd_required ? `₹ ${tender.emd_amount || 0} (${tender.emd_mode})` : 'Exempted / Nil'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#4A5568]">
                      Owner: <span className="font-semibold text-[#14213D]">{tender.tender_owner_name || 'Unassigned'}</span> • Preparer:{' '}
                      <span className="font-semibold text-[#14213D]">{tender.assigned_to_name || 'Unassigned'}</span>
                    </p>
                  </div>
                </Card>
              </div>

              {tender.remarks && (
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Operational Remarks</span>
                  <p className="text-xs text-[#14213D]">{tender.remarks}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LINE ITEMS */}
          {activeTab === 'line_items' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Tender Products & BOQ Specifications</h4>
                  <p className="text-[11px] text-[#4A5568]">Products linked to this tender with catalogue and GeM compliance checks</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsAddLineItemOpen(true)}>
                  Add Line Item
                </Button>
              </div>

              {tender.line_items && tender.line_items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product / Description</TableHead>
                      <TableHead>GeM Status</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>Quoted Unit Price</TableHead>
                      <TableHead>Quoted Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.line_items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="font-semibold text-xs block text-[#14213D]">{item.product_name || item.product_description}</span>
                          {item.specification_summary && (
                            <span className="text-[10px] text-[#4A5568] line-clamp-1">{item.specification_summary}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.product_gem_listed ? (
                            <Badge variant="success" size="sm">GeM Listed</Badge>
                          ) : (
                            <Badge variant="danger" size="sm" title="Suggested to raise portal issue if portal requires listing">
                              Not on GeM
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {item.quantity} {item.unit || 'Nos'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.is_compliant === 'Yes'
                                ? 'success'
                                : item.is_compliant === 'No'
                                ? 'danger'
                                : item.is_compliant === 'Partial'
                                ? 'warning'
                                : 'default'
                            }
                            size="sm"
                          >
                            {item.is_compliant}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.quoted_unit_price ? `₹ ${Number(item.quoted_unit_price).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          {item.quoted_total ? `₹ ${Number(item.quoted_total).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No line items configured"
                  description="Add equipment and specifications to verify GeM catalogue compatibility."
                  action={<Button variant="outline" size="sm" onClick={() => setIsAddLineItemOpen(true)}>Add First Item</Button>}
                />
              )}
            </div>
          )}

          {/* TAB 3: APPROVALS */}
          {activeTab === 'approvals' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#E3EFEE] border border-[#0F5E63]/20 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-[#0F5E63]">Central Decision Protocol (Zero WhatsApp Policy)</h4>
                  <p className="text-[11px] text-[#4A5568]">Every tender go/no-go approval is immutably logged with approver identity and timestamp.</p>
                </div>
                {tender.status === 'identified' && (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Send className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        await api.post(`/tenders/${tender.id}/approval-request`, { remarks: 'Official approval requested' });
                        await loadTender();
                        onTenderUpdated?.();
                        setFeedbackMsg({ type: 'success', text: 'Approval request submitted to designated authorities' });
                      } catch (err: any) {
                        setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to submit for approval' });
                      } finally {
                        setActionLoading(false);
                      }
                    }}
                  >
                    Submit for Approval
                  </Button>
                )}
              </div>

              {tender.approvals && tender.approvals.length > 0 ? (
                <div className="space-y-2">
                  {tender.approvals.map((app: any, idx: number) => (
                    <Card key={app.id || idx} className="p-3 border-[#DCD8CE]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                          <span className="font-semibold text-xs text-[#14213D]">
                            Round {app.approval_round || idx + 1}: {app.approver_name || 'Designated Approver'}
                          </span>
                        </div>
                        <Badge
                          variant={
                            app.status === 'APPROVED' ? 'success' : app.status === 'REJECTED' ? 'danger' : 'warning'
                          }
                          size="sm"
                        >
                          {app.status || 'PENDING'}
                        </Badge>
                      </div>
                      {app.decision_reason && (
                        <p className="text-[11px] text-[#4A5568] mt-1 pl-6">
                          <strong>Note:</strong> {app.decision_reason}
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No approval rounds recorded"
                  description="Submit this tender for approval when all mandatory parameters are completed."
                />
              )}
            </div>
          )}

          {/* TAB 4: DOCUMENTS CHECKLIST */}
          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Document Compliance Checklist</h4>
                  <p className="text-[11px] text-[#4A5568]">Mandatory submission criteria: all required files must be marked Ready or N/A.</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleInitChecklist} isLoading={actionLoading}>
                  Initialize Checklist Templates
                </Button>
              </div>

              {/* Completion Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Readiness Progress</span>
                  <span className="font-mono text-[#0F5E63]">{tender.document_completion_percentage || 0}% Complete</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-[#0F5E63] transition-all duration-300"
                    style={{ width: `${tender.document_completion_percentage || 0}%` }}
                  />
                </div>
              </div>

              {tender.documents && tender.documents.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Mandatory</TableHead>
                      <TableHead>Current Status</TableHead>
                      <TableHead>Attached File</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.documents.map((doc: any) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-semibold text-xs text-[#14213D]">{doc.document_type}</TableCell>
                        <TableCell>
                          {doc.is_mandatory ? (
                            <Badge variant="danger" size="sm">Required</Badge>
                          ) : (
                            <Badge variant="default" size="sm">Optional</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              doc.status === 'Ready'
                                ? 'success'
                                : doc.status === 'In Progress'
                                ? 'warning'
                                : doc.status === 'Not Applicable'
                                ? 'default'
                                : 'outline'
                            }
                            size="sm"
                          >
                            {doc.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {doc.file_name ? (
                            <span className="text-[#0F5E63] underline">{doc.file_name}</span>
                          ) : (
                            <span className="text-[#4A5568]">No attachment</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <select
                            value={doc.status}
                            onChange={(e) => handleUpdateDocStatus(doc.id, e.target.value)}
                            className="text-[11px] p-1 rounded border border-[#DCD8CE] bg-white cursor-pointer"
                          >
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Ready">Ready</option>
                            <option value="Not Applicable">Not Applicable</option>
                          </select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="Checklist not initialized"
                  description="Click 'Initialize Checklist Templates' to populate standard NIT and PQ verification forms."
                />
              )}
            </div>
          )}

          {/* TAB 5: CORRIGENDA */}
          {activeTab === 'corrigenda' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Corrigenda & Deadline Extensions</h4>
                  <p className="text-[11px] text-[#4A5568]">Official portal corrigenda history. Modifying deadline preserves original submission date.</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsCorrigendumOpen(true)}>
                  Add Corrigendum
                </Button>
              </div>

              {tender.corrigenda && tender.corrigenda.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Corrigendum No.</TableHead>
                      <TableHead>Issued Date</TableHead>
                      <TableHead>Old Deadline</TableHead>
                      <TableHead>New Deadline</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.corrigenda.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-bold font-mono text-xs text-[#14213D]">{c.corrigendum_number}</TableCell>
                        <TableCell className="text-xs">{c.issued_date || 'N/A'}</TableCell>
                        <TableCell className="font-mono text-xs text-[#4A5568]">
                          {c.old_deadline ? new Date(c.old_deadline).toLocaleString('en-IN') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          {c.new_deadline ? new Date(c.new_deadline).toLocaleString('en-IN') : 'N/A'}
                        </TableCell>
                        <TableCell className="text-xs text-[#4A5568]">{c.summary || 'Deadline extended'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No corrigenda recorded"
                  description="Log any portal extensions or specification amendments received from the department."
                />
              )}
            </div>
          )}

          {/* TAB 6: FINANCIAL INSTRUMENTS */}
          {activeTab === 'finance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Financial Instruments (EMD, PBG & Fees)</h4>
                  <p className="text-[11px] text-[#4A5568]">Tracked in real time with the Finance department until refund or contract release.</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsInstrumentOpen(true)}>
                  Request Instrument
                </Button>
              </div>

              {tender.financial_instruments && tender.financial_instruments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Mode / Bank</TableHead>
                      <TableHead>Reference No.</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.financial_instruments.map((fi: any) => (
                      <TableRow key={fi.id}>
                        <TableCell className="font-bold text-xs text-[#14213D]">{fi.instrument_type}</TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          ₹ {Number(fi.amount || 0).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fi.mode} • {fi.bank || 'SBI'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{fi.reference_number || 'Pending Generation'}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              fi.status === 'Issued' || fi.status === 'Refunded'
                                ? 'success'
                                : fi.status === 'Refund Due' || fi.status === 'Forfeited'
                                ? 'danger'
                                : 'warning'
                            }
                            size="sm"
                          >
                            {fi.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No financial instruments recorded"
                  description="Raise EMD demand notes or Bank Guarantee requests to central Finance."
                />
              )}
            </div>
          )}

          {/* TAB 7: PORTAL ISSUES */}
          {activeTab === 'portal_issues' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">External Portal Glitch / Downtime Log</h4>
                  <p className="text-[11px] text-[#4A5568]">External GeM/CPPP portal problems are tracked for deadline extension claims.</p>
                </div>
              </div>

              {tender.portal_issues && tender.portal_issues.length > 0 ? (
                <div className="space-y-2">
                  {tender.portal_issues.map((pi: any) => (
                    <Card key={pi.id} className="p-3 border-[#DCD8CE]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-[#14213D]">{pi.issue || pi.issue_description}</span>
                        <Badge
                          variant={pi.resolution_status === 'RESOLVED' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {pi.resolution_status || 'OPEN'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1">
                        Reported on {pi.reported_date} • Responsible: {pi.responsible_name || 'Executive'}
                      </p>
                      {pi.resolution && (
                        <p className="text-[11px] text-emerald-800 font-medium mt-1 bg-emerald-50 p-1.5 rounded">
                          Resolution: {pi.resolution}
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No portal issues logged"
                  description="GeM server timeouts, catalogue missing items, or DSC failures can be registered here."
                />
              )}
            </div>
          )}

          {/* TAB 8: DISCUSSION */}
          {activeTab === 'discussion' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Collaborative Discussion (WhatsApp Replacement)</h4>
                <p className="text-[11px] text-[#4A5568]">Team discussions, technical clarifications, and executive notes are saved permanently.</p>
              </div>

              <div className="flex space-x-2">
                <Input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Type an internal note or mention team members..."
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handlePostComment}
                  isLoading={isCommentSubmitting}
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                >
                  Post Note
                </Button>
              </div>

              {tender.comments && tender.comments.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {tender.comments.map((cm: any) => (
                    <div key={cm.id} className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#14213D]">{cm.author_name || 'Team Member'}</span>
                        <span className="text-[#4A5568] font-mono">{new Date(cm.created_at).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="text-xs text-[#14213D]">{cm.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No discussion notes yet" description="Start a discussion to replace WhatsApp chats." />
              )}
            </div>
          )}

          {/* TAB 9: RESULT & POST-MORTEM */}
          {activeTab === 'result' && (
            <div className="space-y-4">
              {['won', 'WON', 'lost', 'LOST', 'partially_won', 'PARTIALLY_WON'].includes(tender.status) ? (
                <Card className="p-4 space-y-3 border-[#DCD8CE]">
                  <div className="flex items-center justify-between">
                    <h4 className="font-serif font-bold text-sm text-[#14213D]">Declared Tender Outcome</h4>
                    <Badge
                      variant={
                        tender.status.toLowerCase().includes('won') ? 'success' : 'danger'
                      }
                      size="md"
                    >
                      {tender.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Result Date</span>
                      <span className="font-mono font-semibold">{tender.result_date || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Awarded Value</span>
                      <span className="font-mono font-bold text-[#0F5E63]">
                        {tender.tender_result?.awarded_value || tender.tender_value
                          ? `₹ ${(Number(tender.tender_result?.awarded_value || tender.tender_value) / 100000).toFixed(2)} Lakh`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Our Rank</span>
                      <span className="font-mono font-bold">{tender.tender_result?.our_rank || 'L1'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Winning Competitor</span>
                      <span className="font-semibold">{tender.tender_result?.competitor || 'Arihant Trading'}</span>
                    </div>
                  </div>

                  {tender.tender_result?.loss_reasons && tender.tender_result.loss_reasons.length > 0 && (
                    <div className="p-2.5 rounded bg-red-50 border border-red-200">
                      <span className="text-[10px] text-red-800 font-bold block uppercase mb-1">Loss Reasons</span>
                      <div className="flex flex-wrap gap-1">
                        {tender.tender_result.loss_reasons.map((r: string, i: number) => (
                          <Badge key={i} variant="danger" size="sm">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              ) : (
                <EmptyState
                  title="Tender in progress"
                  description="Outcomes (Won, Lost, Partially Won) can be officially recorded once commercial evaluation concludes."
                />
              )}
            </div>
          )}

          {/* TAB 10: LINKED RECORDS */}
          {activeTab === 'linked' && (
            <div className="space-y-4">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Inter-Module Operational Links</h4>
                <p className="text-[11px] text-[#4A5568]">Seamless linkages between PQ tenders, General Bids, Sales Orders, and Warranties.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4 space-y-2 border-[#DCD8CE]">
                  <h5 className="font-semibold text-xs text-[#0F5E63]">PQ to General Tender Conversion</h5>
                  <p className="text-[11px] text-[#4A5568]">
                    When a PQ tender is officially qualified, generate the linked General or MHA tender with cloned documents and lines.
                  </p>
                  {tender.status === 'pq_qualified' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCreateLinkedTender}
                      isLoading={actionLoading}
                      leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                    >
                      Create Linked General Tender
                    </Button>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">Available when tender status is PQ_QUALIFIED.</p>
                  )}
                </Card>

                <Card className="p-4 space-y-2 border-[#DCD8CE]">
                  <h5 className="font-semibold text-xs text-[#0F5E63]">Won Tender to Sales Order Conversion</h5>
                  <p className="text-[11px] text-[#4A5568]">
                    Automatically populates Deliveries & Sales Pipeline with awarded items, customer site, and warranty terms.
                  </p>
                  {['won', 'WON', 'partially_won', 'PARTIALLY_WON'].includes(tender.status) ? (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={handleCreateSalesOrder}
                      isLoading={actionLoading}
                      leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}
                    >
                      Create Sales Order
                    </Button>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">Available when tender status is WON or PARTIALLY_WON.</p>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB 11: AUDIT TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-3">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Immutable Audit Log & Stage Transitions</h4>
                <p className="text-[11px] text-[#4A5568]">Zero tampering: every status transition, approval, and deadline edit is timestamped.</p>
              </div>

              {tender.activities && tender.activities.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {tender.activities.map((act: any) => (
                    <div key={act.id} className="flex items-start space-x-2.5 p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                      <div className="h-2 w-2 rounded-full bg-[#0F5E63] mt-1.5 shrink-0" />
                      <div className="space-y-0.5 flex-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[#14213D]">{act.event_type}</span>
                          <span className="font-mono text-[#4A5568]">{new Date(act.created_at).toLocaleString('en-IN')}</span>
                        </div>
                        <p className="text-xs text-[#4A5568]">{act.description}</p>
                        {act.performed_by_name && (
                          <p className="text-[10px] text-[#0F5E63]">By: {act.performed_by_name}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No timeline entries logged yet" description="All future actions will appear in this chronological log." />
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Sub-Modal: Add Line Item */}
      <Modal
        isOpen={isAddLineItemOpen}
        onClose={() => setIsAddLineItemOpen(false)}
        title="Add Product Line Item"
        maxWidth="lg"
      >
        <div className="space-y-3 text-xs">
          <Input
            label="Product Description / Name"
            value={newLineItem.product_description}
            onChange={(e) => setNewLineItem({ ...newLineItem, product_description: e.target.value })}
            placeholder="e.g. Thermal Night Vision Sensor Model T-40"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Quantity"
              type="number"
              value={newLineItem.quantity}
              onChange={(e) => setNewLineItem({ ...newLineItem, quantity: Number(e.target.value) })}
              required
            />
            <Input
              label="Unit"
              value={newLineItem.unit}
              onChange={(e) => setNewLineItem({ ...newLineItem, unit: e.target.value })}
              placeholder="Units, Nos, Sets"
            />
          </div>
          <Input
            label="Quoted Unit Price (INR)"
            type="number"
            value={newLineItem.quoted_unit_price}
            onChange={(e) => setNewLineItem({ ...newLineItem, quoted_unit_price: e.target.value })}
            placeholder="e.g. 150000"
          />
          <Textarea
            label="Technical Specifications Summary"
            value={newLineItem.specification_summary}
            onChange={(e) => setNewLineItem({ ...newLineItem, specification_summary: e.target.value })}
            placeholder="Key technical capabilities and MIL-STD compliance..."
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddLineItemOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddLineItem} isLoading={actionLoading}>Save Line Item</Button>
          </div>
        </div>
      </Modal>

      {/* Sub-Modal: Add Corrigendum */}
      <Modal
        isOpen={isCorrigendumOpen}
        onClose={() => setIsCorrigendumOpen(false)}
        title="Issue Corrigendum & Update Deadline"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs">
          <Input
            label="Corrigendum Number"
            value={newCorrigendum.corrigendum_number}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, corrigendum_number: e.target.value })}
            placeholder="e.g. CORR-01/2026"
            required
          />
          <Input
            label="New Submission Deadline (IST)"
            type="datetime-local"
            value={newCorrigendum.new_deadline}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, new_deadline: e.target.value })}
            required
          />
          <Textarea
            label="Corrigendum Summary / Justification"
            value={newCorrigendum.summary}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, summary: e.target.value })}
            placeholder="Reason for extension or specification change..."
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsCorrigendumOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddCorrigendum} isLoading={actionLoading}>Record Corrigendum</Button>
          </div>
        </div>
      </Modal>

      {/* Sub-Modal: Add Financial Instrument */}
      <Modal
        isOpen={isInstrumentOpen}
        onClose={() => setIsInstrumentOpen(false)}
        title="Request Financial Instrument (EMD / PBG)"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs">
          <Select
            label="Instrument Type"
            value={newInstrument.instrument_type}
            onChange={(e) => setNewInstrument({ ...newInstrument, instrument_type: e.target.value })}
            options={[
              { value: 'EMD', label: 'Earnest Money Deposit (EMD)' },
              { value: 'PBG', label: 'Performance Bank Guarantee (PBG)' },
              { value: 'Tender Fee', label: 'Tender Document Fee' },
              { value: 'Security Deposit', label: 'Security Deposit' },
            ]}
          />
          <Input
            label="Amount (INR)"
            type="number"
            value={newInstrument.amount}
            onChange={(e) => setNewInstrument({ ...newInstrument, amount: e.target.value })}
            placeholder="e.g. 500000"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Mode"
              value={newInstrument.mode}
              onChange={(e) => setNewInstrument({ ...newInstrument, mode: e.target.value })}
              options={[
                { value: 'DD', label: 'Demand Draft (DD)' },
                { value: 'BG', label: 'Bank Guarantee (BG)' },
                { value: 'Online', label: 'Online Portal Gateway' },
                { value: 'Exempted', label: 'MSE / Startup Exemption' },
              ]}
            />
            <Input
              label="Bank"
              value={newInstrument.bank}
              onChange={(e) => setNewInstrument({ ...newInstrument, bank: e.target.value })}
              placeholder="e.g. State Bank of India"
            />
          </div>
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsInstrumentOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddInstrument} isLoading={actionLoading}>Submit to Finance</Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
