'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckCircle2,
  Clock,
  Search,
  ExternalLink,
  FileText,
  DollarSign,
  Briefcase,
  CheckSquare,
  Truck,
  Wrench,
  Users,
  Layers,
  MailOpen,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canOpen } from '@/lib/route-access';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  PageContainer,
  PageHeader,
  EmptyState,
  FilterMenu,
  InfoCallout,
} from '@/components/ui';

interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  message?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  created_at: string;
}

type NotificationCategory = 'tender' | 'proposal' | 'lead' | 'task' | 'expense' | 'delivery' | 'system';

const CATEGORY_ORDER: NotificationCategory[] = ['tender', 'proposal', 'lead', 'task', 'expense', 'delivery', 'system'];

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; badgeLabel: string; badge: 'warning' | 'info' | 'cyber' | 'urgent' | 'default' }
> = {
  tender: { label: 'Tender alerts', badgeLabel: 'Tender Alert', badge: 'warning' },
  proposal: { label: 'Proposals', badgeLabel: 'Proposal', badge: 'info' },
  lead: { label: 'Lead activity', badgeLabel: 'Lead Activity', badge: 'cyber' },
  task: { label: 'Tasks & blockers', badgeLabel: 'Task Milestone', badge: 'urgent' },
  expense: { label: 'Expense claims', badgeLabel: 'Expense Claim', badge: 'warning' },
  delivery: { label: 'Logistics', badgeLabel: 'Logistics', badge: 'info' },
  system: { label: 'System', badgeLabel: 'System Notification', badge: 'default' },
};

/** Same precedence as the type badge: the first keyword that matches wins. */
function categorize(type: string | null | undefined): NotificationCategory {
  const t = (type || '').toLowerCase();
  if (t.includes('tender')) return 'tender';
  if (t.includes('proposal')) return 'proposal';
  if (t.includes('lead')) return 'lead';
  if (t.includes('task') || t.includes('blocker')) return 'task';
  if (t.includes('expense')) return 'expense';
  if (t.includes('delivery')) return 'delivery';
  return 'system';
}

const PAGE_SIZE = 50;
type Summary = { all: number; unread: number; read: number; byType: Partial<Record<NotificationCategory, number>> };
const EMPTY_SUMMARY: Summary = { all: 0, unread: 0, read: 0, byType: {} };

