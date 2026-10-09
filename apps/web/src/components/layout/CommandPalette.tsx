'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ROLE_PROFILES, formatLakh, type BosModuleKey } from '@arihant/shared';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: 'Tender' | 'Lead' | 'Action' | 'Page';
  href: string;
}

export const CommandPalette: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  const role = user?.role || 'management';
  const roleProfile = ROLE_PROFILES[role];

  const isHrefAllowed = (href: string) => {
    if (!user) return false;
    const path = href.split('?')[0];
    if (path === '/dashboard') return true;
    if (path === '/reports') {
      return ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'].includes(user.role);
    }
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
      subtitle: 'View all 30 live bids, PQ compliance, and closing countdowns',
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
        const promises = [];
        if (isHrefAllowed('/tenders')) {
          promises.push(api.get('/tenders', { search: query, limit: 4 }).catch(() => ({ data: [] })));
        } else {
          promises.push(Promise.resolve({ data: [] }));
        }

        if (isHrefAllowed('/leads')) {
          promises.push(api.get('/leads', { search: query, limit: 4 }).catch(() => ({ data: [] })));
        } else {
          promises.push(Promise.resolve({ data: [] }));
        }

        const [tenderRes, leadRes] = await Promise.all(promises);

        const tenderItems: SearchResult[] = (tenderRes.data || []).map((t: any) => ({
          id: `tender-${t.id}`,
          title: t.tender_no,
          subtitle: `${t.department || 'Govt'} · ${t.title || t.requirement_text || 'Defence Equipment'}`.slice(0, 70),
          category: 'Tender' as const,
          href: `/tenders?highlight=${t.id}`,
        }));

        const leadItems: SearchResult[] = (leadRes.data || []).map((l: any) => {
          const val = l.value_lakh ?? l.estimated_value_lakh;
          return {
            id: `lead-${l.id}`,
            title: l.organisation_name || 'Prospect Client',
            subtitle: `${l.product_name || 'Hardware'}${val !== undefined && val !== null ? ` · Est. ${formatLakh(Number(val))}` : ''}`,
            category: 'Lead' as const,
            href: `/leads?highlight=${l.id}`,
          };
        });

        const filteredStatic = allowedStaticItems.filter(
          (item) =>
            item.title.toLowerCase().includes(query.toLowerCase()) ||
            item.subtitle.toLowerCase().includes(query.toLowerCase()),
        );

        setResults([...tenderItems, ...leadItems, ...filteredStatic]);
      } catch {
        setResults(allowedStaticItems);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, user?.role]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4">
      <div
        className="fixed inset-0 bg-[#2B1A12]/45 backdrop-blur-[3px] transition-opacity"
        onClick={onClose}
      />

      <div className="mt-popup relative w-full max-w-xl rounded-2xl bg-white border border-[#DCD8CE] shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#ECE9E2] bg-[#FBFAF7]">
          <Search className="h-5 w-5 text-[#0F5E63] mr-3 shrink-0" />
          <input
            type="text"
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
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-[#ECE9E2]">
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
            results.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  router.push(item.href);
                  onClose();
                }}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-[#FBFAF7] cursor-pointer transition-colors group"
              >
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="h-8 w-8 rounded-lg bg-[#E3EFEE] flex items-center justify-center text-[#0F5E63] group-hover:bg-[#0F5E63] group-hover:text-white transition-colors shrink-0 border border-[#DCD8CE]">
                    {item.category === 'Tender' && <FileText className="h-4 w-4" />}
                    {item.category === 'Lead' && <Target className="h-4 w-4" />}
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
      </div>
    </div>
  );
};
