'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckCircle2,
  Clock,
  Search,
  ExternalLink,
  RotateCw,
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

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchNotifications = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setIsLoading(true);
      else setIsRefreshing(true);

      const res = await api.get('/notifications', { limit: 100 });
      const raw = Array.isArray(res) ? res : res?.data || [];
      const items: NotificationItem[] = raw.map((item: any) => ({
        ...item,
        body: item.body || item.message || '',
        message: item.message || item.body || '',
      }));

      setNotifications(items);

      // Keep navbar unread count perfectly synchronized
      const unreadCount = items.filter((n) => !n.is_read).length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('notifications:updated', {
            detail: { count: unreadCount },
          }),
        );
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, is_read: true } : n));
        const newUnreadCount = next.filter((n) => !n.is_read).length;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('notifications:updated', {
              detail: { count: newUnreadCount },
            }),
          );
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('notifications:updated', { detail: { count: 0 } }),
        );
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.is_read).length;
    const read = notifications.filter((n) => n.is_read).length;
    const byType = {} as Record<NotificationCategory, number>;
    for (const n of notifications) {
      const c = categorize(n.type);
      byType[c] = (byType[c] || 0) + 1;
    }
    return {
      all: notifications.length,
      unread,
      read,
      byType,
    };
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      // Tab filter
      if (activeTab === 'unread' && item.is_read) return false;
      if (activeTab === 'read' && !item.is_read) return false;

      // Type filter
      if (typeFilter !== 'all' && categorize(item.type) !== typeFilter) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(q);
        const bodyMatch = (item.body || item.message || '').toLowerCase().includes(q);
        const typeMatch = item.type?.toLowerCase().includes(q);
        if (!titleMatch && !bodyMatch && !typeMatch) return false;
      }

      return true;
    });
  }, [notifications, activeTab, typeFilter, searchQuery]);

  const hasActiveFilters = Boolean(searchQuery.trim() || activeTab !== 'all' || typeFilter !== 'all');
  const clearFilters = () => {
    setSearchQuery('');
    setActiveTab('all');
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
      case 'trip':
        return { label: 'View Tour Planner', href: '/visits', icon: Users };
      case 'demo':
        return { label: 'Open Demo', href: entityId ? `/demos?open=${entityId}` : '/demos', icon: Briefcase };
      case 'task':
        return { label: 'Open Task', href: entityId ? `/tasks/${entityId}` : '/tasks', icon: CheckSquare };
      case 'task_digest':
        return { label: 'Open Team Tasks', href: '/tasks/team', icon: CheckSquare };
      case 'performance_review':
        return { label: 'Open My Performance', href: '/tasks/my-performance', icon: CheckSquare };
      case 'delivery':
        return { label: 'View Delivery Register', href: '/deliveries', icon: Truck };
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
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-600" />
              <span>Mark All Read</span>
            </Button>
          </div>
        }
      />

      {/* One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              type="search"
              aria-label="Search notifications"
              placeholder="Search title, message, type…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Status"
              icon={<MailOpen />}
              options={[
                { key: 'all', label: 'All alerts', count: counts.all },
                { key: 'unread', label: 'Unread', count: counts.unread, urgent: true },
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
      </div>
    </PageContainer>
  );
}
