import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@arihant/shared';

export interface ScopeContext {
  entityZoneId?: string | null;
  entityAssignedTo?: string | null;
  entityOwnerId?: string | null;
}

/**
 * Checks if the user is allowed to access/mutate a region-scoped entity
 */
export function checkRegionScope(
  user: AuthUser,
  entityRegionId: string | null | undefined,
  entityZoneIdOrOptions?: string | null | ScopeContext,
  entityAssignedTo?: string | null,
  entityOwnerId?: string | null,
): boolean {
  // 1. Roles with All-India territorial scope bypass regional scoping
  // (per ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md §3 & packages/shared/src/enums.ts:
  // management, admin, accounts, tender_team)
  if (
    user.role === 'management' ||
    user.role === 'admin' ||
    user.role === 'accounts' ||
    user.role === 'tender_team'
  ) {
    return true;
  }

  let entityZoneId: string | null | undefined = null;
  let assignedTo: string | null | undefined = entityAssignedTo;
  let ownerId: string | null | undefined = entityOwnerId;

  if (entityZoneIdOrOptions && typeof entityZoneIdOrOptions === 'object') {
    entityZoneId = entityZoneIdOrOptions.entityZoneId;
    assignedTo = entityZoneIdOrOptions.entityAssignedTo ?? assignedTo;
    ownerId = entityZoneIdOrOptions.entityOwnerId ?? ownerId;
  } else {
    entityZoneId = entityZoneIdOrOptions as string | null | undefined;
  }

  // 2. Direct assignment or ownership overrides regional restriction
  // (e.g. Salesperson or Regional Manager explicitly assigned to a tender or lead)
  if (
    (assignedTo && user.id === assignedTo) ||
    (ownerId && user.id === ownerId)
  ) {
    return true;
  }

  // 3. National / Unscoped entities (no region and no zone assigned)
  // are accessible across regions
  if (!entityRegionId && !entityZoneId) {
    return true;
  }

  // 4. If user has no region or zone assigned, they cannot see or modify region-scoped records
  if (!user.region_id && !user.zone_id) {
    return false;
  }

  // 5. Region match
  if (user.region_id && entityRegionId && user.region_id === entityRegionId) {
    return true;
  }

  // 6. Zone match
  if (user.zone_id && entityZoneId && user.zone_id === entityZoneId) {
    return true;
  }

  return false;
}

/**
 * Asserts that a user has permission to view or edit a region-scoped entity, otherwise throws 403 Forbidden
 */
export function assertRegionScope(
  user: AuthUser,
  entityRegionId: string | null | undefined,
  entityZoneIdOrOptions?: string | null | ScopeContext,
  entityAssignedTo?: string | null,
  entityOwnerId?: string | null,
): void {
  if (!checkRegionScope(user, entityRegionId, entityZoneIdOrOptions, entityAssignedTo, entityOwnerId)) {
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
