'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  FileText,
  Target,
  Calendar,
  Box,
  Receipt,
  CheckSquare,
  Shield,
  ArrowRight,
  X,
  Building2,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canOpen } from '@/lib/route-access';
import { canRead } from '@/lib/module-access';
import { ROLE_PROFILES, formatLakh, type BosModuleKey } from '@arihant/shared';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: 'Tender' | 'Lead' | 'Account' | 'Ticket' | 'Action' | 'Page';
  href: string;
}

/** Records fetched per source; enough that a buyer with several open bids is not cut short. */
const PER_SOURCE = 8;
const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []);

export const CommandPalette: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user } = useAuth();

  const role = user?.role || 'management';
  const roleProfile = ROLE_PROFILES[role];

  const isHrefAllowed = (href: string) => {
    if (!user) return false;
    const path = href.split('?')[0];
    if (path === '/dashboard' || path === '/feedback') return true;
    if (!canOpen(user.role, href)) return false;
    if (path === '/reports' || (path === '/tenders' && user.role === 'sales')) return true;
    const moduleKey = path.replace('/', '') as BosModuleKey;
    return roleProfile?.allowedModules?.includes(moduleKey);
  };

  // Navigation static items
  const staticItems: SearchResult[] = [
    {
      id: 'page-regional',
      title: 'Regional Territory Command Hub',
      subtitle: 'North Zone quota, visits, leads, tenders & employee scorecard',
      category: 'Page',
      href: '/regional',
    },
    {
      id: 'page-tenders',
      title: 'GeM Defence Tenders Pipeline',
      subtitle: 'Live bids, PQ compliance, and closing countdowns',
      category: 'Page',
      href: '/tenders',
    },
    {
      id: 'page-leads',
      title: 'Leads & Accounts CRM Funnel',
      subtitle: 'Active, Expected, Follow-Up deal pipeline in Lakhs',
      category: 'Page',
      href: '/leads',
    },
    {
      id: 'page-visits',
      title: 'Client Tour Planner & Also-Meet Directives',
      subtitle: 'Field travel calendar, scheduled visits & manager directives',
      category: 'Page',
      href: '/visits',
    },
    {
      id: 'page-demos',
      title: 'Demo Fleet Matrix & Depot Inventory',
      subtitle: 'Delhi, Patna, Kolkata depots, hardware reservations & trials',
      category: 'Page',
      href: '/demos',
    },
    {
      id: 'page-proposals',
      title: 'Commercial Proposals & Quotations',
      subtitle: 'Price quotes, margin reviews, and client bid submissions',
      category: 'Page',
      href: '/proposals',
    },
    {
      id: 'page-service',
      title: 'Customer Service & Breakdown Tickets',
      subtitle: 'Emergency incident response, warranty vs AMC fleet, spare parts',
      category: 'Page',
      href: '/service',
    },
    {
      id: 'page-expenses',
      title: 'Two-Stage Expense Claims & Reimbursements',
      subtitle: 'Stage 1 RM endorsement and Stage 2 Accounts payout audit',
      category: 'Page',
      href: '/expenses',
    },
    {
      id: 'page-tasks',
      title: 'Action Tasks & Blocker Clearance',
      subtitle: 'Deliverable milestones, blocker categorization & clearance',
      category: 'Page',
      href: '/tasks',
    },
    {
      id: 'page-admin',
      title: 'Enterprise Administration & Access Controls',
      subtitle: 'Users directory, department hierarchy, equipment masters & audit logs',
      category: 'Page',
      href: '/admin',
    },
    {
      id: 'page-feedback',
      title: 'UI/UX & Field Ergonomics Review Hub',
      subtitle: 'Review Blueprint §4 rules, submit field usability feedback, and view logs',
      category: 'Page',
      href: '/feedback',
    },
    {
      id: 'action-feedback',
      title: 'Action: Submit UI/UX Field Ergonomics Feedback',
      subtitle: 'Rate mobile usability, typing friction, and 1-tap accelerators',
      category: 'Action',
      href: '/feedback',
    },
    {
      id: 'action-visit',
      title: 'Action: Plan New Client Tour Visit',
      subtitle: 'Schedule meetings with BSF, CISF, Army, or State Police',
      category: 'Action',
      href: '/visits',
    },
    {
      id: 'action-claim',
      title: 'Action: Submit Travel Expense Claim',
      subtitle: 'Upload hotel, conveyance, or freight receipt for verification',
      category: 'Action',
      href: '/expenses',
    },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const allowedStaticItems = staticItems.filter((item) => isHrefAllowed(item.href));

  useEffect(() => {
    if (!query.trim()) {
      setResults(allowedStaticItems);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const role = user?.role;
        const none = Promise.resolve({ data: [] });
        const q = query.trim();
        // Each source only when the role may both read it and open the page the result links to.
        const [tenderRes, leadRes, orgRes, ticketRes] = await Promise.all([
          isHrefAllowed('/tenders') ? api.get('/tenders', { search: q, limit: PER_SOURCE }).catch(() => ({ data: [] })) : none,
          isHrefAllowed('/leads') ? api.get('/leads', { search: q, limit: PER_SOURCE }).catch(() => ({ data: [] })) : none,
          isHrefAllowed('/leads') && canRead(role, 'organisations')
            ? api.get('/organisations', { search: q, limit: 5 }).catch(() => ({ data: [] }))
            : none,
          canOpen(role, '/service') && canRead(role, 'service')
            ? api.get('/service/tickets', { search: q, limit: 5 }).catch(() => ({ data: [] }))
            : none,
        ]);

        const tenderItems: SearchResult[] = rowsOf(tenderRes).map((t: any) => {
          const buyer = t.organisation_name || t.organisation || t.buyer_name || t.department || 'Government buyer';
          const what = t.title || t.requirement_text || (t.category ? `${String(t.category).replace(/_/g, ' ').toUpperCase()} tender` : '');
          return {
            id: `tender-${t.id}`,
            title: t.tender_no || t.tender_number || 'Tender',
            subtitle: [buyer, what].filter(Boolean).join(' · ').slice(0, 90),
            category: 'Tender' as const,
            href: `/tenders?highlight=${t.id}`,
          };
        });

        const orgItems: SearchResult[] = rowsOf(orgRes).map((o: any) => ({
          id: `org-${o.id}`,
          title: o.name || 'Customer account',
          subtitle: ['Customer 360', o.sector, [o.city, o.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
          category: 'Account' as const,
          href: `/leads?customer=${o.id}`,
        }));

        const ticketItems: SearchResult[] = rowsOf(ticketRes).map((t: any) => ({
          id: `ticket-${t.id}`,
          title: t.ticket_no || t.ticket_number || 'Service ticket',
          subtitle: [t.organisation_name || t.customer_name || t.claimed_organisation_name, String(t.status || '').replace(/_/g, ' ')]
            .filter(Boolean)
            .join(' · '),
          category: 'Ticket' as const,
          href: `/service?open=${t.id}`,
        }));

        const leadItems: SearchResult[] = rowsOf(leadRes).map((l: any) => {
          const val = l.value_lakh ?? l.estimated_value_lakh;
          return {
            id: `lead-${l.id}`,
            title: l.organisation_name || 'Prospect Client',
            subtitle: `${l.product_name || 'Hardware'}${val !== undefined && val !== null ? ` · Est. ${formatLakh(Number(val))}` : ''}`,
            category: 'Lead' as const,
            href: `/leads?open=${l.id}`,
          };
        });

        const filteredStatic = allowedStaticItems.filter(
          (item) =>
            item.title.toLowerCase().includes(query.toLowerCase()) ||
            item.subtitle.toLowerCase().includes(query.toLowerCase()),
        );

        setResults([...tenderItems, ...orgItems, ...leadItems, ...ticketItems, ...filteredStatic]);
      } catch {
        setResults(allowedStaticItems);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, user?.role]);

  // New result set → highlight the top result, so Enter opens it.
  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActive(0);
    }
  }, [isOpen]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openResult = (item: SearchResult | undefined) => {
    if (!item) return;
    router.push(item.href);
    onClose();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isLoading && e.key === 'Enter') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Home' && results.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && results.length) {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openResult(results[active]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4">
      <div
        className="fixed inset-0 bg-[#2B1A12]/45 backdrop-blur-[3px] transition-opacity"
        onClick={onClose}
      />

      <div className="app-popup relative w-full max-w-xl rounded-2xl bg-white border border-[#DCD8CE] shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#ECE9E2] bg-[#FBFAF7]">
          <Search className="h-5 w-5 text-[#0F5E63] mr-3 shrink-0" />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-results"
            aria-activedescendant={results[active] ? `cmd-opt-${results[active].id}` : undefined}
            aria-label="Search records and pages"
            onKeyDown={onInputKeyDown}
            autoFocus
            placeholder="Type a command or search tenders, leads, visits..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-[#14213D] placeholder:text-[#4A5568] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded text-[#4A5568] hover:text-[#14213D]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono bg-[#E3EFEE] text-[#0F5E63] rounded border border-[#DCD8CE] ml-2 font-semibold">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto p-2 divide-y divide-[#ECE9E2]">
          {isLoading && (
            <div className="p-4 text-center text-xs text-[#4A5568]">
              Searching database...
            </div>
          )}

          {!isLoading && results.length === 0 && (
            <div className="p-6 text-center text-xs text-[#4A5568]">
              No matching records found for "{query}".
            </div>
          )}

          {!isLoading &&
            results.map((item, index) => (
              <div
                key={item.id}
                id={`cmd-opt-${item.id}`}
                role="option"
                aria-selected={index === active}
                data-index={index}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => openResult(item)}
                className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors group ${
                  index === active ? 'bg-[#E3EFEE] ring-1 ring-[#0F5E63]/30' : 'hover:bg-[#FBFAF7]'
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="h-8 w-8 rounded-lg bg-[#E3EFEE] flex items-center justify-center text-[#0F5E63] group-hover:bg-[#0F5E63] group-hover:text-white transition-colors shrink-0 border border-[#DCD8CE]">
                    {item.category === 'Tender' && <FileText className="h-4 w-4" />}
                    {item.category === 'Lead' && <Target className="h-4 w-4" />}
                    {item.category === 'Account' && <Building2 className="h-4 w-4" />}
                    {item.category === 'Ticket' && <Wrench className="h-4 w-4" />}
                    {item.category === 'Action' && <CheckSquare className="h-4 w-4" />}
                    {item.category === 'Page' && <ArrowRight className="h-4 w-4" />}
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-semibold text-[#14213D] group-hover:text-[#0F5E63] transition-colors truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[#4A5568] truncate">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] uppercase font-bold text-[#0F5E63] px-2 py-0.5 rounded bg-[#E3EFEE] border border-[#DCD8CE] shrink-0 ml-2">
                  {item.category}
                </span>
              </div>
            ))}
        </div>
        <div className="hidden items-center gap-3 border-t border-[#ECE9E2] bg-[#FBFAF7] px-4 py-2 font-mono text-[10px] text-[#4A5568] sm:flex">
          <span><kbd className="rounded border border-[#DCD8CE] bg-white px-1">↑</kbd> <kbd className="rounded border border-[#DCD8CE] bg-white px-1">↓</kbd> move</span>
          <span><kbd className="rounded border border-[#DCD8CE] bg-white px-1">Enter</kbd> open</span>
          <span><kbd className="rounded border border-[#DCD8CE] bg-white px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
};
