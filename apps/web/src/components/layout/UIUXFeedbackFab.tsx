'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  MessageSquarePlus,
  X,
  Star,
  CheckCircle2,
  Sparkles,
  Smartphone,
  MousePointerClick,
  SlidersHorizontal,
  ThumbsUp,
  Download,
  Trash2,
  Send,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface UIUXFeedbackItem {
  id: string;
  moduleId: string;
  moduleName: string;
  pathname: string;
  rating: number; // 1-5
  category: string;
  tags: string[];
  comments: string;
  userRole: string;
  userName: string;
  submittedAt: string;
}

const MODULE_ROUTE_MAP: Record<string, { id: string; name: string }> = {
  '/dashboard': { id: 'M10', name: 'Module 10: Command Dashboard' },
  '/leads': { id: 'M1', name: 'Module 1: Lead & Customer Management' },
  '/organisations': { id: 'M1', name: 'Module 1: Lead & Customer Management' },
  '/visits': { id: 'M2', name: 'Module 2: Visit & Field Planning' },
  '/demos': { id: 'M3', name: 'Module 3: Demo Management' },
  '/tenders': { id: 'M4', name: 'Module 4: Tender Management (GeM/CPPP)' },
  '/proposals': { id: 'M5', name: 'Module 5: Proposal Management' },
  '/deliveries': { id: 'M5', name: 'Module 5: Sales Order Deliveries' },
  '/service': { id: 'M6', name: 'Module 6: Service & After-Sales' },
  '/expenses': { id: 'M7', name: 'Module 7: Field Expense Management' },
  '/tasks': { id: 'M8', name: 'Module 8: Task & Productivity' },
  '/regional': { id: 'M9', name: 'Module 9: Regional Analytics' },
  '/reports': { id: 'M9', name: 'Module 9: Sales Performance' },
  '/admin': { id: 'ADMIN', name: 'Administration & Master Data' },
};

