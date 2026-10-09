'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Plus,
  AlertTriangle,
  Clock,
  CheckCircle2,
  User,
  Calendar,
  ShieldCheck,
  Sparkles,
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
  EmptyState, PageLoader, ToolbarBox } from '@/components/ui';

export default function TasksPage() {
  const { user, hasRole } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');


  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBlockerOpen, setIsBlockerOpen] = useState(false);
  const [isResolveOpen, setIsResolveOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  // Blocker forms
  const [blockerReason, setBlockerReason] = useState('');
  const [blockerType, setBlockerType] = useState('vendor');
  const [blockerDecision, setBlockerDecision] = useState<'accepted' | 'rejected' | 'extended' | 'reassigned' | 'escalated'>('accepted');
  const [newDeadline, setNewDeadline] = useState('');
  const [activeBlockerId, setActiveBlockerId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'high',
    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/tasks', {
        status: activeTab !== 'all' ? activeTab : undefined,
        limit: 50,
      });
      setTasks(res.data || []);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [activeTab]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post('/tasks', {
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        deadline: newTask.deadline,
      });

      setIsCreateOpen(false);
      setNewTask({
        title: '',
        description: '',
        priority: 'high',
        deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });
      await fetchTasks();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create task.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkBlocked = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/tasks/${selectedTask.id}/blockers`, {
        blocker_type: blockerType,
        description: blockerReason,
      });

      setIsBlockerOpen(false);
      setBlockerReason('');
      await fetchTasks();
    } catch (err: any) {
      setActionError(err.message || 'Failed to flag blocker.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openResolveModal = async (task: any) => {
    setSelectedTask(task);
    setActionError(null);
    try {
      const detail = await api.get(`/tasks/${task.id}`);
      if (detail.blockers && detail.blockers.length > 0) {
        setActiveBlockerId(detail.blockers[0].id);
      }
    } catch (e) {
      console.error('Failed to load task blockers', e);
    }
    setIsResolveOpen(true);
  };

  const handleResolveBlocker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      let bId = activeBlockerId;
      if (!bId) {
        const detail = await api.get(`/tasks/${selectedTask.id}`);
        bId = detail.blockers?.[0]?.id;
      }
      if (!bId) {
        throw new Error('No active blocker record found to resolve.');
      }

      await api.patch(`/tasks/${selectedTask.id}/blockers/${bId}/resolve`, {
        decision: blockerDecision,
        new_deadline: blockerDecision === 'extended' && newDeadline ? newDeadline : undefined,
      });

      setIsResolveOpen(false);
      setResolutionNotes('');
      setActiveBlockerId(null);
      await fetchTasks();
    } catch (err: any) {
      setActionError(err.message || 'Failed to resolve blocker.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await api.patch(`/tasks/${taskId}`, {
        status: 'completed',
      });
      await fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Failed to complete task');
    }
  };

  return (
    <PageContainer>
      {/* Top Header */}
      <PageHeader
        title="Action Deliverables & Blocker Management"
        icon={<CheckSquare className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            variant="primary"
            className="shadow-xs"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            <span>New Action Task</span>
          </Button>
        }
      />

      {/* Tabs */}
      <ToolbarBox>
      <Tabs
        tabs={[
          { id: 'all', label: 'All Tasks' },
          { id: 'blocked', label: 'Blocked Milestones', badgeVariant: 'urgent' },
          { id: 'pending', label: 'In Progress / Pending' },
          { id: 'completed', label: 'Completed' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      </ToolbarBox>

      {/* Task List */}
      <div className="space-y-3">
        {isLoading ? (
          <PageLoader label="Loading tasks" />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No tasks in this category"
            description="All operational tasks and action deliverables are currently up to date."
          />
        ) : (
          tasks.map((task) => {
            const isBlocked = task.status === 'blocked' || !!task.blocker_reason;
            const isCompleted = task.status === 'completed';

            return (
              <Card
                key={task.id}
                padding="sm"
                accent={isBlocked ? 'amber' : 'none'}
                className="flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center space-x-2">
                    <Badge
                      variant={
                        isCompleted
                          ? 'success'
                          : isBlocked
                          ? 'urgent'
                          : task.priority === 'urgent'
                          ? 'danger'
                          : 'default'
                      }
                      size="sm"
                    >
                      {task.status.toUpperCase()}
                    </Badge>
                    <span className="font-bold text-[#14213D] text-sm">{task.title}</span>
                  </div>

                  <p className="text-xs text-[#14213D] font-medium">{task.description}</p>

                  <div className="flex flex-wrap items-center gap-x-4 text-[11px] text-[#4A5568]">
                    <span className="flex items-center gap-1 text-[#4A5568]">
                      <User className="h-3.5 w-3.5 text-[#4A5568]" />
                      Assignee: {task.assignee_name || 'Self'}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[#4A5568]">
                      <Calendar className="h-3.5 w-3.5 text-[#4A5568]" />
                      Deadline: {new Date(task.deadline).toLocaleDateString('en-IN')}
                    </span>
                  </div>

                  {/* Blocker Callout Banner */}
                  {task.blocker_reason && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start space-x-2.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold uppercase tracking-wider block text-[10px] text-amber-800">
                          BLOCKER OBSTACLE:
                        </span>
                        <p className="mt-0.5">{task.blocker_reason}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Task Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Flag Blocker */}
                  {!isBlocked && !isCompleted && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedTask(task);
                        setIsBlockerOpen(true);
                      }}
                      className="border-amber-300 text-amber-800 hover:bg-amber-50"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                      <span>Flag Blocker</span>
                    </Button>
                  )}

                  {/* Resolve Blocker (Manager/Admin) */}
                  {isBlocked && hasRole(['management', 'regional_manager', 'admin']) && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => openResolveModal(task)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                      <span>Resolve Blocker</span>
                    </Button>
                  )}

                  {/* Complete Task */}
                  {!isCompleted && !isBlocked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCompleteTask(task.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                      <span>Mark Complete</span>
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Flag Blocker Modal */}
      <Modal
        isOpen={isBlockerOpen}
        onClose={() => setIsBlockerOpen(false)}
        title="Flag Operational Blocker"
        description="Notify management of external or technical impediments preventing milestone completion."
        maxWidth="md"
      >
        <form onSubmit={handleMarkBlocked} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Select
            label="Blocker Category"
            value={blockerType}
            onChange={(e) => setBlockerType(e.target.value)}
            options={[
              { value: 'vendor', label: 'Vendor / OEM Dependency' },
              { value: 'customer', label: 'Buyer / Customer Hold' },
              { value: 'mgmt_approval', label: 'Management Approval Pending' },
              { value: 'portal', label: 'GeM / E-Procurement Portal Issue' },
              { value: 'technical', label: 'Technical / Specification Issue' },
              { value: 'missing_info', label: 'Missing Info / Document Verification' },
              { value: 'other_employee', label: 'Cross-Department Handover Pending' },
              { value: 'leave', label: 'Key Personnel on Leave' },
            ]}
          />

          <Input
            label="Obstacle / Blocker Description"
            required
            value={blockerReason}
            onChange={(e) => setBlockerReason(e.target.value)}
            placeholder="e.g. Belgian OEM certificate pending / Buyer changed technical qualification specs"
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsBlockerOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="danger" isLoading={isSubmitting}>
              Flag as Blocked
            </Button>
          </div>
        </form>
      </Modal>

      {/* Resolve Blocker Modal */}
      <Modal
        isOpen={isResolveOpen}
        onClose={() => setIsResolveOpen(false)}
        title="Manager Blocker Resolution"
        description="Record executive intervention or authorization to unblock task."
        maxWidth="md"
      >
        <form onSubmit={handleResolveBlocker} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Select
            label="Management Decision"
            value={blockerDecision}
            onChange={(e) => setBlockerDecision(e.target.value as any)}
            options={[
              { value: 'accepted', label: 'ACCEPTED - Bottleneck verified & addressed' },
              { value: 'extended', label: 'EXTENDED - Grant milestone deadline extension' },
              { value: 'rejected', label: 'REJECTED - Overruled, execute immediately' },
              { value: 'escalated', label: 'ESCALATED - Referred to Board / Executive Committee' },
            ]}
          />

          {blockerDecision === 'extended' && (
            <Input
              label="Revised Deadline"
              type="date"
              required
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
            />
          )}

          <Input
            label="Resolution Directives & Actions Taken"
            required
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            placeholder="e.g. Approved alternate OEM Belgian spec sheet. Spoke to DIG Provisioning."
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsResolveOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Clear Blocker
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Task Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Action Task"
        description="Assign milestone deliverables and target deadlines."
        maxWidth="md"
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Input
            label="Milestone Title"
            required
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            placeholder="e.g. Finalize EMD Bank Guarantee for NSG Tender"
          />

          <Input
            label="Detailed Instructions"
            required
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            placeholder="Details on requirements, OEM coordination, or submission portal..."
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Priority"
              value={newTask.priority}
              onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
              options={[
                { value: 'urgent', label: 'Urgent (Same Day)' },
                { value: 'high', label: 'High Priority' },
                { value: 'medium', label: 'Medium Priority' },
                { value: 'low', label: 'Routine' },
              ]}
            />
            <Input
              label="Target Deadline"
              type="date"
              required
              value={newTask.deadline}
              onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Create Task
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
