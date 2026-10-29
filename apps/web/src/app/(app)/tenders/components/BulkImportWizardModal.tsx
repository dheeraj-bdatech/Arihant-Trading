'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Button,
  Badge,
  Select,
  Textarea,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
} from '@/components/ui';
import {
  CheckCircle2,
  AlertTriangle,
  FileDown,
  FileUp,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { istDateOf, toIstLocalInput } from '@/lib/ist-date';

interface BulkImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------------------------------------------------

/** Row keys POST /tenders/import reads and saves. Nothing else is sent. */
type ImportField =
  | 'tender_number'
  | 'organisation'
  | 'tender_title'
  | 'category'
  | 'estimated_value'
  | 'state'
  | 'city'
  | 'zone'
  | 'region'
  | 'publication_date'
  | 'submission_deadline'
  | 'pre_bid_meeting_date';

const FIELD_LABELS: Record<ImportField, string> = {
  tender_number: 'Tender No',
  organisation: 'Organisation',
  tender_title: 'Title',
  category: 'Category',
  estimated_value: 'Estimated Value',
  state: 'State',
  city: 'City',
  zone: 'Zone',
  region: 'Region',
  publication_date: 'Publication Date',
  submission_deadline: 'Submission Deadline',
  pre_bid_meeting_date: 'Pre-Bid Date',
};

const REQUIRED_FIELDS: ImportField[] = ['tender_number', 'organisation', 'submission_deadline'];

/** A header as a lookup key: lowercase with everything but letters and digits removed ("Bid/Tender No" → "bidtenderno"). */
const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Normalised header → import field. Exact matches only (no substring guessing), covering this wizard's sample and
 * Arihant's live tender sheet (e.g. docs/North Live Tender Sheet FY 2026-27.xlsx). Unknown columns are ignored.
 */
const HEADER_ALIASES: Record<string, ImportField> = {
  // Tender number
  tendernumber: 'tender_number',
  tenderno: 'tender_number',
  bidtenderno: 'tender_number',
  bidtendernumber: 'tender_number',
  tenderbidno: 'tender_number',
  bidno: 'tender_number',
  bidnumber: 'tender_number',
  tenderid: 'tender_number',
  tenderrefno: 'tender_number',
  tenderreference: 'tender_number',
  tenderreferenceno: 'tender_number',
  tenderreferencenumber: 'tender_number',
  gembidno: 'tender_number',
  nitno: 'tender_number',
  // Organisation / buyer
  organisation: 'organisation',
  organization: 'organisation',
  organisationname: 'organisation',
  organizationname: 'organisation',
  customerdepartmentname: 'organisation',
  customerdepartment: 'organisation',
  customer: 'organisation',
  customername: 'organisation',
  department: 'organisation',
  departmentname: 'organisation',
  buyer: 'organisation',
  buyername: 'organisation',
  buyerorganisation: 'organisation',
  buyerorganization: 'organisation',
  client: 'organisation',
  clientname: 'organisation',
  // Title / requirement
  tendertitle: 'tender_title',
  title: 'tender_title',
  bidtitle: 'tender_title',
  productrequirement: 'tender_title',
  requirement: 'tender_title',
  product: 'tender_title',
  itemdescription: 'tender_title',
  description: 'tender_title',
  tenderdescription: 'tender_title',
  nameofwork: 'tender_title',
  workdescription: 'tender_title',
  subject: 'tender_title',
  // Category (a tender category code or name, e.g. PQ / GENERAL_MHA / "General / MHA")
  category: 'category',
  tendercategory: 'category',
  categorycode: 'category',
  // Estimated value (₹ unless the header names lakh / crore)
  estimatedvalue: 'estimated_value',
  estimatedvaluers: 'estimated_value',
  estimatedvalueinr: 'estimated_value',
  estimatedvalueinrs: 'estimated_value',
  estimatedvaluelakh: 'estimated_value',
  estimatedvaluelakhs: 'estimated_value',
  estimatedvalueinlakh: 'estimated_value',
  estimatedvalueinlakhs: 'estimated_value',
  estimatedvaluecr: 'estimated_value',
  estimatedvalueincr: 'estimated_value',
  estimatedvaluecrore: 'estimated_value',
  estimatedvalueincrore: 'estimated_value',
  estimatedcost: 'estimated_value',
  estimatedcontractvalue: 'estimated_value',
  tendervalue: 'estimated_value',
  bidvalue: 'estimated_value',
  value: 'estimated_value',
  // Territory
  state: 'state',
  statename: 'state',
  city: 'city',
  cityname: 'city',
  location: 'city',
  district: 'city',
  place: 'city',
  zone: 'zone',
  zonename: 'zone',
  zonecode: 'zone',
  region: 'region',
  regionname: 'region',
  // Publication
  publicationdate: 'publication_date',
  publisheddate: 'publication_date',
  publishdate: 'publication_date',
  bidstartdate: 'publication_date',
  bidstartdatetime: 'publication_date',
  tenderstartdate: 'publication_date',
  startdate: 'publication_date',
  bidpublishdate: 'publication_date',
  dateofpublication: 'publication_date',
  // Submission deadline
  submissiondeadline: 'submission_deadline',
  submissiondate: 'submission_deadline',
  bidsubmissiondate: 'submission_deadline',
  bidsubmissiondeadline: 'submission_deadline',
  bidclosingdate: 'submission_deadline',
  bidclosingdatetime: 'submission_deadline',
  closingdate: 'submission_deadline',
  closingdatetime: 'submission_deadline',
  tenderclosingdate: 'submission_deadline',
  bidenddate: 'submission_deadline',
  bidenddatetime: 'submission_deadline',
  enddate: 'submission_deadline',
  lastdate: 'submission_deadline',
  lastdateofsubmission: 'submission_deadline',
  lastdateforsubmission: 'submission_deadline',
  duedate: 'submission_deadline',
  bidduedate: 'submission_deadline',
  deadline: 'submission_deadline',
  // Pre-bid meeting
  prebiddate: 'pre_bid_meeting_date',
  prebiddatetime: 'pre_bid_meeting_date',
  prebidmeeting: 'pre_bid_meeting_date',
  prebidmeetingdate: 'pre_bid_meeting_date',
  prebidmeetingdatetime: 'pre_bid_meeting_date',
  prebidconference: 'pre_bid_meeting_date',
  prebidconferencedate: 'pre_bid_meeting_date',
  prebid: 'pre_bid_meeting_date',
};

/** Rupee multiplier implied by a value header ("Estimated Value (Lakh)" → 1,00,000). */
const headerValueMultiplier = (normalisedHeader: string) =>
  /(lakhs?|lacs?)$/.test(normalisedHeader) ? 1e5 : /(crores?|cr)$/.test(normalisedHeader) ? 1e7 : 1;

// ---------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------

interface DelimitedParse {
  records: string[][];
  /** 1-based line on which each record starts (matches the Excel row when the sheet was pasted from row 1). */
  lines: number[];
  /** Line of a quote that is never closed, if any. */
  unclosedQuoteLine: number | null;
}

/**
 * RFC 4180-style parser for CSV, or TSV when the first lines contain a tab (Excel copy/paste): quoted fields,
 * escaped "" quotes, delimiters and line breaks inside quotes, CRLF / LF / CR line ends. Blank lines are dropped.
 */
function parseDelimited(text: string): DelimitedParse {
  const src = text.replace(/^﻿/, '');
  // Look past a title row above the header: a tab in any of the first few lines means an Excel (TSV) paste.
  const leadLines = src.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0).slice(0, 5);
  const delimiter = leadLines.some((l) => l.includes('\t')) ? '\t' : ',';

  const records: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteLine = 0;
  let line = 1;
  let rowStart = 1;

  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((f) => f.trim() !== '')) {
      records.push(row.map((f) => f.trim()));
      lines.push(rowStart);
    }
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        field += '\n';
        line++;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
      quoteLine = line;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowStart = line;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  return { records, lines, unclosedQuoteLine: inQuotes ? quoteLine : null };
}