const ALL_MODULES = [
  { id: 'M1', name: 'Module 1: Lead & Customer Management' },
  { id: 'M2', name: 'Module 2: Visit & Field Planning' },
  { id: 'M3', name: 'Module 3: Demo Fleet & Depot Coordination' },
  { id: 'M4', name: 'Module 4: Tender Management (GeM/CPPP)' },
  { id: 'M5', name: 'Module 5: Proposal & Delivery Pipeline' },
  { id: 'M6', name: 'Module 6: Service & After-Sales (SLA Clock)' },
  { id: 'M7', name: 'Module 7: Field Expense Management (2-Stage)' },
  { id: 'M8', name: 'Module 8: Task & Productivity (Blockers)' },
  { id: 'M9', name: 'Module 9: Regional & Salesperson Performance' },
  { id: 'M10', name: 'Module 10: Management Command Dashboard' },
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
/** Public pages customers open (service requests, lead chat links). */
const CUSTOMER_ROUTES = ['/service-request', '/lead-chat'];

export const UIUXFeedbackFab: React.FC = () => {
  const pathname = usePathname();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<string>('M1');
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [category, setCategory] = useState<string>('field_ergonomics');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comments, setComments] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [viewHistory, setViewHistory] = useState<boolean>(false);
  const [historyItems, setHistoryItems] = useState<UIUXFeedbackItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-detect active module from URL
  useEffect(() => {
    const matched = Object.entries(MODULE_ROUTE_MAP).find(([route]) => pathname.startsWith(route));
    if (matched) {
      setSelectedModule(matched[1].id);
    }
  }, [pathname]);

  // Listen for custom trigger event
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ moduleId?: string }>;
      if (customEvent.detail?.moduleId) {
        setSelectedModule(customEvent.detail.moduleId);
      }
      setIsOpen(true);
      setViewHistory(false);
    };
    window.addEventListener('open-uiux-feedback', handleOpen);
    return () => window.removeEventListener('open-uiux-feedback', handleOpen);
  }, []);

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
  }, [isOpen]);

  // Handle escape & outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

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
      pathname,
      rating,
      category,
      tags: selectedTags,
      comments: comments.trim(),
      userRole: user?.role || 'Guest',
      userName: user?.full_name || 'Anonymous User',
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
      setIsOpen(false);
    }, 1600);
  };

  const handleDeleteHistory = (id: string) => {
    const filtered = historyItems.filter((item) => item.id !== id);
    setHistoryItems(filtered);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
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

  // Staff-only tool: never on the customer-facing pages
  if (CUSTOMER_ROUTES.some((route) => pathname.startsWith(route))) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 left-5 z-50 flex flex-col items-start select-none font-sans"
    >
      {/* Floating Modal / Panel */}
      {isOpen && (
        <div
          className="app-popup mb-3 w-[360px] sm:w-[460px] max-h-[85vh] flex flex-col rounded-[14px] bg-white border border-[#DCD8CE] shadow-2xl p-4 text-xs text-[#14213D] animate-in fade-in slide-in-from-bottom-3 duration-200"
          style={{
            boxShadow:
              '0 20px 45px -10px rgba(15, 94, 99, 0.22), 0 0 0 1px rgba(220, 216, 206, 0.9)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#ECE9E2] shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[8px] bg-[#E3EFEE] border border-[#0F5E63]/30 flex items-center justify-center text-[#0F5E63]">
                <MessageSquarePlus className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#14213D] flex items-center gap-1.5 font-serif">
                  <span>UI/UX Feedback & Field Ergonomics</span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/30">
                    BOS Blueprint
                  </span>
                </div>
                <div className="text-[10px] text-[#4A5568]">
                  Field usability critique & mobile workflow review
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setViewHistory(!viewHistory)}
                className={`px-2 py-1 rounded-[6px] text-[10px] font-semibold border transition-all ${
                  viewHistory
                    ? 'bg-[#0F5E63] text-white border-[#0F5E63]'
                    : 'bg-[#FBFAF7] text-[#4A5568] border-[#DCD8CE] hover:text-[#14213D]'
                }`}
              >
                {viewHistory ? 'New Feedback' : `Log (${historyItems.length})`}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-[6px] hover:bg-[#ECE9E2] text-[#4A5568] hover:text-[#14213D] transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="mt-3 overflow-y-auto pr-1 flex-1 space-y-3">
            {submitted ? (
              <div className="py-10 text-center flex flex-col items-center justify-center gap-2">
                <CheckCircle2 className="w-10 h-10 text-[#0F5E63] animate-in zoom-in-75 duration-200" />
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Feedback Recorded!</h4>
                <p className="text-[11px] text-[#4A5568] max-w-[260px]">
                  Thank you for helping optimize field ergonomics for Arihant BOS.
                </p>
              </div>
            ) : viewHistory ? (
              /* History View */
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-serif font-bold text-xs text-[#14213D]">
                    Submitted Feedback Log
                  </span>
                  {historyItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportJSON}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0F5E63] hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      <span>Export JSON</span>
                    </button>
                  )}
                </div>

                {historyItems.length === 0 ? (
                  <div className="py-8 text-center text-[#4A5568] text-xs">
                    No feedback records logged yet. Be the first to submit field ergonomics review!
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-[10px] bg-[#FBFAF7] border border-[#DCD8CE] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#0F5E63] font-mono">{item.moduleId}</span>
                        <div className="flex items-center gap-1 text-[#A15C07]">
                          {Array.from({ length: item.rating }).map((_, i) => (
                            <Star key={i} className="w-3 h-3 fill-[#A15C07]" />
                          ))}
                        </div>
                      </div>
                      <div className="font-medium text-[11px] text-[#14213D]">{item.moduleName}</div>
                      {item.comments && (
                        <p className="text-[11px] text-[#4A5568] italic">&ldquo;{item.comments}&rdquo;</p>
                      )}
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.tags.map((t, idx) => (
                            <span
                              key={idx}
                              className="text-[9px] bg-white border border-[#DCD8CE] px-1.5 py-0.5 rounded text-[#14213D]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-[#ECE9E2] text-[9px] text-[#4A5568]">
                        <span>
                          By {item.userName} ({item.userRole})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteHistory(item.id)}
                          className="text-[#881337] hover:text-[#700F2D] p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Feedback Form */
              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Module Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-[#14213D] mb-1">
                    Select Target BOS Module:
                  </label>
                  <select
                    value={selectedModule}
                    onChange={(e) => setSelectedModule(e.target.value)}
                    className="w-full bg-white text-[#14213D] text-xs rounded-[8px] border border-[#C9C4B8] px-2.5 py-1.5 font-medium focus:border-[#0F5E63] focus:outline-none"
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
                  <label className="block text-[11px] font-bold text-[#14213D] mb-1">
                    Field Ergonomics & Usability Rating:
                  </label>
                  <div className="flex items-center gap-1.5 py-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        className="p-1 focus:outline-none transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-5 h-5 ${
                            star <= (hoverRating || rating)
                              ? 'text-[#A15C07] fill-[#A15C07]'
                              : 'text-[#C9C4B8]'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="text-[11px] font-mono font-semibold ml-2 text-[#4A5568]">
                      {rating === 5
                        ? '5/5 — Highly Intuitive'
                        : rating === 4
                        ? '4/5 — Smooth Field UX'
                        : rating === 3
                        ? '3/5 — Usable, Minor Friction'
                        : rating === 2
                        ? '2/5 — Heavy / Repetitive'
                        : '1/5 — Needs Ergonomics Redesign'}
                    </span>
                  </div>
                </div>

                {/* Feedback Category */}
                <div>
                  <label className="block text-[11px] font-bold text-[#14213D] mb-1">
                    Category:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {FEEDBACK_CATEGORIES.map((cat) => {
                      const Icon = cat.icon;
                      const isSel = category === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.id)}
                          className={`flex items-center gap-1.5 p-1.5 rounded-[8px] text-left border text-[11px] font-medium transition-all ${
                            isSel
                              ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#0F5E63] font-bold shadow-xs'
                              : 'bg-[#FBFAF7] border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-white'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Usability Tags */}
                <div>
                  <label className="block text-[11px] font-bold text-[#14213D] mb-1">
                    Quick Usability Chips:
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_QUICK_TAGS.map((tag) => {
                      const active = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
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

                {/* Comments Textarea */}
                <div>
                  <label className="block text-[11px] font-bold text-[#14213D] mb-1">
                    Specific Field Suggestions & UX Notes:
                  </label>
                  <textarea
                    rows={2}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="e.g. In Module 2, when meeting DIG Police, pre-filling previous discussion notes saves 3 minutes on field visits..."
                    className="w-full bg-white text-[#14213D] text-xs rounded-[8px] border border-[#C9C4B8] p-2 focus:border-[#0F5E63] focus:outline-none"
                  />
                </div>

                {/* Submit Action */}
                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  className="bg-[#0F5E63] hover:bg-[#0B4A4E] text-white font-semibold text-xs py-2 mt-1"
                  leftIcon={<Send className="w-3.5 h-3.5" />}
                >
                  Submit UI/UX Field Review
                </Button>
              </form>
            )}
          </div>

          {/* Footer Note */}
          <div className="mt-3 pt-2 border-t border-[#ECE9E2] text-center text-[10px] text-[#4A5568] shrink-0 font-medium">
            Arihant BOS &bull; Live Field Ergonomics Feedback
          </div>
        </div>
      )}

      {/* Floating Action Button (FAB Trigger) */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setViewHistory(false);
        }}
        aria-expanded={isOpen}
        title="UI/UX & Field Ergonomics Feedback"
        className="app-fab flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-white/95 backdrop-blur-md border border-[#DCD8CE] shadow-lg hover:shadow-xl hover:border-[#0F5E63]/50 transition-all duration-200 group text-left cursor-pointer active:scale-98"
        style={{ boxShadow: '0 8px 24px -6px rgba(15, 94, 99, 0.2)' }}
      >
        <div className="relative shrink-0">
          <div className="w-7 h-7 rounded-full bg-[#0F5E63] text-white flex items-center justify-center font-bold text-xs shadow-xs group-hover:scale-105 transition-transform">
            <MessageSquarePlus className="w-3.5 h-3.5" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#9A3412] ring-2 ring-white" />
        </div>

        <div className="flex flex-col min-w-0 pr-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-[#4A5568] uppercase tracking-wider leading-none">
              Feedback
            </span>
            <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded border leading-none bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30">
              UI/UX
            </span>
          </div>
          <div className="text-xs font-bold text-[#14213D] leading-tight truncate">
            Field Review
          </div>
        </div>
      </button>
    </div>
  );
};
