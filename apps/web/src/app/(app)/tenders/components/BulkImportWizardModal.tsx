'use client';

import React, { useState } from 'react';
import {
  Modal,
  Button,
  Badge,
  Input,
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
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileDown,
  Layers,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';

interface BulkImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

export function BulkImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
}: BulkImportWizardModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [rawText, setRawText] = useState('');
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [validationReport, setValidationReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sampleTemplate = `Tender Number,Tender Title,Organisation,Category,Estimated Value,Submission Deadline,Publication Date,State
TND-GEM-2026-001,Supply of Advanced Ballistic Helmets,CRPF HQ New Delhi,General,7500000,2026-10-25T15:00:00Z,2026-10-01,Delhi
TND-PQ-2026-002,PQ for Night Vision Weapon Sights,BSF Border Force,PQ,12000000,2026-11-05T17:00:00Z,2026-10-02,Punjab
TND-MHA-2026-003,Procurement of Tactical Shields,CISF Airport Security,MHA,4500000,2026-10-30T14:00:00Z,2026-10-03,Maharashtra`;

  const handleParseCsv = () => {
    try {
      setError(null);
      const text = rawText.trim();
      if (!text) {
        setError('Please paste or upload CSV tender data.');
        return;
      }

      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setError('CSV must contain a header line and at least one data row.');
        return;
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rows: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim());
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          let key = h;
          if (h.includes('number') || h.includes('no')) key = 'tender_number';
          else if (h.includes('title')) key = 'tender_title';
          else if (h.includes('organ') || h.includes('buyer')) key = 'organisation';
          else if (h.includes('cat')) key = 'category';
          else if (h.includes('value') || h.includes('amount')) key = 'estimated_value';
          else if (h.includes('submission') || h.includes('deadline')) key = 'submission_deadline';
          else if (h.includes('publish') || h.includes('date')) key = 'publication_date';
          else if (h.includes('state')) key = 'state';

          rowObj[key] = parts[idx] || '';
        });

        if (rowObj.estimated_value) {
          rowObj.estimated_value = Number(rowObj.estimated_value.replace(/[^0-9.]/g, '')) || 0;
        }

        rows.push(rowObj);
      }

      setParsedRows(rows);
      setStep('preview');
    } catch (err: any) {
      setError(`Failed to parse CSV data: ${err.message}`);
    }
  };

  const handleRunImport = async (commit: boolean) => {
    try {
      setLoading(true);
      setError(null);

      const res = await api.post('/tenders/import', {
        rows: parsedRows,
        duplicate_mode: duplicateMode,
        commit,
      });

      setValidationReport(res.data);
      if (commit) {
        setStep('result');
        if (onImportComplete) onImportComplete();
      }
    } catch (err: any) {
      console.error('Import request failed:', err);
      setError(err?.response?.data?.message || 'Bulk import validation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([sampleTemplate], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arihant_tender_import_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setStep('upload');
    setRawText('');
    setParsedRows([]);
    setValidationReport(null);
    setError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Arihant Tender Sheet — Bulk Import Wizard"
      description="Import active, historical, or pipeline tenders directly from Excel/CSV sheets with automatic column mapping and validation."
      maxWidth="4xl"
    >
      <div className="space-y-6 text-xs">
        {/* Step Indicator */}
        <div className="flex items-center justify-between border-b border-[#DCD8CE] pb-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs font-bold ${
                step === 'upload'
                  ? 'bg-[#0F5E63] text-white'
                  : 'bg-[#E3EFEE] text-[#0F5E63]'
              }`}
            >
              1
            </span>
            <span className={step === 'upload' ? 'font-semibold text-[#14213D]' : 'text-[#4A5568]'}>
              Upload / Paste Data
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs font-bold ${
                step === 'preview'
                  ? 'bg-[#0F5E63] text-white'
                  : 'bg-[#E3EFEE] text-[#0F5E63]'
              }`}
            >
              2
            </span>
            <span className={step === 'preview' ? 'font-semibold text-[#14213D]' : 'text-[#4A5568]'}>
              Preview & Validate
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs font-bold ${
                step === 'result'
                  ? 'bg-[#0F5E63] text-white'
                  : 'bg-[#E3EFEE] text-[#0F5E63]'
              }`}
            >
              3
            </span>
            <span className={step === 'result' ? 'font-semibold text-[#14213D]' : 'text-[#4A5568]'}>
              Import Summary
            </span>
          </div>
        </div>

        {error && (
          <InfoCallout variant="danger" title="Validation Notice">
            {error}
          </InfoCallout>
        )}

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#14213D]">
                Paste CSV or Excel Tab-Separated Values:
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={handleDownloadSample}
                leftIcon={<FileDown className="w-3.5 h-3.5" />}
              >
                Download Sample CSV
              </Button>
            </div>

            <Textarea
              rows={8}
              placeholder={sampleTemplate}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="font-mono text-[11px]"
            />

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div>
                <span className="font-semibold text-[#14213D]">
                  Duplicate Handling Mode:
                </span>
                <p className="text-[11px] text-[#4A5568]">
                  Determines behavior if a tender number already exists.
                </p>
              </div>
              <select
                value={duplicateMode}
                onChange={(e) => setDuplicateMode(e.target.value as any)}
                aria-label="Duplicate Handling Mode"
                className="text-xs rounded-lg border border-[#C9C4B8] bg-white px-2.5 py-1.5 text-[#14213D]"
              >
                <option value="skip">Skip duplicates</option>
                <option value="update">Update existing record</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleParseCsv}
                disabled={!rawText.trim()}
              >
                Parse & Preview Rows
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Preview & Validation */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">
                  Parsed Rows ({parsedRows.length})
                </h4>
                <p className="text-[11px] text-[#4A5568]">
                  Review mapped fields before committing to database. Historical tenders will be flagged source = Bulk Import.
                </p>
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => handleRunImport(false)}
                isLoading={loading}
              >
                Simulate Validation Check
              </Button>
            </div>

            {/* Validation Feedback */}
            {validationReport && (
              <div className="p-3 bg-[#E3EFEE]/40 border border-[#0F5E63]/30 rounded-xl space-y-1">
                <span className="font-bold text-[#0F5E63]">
                  Validation Simulation Passed:
                </span>{' '}
                {validationReport.valid_count ?? parsedRows.length} rows valid,{' '}
                {validationReport.error_count ?? 0} errors detected.
              </div>
            )}

            <div className="max-h-64 overflow-y-auto border border-[#DCD8CE] rounded-xl">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#FBFAF7]">
                    <TableHead>Tender No</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Cat</TableHead>
                    <TableHead>Est. Value</TableHead>
                    <TableHead>Deadline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs font-semibold text-[#0F5E63]">
                        {r.tender_number || 'Missing'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {r.tender_title || 'Untitled'}
                      </TableCell>
                      <TableCell>{r.organisation || 'Prospect'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {r.category || 'General'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        ₹{Number(r.estimated_value || 0).toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-[#9A3412]">
                        {r.submission_deadline || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-[#ECE9E2]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('upload')}
              >
                Back to Edit
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleRunImport(true)}
                isLoading={loading}
              >
                Commit & Import {parsedRows.length} Tenders
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Result Summary */}
        {step === 'result' && (
          <div className="space-y-4 text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#E3EFEE] text-[#0F5E63] mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-serif font-bold text-[#14213D]">
              Import Completed Successfully
            </h3>
            <p className="text-xs text-[#4A5568] max-w-md mx-auto">
              All valid tenders have been committed to the Arihant database pipeline with audit trails and automated territory mapping.
            </p>

            <div className="flex items-center justify-center gap-3 pt-4">
              <Button variant="secondary" size="sm" onClick={resetAll}>
                Import Another Sheet
              </Button>
              <Button variant="primary" size="sm" onClick={onClose}>
                Done & View Pipeline
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