/** Placeholder cells that mean "no value" in the tender sheets. */
const isBlankToken = (s: string) => /^(na|n\/a|n\.a\.?|nil|none|null|tbd|tba|not applicable|-+|—|–)$/i.test(s.trim());

const pad2 = (n: number) => String(n).padStart(2, '0');

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A sheet date as text the API reads as IST wall clock: 'YYYY-MM-DD' (or 'YYYY-MM-DD HH:mm' when `keepTime`).
 * Day-first like Indian sheets and GeM: 31-08-2026, 31/08/2026 11:00, 14.08.2026, 31-Aug-2026 2:00 PM, 2026-08-31,
 * and Excel serial numbers. An ISO instant with a zone is passed through. Returns null when not understood.
 */
function normaliseDate(raw: string, keepTime: boolean): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return keepTime ? s : istDateOf(d);
  }

  let y: number;
  let m: number;
  let d: number;
  let rest = '';
  let match: RegExpMatchArray | null;

  if ((match = s.match(/^(\d{5})(\.\d+)?$/))) {
    // Excel serial day (1900 system); the fraction is the time of day.
    const serial = Number(s);
    if (serial < 20000 || serial > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000);
    const day = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    const hasTime = dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0;
    return keepTime && hasTime ? `${day} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}` : day;
  } else if ((match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/))) {
    [y, m, d, rest] = [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
  } else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)(.*)$/))) {
    [d, m, y, rest] = [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
  } else if ((match = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[- /.]([A-Za-z]{3,9})\.?[- /.,]+(\d{4}|\d{2})(?!\d)(.*)$/))) {
    [d, m, y, rest] = [Number(match[1]), MONTHS[match[2].slice(0, 3).toLowerCase()] || 0, Number(match[3]), match[4]];
  } else if ((match = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(.*)$/))) {
    [m, d, y, rest] = [MONTHS[match[1].slice(0, 3).toLowerCase()] || 0, Number(match[2]), Number(match[3]), match[4]];
  } else {
    return null;
  }

  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const day = `${y}-${pad2(m)}-${pad2(d)}`;

  const timeText = rest.trim().replace(/^(t|,|at)\s*/i, '');
  if (!timeText) return day;
  const t = timeText.match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(hrs|hours|ist)?\.?$/i);
  if (!t) return null;
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  const meridiem = (t[4] || '').replace(/\./g, '').toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return keepTime ? `${day} ${pad2(hour)}:${pad2(minute)}` : day;
}