/** Tell the header bell the server's unread count (never a count of the rows loaded on this page). */
const announceUnread = (count: number) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('notifications:updated', { detail: { count } }));
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // DEF-106: the inbox opens on unread items, so a dismissed alert leaves the list straight away; "Read (archived)"
  // and "All alerts" still find it.
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('unread');
  const [typeFilter, setTypeFilter] = useState<NotificationCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/notifications/summary');
      const next: Summary = { all: res?.all || 0, unread: res?.unread || 0, read: res?.read || 0, byType: res?.byType || {} };
      setSummary(next);
      announceUnread(next.unread);
    } catch {
      /* the list still loads; counts stay as they were */
    }
  }, []);

  const fetchPage = useCallback(
    async (pageNo: number) => {
      const params: Record<string, string | number> = { page: pageNo, limit: PAGE_SIZE, status: activeTab };
      if (typeFilter !== 'all') params.category = typeFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await api.get('/notifications', params);
      const raw = Array.isArray(res) ? res : res?.data || [];
      const items: NotificationItem[] = raw.map((item: any) => ({
        ...item,
        body: item.body || item.message || '',
        message: item.message || item.body || '',
      }));
      return { items, total: Number(res?.total ?? items.length) };
    },
    [activeTab, typeFilter, debouncedSearch],
  );

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [{ items, total: t }] = await Promise.all([fetchPage(1), fetchSummary()]);
      setNotifications(items);
      setTotal(t);
      setPage(1);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load notifications');
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, fetchSummary]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const loadMore = async () => {
    setIsLoadingMore(true);
    try {
      const { items, total: t } = await fetchPage(page + 1);
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...items.filter((n) => !seen.has(n.id))];
      });
      setTotal(t);
      setPage((p) => p + 1);
    } catch (err: any) {
      setActionError(err?.message || 'Could not load more notifications');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    setActionError(null);
    try {
      const res = await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        activeTab === 'unread' ? prev.filter((n) => n.id !== id) : prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      if (activeTab === 'unread') setTotal((t) => Math.max(0, t - 1));
      const unread = typeof res?.unreadCount === 'number' ? res.unreadCount : Math.max(0, summary.unread - 1);
      setSummary((s) => ({ ...s, unread, read: s.all - unread }));
      announceUnread(unread);
    } catch (err: any) {
      setActionError(err?.message || 'Could not dismiss the notification');
    }
  };

  const handleMarkAllRead = async () => {
    setActionError(null);
    try {
      await api.patch('/notifications/read-all');
      announceUnread(0);
      await fetchNotifications();
    } catch (err: any) {
      setActionError(err?.message || 'Could not mark all notifications as read');
    }
  };

  const counts = useMemo(() => ({ all: summary.all, unread: summary.unread, read: summary.read, byType: summary.byType }), [summary]);
  const filteredNotifications = notifications;
  const hasMore = notifications.length < total;

  const hasActiveFilters = Boolean(searchQuery.trim() || activeTab !== 'unread' || typeFilter !== 'all');
  const clearFilters = () => {
    setSearchQuery('');
    setActiveTab('unread');
    setTypeFilter('all');
  };


  const getEntityLink = (entityType?: string | null, entityId?: string | null) => {
    if (!entityType) return null;
    const type = entityType.toLowerCase();
    switch (type) {
      case 'tender':
        return { label: 'View Tender War Room', href: entityId ? `/tenders?highlight=${entityId}` : '/tenders', icon: FileText };
      case 'proposal':
        return { label: 'View Commercial Proposal', href: entityId ? `/proposals?open=${entityId}` : '/proposals', icon: DollarSign };
      case 'lead':
        return { label: 'View CRM Lead', href: entityId ? `/leads?open=${entityId}` : '/leads', icon: Briefcase };
      case 'follow_up':
        return { label: 'View Follow-ups', href: '/leads', icon: Briefcase };
      case 'visit':
        return { label: 'View Visit', href: entityId ? `/visits?open=${entityId}` : '/visits', icon: Users };
      case 'trip':
        return { label: 'View Tour Planner', href: '/visits', icon: Users };
      case 'demo':
        return { label: 'Open Demo', href: entityId ? `/demos?open=${entityId}` : '/demos', icon: Briefcase };
      case 'task':
        return { label: 'Open Task', href: entityId ? `/tasks/${entityId}` : '/tasks', icon: CheckSquare };
      case 'task_digest':
        return { label: 'Open Team Tasks', href: '/tasks/team', icon: CheckSquare };
      case 'performance_review':
        return { label: 'Open My Performance', href: '/performance', icon: CheckSquare };
      case 'delivery':
        return { label: 'View Delivery', href: entityId ? `/deliveries?open=${entityId}` : '/deliveries', icon: Truck };
      case 'expense':
      case 'expense_claim':
        return { label: 'Open Expense Claim', href: entityId ? `/expenses/${entityId}` : '/expenses', icon: DollarSign };
      case 'expense_queue':
        return { label: 'Open Expense Approvals', href: '/expenses/approvals', icon: DollarSign };
      case 'service':
      case 'service_ticket':
        return { label: 'Open Service Ticket', href: entityId ? `/service?open=${entityId}` : '/service', icon: Wrench };
      default:
        return null;
    }
  };

  const getTypeBadge = (type: string) => {
    const meta = CATEGORY_META[categorize(type)];
    return <Badge variant={meta.badge} size="sm">{meta.badgeLabel}</Badge>;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Alerts, Directives & Notifications"
        icon={<Bell className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={counts.unread === 0}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-[#0F5E63]" />
              <span>Mark All Read</span>
            </Button>
          </div>
        }
      />

      {/* One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search notifications"
              placeholder="Search title, message, type…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Status"
              icon={<MailOpen />}
              options={[
                { key: 'unread', label: 'Unread (inbox)', count: counts.unread, urgent: true },
                { key: 'all', label: 'All alerts', count: counts.all },
                { key: 'read', label: 'Read (archived)', count: counts.read },
              ].map((o) => ({
                ...o,
                active: activeTab === o.key,
                onSelect: () => setActiveTab(o.key as 'all' | 'unread' | 'read'),
              }))}
            />
            <FilterMenu
              label="Type"
              icon={<Layers />}
              options={[
                { key: 'all', label: 'All types', count: counts.all },
                ...CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_META[c].label, count: counts.byType[c] || 0 })),
              ].map((o) => ({
                ...o,
                active: typeFilter === o.key,
                onSelect: () => setTypeFilter(o.key as NotificationCategory | 'all'),
              }))}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {(loadError || actionError) && (
        <InfoCallout
          variant="danger"
          title={loadError ? 'Could not load notifications' : 'Action failed'}
          onClose={() => {
            setLoadError(null);
            setActionError(null);
          }}
        >
          {loadError || actionError}
        </InfoCallout>
      )}

      {/* Notifications List */}
      <div className="space-y-3 pt-1">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-[14px] shadow-2xs space-y-2">
            <div className="h-6 w-6 border-2 border-[#0F5E63] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="font-medium">Loading notifications inbox...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={
              searchQuery || typeFilter !== 'all'
                ? 'No matching notifications found'
                : activeTab === 'unread'
                ? 'All caught up!'
                : activeTab === 'read'
                ? 'No archived notifications'
                : 'No notifications in your inbox'
            }
            description={
              searchQuery
                ? `No alerts match your filter "${searchQuery}". Clear your search or change the filters.`
                : typeFilter !== 'all'
                ? `No ${CATEGORY_META[typeFilter].label.toLowerCase()} notifications in this view.`
                : activeTab === 'unread'
                ? 'You have zero pending unread alerts or directives across all territorial operations.'
                : 'You are fully caught up with all regional alerts, GeM bid updates, and corporate directives.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          filteredNotifications.map((n) => {
            const target = getEntityLink(n.entity_type, n.entity_id);
            const entityLink = target && canOpen(user?.role, target.href) ? target : null;
            const content = n.message || n.body || '';

            return (
              <Card
                key={n.id}
                padding="sm"
                accent={!n.is_read ? 'red' : 'none'}
                className={`transition-all ${
                  !n.is_read
                    ? 'bg-white border-[#C9C4B8] shadow-xs'
                    : 'bg-[#FBFAF7]/70 border-[#ECE9E2]'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
                  <div className="flex items-start space-x-3 min-w-0 flex-1">
                    {/* Visual Unread / Type Indicator */}
                    <div
                      className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        !n.is_read
                          ? 'bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/30 shadow-2xs'
                          : 'bg-[#FBFAF7] text-[#5E6A7C] border border-[#DCD8CE]'
                      }`}
                    >
                      <Bell className="h-4 w-4" />
                    </div>

                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {getTypeBadge(n.type)}
                        <span
                          className={`text-sm min-w-0 max-w-full break-words ${
                            !n.is_read
                              ? 'font-bold text-[#14213D]'
                              : 'font-semibold text-[#35463F]'
                          }`}
                        >
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span
                            className="h-2 w-2 rounded-full bg-[#B42318] inline-block shrink-0 animate-pulse"
                            title="Unread notification"
                          />
                        )}
                      </div>

                      {content && (
                        <p className="text-xs text-[#4A5568] leading-relaxed break-words">
                          {content}
                        </p>
                      )}

                      <div className="flex items-center space-x-3 text-[11px] font-mono text-[#5E6A7C] pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-[#5E6A7C]" />
                          {new Date(n.created_at).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                        {n.entity_type && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-white border border-[#DCD8CE] text-[#0F5E63]">
                            {n.entity_type}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions: Direct link & Dismiss */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {entityLink && (
                      <Link href={entityLink.href}>
                        <Button
                          size="xs"
                          variant="outline"
                          rightIcon={<ExternalLink className="h-3 w-3" />}
                        >
                          {entityLink.label}
                        </Button>
                      </Link>
                    )}

                    {!n.is_read && (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => handleMarkAsRead(n.id)}
                        className="text-[#0F5E63] font-semibold"
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
        {!isLoading && filteredNotifications.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-2 text-[11px] text-[#4A5568]">
            <span className="font-mono">
              Showing {filteredNotifications.length} of {total}
            </span>
            {hasMore && (
              <Button variant="secondary" size="sm" onClick={loadMore} isLoading={isLoadingMore}>
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
