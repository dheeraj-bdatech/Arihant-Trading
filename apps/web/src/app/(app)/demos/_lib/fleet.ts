/**
 * Demo-fleet availability as the status pill shown next to each option in the product / kit dropdowns
 * (demo request, lead demo scheduling, visit planning): green when it can be used now, red otherwise.
 */
import { formatDateIN, type SelectOption } from '@/components/ui';

type Hint = Pick<SelectOption, 'hint' | 'hintTone'>;

/** A product: how many of its demo units are free right now. */
export function fleetHint(ready: number, total: number): Hint {
  if (ready > 0) return { hint: `${ready}/${total} ready`, hintTone: 'success' };
  if (total > 0) return { hint: 'In trial', hintTone: 'danger' };
  return { hint: 'No demo unit', hintTone: 'danger' };
}

/** One demo unit (serial): its current status. */
export function unitHint(e: { availability_status?: string | null; reserved_until?: string | null }): Hint {
  const st = e.availability_status;
  if (st === 'available') return { hint: 'Available', hintTone: 'success' };
  if (st === 'reserved' || st === 'in_use') return { hint: e.reserved_until ? `Reserved to ${formatDateIN(e.reserved_until)}` : 'Reserved', hintTone: 'danger' };
  if (st === 'maintenance') return { hint: 'Maintenance', hintTone: 'danger' };
  return { hint: (st || 'unknown').replace(/_/g, ' '), hintTone: 'danger' };
}

type Unit = { model?: string | null; serial_no?: string | null; current_location?: string | null; product_id?: string | null };

/** The kit dropdown's value for a demo unit — the text saved as the demo's equipment_required. */
export const kitValue = (e: Unit) => `${e.model} | S/N: ${e.serial_no} (${e.current_location} Depot)`;

/** After the product changes: drop a chosen kit that is a unit of another product (custom text is kept). */
export function kitForProduct(kit: string, productId: string, units: Unit[]): string {
  const unit = units.find((u) => kitValue(u) === kit);
  return unit && productId && unit.product_id !== productId ? '' : kit;
}

/** Available options first (status pill green), keeping each group's own order. */
export const availableFirst = <T extends Hint>(opts: T[]): T[] =>
  [...opts.filter((o) => o.hintTone === 'success'), ...opts.filter((o) => o.hintTone !== 'success')];
