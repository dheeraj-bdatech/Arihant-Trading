'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Send,
  MessageSquare,
  Sparkles,
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
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  PageContainer,
  PageHeader,
  EmptyState,
  Tabs,
  Input,
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

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
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
    return {
      all: notifications.length,
      unread,
      read,
    };
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      // Tab filter
      if (activeTab === 'unread' && item.is_read) return false;
      if (activeTab === 'read' && !item.is_read) return false;

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
  }, [notifications, activeTab, searchQuery]);

  const getEntityLink = (entityType?: string | null, entityId?: string | null) => {
    if (!entityType) return null;
    const type = entityType.toLowerCase();
    switch (type) {
      case 'tender':
        return { label: 'View Tender War Room', href: '/tenders', icon: FileText };
      case 'proposal':
        return { label: 'View Commercial Proposal', href: '/proposals', icon: DollarSign };
      case 'lead':
        return { label: 'View CRM Lead', href: '/leads', icon: Briefcase };
      case 'visit':
        return { label: 'View Tour Planner', href: '/visits', icon: Users };
      case 'task':
        return { label: 'View Task & Milestone', href: '/tasks', icon: CheckSquare };
      case 'delivery':
        return { label: 'View Delivery Register', href: '/deliveries', icon: Truck };
      case 'expense':
        return { label: 'View Expense Record', href: '/reports', icon: DollarSign };
      case 'service':
        return { label: 'View Service Desk', href: '/service', icon: Wrench };
      default:
        return null;
    }
  };

  const getTypeBadge = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('tender')) {
      return <Badge variant="warning" size="sm">Tender Alert</Badge>;
    }
    if (t.includes('proposal')) {
      return <Badge variant="info" size="sm">Proposal</Badge>;
    }
    if (t.includes('lead')) {
      return <Badge variant="cyber" size="sm">Lead Activity</Badge>;
    }
    if (t.includes('task') || t.includes('blocker')) {
      return <Badge variant="urgent" size="sm">Task Milestone</Badge>;
    }
    if (t.includes('expense')) {
      return <Badge variant="warning" size="sm">Expense Claim</Badge>;
    }
    if (t.includes('delivery')) {
      return <Badge variant="info" size="sm">Logistics</Badge>;
    }
    return <Badge variant="default" size="sm">System Notification</Badge>;
  };

  return (
    <PageContainer>
      <PageHeader
        badge="System Updates"
        title="Alerts, Directives & Notifications"
        subtitle="Real-time system events, GeM bid closing alerts, and executive broadcasts."
        icon={<Bell className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNotifications(true)}
              isLoading={isRefreshing}
              leftIcon={<RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />}
            >
              <span>Refresh</span>
            </Button>
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

      {/* Tabs & Search Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <Tabs
          tabs={[
            { id: 'all', label: 'All Alerts', count: counts.all },
            {
              id: 'unread',
              label: 'Unread',
              count: counts.unread,
              badgeVariant: counts.unread > 0 ? 'urgent' : 'default',
            },
            { id: 'read', label: 'Archived', count: counts.read },
          ]}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as 'all' | 'unread' | 'read')}
          variant="segmented"
          size="sm"
        />

        <div className="w-full sm:w-72 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5E6A7C] pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter notifications..."
            className="pl-9 h-9"
          />
        </div>
      </div>

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
              searchQuery
                ? 'No matching notifications found'
                : activeTab === 'unread'
                ? 'All caught up!'
                : activeTab === 'read'
                ? 'No archived notifications'
                : 'No notifications in your inbox'
            }
            description={
              searchQuery
                ? `No alerts match your filter "${searchQuery}". Clear your search or switch tabs.`
                : activeTab === 'unread'
                ? 'You have zero pending unread alerts or directives across all territorial operations.'
                : 'You are fully caught up with all regional alerts, GeM bid updates, and corporate directives.'
            }
            action={
              searchQuery ? (
                <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                  Clear Search Filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          filteredNotifications.map((n) => {
            const entityLink = getEntityLink(n.entity_type, n.entity_id);
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
                          className={`text-sm truncate ${
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

