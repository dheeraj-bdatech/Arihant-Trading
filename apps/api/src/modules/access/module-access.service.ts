import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { ACCESS_MODULES, USER_ROLES, accessModuleForApi, isLockedModule, type Database, type UserRole } from '@arihant/shared';

/** How long a role's switched-off modules are cached; a change made here is visible at once (cache cleared). */
const CACHE_MS = 15_000;

/**
 * Modules an administrator has switched off for a role (role_module_blocks). Read on every API call by
 * ModuleAccessInterceptor, so it is cached; a change through setBlocked() clears the cache straight away (other API
 * instances pick it up within CACHE_MS).
 */
@Injectable()
export class ModuleAccessService {
  private cache: { at: number; byRole: Map<string, Set<string>> } | null = null;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly events: EventEmitter2,
  ) {}

  private async byRole(): Promise<Map<string, Set<string>>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.byRole;
    const rows = await this.db.selectFrom('role_module_blocks').select(['role', 'module']).execute();
    const byRole = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byRole.has(r.role)) byRole.set(r.role, new Set());
      byRole.get(r.role)!.add(r.module);
    }
    this.cache = { at: Date.now(), byRole };
    return byRole;
  }

  /** The modules switched off for a role. */
  async blockedFor(role: string): Promise<string[]> {
    return [...((await this.byRole()).get(role) || [])];
  }

  /** The switched-off module an API call falls in, if any (`path` without the /api prefix). */
  async blockedModuleForApi(role: string, method: string, path: string) {
    const module = accessModuleForApi(method, path);
    if (!module || isLockedModule(role, module.key)) return null;
    return (await this.byRole()).get(role)?.has(module.key) ? module : null;
  }

  /** Every switch that is off, with who turned it off and why (the admin panel's matrix). */
  async listBlocks() {
    return this.db
      .selectFrom('role_module_blocks')
      .leftJoin('users', 'users.id', 'role_module_blocks.blocked_by')
      .select(['role_module_blocks.role', 'role_module_blocks.module', 'role_module_blocks.reason', 'role_module_blocks.blocked_at', 'users.full_name as blocked_by_name'])
      .orderBy('role_module_blocks.role')
      .orderBy('role_module_blocks.module')
      .execute();
  }

  /** Switch a module off (with a reason) or back on for a role; audited. */
  async setBlocked(role: string, module: string, blocked: boolean, reason: string | undefined, actorId: string) {
    if (!(USER_ROLES as string[]).includes(role)) throw new BadRequestException(`Unknown role "${role}"`);
    const mod = ACCESS_MODULES.find((m) => m.key === module);
    if (!mod) throw new BadRequestException(`Unknown module "${module}"`);
    if (isLockedModule(role, module)) throw new BadRequestException('The administrator always keeps the administration panel');
    const why = (reason || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (blocked && why.length < 5) throw new BadRequestException('Give a reason (at least 5 characters) for switching this module off');

    const was = (await this.blockedFor(role)).includes(module);
    if (blocked) {
      await this.db
        .insertInto('role_module_blocks')
        .values({ role: role as UserRole, module, reason: why, blocked_by: actorId })
        .onConflict((oc) => oc.columns(['role', 'module']).doUpdateSet({ reason: why, blocked_by: actorId, blocked_at: new Date() }))
        .execute();
    } else {
      await this.db.deleteFrom('role_module_blocks').where('role', '=', role as UserRole).where('module', '=', module).execute();
    }
    this.cache = null;

    if (was !== blocked) {
      this.events.emit('audit.log', {
        actorId,
        entityType: 'role_access',
        entityId: accessEntityId(role, module), // audit_log.entity_id is a uuid: one stable id per role × module
        action: blocked ? 'module_switched_off' : 'module_switched_on',
        previousValue: { role, module, enabled: !was },
        newValue: { role, module, module_label: mod.label, enabled: !blocked, reason: blocked ? why : (reason || '').trim() || null },
      });
    }
    return { role, module, blocked };
  }
}

/** A stable uuid for a role × module pair, so its audit entries line up as one record. */
export function accessEntityId(role: string, module: string): string {
  const h = createHash('md5').update(`role_access:${role}:${module}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