/** A rupee amount from "₹ 75,00,000", "Rs. 4500000/-", "93 Lakh", "1.2 Cr". Null when not understood. */
function parseRupees(raw: string, headerMultiplier: number): number | null {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(₹|inr|rs\.?)\s*/, '').replace(/\s*(\/-|only|inr)$/, '').replace(/[,\s]/g, '');
  const match = s.match(/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(lakhs?|lacs?|lac|l|crores?|cr\.?)?$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = match[2] || '';
  const multiplier = /^(lakh|lac|l)/.test(unit) ? 1e5 : /^cr/.test(unit) ? 1e7 : headerMultiplier;
  return Math.round(num * multiplier * 100) / 100;
}

type RowValues = Partial<Record<ImportField, string | number>>;

interface ParsedRow {
  /** Line in the pasted text / file where the record starts. */
  line: number;
  values: RowValues;
  /** Cells this wizard could not read (left blank rather than sent as guesses). */
  notes: string[];
}

interface ParseResult {
  rows: ParsedRow[];
  headerLine: number;
  mapped: { header: string; field: ImportField }[];
  ignored: string[];
  emptyRowsSkipped: number;
}

const DATE_FIELDS: ImportField[] = ['publication_date', 'submission_deadline', 'pre_bid_meeting_date'];

