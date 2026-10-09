import { ForbiddenException } from '@nestjs/common';
import { checkRegionScope, assertRegionScope } from '../src/common/utils/scope.util.js';
import type { AuthUser } from '@arihant/shared';

describe('Scope Utility — Cross-Region Access & IDOR Rules', () => {
  const tenderTeamUser: AuthUser = {
    id: 'user-tender-1',
    email: 'tender@arihant.com',
    full_name: 'Tender Lead',
    role: 'tender_team',
    zone_id: null,
    region_id: null,
    reporting_manager_id: null,
    is_active: true,
  };

  const managementUser: AuthUser = {
    id: 'user-mgmt-1',
    email: 'mgmt@arihant.com',
    full_name: 'Top Management',
    role: 'management',
    zone_id: null,
    region_id: null,
    reporting_manager_id: null,
    is_active: true,
  };

  const salesUserNorth: AuthUser = {
    id: 'user-sales-north',
    email: 'sales.north@arihant.com',
    full_name: 'Sales North',
    role: 'sales',
    zone_id: 'zone-north',
    region_id: 'reg-delhi',
    reporting_manager_id: null,
    is_active: true,
  };

  it('allows all-India roles (management, tender_team, admin, accounts) to access cross-region records', () => {
    expect(checkRegionScope(managementUser, 'reg-mumbai', 'zone-west')).toBe(true);
    expect(checkRegionScope(tenderTeamUser, 'reg-mumbai', 'zone-west')).toBe(true);
    expect(() => assertRegionScope(tenderTeamUser, 'reg-kolkata')).not.toThrow();
  });

  it('allows access to national / unscoped records (null region and null zone)', () => {
    expect(checkRegionScope(salesUserNorth, null, null)).toBe(true);
    expect(() => assertRegionScope(salesUserNorth, null, null)).not.toThrow();
  });

  it('allows a directly assigned salesperson or owner to access record even if cross-region', () => {
    // Sales person is from Delhi / North, but assigned to a West / Mumbai tender
    const crossRegionTender = {
      region_id: 'reg-mumbai',
      zone_id: 'zone-west',
      assigned_to: 'user-sales-north',
      owner: 'user-rm-west',
    };

    expect(
      checkRegionScope(salesUserNorth, crossRegionTender.region_id, {
        entityZoneId: crossRegionTender.zone_id,
        entityAssignedTo: crossRegionTender.assigned_to,
        entityOwnerId: crossRegionTender.owner,
      }),
    ).toBe(true);

    expect(() =>
      assertRegionScope(salesUserNorth, crossRegionTender.region_id, {
        entityZoneId: crossRegionTender.zone_id,
        entityAssignedTo: crossRegionTender.assigned_to,
        entityOwnerId: crossRegionTender.owner,
      }),
    ).not.toThrow();
  });

  it('blocks cross-region access when user is not assigned and region does not match', () => {
    const unassignedCrossRegionTender = {
      region_id: 'reg-mumbai',
      zone_id: 'zone-west',
      assigned_to: 'user-other',
      owner: 'user-other-owner',
    };

    expect(
      checkRegionScope(salesUserNorth, unassignedCrossRegionTender.region_id, {
        entityZoneId: unassignedCrossRegionTender.zone_id,
        entityAssignedTo: unassignedCrossRegionTender.assigned_to,
        entityOwnerId: unassignedCrossRegionTender.owner,
      }),
    ).toBe(false);

    expect(() =>
      assertRegionScope(salesUserNorth, unassignedCrossRegionTender.region_id, {
        entityZoneId: unassignedCrossRegionTender.zone_id,
        entityAssignedTo: unassignedCrossRegionTender.assigned_to,
        entityOwnerId: unassignedCrossRegionTender.owner,
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows regional match when region matches user region', () => {
    expect(checkRegionScope(salesUserNorth, 'reg-delhi', 'zone-north')).toBe(true);
  });
});
