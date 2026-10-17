'use client';

import React, { useState, useEffect } from 'react';
import {
  PageContainer,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Tabs,
} from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import {
  MessageSquarePlus,
  Star,
  Smartphone,
  MousePointerClick,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  Download,
  Trash2,
  CheckCircle2,
  Send,
  ShieldCheck,
  Zap,
  Layers,
  FileCheck2,
} from 'lucide-react';
import { UIUXFeedbackItem } from '@/components/layout/UIUXFeedbackFab';

const ALL_MODULES = [
  {
    id: 'M1',
    name: 'Module 1: Lead & Customer Management',
    tagline: 'Customer 360 Anchor & Deduplication',
    ergonomics: '1-click duplicate detection, auto-fill department, rapid contact cards, zero repetitive typing.',
    chips: ['1-Tap Deduplication', 'Pre-filled Dept', 'Rapid Contact Add', 'Interaction Timeline'],
  },
  {
    id: 'M2',
    name: 'Module 2: Visit & Field Planning',
    tagline: '1-Week Advance Itinerary & "Also-Meet" Directives',
    ergonomics: '1-tap route planner, quick "Also-Meet" push directive badges, mobile GPS auto-check-in, voice notes for post-visit updates.',
    chips: ['Also-Meet Badges', 'Auto GPS Check-in', 'Voice Notes', '1-Tap Reschedule'],
  },
  {
    id: 'M3',
    name: 'Module 3: Demo Fleet & Depot Coordination',
    tagline: 'Multi-Depot Stock & Automated Conflict Engine',
    ergonomics: '1-click depot stock checker, auto-conflict warning banners (409), simple technical failure checklist, touch-friendly gate-pass signoff.',
    chips: ['Conflict Warning Banner', 'Depot Stock Glance', '1-Tap Gate Pass', 'Failure Root Cause'],
  },
  {
    id: 'M4',
    name: 'Module 4: Tender Management (GeM/CPPP)',
    tagline: '13-Stage State Machine & Executive Approvals',
    ergonomics: 'Kanban visual stage progression, 1-click management approval modal, portal downtime alerts, pre-filled EMD voucher forms.',
    chips: ['Kanban Drag/1-Click', '1-Click Mgmt Approval', 'Downtime Alert Banner', 'Auto EMD Voucher'],
  },
  {
    id: 'M5',
    name: 'Module 5: Proposal & Delivery Pipeline',
    tagline: 'Quotation Register & Sales Order Conversion',
    ergonomics: '1-click PDF quote generator, auto-increment revision switcher, auto follow-up reminder chips, converted order 1-tap handoff.',
    chips: ['1-Click PDF Quotation', 'Revision Auto-Inc', 'Follow-Up Chips', 'Sales Order 1-Tap'],
  },
  {
    id: 'M6',
    name: 'Module 6: Service & After-Sales (SLA Clock)',
    tagline: 'Real-time SLA Countdown & Mobile Service Reports',
    ergonomics: 'Prominent SLA countdown clock, 1-tap ticket dispatch to nearest engineer, spare stock-out pause toggle, mobile digital signature pad.',
    chips: ['Live SLA Countdown', '1-Tap Tech Dispatch', 'Stock-Out Pause Toggle', 'Digital Sign-off Pad'],
  },
  {
    id: 'M7',
    name: 'Module 7: Field Expense Management (2-Stage)',
    tagline: 'Quick Expense Claim & Tally ERP Export',
    ergonomics: 'Receipt photo snap-and-upload, auto-km travel calculation, 1-swipe approval for Regional Managers, 1-click Tally batch export.',
    chips: ['Receipt Camera Snap', 'Auto-KM Distance', '1-Swipe Stage-1 Endorse', 'Tally 1-Click Export'],
  },
  {
    id: 'M8',
    name: 'Module 8: Task & Productivity (Blockers)',
    tagline: 'Zero-Penalty Blocker Capture & Resolution Flow',
    ergonomics: 'Zero-penalty blocker reporting, 1-click extension request, visual blocker resolution thread, transparent productivity dashboard.',
    chips: ['Zero-Penalty Blocker', '1-Click Extension', 'Threaded Resolution', 'Accountability Evidence'],
  },
  {
    id: 'M9',
    name: 'Module 9: Sales & Regional Analytics',
    tagline: 'Multi-Dimensional Conversion & Vikas PQ Split',
    ergonomics: 'One-glance Vikas PQ vs General tender comparison charts, drill-down conversion funnel, sales rep target progress gauges.',
    chips: ['Vikas PQ / General Split', 'Territory Filter Switch', 'Funnel Speed Visualizer', '1-Click Audit Export'],
  },
  {
    id: 'M10',
    name: 'Module 10: Management Command Dashboard',
    tagline: 'Executive High-Contrast Exception Monitor',
    ergonomics: 'High-contrast Dark Navy (#14213D) HUD, critical items highlighted in Terracotta (#9A3412), 1-click emergency approval hotkeys, real-time live feed.',
    chips: ['High-Contrast Dark HUD', 'Terracotta Urgent Chips', '1-Click Emergency Signoff', 'Live WebSocket Feed'],
  },
];

