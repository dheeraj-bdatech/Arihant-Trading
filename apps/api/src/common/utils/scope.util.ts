import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@arihant/shared';

/**
 * Checks if the user is allowed to access/mutate a region-scoped entity
 */
export function checkRegionScope(user: AuthUser, entityRegionId: string | null, entityZoneId?: string | null): boolean {
  if (user.role === 'management' || user.role === 'admin' || user.role === 'accounts') {
    return true;
  }

  // If user has no region assigned, they cannot see or modify region-scoped records
  if (!user.region_id && !user.zone_id) {
    return false;
  }

  if (user.region_id && entityRegionId && user.region_id === entityRegionId) {
    return true;
  }

  if (user.zone_id && entityZoneId && user.zone_id === entityZoneId) {
    return true;
  }

  return false;
}

/**
 * Asserts that a user has permission to view or edit a region-scoped entity, otherwise throws 403 Forbidden
 */
export function assertRegionScope(user: AuthUser, entityRegionId: string | null, entityZoneId?: string | null): void {
  if (!checkRegionScope(user, entityRegionId, entityZoneId)) {
    throw new ForbiddenException('Access denied: cross-region record access is forbidden (IDOR protection)');
  }
}

/**
 * Enforces that a manager cannot approve their own submitted expense, tender, or blocker
 */
export function assertNotSelfApproval(actorId: string, resourceOwnerId: string, actionName: string = 'approval'): void {
  if (actorId === resourceOwnerId) {
    throw new ForbiddenException(`Self-${actionName} is strictly forbidden by policy.`);
  }
}