function buildRows(text: string): { result?: ParseResult; error?: string } {
  const { records, lines, unclosedQuoteLine } = parseDelimited(text);
  if (unclosedQuoteLine !== null) {
    return {
      error: `Line ${unclosedQuoteLine} opens a quoted value (") that is never closed, so the rows after it cannot be read. Remove the stray quote or close it.`,
    };
  }
  if (records.length < 2) {
    return { error: 'Paste a header row and at least one tender row.' };
  }

  // The header is the row (among the first few) whose cells match the most known column names.
  let headerIdx = -1;
  let bestHits = 1;
  for (let i = 0; i < Math.min(5, records.length - 1); i++) {
    const hits = new Set(records[i].map((h) => HEADER_ALIASES[normaliseHeader(h)]).filter(Boolean)).size;
    if (hits > bestHits) {
      bestHits = hits;
      headerIdx = i;
    }
  }
  if (headerIdx < 0) {
    return {
      error:
        'No header row found. The first rows must name the columns, e.g. "Bid/Tender No", "Customer/Department Name", "Bid Closing Date".',
    };
  }

  const headers = records[headerIdx];
  const columnField: (ImportField | null)[] = [];
  const multipliers: number[] = [];
  const mapped: { header: string; field: ImportField }[] = [];
  const ignored: string[] = [];
  const used = new Set<ImportField>();
  headers.forEach((h, idx) => {
    const norm = normaliseHeader(h);
    const field = HEADER_ALIASES[norm];
    multipliers[idx] = headerValueMultiplier(norm);
    if (field && !used.has(field)) {
      used.add(field);
      columnField[idx] = field;
      mapped.push({ header: h, field });
    } else {
      columnField[idx] = null;
      if (h.trim()) ignored.push(field ? `${h} (second ${FIELD_LABELS[field]} column)` : h);
    }
  });

  const missing = REQUIRED_FIELDS.filter((f) => !used.has(f));
  if (missing.length > 0) {
    return {
      error: `No column found for ${missing.map((f) => FIELD_LABELS[f]).join(', ')}. Rename the header (e.g. "Bid/Tender No", "Customer/Department Name", "Bid Closing Date") and parse again.`,
    };
  }

  const rows: ParsedRow[] = [];
  let emptyRowsSkipped = 0;
  for (let r = headerIdx + 1; r < records.length; r++) {
    const record = records[r];
    const values: RowValues = {};
    const notes: string[] = [];
    columnField.forEach((field, idx) => {
      if (!field) return;
      const raw = (record[idx] ?? '').trim();
      if (!raw || isBlankToken(raw)) return;
      if (field === 'estimated_value') {
        const rupees = parseRupees(raw, multipliers[idx]);
        if (rupees === null) notes.push(`Estimated value "${raw}" not understood — left blank.`);
        else values.estimated_value = rupees;
      } else if (DATE_FIELDS.includes(field)) {
        const date = normaliseDate(raw, field !== 'publication_date');
        if (date === null) notes.push(`${FIELD_LABELS[field]} "${raw}" not understood — use DD-MM-YYYY HH:mm.`);
        else values[field] = date;
      } else {
        values[field] = raw.replace(/\s*\n\s*/g, ' ');
      }
    });
    if (Object.keys(values).length === 0 && notes.length === 0) {
      emptyRowsSkipped++;
      continue;
    }
    rows.push({ line: lines[r], values, notes });
  }

  if (rows.length === 0) {
    return { error: 'The header was found but no tender rows below it have values in the recognised columns.' };
  }

  return { result: { rows, headerLine: lines[headerIdx], mapped, ignored, emptyRowsSkipped } };
}

// ---------------------------------------------------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------------------------------------------------

interface ImportRowReport {
  row: number;
  tender_number: string;
  organisation: string;
  valid: boolean;
  errors: string[];
  action: 'INSERT' | 'UPDATE' | 'SKIP';
}

interface ImportPreviewResponse {
  preview: true;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  reports: ImportRowReport[];
}

interface ImportCommitResponse {
  committed: true;
  total_rows: number;
  inserted: number;
  updated: number;
  skipped: number;
  reports: ImportRowReport[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------------------------------------

/** A normalised import date as DD-MM-YYYY[ HH:mm] (IST). */
const displayDate = (v: string | number | undefined) => {
  if (v === undefined || v === '') return '—';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4]}` : ''}`;
  const local = toIstLocalInput(s);
  return local ? `${local.slice(8, 10)}-${local.slice(5, 7)}-${local.slice(0, 4)} ${local.slice(11, 16)}` : s;
};

const formatRupees = (v: string | number | undefined) => {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
};

const ACTION_BADGE: Record<ImportRowReport['action'], { label: string; variant: 'success' | 'info' | 'warning' }> = {
  INSERT: { label: 'New', variant: 'success' },
  UPDATE: { label: 'Update', variant: 'info' },
  SKIP: { label: 'Skip', variant: 'warning' },
};