const FEEDBACK_CATEGORIES = [
  { id: 'field_ergonomics', label: 'Field Ergonomics & Mobile Usability', icon: Smartphone },
  { id: 'typing_reduction', label: 'Too Much Typing / Needs Pre-Fill', icon: MousePointerClick },
  { id: 'workflow_speed', label: 'Workflow Friction / Slow Step', icon: SlidersHorizontal },
  { id: 'visual_contrast', label: 'Visual Clarity & Contrast', icon: Sparkles },
  { id: 'praise_feature', label: 'Delight / Great UX Flow', icon: ThumbsUp },
];

const PRESET_QUICK_TAGS = [
  'Pre-fill Department & Zone',
  '1-Tap Status Advance',
  'Touch target too small',
  'Needs Offline Caching',
  'Add Voice-to-Text remarks',
  'Approval Swipe Gesture',
  'High-contrast card borders',
  'Simplify multi-step modal',
];

const STORAGE_KEY = 'arihant_bos_uiux_feedback_records';

export default function UIUXFeedbackPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('submit');
  const [selectedModule, setSelectedModule] = useState<string>('M1');
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [category, setCategory] = useState<string>('field_ergonomics');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comments, setComments] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [historyItems, setHistoryItems] = useState<UIUXFeedbackItem[]>([]);
  const [filterModule, setFilterModule] = useState<string>('ALL');

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistoryItems(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, [submitted]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const modObj = ALL_MODULES.find((m) => m.id === selectedModule) || {
      id: selectedModule,
      name: `Module ${selectedModule}`,
    };

    const newRecord: UIUXFeedbackItem = {
      id: `FB-${Date.now().toString().slice(-6)}`,
      moduleId: selectedModule,
      moduleName: modObj.name,
      pathname: `/feedback?module=${selectedModule}`,
      rating,
      category,
      tags: selectedTags,
      comments: comments.trim(),
      userRole: user?.role || 'Field Operator',
      userName: user?.full_name || 'Arihant Specialist',
      submittedAt: new Date().toISOString(),
    };

    const updated = [newRecord, ...historyItems];
    setHistoryItems(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }

    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setComments('');
      setSelectedTags([]);
      setRating(5);
      setActiveTab('log');
    }, 1500);
  };

  const handleDelete = (id: string) => {
    const updated = historyItems.filter((item) => item.id !== id);
    setHistoryItems(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(historyItems, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `arihant_bos_uiux_feedback_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const filteredHistory = filterModule === 'ALL'
    ? historyItems
    : historyItems.filter((item) => item.moduleId === filterModule);

  return (
    <PageContainer>
      <PageHeader
        title="UI/UX Feedback & Ergonomics Hub"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handleExportJSON}
            >
              Export JSON
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<MessageSquarePlus className="w-4 h-4" />}
              onClick={() => {
                setActiveTab('submit');
                window.scrollTo({ top: 300, behavior: 'smooth' });
              }}
            >
              Submit Feedback
            </Button>
          </div>
        }
      />

      {/* Hero Header */}
      <div className="p-6 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/30">
            FIELD ERGONOMICS & USABILITY
          </span>
          <span className="text-xs text-[#4A5568]">&bull; Scope Blueprint Standard</span>
        </div>
        <h1 className="font-serif font-bold text-2xl text-[#14213D]">UI/UX Feedback & Ergonomics Hub</h1>
        <p className="text-xs text-[#4A5568] mt-1 max-w-3xl leading-relaxed">
          Continuous review system ensuring the Arihant BOS minimises typing, eliminates duplicate data entry, and accelerates field adoption across Modules 1 to 10.
        </p>
      </div>

      {/* Blueprint Principles Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs">
          <div className="flex items-center gap-2.5 text-[#0F5E63] font-bold text-xs font-serif mb-1">
            <Zap className="w-4 h-4" />
            <span>1-Tap Action Speed</span>
          </div>
          <p className="text-[12px] text-[#4A5568]">
            Key transitions require only a single tap with auto-advancing status pipelines.
          </p>
        </div>

        <div className="p-4 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs">
          <div className="flex items-center gap-2.5 text-[#0F5E63] font-bold text-xs font-serif mb-1">
            <MousePointerClick className="w-4 h-4" />
            <span>Smart Pre-Fill</span>
          </div>
          <p className="text-[12px] text-[#4A5568]">
            Customer, Zone, and Dept auto-populate across all 10 modules from the Organisation anchor.
          </p>
        </div>

        <div className="p-4 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs">
          <div className="flex items-center gap-2.5 text-[#0F5E63] font-bold text-xs font-serif mb-1">
            <Smartphone className="w-4 h-4" />
            <span>Touch Ergonomics</span>
          </div>
          <p className="text-[12px] text-[#4A5568]">
            48px minimum touch targets, thumb-zone buttons, and high-contrast daylight text.
          </p>
        </div>

        <div className="p-4 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs">
          <div className="flex items-center gap-2.5 text-[#0F5E63] font-bold text-xs font-serif mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Zero-Penalty Blockers</span>
          </div>
          <p className="text-[12px] text-[#4A5568]">
            Employees can report committee delays or GeM portal outages without penalty.
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="pt-2">
        <Tabs
          variant="segmented"
          activeTab={activeTab}
          onChange={(val) => setActiveTab(val)}
          tabs={[
            { id: 'submit', label: 'Submit Field Review' },
            { id: 'modules', label: 'Module Ergonomics Blueprint (1–10)' },
            { id: 'log', label: `Feedback Records (${historyItems.length})` },
          ]}
        />
      </div>

      {/* Tab 1: Submit Feedback Form */}
      {activeTab === 'submit' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
          <div className="lg:col-span-2">
            <Card variant="default">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Submit Module Usability Review</CardTitle>
                    <p className="text-xs text-[#4A5568] mt-0.5">
                      Help optimize field ergonomics for defence, police, and GeM procurement workflows.
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[#0F5E63] bg-[#E3EFEE] border-[#0F5E63]/30">
                    BOS Blueprint Standard
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {submitted ? (
                  <div className="py-12 text-center flex flex-col items-center justify-center gap-3">
                    <CheckCircle2 className="w-12 h-12 text-emerald-600 animate-in zoom-in-75 duration-200" />
                    <h3 className="font-serif font-bold text-lg text-[#14213D]">Feedback Recorded!</h3>
                    <p className="text-sm text-[#4A5568] max-w-sm">
                      Your field ergonomics critique has been saved to the audit log. Switching to feedback records...
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Target Module */}
                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1.5">
                        Target Arihant BOS Module:
                      </label>
                      <select
                        value={selectedModule}
                        onChange={(e) => setSelectedModule(e.target.value)}
                        className="w-full bg-white text-[#14213D] text-sm rounded-[8px] border border-[#C9C4B8] p-2.5 font-medium focus:border-[#0F5E63] focus:outline-none"
                      >
                        {ALL_MODULES.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Rating */}
                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1.5">
                        Field Ergonomics & Usability Rating:
                      </label>
                      <div className="flex items-center gap-2 py-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(0)}
                            className="p-1 focus:outline-none transition-transform hover:scale-110 cursor-pointer"
                          >
                            <Star
                              className={`w-6 h-6 ${
                                star <= (hoverRating || rating)
                                  ? 'text-amber-500 fill-amber-500'
                                  : 'text-gray-300'
                              }`}
                            />
                          </button>
                        ))}
                        <span className="text-xs font-mono font-semibold ml-3 text-[#4A5568]">
                          {rating === 5
                            ? '5/5 — Highly Intuitive (Zero Friction)'
                            : rating === 4
                            ? '4/5 — Smooth Field UX'
                            : rating === 3
                            ? '3/5 — Usable, Minor Friction'
                            : rating === 2
                            ? '2/5 — Heavy / Repetitive Typing'
                            : '1/5 — Needs Ergonomics Redesign'}
                        </span>
                      </div>
                    </div>

                    {/* Feedback Category */}
                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1.5">
                        Feedback Category:
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {FEEDBACK_CATEGORIES.map((cat) => {
                          const Icon = cat.icon;
                          const isSel = category === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => setCategory(cat.id)}
                              className={`flex items-center gap-2 p-2.5 rounded-[8px] text-left border text-xs font-medium transition-all cursor-pointer ${
                                isSel
                                  ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#0F5E63] font-bold shadow-xs'
                                  : 'bg-[#FBFAF7] border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-white'
                              }`}
                            >
                              <Icon className="w-4 h-4 shrink-0" />
                              <span className="truncate">{cat.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Quick Usability Tags */}
                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1.5">
                        Quick Usability Tags:
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_QUICK_TAGS.map((tag) => {
                          const active = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                                active
                                  ? 'bg-[#0F5E63] text-white border-[#0F5E63] font-semibold'
                                  : 'bg-white text-[#4A5568] border-[#DCD8CE] hover:border-[#0F5E63]/40'
                              }`}
                            >
                              {active ? `✓ ${tag}` : `+ ${tag}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Specific Comments */}
                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1.5">
                        Detailed Field Usability Remarks:
                      </label>
                      <textarea
                        rows={4}
                        value={comments}
                        onChange={(e) => setComments(e.target.value)}
                        placeholder="e.g. When performing Module 3 demo trials at the Kolkata depot, pre-filling customer gate pass information eliminates 4 minutes of duplicate data entry..."
                        className="w-full bg-white text-[#14213D] text-sm rounded-[8px] border border-[#C9C4B8] p-3 focus:border-[#0F5E63] focus:outline-none"
                      />
                    </div>

                    {/* Submit Button */}
                    <Button
                      type="submit"
                      variant="primary"
                      fullWidth
                      className="bg-[#0F5E63] hover:bg-[#0B4A4E] text-white font-semibold text-sm py-2.5"
                      leftIcon={<Send className="w-4 h-4" />}
                    >
                      Submit UI/UX Field Review
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Active Module Ergonomics Preview */}
          <div className="space-y-4">
            <Card variant="flat" className="border border-[#DCD8CE] bg-[#FBFAF7]">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#0F5E63]" />
                  <CardTitle>Selected Module Ergonomics</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const m = ALL_MODULES.find((mod) => mod.id === selectedModule)!;
                  return (
                    <div className="space-y-3">
                      <div>
                        <span className="font-mono text-xs font-bold text-[#0F5E63]">{m.id}</span>
                        <h4 className="font-serif font-bold text-sm text-[#14213D]">{m.name}</h4>
                        <p className="text-xs text-[#9A3412] font-semibold mt-0.5">{m.tagline}</p>
                      </div>

                      <div className="p-3 rounded-[8px] bg-white border border-[#DCD8CE] text-xs text-[#4A5568] leading-relaxed">
                        {m.ergonomics}
                      </div>

                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-[#14213D]">Key Ergonomics Directives:</span>
                        <div className="flex flex-wrap gap-1">
                          {m.chips.map((chip, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <Card variant="default">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-[#9A3412]" />
                  <CardTitle>Scope Blueprint Rule §4</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-[#4A5568] leading-relaxed">
                  &ldquo;Adoption is a functional requirement, not merely a UI consideration. The system should minimise: Long forms, duplicate entry, typing, complicated navigation. Preferred patterns: Pre-filled data, dropdowns, quick actions, 1-click updates, contextual forms.&rdquo;
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Tab 2: Module Ergonomics Blueprint (1 to 10) */}
      {activeTab === 'modules' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {ALL_MODULES.map((m) => (
            <Card key={m.id} variant="default" className="flex flex-col justify-between">
              <div>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-[#0F5E63]">{m.id}</span>
                      <CardTitle className="mt-0.5">{m.name}</CardTitle>
                      <p className="text-xs text-[#9A3412] font-medium mt-0.5">{m.tagline}</p>
                    </div>
                    <Badge variant="outline" className="text-[#0F5E63] bg-[#E3EFEE] border-[#0F5E63]/30">
                      Ergonomics Standard
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-[#4A5568] leading-relaxed">{m.ergonomics}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {m.chips.map((chip, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-[#FBFAF7] border border-[#DCD8CE] text-[#14213D]"
                      >
                        ✓ {chip}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </div>

              <div className="p-4 pt-0">
                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  onClick={() => {
                    setSelectedModule(m.id);
                    setActiveTab('submit');
                    window.scrollTo({ top: 400, behavior: 'smooth' });
                  }}
                  leftIcon={<MessageSquarePlus className="w-3.5 h-3.5 text-[#0F5E63]" />}
                >
                  Review Module {m.id} Usability
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tab 3: Feedback History Log */}
      {activeTab === 'log' && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between flex-wrap gap-3 p-3 bg-white border border-[#DCD8CE] rounded-[14px]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#14213D]">Filter by Module:</span>
              <select
                value={filterModule}
                onChange={(e) => setFilterModule(e.target.value)}
                className="bg-[#FBFAF7] text-xs font-medium border border-[#C9C4B8] rounded-[6px] px-2 py-1 focus:outline-none"
              >
                <option value="ALL">All Modules ({historyItems.length})</option>
                {ALL_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportJSON}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Export JSON
              </Button>
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <Card variant="flat">
              <CardContent className="py-12 text-center text-[#4A5568]">
                <MessageSquarePlus className="w-10 h-10 mx-auto text-[#0F5E63]/40 mb-2" />
                <h4 className="font-serif font-bold text-sm text-[#14213D]">No Feedback Records Found</h4>
                <p className="text-xs text-[#4A5568] mt-1 max-w-sm mx-auto">
                  Submit a review for any of the 10 modules to record usability critiques and field ergonomics telemetry.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setActiveTab('submit')}
                >
                  Submit First Review
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-[14px] bg-white border border-[#DCD8CE] shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-[#0F5E63]">{item.moduleId}</span>
                      <span className="text-xs font-bold text-[#14213D] truncate max-w-[200px]">
                        {item.moduleName}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 text-amber-500">
                      {Array.from({ length: item.rating }).map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 fill-amber-500" />
                      ))}
                    </div>
                  </div>

                  {item.comments && (
                    <p className="text-xs text-[#4A5568] italic bg-[#FBFAF7] p-2.5 rounded-[8px] border border-[#ECE9E2]">
                      &ldquo;{item.comments}&rdquo;
                    </p>
                  )}

                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] bg-white border border-[#DCD8CE] px-2 py-0.5 rounded text-[#14213D]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-[#ECE9E2] text-[11px] text-[#4A5568]">
                    <span>
                      Logged by <strong className="text-[#14213D]">{item.userName}</strong> ({item.userRole})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 hover:text-red-700 p-1 cursor-pointer"
                      title="Delete record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
