import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface ScheduleRow {
  phase: string;
  wbsCode: string;
  activity: string;
  description: string;
  startDate: string;
  endDate: string;
  duration: number;
  dependencies: string;
  isMilestone: boolean;
  plannedProgress: number;
  actualProgress: number;
  responsiblePerson: string;
  remarks: string;
  errors: string[];
}

const TARGET_FIELDS = [
  { key: 'phase', label: 'Phase' },
  { key: 'wbsCode', label: 'WBS Code' },
  { key: 'activity', label: 'Activity Name *' },
  { key: 'description', label: 'Description' },
  { key: 'startDate', label: 'Start Date *' },
  { key: 'endDate', label: 'End Date *' },
  { key: 'duration', label: 'Duration (Days)' },
  { key: 'dependencies', label: 'Dependencies (WBS)' },
  { key: 'isMilestone', label: 'Milestone (Yes/No)' },
  { key: 'plannedProgress', label: 'Planned %' },
  { key: 'actualProgress', label: 'Actual %' },
  { key: 'responsiblePerson', label: 'Responsible Person' },
  { key: 'remarks', label: 'Remarks' },
] as const;

function normalizeDate(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed) {
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${m}-${d}`;
    }
  }
  const s = String(val).trim();
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return '';
}

export const ScheduleImportModal: React.FC<{
  projectId: number;
  hasExistingSchedule: boolean;
  onClose: () => void;
  onImported: () => void;
}> = ({ projectId, hasExistingSchedule, onClose, onImported }) => {
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ScheduleRow[]>([]);
  const [revisionNote, setRevisionNote] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [activateNow, setActivateNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    setSelectedSheet(sheetName);
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (json.length === 0) {
      setError('Selected worksheet is empty.');
      return;
    }
    const cols = Object.keys(json[0]);
    setHeaders(cols);
    setRawRows(json);

    // Auto-detect column mapping
    const autoMap: Record<string, string> = {};
    const lowerCols = cols.map((c) => ({ orig: c, low: c.toLowerCase() }));
    const match = (patterns: string[]) =>
      lowerCols.find((c) => patterns.some((p) => c.low.includes(p)))?.orig || '';

    autoMap.phase = match(['phase', 'stage', 'section']);
    autoMap.wbsCode = match(['wbs', 'code', 'id']);
    autoMap.activity = match(['activity', 'task', 'title', 'item']);
    autoMap.description = match(['desc', 'scope', 'detail']);
    autoMap.startDate = match(['start']);
    autoMap.endDate = match(['end', 'finish', 'completion']);
    autoMap.duration = match(['dur', 'days']);
    autoMap.dependencies = match(['dep', 'pred']);
    autoMap.isMilestone = match(['mile']);
    autoMap.plannedProgress = match(['plan']);
    autoMap.actualProgress = match(['actual', 'progress', '%']);
    autoMap.responsiblePerson = match(['resp', 'owner', 'lead', 'eng']);
    autoMap.remarks = match(['remark', 'note']);

    setMapping(autoMap);
    setError('');
    setStep('map');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      setWorkbook(wb);
      setFileName(file.name);
      setSheetNames(wb.SheetNames);
      if (wb.SheetNames.length > 0) {
        loadSheet(wb, wb.SheetNames[0]);
      }
    } catch {
      setError('Unable to parse Excel workbook. Ensure it is a valid .xlsx, .xls, or .csv file.');
    }
  };

  const downloadSampleTemplate = () => {
    const sample = [
      {
        Phase: 'Site Mobilization',
        'WBS Code': '1.1',
        'Activity Name': 'Perimeter Fencing & Survey',
        Description: 'Site layout and temporary utilities',
        'Start Date': '2026-12-01',
        'End Date': '2026-12-14',
        Duration: 14,
        Dependencies: '',
        Milestone: 'No',
        'Planned %': 100,
        'Actual %': 100,
        'Responsible Person': 'Site Engineer',
        Remarks: 'Baseline activity',
      },
      {
        Phase: 'Substructure',
        'WBS Code': '1.2',
        'Activity Name': 'Foundation Footings Complete',
        Description: 'Reinforced concrete footings and curing',
        'Start Date': '2026-12-15',
        'End Date': '2027-01-10',
        Duration: 27,
        Dependencies: '1.1',
        Milestone: 'Yes',
        'Planned %': 50,
        'Actual %': 25,
        'Responsible Person': 'Structural Lead',
        Remarks: 'Critical path milestone',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Schedule');
    XLSX.writeFile(wb, 'CBMS_Schedule_Import_Template.xlsx');
  };

  const buildPreview = () => {
    const rows: ScheduleRow[] = rawRows.map((raw, idx) => {
      const getVal = (k: string) => (mapping[k] ? raw[mapping[k]] : '');
      const activity = String(getVal('activity') || '').trim();
      const startDate = normalizeDate(getVal('startDate'));
      const endDate = normalizeDate(getVal('endDate'));
      const errors: string[] = [];
      if (!activity) errors.push('Missing activity name');
      if (!startDate) errors.push('Invalid/missing start date');
      if (!endDate) errors.push('Invalid/missing end date');
      if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        errors.push('End date precedes start date');
      }
      const milestoneRaw = String(getVal('isMilestone') || '').toLowerCase();
      return {
        phase: String(getVal('phase') || 'General Construction').trim(),
        wbsCode: String(getVal('wbsCode') || `${idx + 1}.0`).trim(),
        activity,
        description: String(getVal('description') || '').trim(),
        startDate,
        endDate,
        duration: Number(getVal('duration')) || 1,
        dependencies: String(getVal('dependencies') || '').trim(),
        isMilestone: ['yes', 'true', '1', 'y', 'milestone'].includes(milestoneRaw),
        plannedProgress: Number(getVal('plannedProgress')) || 0,
        actualProgress: Number(getVal('actualProgress')) || 0,
        responsiblePerson: String(getVal('responsiblePerson') || '').trim(),
        remarks: String(getVal('remarks') || '').trim(),
        errors,
      };
    });
    setPreviewRows(rows);
    setStep('preview');
  };

  const updateRowField = (index: number, field: keyof ScheduleRow, value: string) => {
    setPreviewRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, [field]: value };
        const errors: string[] = [];
        if (!next.activity) errors.push('Missing activity name');
        if (!next.startDate) errors.push('Invalid/missing start date');
        if (!next.endDate) errors.push('Invalid/missing end date');
        if (next.startDate && next.endDate && new Date(next.endDate) < new Date(next.startDate)) {
          errors.push('End date precedes start date');
        }
        return { ...next, errors };
      })
    );
  };

  const hasErrors = previewRows.some((r) => r.errors.length > 0);

  const handleConfirmImport = async () => {
    if (hasErrors) {
      setError('Resolve all validation errors before importing.');
      return;
    }
    if (hasExistingSchedule && !confirmOverwrite) {
      setError('Confirm creating a new schedule revision to protect existing baseline history.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiRequest(`/api/projects/${projectId}/schedule/import`, {
        method: 'POST',
        body: {
          rows: previewRows,
          revisionNote: revisionNote || `Imported from ${fileName}`,
          sourceFilename: fileName,
          confirmRevision: true,
          activateNow,
        },
      });
      onImported();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">Import Project Schedule (Excel / CSV)</h2>
              <p className="text-xs text-slate-500">
                Inspect worksheets, map columns, validate dates & dependencies, and create a tracked revision.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center hover:border-amber-500 hover:bg-amber-50/30 transition">
                <Upload className="h-8 w-8 text-slate-500 mb-3" />
                <span className="text-sm font-semibold text-slate-800">Select Excel Workbook (.xlsx, .xls, .csv)</span>
                <span className="mt-1 text-xs text-slate-500">Client or internal master schedule files are parsed locally before import validation.</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" />
              </label>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs">
                <span className="text-slate-600">Need a standardized structure to test schedule importing?</span>
                <button
                  type="button"
                  onClick={downloadSampleTemplate}
                  className="font-semibold text-amber-700 hover:text-amber-800 underline"
                >
                  Download Excel Template (.xlsx)
                </button>
              </div>
            </div>
          )}

          {step === 'map' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-xs font-medium text-slate-500">Workbook: {fileName}</div>
                  <div className="text-sm font-semibold text-slate-900">{rawRows.length} rows detected</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-700">Worksheet:</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => workbook && loadSheet(workbook, e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TARGET_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700">{field.label}</label>
                    <select
                      value={mapping[field.key] || ''}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800"
                    >
                      <option value="">— Not Mapped —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-medium text-slate-700">
                  Previewing {previewRows.length} schedule activities ·{' '}
                  {hasErrors ? (
                    <span className="text-red-700 font-semibold">Fix highlighted errors inline before import</span>
                  ) : (
                    <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> All rows validated
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">WBS</th>
                      <th className="px-3 py-2">Phase</th>
                      <th className="px-3 py-2">Activity</th>
                      <th className="px-3 py-2">Start Date</th>
                      <th className="px-3 py-2">End Date</th>
                      <th className="px-3 py-2">Deps</th>
                      <th className="px-3 py-2">Actual %</th>
                      <th className="px-3 py-2">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className={row.errors.length > 0 ? 'bg-red-50/50' : 'bg-white'}>
                        <td className="px-3 py-2 font-mono">{row.wbsCode}</td>
                        <td className="px-3 py-2">{row.phase}</td>
                        <td className="px-3 py-2">
                          <input
                            value={row.activity}
                            onChange={(e) => updateRowField(idx, 'activity', e.target.value)}
                            className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={row.startDate}
                            onChange={(e) => updateRowField(idx, 'startDate', e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={row.endDate}
                            onChange={(e) => updateRowField(idx, 'endDate', e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono">{row.dependencies || '—'}</td>
                        <td className="px-3 py-2 font-mono">{row.actualProgress}%</td>
                        <td className="px-3 py-2">
                          {row.errors.length > 0 ? (
                            <span className="text-red-700 font-medium">{row.errors.join('; ')}</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Revision Note</label>
                  <input
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    placeholder="e.g., Client Approved Baseline Rev 2"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div className="flex flex-col justify-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={activateNow}
                      onChange={(e) => setActivateNow(e.target.checked)}
                    />
                    Approve and activate this schedule revision immediately (if authorized)
                  </label>
                  {hasExistingSchedule && (
                    <label className="inline-flex items-center gap-2 font-medium text-amber-800">
                      <input
                        type="checkbox"
                        checked={confirmOverwrite}
                        onChange={(e) => setConfirmOverwrite(e.target.checked)}
                      />
                      Confirm creating a new revision (prior approved schedule will be preserved in history)
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 bg-slate-50 rounded-b-xl">
          <div className="flex items-center gap-2">
            {step !== 'upload' && (
              <button
                type="button"
                onClick={() => setStep(step === 'preview' ? 'map' : 'upload')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            {step === 'map' && (
              <button
                type="button"
                onClick={buildPreview}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Preview & Validate
              </button>
            )}
            {step === 'preview' && (
              <button
                type="button"
                disabled={submitting || hasErrors}
                onClick={handleConfirmImport}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? 'Importing...' : 'Commit Schedule Revision'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