const SAMPLE_TEMPLATE = `Tender Number,Organisation,Tender Title,Category,Estimated Value,State,City,Publication Date,Pre-Bid Meeting Date,Submission Deadline
GEM/2026/B/7001001,CRPF HQ New Delhi,Supply of Advanced Ballistic Helmets,General / MHA,"75,00,000",Delhi,New Delhi,02-11-2026,09-11-2026 11:00,25-11-2026 15:00
GEM/2026/B/7001002,BSF Frontier HQ Jalandhar,PQ for Night Vision Weapon Sights,PQ,1.2 Cr,Punjab,Jalandhar,03-11-2026,,05-12-2026 17:00
GEM/2026/B/7001003,CISF Airport Security Mumbai,Procurement of Tactical Shields,General / MHA,45 Lakh,Maharashtra,Mumbai,04-11-2026,12-11-2026 11:30,30-11-2026 14:00`;

const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls|ods|numbers)$/i;

export function BulkImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
}: BulkImportWizardModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [validationReport, setValidationReport] = useState<ImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState<'validate' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every reset so a response that arrives after the wizard was closed or restarted is ignored.
  const sessionRef = useRef(0);

  const parsedRows = parseResult?.rows || [];

  const resetAll = () => {
    sessionRef.current++;
    setStep('upload');
    setRawText('');
    setFileName(null);
    setDuplicateMode('skip');
    setParseResult(null);
    setValidationReport(null);
    setCommitResult(null);
    setLoading(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // The modal stays mounted between openings: start every opening from a clean wizard.
  useEffect(() => {
    if (isOpen) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const handleParse = () => {
    setError(null);
    setValidationReport(null);
    if (!rawText.trim()) {
      setError('Paste the tender rows or choose a CSV / TSV file.');
      return;
    }
    try {
      const { result, error: parseError } = buildRows(rawText);
      if (parseError || !result) {
        setError(parseError || 'Could not read the pasted data.');
        return;
      }
      setParseResult(result);
      setStep('preview');
    } catch (err: any) {
      setError(`Could not read the pasted data: ${err?.message || 'unknown error'}`);
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (SPREADSHEET_EXT.test(file.name)) {
      setError(
        `${file.name} is an Excel workbook, which can't be read here. In Excel, select the rows (with the header row) and paste them below, or use File → Save As → CSV (UTF-8) and choose that file.`,
      );
      return;
    }
    try {
      const text = await file.text();
      setRawText(text);
      setFileName(file.name);
    } catch (err: any) {
      setError(`Could not read ${file.name}: ${err?.message || 'unknown error'}`);
    }
  };

  const handleBackToEdit = () => {
    setValidationReport(null);
    setError(null);
    setStep('upload');
  };

  const handleRunImport = async (commit: boolean) => {
    const session = sessionRef.current;
    try {
      setLoading(commit ? 'commit' : 'validate');
      setError(null);

      const res = await api.post<ImportPreviewResponse | ImportCommitResponse>('/tenders/import', {
        rows: parsedRows.map((r) => r.values),
        duplicate_mode: duplicateMode,
        commit,
      });
      if (session !== sessionRef.current) return;

      if (commit) {
        const result = res as ImportCommitResponse;
        setCommitResult(result);
        setStep('result');
        if ((Number(result?.inserted) || 0) + (Number(result?.updated) || 0) > 0) onImportComplete?.();
      } else {
        setValidationReport(res as ImportPreviewResponse);
      }
    } catch (err: any) {
      if (session !== sessionRef.current) return;
      console.error('Import request failed:', err);
      setError(err?.message || (commit ? 'The import could not be completed.' : 'Validation failed.'));
    } finally {
      if (session === sessionRef.current) setLoading(null);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arihant_tender_import_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Report rows by the 1-based position of the row sent, with the sheet line it came from. */
  const reportFor = (reports: ImportRowReport[] | undefined) => {
    const map = new Map<number, ImportRowReport>();
    (reports || []).forEach((r) => map.set(Number(r.row), r));
    return map;
  };
  const validationByRow = reportFor(validationReport?.reports);
  const lineOf = (reportRow: number) => parsedRows[reportRow - 1]?.line ?? reportRow;
  const rowsWithNotes = parsedRows.filter((r) => r.notes.length > 0).length;

  const written = commitResult ? (Number(commitResult.inserted) || 0) + (Number(commitResult.updated) || 0) : 0;
  const commitProblems = (commitResult?.reports || []).filter((r) => !r.valid);

  const renderProblemTable = (problems: ImportRowReport[]) => (
    <div className="max-h-56 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#FBFAF7]">
            <TableHead>Line</TableHead>
            <TableHead>Tender No</TableHead>
            <TableHead>Organisation</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {problems.map((r) => (
            <TableRow key={r.row}>
              <TableCell className="font-mono text-[11px] text-[#4A5568]">{lineOf(Number(r.row))}</TableCell>
              <TableCell className="font-mono text-[11px] font-semibold text-[#14213D]">{r.tender_number || '—'}</TableCell>
              <TableCell>
                <div className="max-w-[180px] truncate" title={r.organisation || undefined}>
                  {r.organisation || '—'}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={r.action === 'SKIP' ? 'warning' : 'danger'} size="sm">
                  {r.action === 'SKIP' ? 'Skip' : 'Error'}
                </Badge>
              </TableCell>
              <TableCell className="text-[11px] text-[#881337]">
                {(r.errors || []).length > 0 ? r.errors.join('; ') : 'Not written'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Arihant Tender Sheet — Bulk Import Wizard"
      description="Import active, historical, or pipeline tenders from Excel/CSV sheets with column mapping and validation."
      maxWidth="4xl"
    >
      <div className="space-y-6 text-xs">
        {/* Step Indicator */}
        <div className="flex items-center justify-between border-b border-[#DCD8CE] pb-3">
          {([
            ['upload', 1, 'Upload / Paste Data'],
            ['preview', 2, 'Preview & Validate'],
            ['result', 3, 'Import Summary'],
          ] as const).map(([key, n, label]) => (
            <div key={key} className="flex items-center gap-3">
              <span
                className={`flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs font-bold ${
                  step === key ? 'bg-[#0F5E63] text-white' : 'bg-[#E3EFEE] text-[#0F5E63]'
                }`}
              >
                {n}
              </span>
              <span className={step === key ? 'font-semibold text-[#14213D]' : 'text-[#4A5568]'}>{label}</span>
            </div>
          ))}
        </div>

        {error && (
          <InfoCallout variant="danger" title="Validation Notice" onClose={() => setError(null)}>
            {error}
          </InfoCallout>
        )}

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#14213D]">
                Paste rows from Excel (with the header row), or choose a CSV / TSV file:
              </span>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  className="hidden"
                  onChange={handleFileChosen}
                />
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => fileInputRef.current?.click()}
                  leftIcon={<FileUp className="w-3.5 h-3.5" />}
                >
                  Choose CSV / TSV
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleDownloadSample}
                  leftIcon={<FileDown className="w-3.5 h-3.5" />}
                >
                  Download Sample CSV
                </Button>
              </div>
            </div>

            {fileName && (
              <div className="flex items-center gap-2 text-[11px] text-[#4A5568]">
                Loaded <span className="font-mono text-[#14213D]">{fileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFileName(null);
                    setRawText('');
                  }}
                  aria-label="Clear loaded file"
                  className="p-0.5 rounded text-[#4A5568] hover:bg-[#ECE9E2]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <Textarea
              rows={8}
              placeholder={SAMPLE_TEMPLATE}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                if (fileName) setFileName(null);
              }}
              className="font-mono text-[11px]"
            />

            <InfoCallout variant="neutral">
              <p>
                Tab-separated text pasted from Excel is detected automatically. Excel workbooks (.xlsx) can&apos;t be
                uploaded here — paste the rows, or use <span className="font-semibold">File → Save As → CSV</span>.
              </p>
              <p>
                Dates are day-first in IST: <span className="font-mono">DD-MM-YYYY</span> or{' '}
                <span className="font-mono">DD-MM-YYYY HH:mm</span> (24-hour). Values in ₹, or as{' '}
                <span className="font-mono">93 Lakh</span> / <span className="font-mono">1.2 Cr</span>.
              </p>
              <p>
                Required columns: Tender No (or &quot;Bid/Tender No&quot;), Organisation (or &quot;Customer/Department
                Name&quot;), Submission Deadline (or &quot;Bid Closing Date&quot;). Also read: Title / Product/Requirement,
                Category, Estimated Value, State, City / Location, Zone, Region, Publication Date / Bid Start Date,
                Pre-Bid Date. Other columns are ignored.
              </p>
            </InfoCallout>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-[14px] bg-[#FBFAF7] border border-[#DCD8CE]">
              <div>
                <span className="font-semibold text-[#14213D]">Duplicate Handling Mode:</span>
                <p className="text-[11px] text-[#4A5568]">
                  What to do when a tender number already exists for the same organisation.
                </p>
              </div>
              <div className="sm:w-56">
                <Select
                  aria-label="Duplicate Handling Mode"
                  value={duplicateMode}
                  onChange={(e) => setDuplicateMode(e.target.value as 'skip' | 'update')}
                  searchable={false}
                  options={[
                    { value: 'skip', label: 'Skip duplicates' },
                    { value: 'update', label: 'Update existing record' },
                  ]}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleParse} disabled={!rawText.trim()}>
                Parse & Preview Rows
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Preview & Validation */}
        {step === 'preview' && parseResult && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="font-serif font-bold text-sm text-[#14213D]">
                  Parsed Rows (<span className="font-mono">{parsedRows.length}</span>)
                </h4>
                <p className="text-[11px] text-[#4A5568]">
                  Review the mapped fields before committing. Imported tenders are flagged as historical (source = Bulk
                  Import). Duplicates: {duplicateMode === 'skip' ? 'skipped' : 'existing records updated'}.
                  {parseResult.headerLine > 1 ? ` Header found on line ${parseResult.headerLine}.` : ''}
                  {parseResult.emptyRowsSkipped > 0
                    ? ` ${parseResult.emptyRowsSkipped} empty row${parseResult.emptyRowsSkipped === 1 ? '' : 's'} skipped.`
                    : ''}
                </p>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => handleRunImport(false)}
                isLoading={loading === 'validate'}
                disabled={loading !== null}
              >
                Run Validation Check
              </Button>
            </div>

            {/* Column mapping */}
            <div className="space-y-2 p-3 rounded-[14px] bg-[#FBFAF7] border border-[#DCD8CE]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-[#14213D] mr-1">Mapped columns:</span>
                {parseResult.mapped.map(({ header, field }) => (
                  <Badge key={field} variant="info" size="sm">
                    {header} → {FIELD_LABELS[field]}
                  </Badge>
                ))}
              </div>
              {parseResult.ignored.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-[#14213D] mr-1">Ignored columns:</span>
                  {parseResult.ignored.map((h, i) => (
                    <Badge key={`${h}-${i}`} variant="outline" size="sm">
                      {h}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {rowsWithNotes > 0 && (
              <InfoCallout variant="warning" title={`${rowsWithNotes} row${rowsWithNotes === 1 ? '' : 's'} with unreadable cells`}>
                Cells this wizard could not read are left blank (see the Check column). Fix them in the sheet and parse
                again if they matter.
              </InfoCallout>
            )}

            {/* Validation Feedback */}
            {validationReport && (
              <div className="space-y-3">
                {validationReport.error_rows === 0 ? (
                  <InfoCallout variant="success" title="Validation passed">
                    All <span className="font-mono">{validationReport.valid_rows}</span> of{' '}
                    <span className="font-mono">{validationReport.total_rows}</span> rows are valid.
                  </InfoCallout>
                ) : (
                  <InfoCallout variant="warning" title="Some rows will not be imported">
                    <span className="font-mono">{validationReport.valid_rows}</span> valid,{' '}
                    <span className="font-mono">{validationReport.error_rows}</span> with errors (of{' '}
                    <span className="font-mono">{validationReport.total_rows}</span>). Rows with errors are skipped on
                    commit.
                  </InfoCallout>
                )}
                {validationReport.reports?.some((r) => !r.valid) &&
                  renderProblemTable(validationReport.reports.filter((r) => !r.valid))}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#FBFAF7]">
                    <TableHead>Line</TableHead>
                    <TableHead>Tender No / Organisation</TableHead>
                    <TableHead>Title / Category</TableHead>
                    <TableHead>Est. Value</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Dates (IST)</TableHead>
                    <TableHead>Check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((r, i) => {
                    const v = r.values;
                    const report = validationByRow.get(i + 1);
                    return (
                      <TableRow key={`${r.line}-${i}`}>
                        <TableCell className="font-mono text-[11px] text-[#4A5568] align-top">{r.line}</TableCell>
                        <TableCell className="align-top">
                          <div className="font-mono text-[11px] font-semibold text-[#0F5E63]">
                            {v.tender_number || <span className="text-[#881337]">Missing</span>}
                          </div>
                          <div className="max-w-[180px] truncate text-[11px]" title={String(v.organisation || '')}>
                            {v.organisation || <span className="text-[#881337]">Missing organisation</span>}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="max-w-[200px] truncate" title={String(v.tender_title || '')}>
                            {v.tender_title || <span className="text-[#6B7280]">—</span>}
                          </div>
                          {v.category && (
                            <Badge variant="outline" size="sm" className="mt-1">
                              {v.category}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] align-top">{formatRupees(v.estimated_value)}</TableCell>
                        <TableCell className="align-top text-[11px]">
                          <div>{[v.city, v.state].filter(Boolean).join(', ') || '—'}</div>
                          {(v.zone || v.region) && (
                            <div className="text-[#4A5568]">{[v.zone, v.region].filter(Boolean).join(' · ')}</div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-[11px] whitespace-nowrap">
                          <div className="font-mono text-[#9A3412]">Closes {displayDate(v.submission_deadline)}</div>
                          {v.pre_bid_meeting_date && (
                            <div className="font-mono text-[#4A5568]">Pre-bid {displayDate(v.pre_bid_meeting_date)}</div>
                          )}
                          {v.publication_date && (
                            <div className="font-mono text-[#4A5568]">Published {displayDate(v.publication_date)}</div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-[11px]">
                          {report &&
                            (report.valid ? (
                              <Badge variant={ACTION_BADGE[report.action]?.variant || 'success'} size="sm">
                                {ACTION_BADGE[report.action]?.label || report.action}
                              </Badge>
                            ) : (
                              <Badge variant={report.action === 'SKIP' ? 'warning' : 'danger'} size="sm">
                                {report.action === 'SKIP' ? 'Skip' : 'Error'}
                              </Badge>
                            ))}
                          {r.notes.map((n, k) => (
                            <div key={k} className="mt-1 max-w-[220px] text-[#A15C07]">
                              {n}
                            </div>
                          ))}
                          {!report && r.notes.length === 0 && <span className="text-[#6B7280]">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-[#ECE9E2]">
              <Button variant="outline" size="sm" onClick={handleBackToEdit} disabled={loading !== null}>
                Back to Edit
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleRunImport(true)}
                isLoading={loading === 'commit'}
                disabled={loading !== null || (validationReport !== null && validationReport.valid_rows === 0)}
              >
                {validationReport
                  ? `Commit & Import ${validationReport.valid_rows} Valid Row${validationReport.valid_rows === 1 ? '' : 's'}`
                  : `Commit & Import ${parsedRows.length} Row${parsedRows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Result Summary */}
        {step === 'result' && commitResult && (
          <div className="space-y-4 py-2">
            <div className="text-center space-y-2">
              <div
                className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
                  written > 0 ? 'bg-[#E3EFEE] text-[#0F5E63]' : 'bg-[#FBEBDD] text-[#9A3412]'
                }`}
              >
                {written > 0 ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
              </div>
              <h3 className="text-lg font-serif font-bold text-[#14213D]">
                {written > 0 ? 'Import Completed' : 'Nothing Was Imported'}
              </h3>
              <p className="text-xs text-[#4A5568] max-w-md mx-auto">
                {written > 0
                  ? 'The tenders below were written to the pipeline with territory mapping and an audit trail.'
                  : 'No tender was inserted or updated. The reasons for each row are listed below.'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
              {([
                ['Inserted', commitResult.inserted, 'text-[#0F5E63]'],
                ['Updated', commitResult.updated, 'text-[#0F5E63]'],
                ['Skipped', commitResult.skipped, Number(commitResult.skipped) > 0 ? 'text-[#9A3412]' : 'text-[#14213D]'],
              ] as const).map(([label, count, tone]) => (
                <div key={label} className="p-3 rounded-[14px] bg-white border border-[#DCD8CE] text-center">
                  <div className={`text-xl font-mono font-bold ${tone}`}>{Number(count) || 0}</div>
                  <div className="text-[11px] text-[#4A5568]">{label}</div>
                </div>
              ))}
            </div>

            {commitProblems.length > 0 && (
              <div className="space-y-2">
                <span className="font-semibold text-[#14213D]">Rows not written</span>
                {renderProblemTable(commitProblems)}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={resetAll}>
                Import Another Sheet
              </Button>
              <Button variant="primary" size="sm" onClick={handleClose}>
                {written > 0 ? 'Done & View Pipeline' : 'Close'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
