/**
 * §9 — Standard Excel template and import. An import creates a DRAFT only (never auto-submits)
 * and is all-or-nothing: if any row fails, nothing is created and every bad row is reported
 * with its row number and reason, so the employee fixes the sheet and re-imports.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import {
  CATEGORY_DETAIL_KIND,
  EXPENSE_IMPORT_TEMPLATE_COLUMNS,
  MEAL_TYPES,
  TRAVEL_MODES,
  todayInKolkata,
  type AuthUser,
} from '@arihant/shared';
import { ExpenseClaimsService, money } from './expense-claims.service.js';
import { ExpenseValidationException, readText, TEXT_LIMITS, validateItem, type FieldErrors } from './expense-validation.js';
import type { UploadedFile } from './expense-attachments.service.js';
import type { ImportClaimDto } from './expense.dto.js';

const MAX_ROWS = 500;

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof (v as any).text === 'string') return (v as any).text.trim();
    if ('result' in v) return cellText((v as any).result);
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('').trim();
    return '';
  }
  return String(v).trim();
}

/** DD-MM-YYYY (or an Excel date cell) → YYYY-MM-DD; returns the raw text when it cannot be parsed. */
function toIsoDate(v: ExcelJS.CellValue): string {
  if (v instanceof Date) {
    // Excel dates arrive as UTC midnight of the calendar day.
    return v.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

@Injectable()
export class ExpenseImportService {
  constructor(private readonly claims: ExpenseClaimsService) {}

  private get db() {
    return this.claims.db;
  }

  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Arihant BOS';
    const sheet = wb.addWorksheet('Expenses');
    sheet.columns = EXPENSE_IMPORT_TEMPLATE_COLUMNS.map((h) => ({ header: h, width: Math.max(14, h.length + 2) }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const cats = await this.db.selectFrom('expense_categories').selectAll().where('is_active', '=', true).orderBy('display_order').execute();
    const catSheet = wb.addWorksheet('Categories');
    catSheet.columns = [
      { header: 'Category Code', width: 20 },
      { header: 'Name', width: 28 },
      { header: 'Receipt required at or above (₹)', width: 30 },
      { header: 'Cap per item (₹)', width: 18 },
      { header: 'Needs customer/project', width: 22 },
      { header: 'Needs remarks', width: 16 },
      { header: 'Extra columns to fill', width: 60 },
    ];
    catSheet.getRow(1).font = { bold: true };
    const extra: Record<string, string> = {
      travel: `From, To, Travel Mode (${TRAVEL_MODES.join(' / ')})`,
      hotel: 'Hotel Name, Check-in, Check-out',
      conveyance: 'From, To; optionally Distance (km) + Rate per km (amount is then calculated)',
      food: `Meal Type (${MEAL_TYPES.join(' / ')}), Persons`,
    };
    for (const c of cats) {
      catSheet.addRow([
        c.code,
        c.name,
        c.receipt_required_above === null ? 'Never' : Number(c.receipt_required_above),
        c.max_amount_per_item === null ? '—' : Number(c.max_amount_per_item),
        c.requires_customer_or_project ? 'Yes' : 'No',
        c.requires_remark ? 'Yes' : 'No',
        extra[CATEGORY_DETAIL_KIND[c.code] || ''] || '—',
      ]);
    }
    const help = wb.addWorksheet('Instructions');
    help.getColumn(1).width = 110;
    [
      'How to use this template',
      '1. Fill one row per expense in the "Expenses" sheet. Do not rename or reorder the header row.',
      '2. Dates must be DD-MM-YYYY. Amounts are plain numbers with up to 2 decimals (no ₹ sign, no commas).',
      '3. Use a Category Code from the "Categories" sheet and fill the extra columns that category needs.',
      '4. Customer Name must match the customer name in the BOS exactly; Project Code must be an active project.',
      '5. Importing creates a DRAFT claim. Attach receipts and submit from the BOS — nothing is submitted automatically.',
      '6. If any row has a problem, nothing is imported and you get a list of row numbers with the reason.',
    ].forEach((line, i) => {
      help.addRow([line]);
      if (i === 0) help.getRow(1).font = { bold: true, size: 13 };
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(file: UploadedFile | undefined, dto: ImportClaimDto, user: AuthUser) {
    const employee = await this.db.selectFrom('users').select('is_active').where('id', '=', user.id).executeTakeFirst();
    if (!employee?.is_active) throw new ForbiddenException('Your account is inactive and cannot raise new expense claims.');
    if (!file?.buffer?.length) throw new ExpenseValidationException({ file: 'Choose the filled-in Excel template to import.' });
    if (file.size > 5 * 1024 * 1024) throw new ExpenseValidationException({ file: 'Import files can be at most 5 MB.' });
    if (file.buffer.subarray(0, 2).toString('ascii') !== 'PK') {
      throw new ExpenseValidationException({ file: 'Upload the .xlsx template (other formats are not supported).' });
    }

    const errors: FieldErrors = {};
    const title = readText(errors, 'title', dto.title, TEXT_LIMITS.title, { required: true, label: 'Title / purpose' });
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    const link = await this.claims.resolveLink(this.db, user.id, dto.trip_id, dto.visit_id, { linkingNew: true });

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new ExpenseValidationException({ file: 'The file could not be read as an Excel workbook.' });
    }
    const sheet = wb.getWorksheet('Expenses') ?? wb.worksheets[0];
    if (!sheet) throw new ExpenseValidationException({ file: 'The workbook has no "Expenses" sheet.' });
    const header = EXPENSE_IMPORT_TEMPLATE_COLUMNS.map((_, i) => cellText(sheet.getRow(1).getCell(i + 1).value));
    if (header.some((h, i) => h !== EXPENSE_IMPORT_TEMPLATE_COLUMNS[i])) {
      throw new ExpenseValidationException({ file: 'The header row does not match the standard template. Download a fresh template and copy your rows into it.' });
    }

    const cats = (await this.db.selectFrom('expense_categories').selectAll().execute()).map((c) => ({
      ...c,
      receipt_required_above: money(c.receipt_required_above),
      max_amount_per_item: money(c.max_amount_per_item),
    }));
    const today = todayInKolkata();
    const rowErrors: ImportRowError[] = [];
    const parsed: { row: number; item: ReturnType<typeof validateItem>; categoryName: string }[] = [];
    const seen = new Map<string, number>();

    const rows: { n: number; v: (c: number) => ExcelJS.CellValue }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const v = (c: number) => row.getCell(c).value;
      if (EXPENSE_IMPORT_TEMPLATE_COLUMNS.every((_, i) => cellText(v(i + 1)) === '')) return;
      rows.push({ n, v });
    });
    if (!rows.length) throw new ExpenseValidationException({ file: 'The "Expenses" sheet has no rows to import.' });
    if (rows.length > MAX_ROWS) throw new ExpenseValidationException({ file: `At most ${MAX_ROWS} rows can be imported at once.` });

    for (const { n, v } of rows) {
      const code = cellText(v(2)).toUpperCase();
      const cat = cats.find((c) => c.code === code) ?? null;
      if (!cat) {
        rowErrors.push({ row: n, field: 'Category Code', message: code ? `Unknown category code "${code}".` : 'Category Code is required.' });
        continue;
      }
      const kind = CATEGORY_DETAIL_KIND[cat.code];
      const details: Record<string, unknown> = {};
      if (kind === 'travel') Object.assign(details, { from: cellText(v(8)), to: cellText(v(9)), mode: cellText(v(10)).toLowerCase().replace(/\s+/g, '_') });
      if (kind === 'hotel') Object.assign(details, { hotel_name: cellText(v(11)), check_in: toIsoDate(v(12)), check_out: toIsoDate(v(13)) });
      if (kind === 'conveyance') {
        Object.assign(details, { from: cellText(v(8)), to: cellText(v(9)) });
        if (cellText(v(14))) details.km = cellText(v(14));
        if (cellText(v(15))) details.rate_per_km = cellText(v(15));
      }
      if (kind === 'food') Object.assign(details, { meal_type: cellText(v(16)).toLowerCase().replace(/\s+/g, '_'), persons: Number(cellText(v(17))) });

      let customer_id: string | null = null;
      const customerName = cellText(v(5));
      if (customerName) {
        const matches = await this.db
          .selectFrom('organisations')
          .select('id')
          .where(sql<boolean>`lower(trim(name)) = ${customerName.toLowerCase()}`)
          .limit(2)
          .execute();
        if (matches.length !== 1) {
          rowErrors.push({ row: n, field: 'Customer Name', message: matches.length ? `"${customerName}" matches more than one customer.` : `Customer "${customerName}" not found.` });
          continue;
        }
        customer_id = matches[0].id;
      }
      let project_id: string | null = null;
      const projectCode = cellText(v(6)).toUpperCase();
      if (projectCode) {
        const p = await this.db.selectFrom('projects').select(['id', 'is_active']).where('code', '=', projectCode).executeTakeFirst();
        if (!p || !p.is_active) {
          rowErrors.push({ row: n, field: 'Project Code', message: p ? `Project "${projectCode}" is inactive.` : `Project "${projectCode}" not found.` });
          continue;
        }
        project_id = p.id;
      }

      const rawAmount = v(3);
      try {
        const item = validateItem(
          {
            expense_date: toIsoDate(v(1)),
            category_id: cat.id,
            amount: typeof rawAmount === 'number' ? rawAmount : cellText(rawAmount),
            purpose: cellText(v(4)),
            customer_id,
            project_id,
            remarks: cellText(v(7)) || null,
            // The template has no separate column; the Remarks cell doubles as the late-submission reason.
            late_submission_reason: cellText(v(7)) || null,
            category_details: details,
          },
          { category: cat, today, config: this.claims.config, window: link.window },
        );
        const key = `${item.expense_date}|${item.category_id}|${item.amount}`;
        if (seen.has(key)) {
          rowErrors.push({ row: n, field: 'Amount', message: `Same date, category and amount as row ${seen.get(key)} — possible duplicate.` });
          continue;
        }
        seen.set(key, n);
        const dup = await this.claims.findDuplicates(this.db, user.id, item.expense_date, item.category_id, item.amount);
        if (dup.length) {
          rowErrors.push({ row: n, field: 'Amount', message: `Already claimed on ${dup.map((d) => d.claim_number).join(', ')}. Add this line manually if it is genuinely separate.` });
          continue;
        }
        parsed.push({ row: n, item, categoryName: cat.name });
      } catch (e: any) {
        const fieldErrors: Record<string, string> = e?.getResponse?.()?.errors || { row: e?.message || 'Invalid row.' };
        for (const [field, message] of Object.entries(fieldErrors)) rowErrors.push({ row: n, field, message });
      }
    }

    if (rowErrors.length) {
      throw new BadRequestException({
        message: `${new Set(rowErrors.map((e) => e.row)).size} row(s) have problems. Nothing was imported — fix the rows and import again.`,
        code: 'IMPORT_FAILED',
        row_errors: rowErrors.sort((a, b) => a.row - b.row),
      });
    }

    const claimId = await this.db.transaction().execute(async (trx) => {
      const claim = await trx
        .insertInto('expense_claims')
        .values({
          claim_number: sql`'EXP-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('expense_claim_number_seq')::text, 6, '0')`,
          employee_id: user.id,
          trip_id: link.trip_id,
          visit_id: link.visit_id,
          title: title!,
          status: 'draft',
          created_by: user.id,
          updated_by: user.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const p of parsed) {
        await trx
          .insertInto('expense_items')
          .values({
            claim_id: claim.id,
            expense_date: p.item.expense_date,
            category_id: p.item.category_id,
            category_name: p.categoryName,
            amount: p.item.amount,
            purpose: p.item.purpose,
            customer_id: p.item.customer_id,
            project_id: p.item.project_id,
            remarks: p.item.remarks,
            late_submission_reason: p.item.late_submission_reason,
            category_details: JSON.stringify(p.item.category_details),
            created_by: user.id,
            updated_by: user.id,
          })
          .execute();
      }
      await this.claims.recalc(trx, claim.id, user);
      await this.claims.history(trx, claim.id, {
        from: null,
        to: 'draft',
        action: 'import',
        actor: user,
        comment: `Imported ${parsed.length} line(s) from ${file.originalname}`,
        metadata: { rows: parsed.length },
      });
      return claim.id;
    });
    return this.claims.getDetail(claimId, user);
  }
}
