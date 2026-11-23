import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Calendar,
  Camera,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  HardHat,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
  Upload,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import { CircularProgressRing, StatusLabel } from '../components/Charts';
import { ProjectFinancialWorkspace } from '../components/ProjectFinancialWorkspace';
import { PurchaseRequestsWorkspace } from '../components/PurchaseRequestsWorkspace';
import { ScheduleImportModal } from '../components/ScheduleImportModal';
import {
  formatTaskStatusLabel,
  TaskCompletionSubmitModal,
  TaskVerificationModal,
} from '../components/TaskCompletionModals';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { apiRequest, formatCurrency, getApiToken } from '../lib/api';

type WorkspaceSection =
  | 'overview'
  | 'schedule'
  | 'dpr'
  | 'tasks'
  | 'financials'
  | 'procurement'
  | 'quality'
  | 'documents'
  | 'communications'
  | 'toolbox';

export const ProjectWorkspaceView: React.FC<{
  projectId: number;
  onBack: () => void;
}> = ({ projectId, onBack }) => {
  const { hasPerm } = useAuth();
  const { syncVersion, mutateWithOfflineQueue, fetchWithCache } = useSync();

  const [section, setSection] = useState<WorkspaceSection>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [dprs, setDprs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [finData, setFinData] = useState<any>(null);
  const [prs, setPrs] = useState<any[]>([]);
  const [qcData, setQcData] = useState<any>({ inspections: [], defects: [] });
  const [docs, setDocs] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [toolboxData, setToolboxData] = useState<any>(null);
  const [showEditProject, setShowEditProject] = useState(false);
  const [editProjectForm, setEditProjectForm] = useState({
    name: '',
    location: '',
    address: '',
    description: '',
    scope: '',
    contractAmount: '',
    approvedBudget: '',
    startDate: '',
    originalEndDate: '',
    status: 'active',
  });
  const [showToolboxTxModal, setShowToolboxTxModal] = useState(false);
  const [toolboxTxForm, setToolboxTxForm] = useState({
    itemId: '',
    txType: 'consume',
    quantity: '1',
    referenceDoc: '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState('');

  // Modals & forms
  const [showImport, setShowImport] = useState(false);
  const [publishDpr, setPublishDpr] = useState<any>(null);
  const [publishSummary, setPublishSummary] = useState('');
  const [publishCompleted, setPublishCompleted] = useState('');
  const [publishNext, setPublishNext] = useState('');
  const [publishPhotos, setPublishPhotos] = useState<any[]>([]);
  const [publishAvailablePhotos, setPublishAvailablePhotos] = useState<any[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // DPR Form
  const [dprForm, setDprForm] = useState({
    reportDate: new Date().toISOString().slice(0, 10),
    weather: 'Clear · 20°C',
    activitiesPerformed: '',
    accomplishments: '',
    workCompletedPct: '0',
    manpowerCount: '0',
    materialsUsed: '',
    equipmentUsed: '',
    delaysProblems: '',
    safetyObservations: '',
    nextDayPlan: '',
    submitNow: true,
  });
  const [dprPhotos, setDprPhotos] = useState<Array<{ url: string; caption: string; phase?: string }>>([]);

  // Task Form & View Mode
  const [taskView, setTaskView] = useState<'list' | 'kanban' | 'calendar'>('list');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [completionModalTask, setCompletionModalTask] = useState<any | null>(null);
  const [verifyTaskId, setVerifyTaskId] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    assigneeKey: '',
    priority: 'medium',
    startDate: new Date().toISOString().slice(0, 10),
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  });

  // QC Form
  const [qcForm, setQcForm] = useState({
    title: '',
    inspectionDate: new Date().toISOString().slice(0, 10),
    reporterKey: '',
    status: 'scheduled',
    defectsSummary: '',
  });
  const [defectDesc, setDefectDesc] = useState<Record<number, string>>({});

  // Doc upload
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('Drawings');
  const [docClientVisible, setDocClientVisible] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);

  // Message Form
  const [msgChannel, setMsgChannel] = useState<'internal' | 'client'>('internal');
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const ov = await fetchWithCache(`project_${projectId}_overview`, `/api/projects/${projectId}`);
      setOverview(ov.data);

      const calls: Promise<void>[] = [];
      if (hasPerm('schedules', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/schedule`).then(setScheduleData).catch(() => {})
        );
      }
      if (hasPerm('dpr', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/dpr`).then((r) => setDprs(r.reports || [])).catch(() => {})
        );
      }
      if (hasPerm('tasks', 'view')) {
        calls.push(
          apiRequest(`/api/tasks?projectId=${projectId}`).then((r) => setTasks(r.tasks || [])).catch(() => {})
        );
      }
      if (hasPerm('financials', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/financials`).then(setFinData).catch(() => {})
        );
      }
      if (hasPerm('procurement', 'view')) {
        calls.push(
          apiRequest(`/api/purchase-requests?projectId=${projectId}`)
            .then((r) => setPrs(r.purchaseRequests || []))
            .catch(() => {})
        );
      }
      if (hasPerm('quality', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/quality`).then(setQcData).catch(() => {})
        );
      }
      if (hasPerm('documents', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/documents`).then((r) => setDocs(r.documents || [])).catch(() => {})
        );
      }
      if (hasPerm('communications', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/messages`).then((r) => setMessages(r.messages || [])).catch(() => {})
        );
      }
      if (hasPerm('equipment', 'view')) {
        calls.push(
          apiRequest(`/api/projects/${projectId}/toolbox`).then(setToolboxData).catch(() => {})
        );
      }
      await Promise.all(calls);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [projectId, syncVersion]);

  const sections: Array<{ id: WorkspaceSection; label: string; allowed: boolean }> = [
    { id: 'overview', label: 'Overview', allowed: true },
    { id: 'schedule', label: 'Schedule & Gantt', allowed: hasPerm('schedules', 'view') },
    { id: 'dpr', label: 'Daily Reports (DPR)', allowed: hasPerm('dpr', 'view') },
    { id: 'tasks', label: 'Tasks', allowed: hasPerm('tasks', 'view') },
    { id: 'financials', label: 'Budget & Expenses', allowed: hasPerm('financials', 'view') },
    { id: 'procurement', label: 'Purchase Requests', allowed: hasPerm('procurement', 'view') },
    { id: 'quality', label: 'Quality Control', allowed: hasPerm('quality', 'view') },
    { id: 'documents', label: 'Documents', allowed: hasPerm('documents', 'view') },
    { id: 'communications', label: 'Communications', allowed: hasPerm('communications', 'view') },
    { id: 'toolbox', label: 'Toolbox & Site Resources', allowed: hasPerm('equipment', 'view') },
  ].filter((s) => s.allowed) as any;

  const employeeOptions: Array<{ key: string; label: string; userId?: number | null; personnelId?: number | null }> = (() => {
    const opts: Array<{ key: string; label: string; userId?: number | null; personnelId?: number | null }> = [];
    const coveredUserIds = new Set<number>();
    for (const per of overview?.projectPersonnel || []) {
      if (per.user_id) coveredUserIds.add(Number(per.user_id));
      opts.push({
        key: `personnel:${per.id}`,
        label: `${per.full_name} (${per.position || per.trade_skill || 'Staff'})`,
        userId: per.user_id || null,
        personnelId: per.id,
      });
    }
    for (const u of overview?.assignableStaff || []) {
      if (coveredUserIds.has(Number(u.id))) continue;
      opts.push({
        key: `user:${u.id}`,
        label: `${u.full_name} (${u.job_title || u.role_name || 'Team'})`,
        userId: u.id,
        personnelId: null,
      });
    }
    return opts;
  })();

  const compressImageToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(String(reader.result));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = () => resolve(String(reader.result));
        img.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });

  const handleDprPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, Math.max(0, 10 - dprPhotos.length));
    if (files.length === 0) return;
    const processed = await Promise.all(
      files.map(async (file) => ({
        url: await compressImageToDataUrl(file),
        caption: file.name.replace(/\.[^.]+$/, ''),
        phase: 'Site Activity Proof',
      }))
    );
    setDprPhotos((prev) => [...prev, ...processed].slice(0, 10));
    e.target.value = '';
  };

  const handleSubmitDpr = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateWithOfflineQueue({
      method: 'POST',
      url: `/api/projects/${projectId}/dpr`,
      body: {
        ...dprForm,
        workCompletedPct: Number(dprForm.workCompletedPct),
        manpowerCount: Number(dprForm.manpowerCount),
        photos: dprPhotos,
      },
      label: `DPR ${dprForm.reportDate}`,
    });
    setBanner(res.queued ? 'Offline: Daily Progress Report queued for automatic sync.' : 'Daily Progress Report saved.');
    setDprForm((prev) => ({ ...prev, activitiesPerformed: '', accomplishments: '', delaysProblems: '', nextDayPlan: '' }));
    setDprPhotos([]);
    if (!res.queued) loadWorkspace();
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = employeeOptions.find((o) => o.key === taskForm.assigneeKey);
    const res = await mutateWithOfflineQueue({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      body: {
        title: taskForm.title,
        description: taskForm.description,
        priority: taskForm.priority,
        startDate: taskForm.startDate,
        deadline: taskForm.deadline,
        assignedTo: chosen?.userId || null,
        assignedPersonnelId: chosen?.personnelId || null,
      },
      label: `Task: ${taskForm.title}`,
    });
    setBanner(res.queued ? 'Offline: Task queued for sync.' : 'Task created and assigned.');
    setTaskForm((prev) => ({ ...prev, title: '', description: '', assigneeKey: '', priority: 'medium' }));
    setShowTaskForm(false);
    if (!res.queued) loadWorkspace();
  };

  const handleTaskStatusSelect = async (task: any, nextStatus: string) => {
    if (nextStatus === 'for_review' || nextStatus === 'completed') {
      setCompletionModalTask(task);
      return;
    }
    try {
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      loadWorkspace();
    } catch (err: any) {
      setBanner(err?.message || 'Unable to update task status');
    }
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) return;
    const fd = new FormData();
    fd.append('file', docFile);
    fd.append('title', docTitle || docFile.name);
    fd.append('category', docCategory);
    fd.append('isClientVisible', docClientVisible ? 'true' : 'false');
    fd.append('isConfidential', docClientVisible ? 'false' : 'true');
    await apiRequest(`/api/projects/${projectId}/documents`, {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
    setDocTitle('');
    setDocFile(null);
    setBanner('Document uploaded securely outside web root.');
    loadWorkspace();
  };

  if (loading && !overview) {
    return <div className="p-8 text-center text-xs text-slate-500">Loading project workspace...</div>;
  }

  const p = overview?.project;
  const sched = overview?.schedule;
  const fin = overview?.financials;
  const evm = overview?.evm;

  const projectEndDate = p?.actual_end_date || p?.revised_end_date || p?.original_end_date || '';
  const projectDurationDays = (() => {
    if (!p?.start_date || !projectEndDate) return null;
    const s = new Date(`${p.start_date}T00:00:00`).getTime();
    const e = new Date(`${projectEndDate}T00:00:00`).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Projects
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{p?.name}</h1>
              <StatusLabel status={sched?.healthStatus || p?.status || ''} />
            </div>
            <p className="text-xs text-slate-500">
              <span className="font-mono">{p?.ref_number}</span> · Client: {p?.client_name} · Location: {p?.location}
              {p?.description ? ` · ${p.description}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasPerm('projects', 'edit') && (
              <button
                type="button"
                onClick={() => {
                  setEditProjectForm({
                    name: p?.name || '',
                    location: p?.location || '',
                    address: p?.address || '',
                    description: p?.description || '',
                    scope: p?.scope || '',
                    contractAmount: p?.contract_amount || '',
                    approvedBudget: p?.approved_budget || '',
                    startDate: p?.start_date || '',
                    originalEndDate: p?.original_end_date || '',
                    status: p?.status || 'active',
                  });
                  setShowEditProject(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Wrench className="h-4 w-4" />
                Edit Project Details
              </button>
            )}
            {hasPerm('schedules', 'create') && (
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-700 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Import Excel Schedule
              </button>
            )}
          </div>
        </div>

        {/* Project Schedule Metadata Bar matching spreadsheet header */}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3.5 text-xs sm:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium text-slate-500">Project Start Date</div>
            <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">{p?.start_date || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500">Project End Date</div>
            <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">{projectEndDate || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500">Project Duration</div>
            <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
              {projectDurationDays !== null ? `${projectDurationDays} Days` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500">Project Status</div>
            <div className="mt-0.5 font-semibold text-slate-900 capitalize">
              {String(p?.status || 'active').replace(/_/g, ' ')}
            </div>
          </div>
        </div>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner('')} className="underline">Dismiss</button>
        </div>
      )}

      {/* Workspace Section Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`px-3.5 py-2.5 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
              section === s.id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* SECTION: OVERVIEW (Executive Dashboard Style + Spreadsheet Categories) */}
      {section === 'overview' && (
        <div className="space-y-5">
          {hasPerm('financials', 'view') && (
            <ProjectFinancialWorkspace
              projectId={projectId}
              finData={finData}
              summary={fin}
              prs={prs}
              employeeOptions={employeeOptions}
              mode="overview"
              onOpenFullFinancials={() => setSection('financials')}
              onRefresh={loadWorkspace}
              onNotify={setBanner}
            />
          )}

          {/* Schedule Progress, Earned Value & Scope / Team */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex items-center gap-5">
              <CircularProgressRing percentage={sched?.actualProgress || 0} label="Actual" />
              <div className="space-y-1.5 text-xs">
                <div className="font-display text-sm font-semibold text-slate-900">Schedule Progress</div>
                <div className="font-mono text-slate-600 tabular-nums">
                  Planned: {sched?.plannedProgress?.toFixed(1)}% · Actual: {sched?.actualProgress?.toFixed(1)}%
                </div>
                <div className={`font-mono font-semibold tabular-nums ${(sched?.progressVariance || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  Variance: {(sched?.progressVariance || 0) >= 0 ? '+' : ''}
                  {sched?.progressVariance?.toFixed(1)}%
                </div>
                <div className="text-slate-500">
                  Milestones: {sched?.completedMilestones}/{sched?.totalMilestones} completed
                </div>
              </div>
            </div>

            {hasPerm('financials', 'view') && evm && (
              <div className="lg:col-span-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-slate-900">Earned Value (EVM)</span>
                  <span className="text-[11px] font-medium text-amber-700">
                    {evm.isProvisional ? 'Provisional' : 'Verified'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div>
                    <div className="text-slate-500">SPI</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums">{evm.spi ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">CPI</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums">{evm.cpi ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">EAC</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums">
                      {evm.eac !== null ? formatCurrency(evm.eac) : '—'}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 pt-1">
                  PV: {formatCurrency(evm.pv)} · EV: {formatCurrency(evm.ev)} · AC: {formatCurrency(evm.ac)}
                </div>
              </div>
            )}

            <div className={`${hasPerm('financials', 'view') && evm ? 'lg:col-span-4' : 'lg:col-span-8'} rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-2.5 text-xs`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-slate-900">Budget Commitments</span>
                {hasPerm('financials', 'view') && fin && (
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    Utilization: {fin.budgetUtilizationPct}%
                  </span>
                )}
              </div>
              {hasPerm('financials', 'view') && fin ? (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="text-slate-500">Open PR Commitments</div>
                    <div className="font-mono font-bold text-amber-700 tabular-nums">{formatCurrency(fin.outstandingCommitments)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Remaining Available Budget</div>
                    <div className="font-mono font-bold text-emerald-700 tabular-nums">{formatCurrency(fin.remainingAvailableBudget)}</div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500">Schedule and operational execution overview active.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-3 text-xs">
              <h3 className="font-display text-sm font-semibold text-slate-900">Project Scope &amp; Client Details</h3>
              <p className="text-slate-700 leading-relaxed">{p?.description || 'No description provided.'}</p>
              <div className="border-t border-slate-100 pt-3">
                <div className="font-semibold text-slate-800 mb-1">Approved Scope</div>
                <p className="text-slate-600 leading-relaxed">{p?.scope || '—'}</p>
              </div>
              <div className="border-t border-slate-100 pt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] text-slate-500">Client Representative</div>
                  <div className="font-medium text-slate-900">
                    {p?.client_representative || '—'}
                    {p?.client_rep_title ? ` (${p.client_rep_title})` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Contact Information</div>
                  <div className="text-slate-900">{p?.client_email || '—'}</div>
                  {p?.client_phone && <div className="font-mono text-[11px] text-slate-600">{p.client_phone}</div>}
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[11px] text-slate-500">Client Address</div>
                  <div className="text-slate-700">{p?.client_address || p?.address || '—'}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-3 text-xs">
              <h3 className="font-display text-sm font-semibold text-slate-900">Assigned Project Team</h3>
              <div className="divide-y divide-slate-100">
                {(overview?.team || []).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium text-slate-900">{m.full_name}</div>
                      <div className="text-[11px] text-slate-500">{m.email}</div>
                    </div>
                    <span className="text-slate-600">{m.role_name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: SCHEDULE & GANTT */}
      {section === 'schedule' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <div>
              <span className="font-semibold text-slate-900">
                Active Revision: Rev {scheduleData?.activeRevision?.revision_number ?? 'None'}
              </span>
              {scheduleData?.activeRevision?.source_filename && (
                <span className="ml-2 text-slate-500">({scheduleData.activeRevision.source_filename})</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(scheduleData?.revisions || []).map((rev: any) => (
                <button
                  key={rev.id}
                  type="button"
                  onClick={async () => {
                    if (!rev.is_active && hasPerm('schedules', 'approve')) {
                      await apiRequest(`/api/projects/${projectId}/schedule/revisions/${rev.id}/activate`, {
                        method: 'POST',
                      });
                      loadWorkspace();
                    }
                  }}
                  className={`rounded-md px-2.5 py-1 border text-xs font-mono ${
                    rev.is_active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Rev {rev.revision_number} {rev.is_active ? '(Active)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Gantt Timeline Visualization */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Gantt Schedule & Critical Path
              </h3>
              <span className="text-xs text-slate-500">
                Amber bars = Critical Path · Adjust progress % inline
              </span>
            </div>
            <div className="overflow-x-auto">
              {(() => {
                const acts: any[] = scheduleData?.activities || [];
                if (acts.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No schedule activities imported yet. Use "Import Excel Schedule" to upload a project workbook.
                    </div>
                  );
                }
                const minTs = Math.min(...acts.map((a) => new Date(a.start_date).getTime()));
                const maxTs = Math.max(...acts.map((a) => new Date(a.end_date).getTime()));
                const span = Math.max(86400000, maxTs - minTs);

                return (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">WBS</th>
                        <th className="px-4 py-2.5">Activity & Phase</th>
                        <th className="px-4 py-2.5">Dates</th>
                        <th className="px-4 py-2.5 w-64">Timeline Bar</th>
                        <th className="px-4 py-2.5 text-right">Actual %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {acts.map((a) => {
                        const leftPct = ((new Date(a.start_date).getTime() - minTs) / span) * 100;
                        const widthPct = Math.max(
                          3,
                          ((new Date(a.end_date).getTime() - new Date(a.start_date).getTime()) / span) * 100
                        );
                        return (
                          <tr key={a.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-mono text-slate-600">{a.wbs_code}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-900">
                                {a.name}
                                {a.is_milestone ? ' ◆ Milestone' : ''}
                                {a.is_critical_path ? ' · Critical' : ''}
                              </div>
                              <div className="text-[11px] text-slate-500">{a.phase_name}</div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {a.start_date} → {a.end_date}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="relative h-4 w-full rounded bg-slate-100">
                                <div
                                  className={`absolute top-0.5 bottom-0.5 rounded ${
                                    a.is_critical_path ? 'bg-amber-600' : 'bg-slate-700'
                                  }`}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  defaultValue={a.actual_progress}
                                  onBlur={async (e) => {
                                    const val = Number(e.target.value);
                                    if (val !== a.actual_progress && hasPerm('schedules', 'edit')) {
                                      await apiRequest(`/api/projects/${projectId}/activities/${a.id}`, {
                                        method: 'PATCH',
                                        body: { actualProgress: val },
                                      });
                                      loadWorkspace();
                                    }
                                  }}
                                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                                />
                                <span className="font-mono text-slate-500">%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* SECTION: DAILY PROGRESS REPORTS */}
      {section === 'dpr' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {hasPerm('dpr', 'create') && (
            <form onSubmit={handleSubmitDpr} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit">
              <h3 className="font-display text-sm font-semibold text-slate-900">Log Daily Progress Report</h3>
              <p className="text-[11px] text-slate-500">
                Internal by default. Works offline and queues automatically if connectivity drops.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Report Date</label>
                  <input
                    type="date"
                    required
                    value={dprForm.reportDate}
                    onChange={(e) => setDprForm({ ...dprForm, reportDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Weather</label>
                  <input
                    value={dprForm.weather}
                    onChange={(e) => setDprForm({ ...dprForm, weather: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Activities Performed *</label>
                <textarea
                  required
                  rows={3}
                  value={dprForm.activitiesPerformed}
                  onChange={(e) => setDprForm({ ...dprForm, activitiesPerformed: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Manpower Deployed</label>
                  <input
                    type="number"
                    min="0"
                    value={dprForm.manpowerCount}
                    onChange={(e) => setDprForm({ ...dprForm, manpowerCount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Work Completed %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={dprForm.workCompletedPct}
                    onChange={(e) => setDprForm({ ...dprForm, workCompletedPct: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Delays / Internal Observations</label>
                <input
                  value={dprForm.delaysProblems}
                  onChange={(e) => setDprForm({ ...dprForm, delaysProblems: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Next Day Work Plan</label>
                <input
                  value={dprForm.nextDayPlan}
                  onChange={(e) => setDprForm({ ...dprForm, nextDayPlan: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>

              {/* Photo Proofs Upload */}
              <div className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                    <Camera className="h-3.5 w-3.5 text-amber-600" />
                    Activity Photo Proofs ({dprPhotos.length}/10)
                  </label>
                  <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                    Upload Photos
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleDprPhotoSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                {dprPhotos.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    Attach site photos as visual proof of completed activities (stored offline if disconnected).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {dprPhotos.map((ph, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5">
                        <img src={ph.url} alt={ph.caption} className="h-11 w-14 shrink-0 rounded object-cover" />
                        <input
                          value={ph.caption}
                          onChange={(e) =>
                            setDprPhotos((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, caption: e.target.value } : item))
                            )
                          }
                          placeholder="Photo caption / activity note..."
                          className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => setDprPhotos((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Remove photo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
              >
                Submit Daily Report
              </button>
            </form>
          )}

          <div className="lg:col-span-2 space-y-4">
            {dprs.map((d) => {
              let photos: Array<{ url: string; caption?: string }> = [];
              try {
                photos = JSON.parse(d.photos_json || '[]');
              } catch {
                photos = [];
              }
              return (
                <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="font-display text-sm font-semibold text-slate-900">
                        DPR · {d.report_date}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Prepared by {d.prepared_by_name} · Weather: {d.weather || '—'} · Manpower: {d.manpower_count}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusLabel status={d.status} />
                      {d.is_published_to_client ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Globe className="h-3.5 w-3.5" /> Published to Client
                        </span>
                      ) : (
                        <span className="text-slate-500">Private (Internal)</span>
                      )}
                    </div>
                  </div>
                  <p className="text-slate-800 leading-relaxed">{d.activities_performed}</p>
                  {photos.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-500">
                        Photo Proofs ({photos.length})
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {photos.map((ph, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setLightboxUrl(ph.url)}
                            className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left"
                          >
                            <img
                              src={ph.url}
                              alt={ph.caption || 'Activity proof'}
                              className="h-20 w-28 object-cover transition-transform group-hover:scale-105"
                            />
                            {ph.caption && (
                              <div className="max-w-[112px] truncate px-1.5 py-1 text-[10px] text-slate-600 bg-white border-t border-slate-100">
                                {ph.caption}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {d.delays_problems && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
                      <strong>Internal Delays/Notes:</strong> {d.delays_problems}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {hasPerm('dpr', 'review') && d.status === 'submitted' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiRequest(`/api/dpr/${d.id}/workflow`, { method: 'PATCH', body: { action: 'approve' } });
                          loadWorkspace();
                        }}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800"
                      >
                        Approve DPR
                      </button>
                    )}
                    {hasPerm('dpr', 'publish_client') && (
                      <button
                        type="button"
                        onClick={() => {
                          setPublishDpr(d);
                          setPublishSummary(d.client_summary || d.accomplishments || d.activities_performed);
                          setPublishCompleted(d.client_completed_activities || d.activities_performed);
                          setPublishNext(d.client_next_activities || d.next_day_plan);
                          try {
                            const allPh = JSON.parse(d.photos_json || '[]');
                            setPublishAvailablePhotos(Array.isArray(allPh) ? allPh : []);
                            setPublishPhotos(Array.isArray(allPh) ? allPh : []);
                          } catch {
                            setPublishAvailablePhotos([]);
                            setPublishPhotos([]);
                          }
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
                      >
                        {d.is_published_to_client ? 'Edit Client Update' : 'Publish to Client Portal'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION: TASKS (List, Kanban, Calendar) */}
      {section === 'tasks' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['list', 'kanban', 'calendar'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTaskView(v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                    taskView === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {v} View
                </button>
              ))}
            </div>
            {hasPerm('tasks', 'create') && (
              <button
                type="button"
                onClick={() => setShowTaskForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                {showTaskForm ? 'Close Task Form' : 'New Task'}
              </button>
            )}
          </div>

          {hasPerm('tasks', 'create') && showTaskForm && (
            <form
              onSubmit={handleCreateTask}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-display text-sm font-semibold text-slate-900">Create & Assign Task</h3>
                <button
                  type="button"
                  onClick={() => setShowTaskForm(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Task Title *</label>
                  <input
                    required
                    placeholder="e.g., Inspect rebar spacing at Zone B"
                    value={taskForm.title}
                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assigned Employee *</label>
                  <select
                    required
                    value={taskForm.assigneeKey}
                    onChange={(e) => setTaskForm({ ...taskForm, assigneeKey: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">Select responsible employee...</option>
                    {employeeOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Priority *</label>
                  <select
                    required
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">
                    Task Description & Detailed Instructions *
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Specify scope, location, safety requirements, drawings/specs, and acceptance criteria..."
                    value={taskForm.description}
                    onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={taskForm.startDate}
                    onChange={(e) => setTaskForm({ ...taskForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Deadline *</label>
                  <input
                    type="date"
                    required
                    value={taskForm.deadline}
                    onChange={(e) => setTaskForm({ ...taskForm, deadline: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowTaskForm(false)}
                  className="rounded-lg border border-slate-300 px-3.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Save & Assign Task
                </button>
              </div>
            </form>
          )}

          {taskView === 'list' && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Ref</th>
                    <th className="px-4 py-2.5">Task & Instructions</th>
                    <th className="px-4 py-2.5">Assigned Employee</th>
                    <th className="px-4 py-2.5">Priority</th>
                    <th className="px-4 py-2.5">Deadline</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {tasks.map((t) => {
                    const pColor =
                      t.priority === 'high' || t.priority === 'critical'
                        ? 'text-red-700 font-semibold'
                        : t.priority === 'low'
                        ? 'text-slate-500'
                        : 'text-amber-700 font-medium';
                    return (
                      <tr key={t.id} className="align-top">
                        <td className="px-4 py-3 font-mono text-slate-600">{t.ref_number}</td>
                        <td className="px-4 py-3 max-w-md">
                          <div className="font-semibold text-slate-900">{t.title}</div>
                          {t.description && (
                            <p className="mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
                              {t.description}
                            </p>
                          )}
                          {t.photo_count > 0 && (
                            <div className="mt-1 text-[11px] font-medium text-emerald-700">
                              {t.photo_count} completion photo{t.photo_count > 1 ? 's' : ''} attached
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {t.assigned_to_name ? (
                            <div>
                              <div className="font-medium text-slate-900">{t.assigned_to_name}</div>
                              {t.assigned_position && (
                                <div className="text-[11px] text-slate-500">{t.assigned_position}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">Unassigned</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 capitalize ${pColor}`}>{t.priority}</td>
                        <td className="px-4 py-3 font-mono">{t.deadline}</td>
                        <td className="px-4 py-3">
                          <StatusLabel status={t.status} labelOverride={formatTaskStatusLabel(t)} />
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                            {t.status !== 'completed' && hasPerm('tasks', 'edit') && (
                              <button
                                type="button"
                                onClick={() => setCompletionModalTask(t)}
                                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                              >
                                Submit Proof
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setVerifyTaskId(t.id)}
                              className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                                t.status === 'for_review' && (hasPerm('tasks', 'verify') || hasPerm('tasks', 'approve'))
                                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {t.status === 'for_review' && (hasPerm('tasks', 'verify') || hasPerm('tasks', 'approve'))
                                ? 'Verify'
                                : 'Evidence'}
                            </button>
                            {t.status !== 'completed' && hasPerm('tasks', 'edit') && (
                              <select
                                value={t.status}
                                onChange={(e) => handleTaskStatusSelect(t, e.target.value)}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                {['pending', 'acknowledged', 'in_progress', 'for_review', 'completed', 'on_hold', 'overdue', 'rejected'].map(
                                  (st) => (
                                    <option key={st} value={st}>
                                      {st === 'for_review'
                                        ? 'submit for review'
                                        : st === 'completed'
                                        ? 'complete (photo req.)'
                                        : st.replace(/_/g, ' ')}
                                    </option>
                                  )
                                )}
                              </select>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {taskView === 'kanban' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {[
                { key: 'pending', label: 'Pending' },
                { key: 'in_progress', label: 'In Progress' },
                { key: 'for_review', label: 'Awaiting Verification' },
                { key: 'completed', label: 'Completed — Verified' },
              ].map((col) => (
                <div key={col.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
                    <span>{col.label}</span>
                    <span className="font-mono">{tasks.filter((t) => t.status === col.key).length}</span>
                  </div>
                  {tasks
                    .filter((t) => t.status === col.key)
                    .map((t) => (
                      <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-500">
                          <span>{t.ref_number} · {t.deadline}</span>
                          <span
                            className={`capitalize font-sans font-semibold ${
                              t.priority === 'high' || t.priority === 'critical'
                                ? 'text-red-700'
                                : t.priority === 'low'
                                ? 'text-slate-500'
                                : 'text-amber-700'
                            }`}
                          >
                            {t.priority}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        {t.description && (
                          <p className="text-[11px] text-slate-600 line-clamp-3">{t.description}</p>
                        )}
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>
                            Assignee: <strong className="text-slate-700">{t.assigned_to_name || 'Unassigned'}</strong>
                          </span>
                          {t.photo_count > 0 && (
                            <span className="text-emerald-700 font-medium">{t.photo_count} photo</span>
                          )}
                        </div>
                        <div className="flex gap-1.5 pt-1">
                          {t.status !== 'completed' && hasPerm('tasks', 'edit') && (
                            <button
                              type="button"
                              onClick={() => setCompletionModalTask(t)}
                              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
                            >
                              Submit Proof
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setVerifyTaskId(t.id)}
                            className={`flex-1 rounded px-2 py-1 text-[11px] font-medium ${
                              t.status === 'for_review' && (hasPerm('tasks', 'verify') || hasPerm('tasks', 'approve'))
                                ? 'bg-emerald-700 text-white'
                                : 'border border-slate-300 bg-white text-slate-700'
                            }`}
                          >
                            {t.status === 'for_review' && (hasPerm('tasks', 'verify') || hasPerm('tasks', 'approve'))
                              ? 'Verify'
                              : 'Evidence'}
                          </button>
                        </div>
                        {t.status !== 'completed' && hasPerm('tasks', 'edit') && (
                          <select
                            value={t.status}
                            onChange={(e) => handleTaskStatusSelect(t, e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                          >
                            {['pending', 'in_progress', 'for_review', 'completed', 'on_hold'].map((s) => (
                              <option key={s} value={s}>
                                Move to: {s === 'completed' ? 'complete (requires photo)' : s.replace(/_/g, ' ')}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}

          {taskView === 'calendar' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Calendar className="h-4 w-4 text-amber-600" />
                <span>Chronological Task Deadline Schedule</span>
              </div>
              <div className="divide-y divide-slate-100">
                {[...tasks]
                  .sort((a, b) => a.deadline.localeCompare(b.deadline))
                  .map((t) => (
                    <div key={t.id} className="flex flex-wrap items-start justify-between py-2.5 gap-3">
                      <div>
                        <div>
                          <span className="font-mono font-semibold text-slate-700 mr-3">{t.deadline}</span>
                          <span className="font-semibold text-slate-900">{t.title}</span>
                          <span className="ml-2 text-[11px] capitalize text-slate-500">
                            · Priority: {t.priority} · {t.assigned_to_name || 'Unassigned'}
                          </span>
                        </div>
                        {t.description && <p className="mt-1 text-[11px] text-slate-600">{t.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusLabel status={t.status} labelOverride={formatTaskStatusLabel(t)} />
                        <button
                          type="button"
                          onClick={() => setVerifyTaskId(t.id)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Proof
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {completionModalTask && (
            <TaskCompletionSubmitModal
              task={completionModalTask}
              onClose={() => setCompletionModalTask(null)}
              onSubmitted={loadWorkspace}
            />
          )}

          {verifyTaskId !== null && (
            <TaskVerificationModal
              taskId={verifyTaskId}
              onClose={() => setVerifyTaskId(null)}
              onUpdated={loadWorkspace}
              onOpenResubmit={(task) => setCompletionModalTask(task)}
            />
          )}
        </div>
      )}

      {/* SECTION: BUDGET & EXPENSES */}
      {section === 'financials' && finData && (
        <ProjectFinancialWorkspace
          projectId={projectId}
          finData={finData}
          summary={fin}
          prs={prs}
          employeeOptions={employeeOptions}
          mode="full"
          onRefresh={loadWorkspace}
          onNotify={setBanner}
        />
      )}

      {/* SECTION: PURCHASE REQUESTS */}
      {section === 'procurement' && (
        <PurchaseRequestsWorkspace
          projectId={projectId}
          defaultSiteLocation={p?.location || ''}
          onRefreshParent={loadWorkspace}
          onNotify={setBanner}
        />
      )}

      {/* SECTION: QUALITY CONTROL */}
      {section === 'quality' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {hasPerm('quality', 'create') && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const chosen = employeeOptions.find((o) => o.key === qcForm.reporterKey);
                await apiRequest(`/api/projects/${projectId}/quality`, {
                  method: 'POST',
                  body: {
                    title: qcForm.title,
                    inspectionDate: qcForm.inspectionDate,
                    status: qcForm.status,
                    defectsSummary: qcForm.defectsSummary,
                    inspectorId: chosen?.userId || null,
                    reportedByPersonnelId: chosen?.personnelId || null,
                  },
                });
                setQcForm({ ...qcForm, title: '', defectsSummary: '', reporterKey: '' });
                loadWorkspace();
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit"
            >
              <h3 className="font-display text-sm font-semibold text-slate-900">Create QC Inspection</h3>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Inspection Title *</label>
                <input
                  required
                  value={qcForm.title}
                  onChange={(e) => setQcForm({ ...qcForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Personnel Responsible (Reporting Inspection) *
                </label>
                <select
                  required
                  value={qcForm.reporterKey}
                  onChange={(e) => setQcForm({ ...qcForm, reporterKey: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="">Select reporting personnel...</option>
                  {employeeOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Inspection Date</label>
                <input
                  type="date"
                  required
                  value={qcForm.inspectionDate}
                  onChange={(e) => setQcForm({ ...qcForm, inspectionDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Initial Status</label>
                <select
                  value={qcForm.status}
                  onChange={(e) => setQcForm({ ...qcForm, status: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="reinspection">Reinspection</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Findings / Summary Notes</label>
                <textarea
                  rows={2}
                  value={qcForm.defectsSummary}
                  onChange={(e) => setQcForm({ ...qcForm, defectsSummary: e.target.value })}
                  placeholder="Optional inspection notes or findings..."
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white">
                Log Inspection
              </button>
            </form>
          )}

          <div className="lg:col-span-2 space-y-4">
            {(qcData.inspections || []).map((ins: any) => (
              <div key={ins.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-slate-500">{ins.ref_number} · {ins.inspection_date}</span>
                    <div className="font-display text-sm font-semibold text-slate-900">{ins.title}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                      <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                      <span>
                        Reported by: <strong className="text-slate-800">{ins.inspector_name}</strong>
                        {ins.inspector_position ? ` (${ins.inspector_position})` : ''}
                      </span>
                    </div>
                  </div>
                  <StatusLabel status={ins.status} />
                </div>
                {ins.defects_summary && <p className="text-slate-600">{ins.defects_summary}</p>}
                {hasPerm('quality', 'create') && (
                  <div className="flex gap-2 pt-1">
                    <input
                      placeholder="Log defect & auto-generate task..."
                      value={defectDesc[ins.id] || ''}
                      onChange={(e) => setDefectDesc((p) => ({ ...p, [ins.id]: e.target.value }))}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const text = defectDesc[ins.id]?.trim();
                        if (!text) return;
                        await apiRequest(`/api/quality/${ins.id}/defects`, {
                          method: 'POST',
                          body: {
                            description: text,
                            severity: 'major',
                            deadline: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
                            generateTask: true,
                          },
                        });
                        setDefectDesc((p) => ({ ...p, [ins.id]: '' }));
                        setBanner('Defect logged and corrective action task automatically generated.');
                        loadWorkspace();
                      }}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 whitespace-nowrap"
                    >
                      Log Defect + Create Task
                    </button>
                  </div>
                )}
              </div>
            ))}

            {(qcData.defects || []).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 text-xs">
                <h4 className="font-display text-sm font-semibold text-slate-900">Punch List & Corrective Actions</h4>
                <div className="divide-y divide-slate-100">
                  {qcData.defects.map((df: any) => (
                    <div key={df.id} className="flex items-center justify-between py-2.5 gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{df.description}</div>
                        <div className="text-[11px] text-slate-500">
                          Severity: {df.severity} · Due: {df.deadline} {df.linked_task_ref ? `· Task: ${df.linked_task_ref}` : ''}
                        </div>
                      </div>
                      <StatusLabel status={df.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION: DOCUMENTS */}
      {section === 'documents' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {hasPerm('documents', 'create') && (
            <form onSubmit={handleDocUpload} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit">
              <h3 className="font-display text-sm font-semibold text-slate-900">Upload Project Document</h3>
              <p className="text-[11px] text-slate-500">
                Stored outside public directory and served strictly via permission-checked routes.
              </p>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Document Title</label>
                <input
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g., Architectural Floor Plan Rev 3"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  {[
                    'Contracts',
                    'Permits',
                    'Drawings',
                    'Technical specifications',
                    'Bills of quantities',
                    'Inspection reports',
                    'Safety documents',
                    'Receipts',
                    'Correspondence',
                    'Other project records',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select File (PDF, JPG, PNG, XLSX, DOCX)</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  className="w-full text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={docClientVisible}
                  onChange={(e) => setDocClientVisible(e.target.checked)}
                />
                Approve for Client Portal visibility (non-confidential)
              </label>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
              >
                <Upload className="h-3.5 w-3.5" /> Upload Protected File
              </button>
            </form>
          )}

          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Title & File</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Ver</th>
                  <th className="px-4 py-2.5">Access</th>
                  <th className="px-4 py-2.5 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{doc.title}</div>
                      <div className="text-[11px] text-slate-500">{doc.file_name}</div>
                    </td>
                    <td className="px-4 py-2.5">{doc.category}</td>
                    <td className="px-4 py-2.5 font-mono">v{doc.version}</td>
                    <td className="px-4 py-2.5">
                      {doc.is_client_visible ? (
                        <span className="text-emerald-700 font-medium">Client Visible</span>
                      ) : (
                        <span className="text-slate-600">Confidential</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/documents/${doc.id}/download?token=${encodeURIComponent(getApiToken() || '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION: COMMUNICATIONS */}
      {section === 'communications' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest(`/api/projects/${projectId}/messages`, {
                method: 'POST',
                body: { channel: msgChannel, subject: msgSubject, body: msgBody },
              });
              setMsgSubject('');
              setMsgBody('');
              loadWorkspace();
            }}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit"
          >
            <h3 className="font-display text-sm font-semibold text-slate-900">Post Project Message</h3>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Channel</label>
              <select
                value={msgChannel}
                onChange={(e) => setMsgChannel(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="internal">Internal Staff Only (Private)</option>
                <option value="client">Client Portal Communication</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Subject</label>
              <input
                value={msgSubject}
                onChange={(e) => setMsgSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Message *</label>
              <textarea
                required
                rows={3}
                value={msgBody}
                onChange={(e) => setMsgBody(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 font-semibold text-white"
            >
              <Send className="h-3.5 w-3.5" /> Post Message
            </button>
          </form>

          <div className="lg:col-span-2 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{m.subject || 'Project Note'}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {m.channel === 'client' ? 'Client Channel' : 'Internal Only'} · {m.created_at?.slice(0, 16)}
                  </span>
                </div>
                <p className="text-slate-700">{m.body}</p>
                <div className="text-[11px] text-slate-500">
                  From: {m.sender_name} ({m.sender_role})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION: TOOLBOX & SITE RESOURCES */}
      {section === 'toolbox' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">Project Toolbox &amp; Site Resources</h2>
              <p className="text-xs text-slate-500">
                Materials, supplies, tools, and machines currently assigned to or physically located at this site.
              </p>
            </div>
            {hasPerm('equipment', 'edit') && (
              <button
                type="button"
                onClick={() => setShowToolboxTxModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Record Site Transaction
              </button>
            )}
          </div>

          {/* Toolbox Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Site Inventory Items</div>
              <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                {toolboxData?.siteInventory?.length || 0}
              </div>
              <div className="text-[11px] text-emerald-700">Active stock assigned to site</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Equipment Deployed</div>
              <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                {toolboxData?.summary?.totalEquipment || 0}
              </div>
              <div className="text-[11px] text-slate-600">
                {toolboxData?.summary?.operationalEquipment || 0} Operational · {toolboxData?.summary?.maintenanceEquipment || 0} Maintenance
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Recorded Transactions</div>
              <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                {toolboxData?.transactions?.length || 0}
              </div>
              <div className="text-[11px] text-slate-500">Consumption &amp; movement log</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Warehouse Deliveries</div>
              <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                {toolboxData?.releases?.length || 0}
              </div>
              <div className="text-[11px] text-amber-700">Releases &amp; acknowledgments</div>
            </div>
          </div>

          {/* Inventory Currently at Site */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden space-y-3">
            <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">Inventory Currently at Site</h3>
              <span className="text-xs text-slate-500">Materials, consumables &amp; supplies</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Item Code / SKU</th>
                    <th className="px-4 py-2.5">Item Name</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Unit</th>
                    <th className="px-4 py-2.5 text-right">Site Quantity</th>
                    <th className="px-4 py-2.5">Storage Location</th>
                    <th className="px-4 py-2.5">Supplier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(toolboxData?.siteInventory || []).map((it: any) => (
                    <tr key={it.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-mono text-amber-700">{it.sku}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{it.name}</td>
                      <td className="px-4 py-2.5">{it.category}</td>
                      <td className="px-4 py-2.5">{it.unit}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {it.site_qty ?? it.current_qty}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{it.storage_location}</td>
                      <td className="px-4 py-2.5 text-slate-500">{it.supplier || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Equipment and Machines Currently at Site */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden space-y-3">
            <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">Equipment &amp; Machines Deployed to Site</h3>
              <span className="text-xs text-slate-500">Heavy equipment, tools &amp; machines</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Equipment ID</th>
                    <th className="px-4 py-2.5">Equipment / Machine</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Condition / Status</th>
                    <th className="px-4 py-2.5">Operator / Custodian</th>
                    <th className="px-4 py-2.5 text-right">Operating Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(toolboxData?.siteEquipment || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No heavy equipment or machines currently deployed to this project site.
                      </td>
                    </tr>
                  ) : (
                    (toolboxData?.siteEquipment || []).map((eq: any) => (
                      <tr key={eq.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-amber-700">{eq.equipment_code}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {eq.name}
                          {eq.brand_model ? ` (${eq.brand_model})` : ''}
                        </td>
                        <td className="px-4 py-2.5">{eq.type}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                              eq.condition_status === 'operational'
                                ? 'bg-emerald-50 text-emerald-700'
                                : eq.condition_status === 'maintenance'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {eq.condition_status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{eq.operator_name || 'Unassigned'}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{eq.operating_hours} hrs</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Toolbox Activity History / Transactions */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden space-y-3">
            <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">Toolbox Activity History</h3>
              <span className="text-xs text-slate-500">Recent inventory consumption &amp; site movements</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Timestamp</th>
                    <th className="px-4 py-2.5">Transaction Type</th>
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5 text-right">Quantity</th>
                    <th className="px-4 py-2.5">Reference / Notes</th>
                    <th className="px-4 py-2.5">Performed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(toolboxData?.transactions || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No inventory transactions recorded for this project yet.
                      </td>
                    </tr>
                  ) : (
                    (toolboxData?.transactions || []).map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{tx.created_at}</td>
                        <td className="px-4 py-2.5 uppercase font-mono text-[11px] font-semibold text-slate-900">
                          {tx.tx_type}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {tx.item_name} <span className="font-mono text-slate-500">({tx.sku})</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-slate-900">
                          {tx.quantity} {tx.unit}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{tx.notes || tx.reference_doc || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-700">{tx.performed_by_name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Excel Schedule Import Modal */}
      {showImport && (
        <ScheduleImportModal
          projectId={projectId}
          hasExistingSchedule={Boolean(scheduleData?.activeRevision)}
          onClose={() => setShowImport(false)}
          onImported={loadWorkspace}
        />
      )}

      {/* Publish DPR to Client Portal Modal */}
      {publishDpr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Publish Client Progress Update ({publishDpr.report_date})
              </h3>
            </div>
            <p className="text-slate-600">
              Internal comments, confidential delays, and private attachments remain hidden. Curate the client-facing summary below.
            </p>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Client Progress Summary</label>
              <textarea
                rows={3}
                value={publishSummary}
                onChange={(e) => setPublishSummary(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Completed Activities</label>
              <input
                value={publishCompleted}
                onChange={(e) => setPublishCompleted(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Upcoming Activities</label>
              <input
                value={publishNext}
                onChange={(e) => setPublishNext(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            {publishAvailablePhotos.length > 0 && (
              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Select Photo Proofs to Share with Client ({publishPhotos.length}/{publishAvailablePhotos.length})
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {publishAvailablePhotos.map((ph, idx) => {
                    const checked = publishPhotos.some((p) => p.url === ph.url);
                    return (
                      <label
                        key={idx}
                        className={`relative cursor-pointer overflow-hidden rounded-lg border-2 ${
                          checked ? 'border-amber-600' : 'border-slate-200 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPublishPhotos((prev) => [...prev, ph]);
                            } else {
                              setPublishPhotos((prev) => prev.filter((p) => p.url !== ph.url));
                            }
                          }}
                          className="sr-only"
                        />
                        <img src={ph.url} alt={ph.caption || 'Proof'} className="h-16 w-full object-cover" />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPublishDpr(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiRequest(`/api/dpr/${publishDpr.id}/publish-client`, {
                    method: 'POST',
                    body: {
                      clientSummary: publishSummary,
                      completedActivities: publishCompleted,
                      nextActivities: publishNext,
                      approvedPhotos: publishPhotos,
                      publish: true,
                    },
                  });
                  setPublishDpr(null);
                  setBanner('Client-facing update published to Client Portal.');
                  loadWorkspace();
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700"
              >
                Publish to Client Portal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Details Modal */}
      {showEditProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-sm font-semibold text-slate-900">Edit Project Details</h3>
              <button type="button" onClick={() => setShowEditProject(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest(`/api/projects/${projectId}`, {
                  method: 'PATCH',
                  body: editProjectForm,
                });
                setBanner('Project details updated successfully.');
                setShowEditProject(false);
                loadWorkspace();
              }}
              className="p-6 space-y-4 text-xs"
            >
              <div>
                <label className="block font-medium text-slate-700 mb-1">Project Name *</label>
                <input
                  required
                  value={editProjectForm.name}
                  onChange={(e) => setEditProjectForm({ ...editProjectForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Site Location *</label>
                  <input
                    required
                    value={editProjectForm.location}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, location: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status *</label>
                  <select
                    value={editProjectForm.status}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 capitalize"
                  >
                    {['active', 'on_hold', 'at_risk', 'completed', 'delayed'].map((st) => (
                      <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contract Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editProjectForm.contractAmount}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, contractAmount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Approved Budget ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editProjectForm.approvedBudget}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, approvedBudget: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={editProjectForm.startDate}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Expected Completion *</label>
                  <input
                    type="date"
                    required
                    value={editProjectForm.originalEndDate}
                    onChange={(e) => setEditProjectForm({ ...editProjectForm, originalEndDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editProjectForm.description}
                  onChange={(e) => setEditProjectForm({ ...editProjectForm, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Approved Scope</label>
                <textarea
                  rows={2}
                  value={editProjectForm.scope}
                  onChange={(e) => setEditProjectForm({ ...editProjectForm, scope: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditProject(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Site Toolbox Transaction Modal */}
      {showToolboxTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-sm font-semibold text-slate-900">Record Site Toolbox Transaction</h3>
              <button type="button" onClick={() => setShowToolboxTxModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest(`/api/projects/${projectId}/toolbox/transactions`, {
                  method: 'POST',
                  body: toolboxTxForm,
                });
                setBanner('Site toolbox transaction recorded successfully.');
                setShowToolboxTxModal(false);
                loadWorkspace();
              }}
              className="p-6 space-y-4 text-xs"
            >
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Inventory Item *</label>
                <select
                  required
                  value={toolboxTxForm.itemId}
                  onChange={(e) => setToolboxTxForm({ ...toolboxTxForm, itemId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">Select item...</option>
                  {(toolboxData?.siteInventory || []).map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.sku}) — Available: {it.site_qty ?? it.current_qty} {it.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Transaction Type *</label>
                  <select
                    value={toolboxTxForm.txType}
                    onChange={(e) => setToolboxTxForm({ ...toolboxTxForm, txType: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="consume">Issue / Consume Materials</option>
                    <option value="return">Return Unused to Warehouse</option>
                    <option value="transfer">Inter-Project Transfer</option>
                    <option value="damage">Report Damage / Loss</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={toolboxTxForm.quantity}
                    onChange={(e) => setToolboxTxForm({ ...toolboxTxForm, quantity: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reference Document / Slip #</label>
                <input
                  placeholder="e.g., ISS-2026-089"
                  value={toolboxTxForm.referenceDoc}
                  onChange={(e) => setToolboxTxForm({ ...toolboxTxForm, referenceDoc: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Remarks / Justification</label>
                <textarea
                  rows={2}
                  placeholder="Notes on consumption, return condition, or damage report"
                  value={toolboxTxForm.notes}
                  onChange={(e) => setToolboxTxForm({ ...toolboxTxForm, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowToolboxTxModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                >
                  Record Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Photo Proof Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              className="absolute -right-3 -top-3 rounded-full bg-white p-1.5 text-slate-900 shadow-lg hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
            <img src={lightboxUrl} alt="DPR Activity Proof" className="max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};
