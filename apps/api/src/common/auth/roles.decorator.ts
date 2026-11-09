import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@arihant/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const ADMIN_ONLY_KEY = 'admin_only';
/**
 * System-administrator work (§2: user onboarding, master data CRUD, role provisioning). Unlike `@Roles('admin')`,
 * management does not pass this one: directors read the admin panel but never change accounts or masters.
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
