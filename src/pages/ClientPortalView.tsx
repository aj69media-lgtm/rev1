import React, { useEffect, useState } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  LogOut,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CircularProgressRing, StatusLabel } from '../components/Charts';
import { PWAInstallButton } from '../components/PWAComponents';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { apiRequest, formatCurrency, getApiToken } from '../lib/api';

export const ClientPortalView: React.FC<{ onExitToInternal?: () => void }> = ({ onExitToInternal }) => {
  const { user, logout } = useAuth();
  const { syncVersion } = useSync();

  const [overview, setOverview] = useState<any>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'gallery' | 'revisions' | 'messages'>('overview');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [lightboxPhoto, setLightboxPhoto] = useState<any>(null);
  const [banner, setBanner] = useState('');

  // Revision request form
  const [revCategory, setRevCategory] = useState('Design changes');
  const [revDesc, setRevDesc] = useState('');
  const [revReason, setRevReason] = useState('');
  const [revPrefDate, setRevPrefDate] = useState('');

  // Message form
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  useEffect(() => {
    setLoading(true);
    apiRequest('/api/client-portal/overview')
      .then((res) => {
        setOverview(res);
        if (res.projects?.length > 0 && !selectedProjectId) {
          setSelectedProjectId(res.projects[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, [syncVersion]);

  useEffect(() => {
    if (!selectedProjectId) return;
    apiRequest(`/api/client-portal/projects/${selectedProjectId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedProjectId, syncVersion]);

  const handleSubmitRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    await apiRequest(`/api/client-portal/projects/${selectedProjectId}/revisions`, {
      method: 'POST',
      body: {
        category: revCategory,
        description: revDesc,
        reason: revReason,
        preferredDate: revPrefDate,
      },
    });
    setRevDesc('');
    setRevReason('');
    setRevPrefDate('');
    setBanner('Revision request submitted for formal technical & cost review.');
    const updated = await apiRequest(`/api/client-portal/projects/${selectedProjectId}`);
    setDetail(updated);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    await apiRequest(`/api/client-portal/projects/${selectedProjectId}/messages`, {
      method: 'POST',
      body: { subject: msgSubject, body: msgBody },
    });
    setMsgSubject('');
    setMsgBody('');
    const updated = await apiRequest(`/api/client-portal/projects/${selectedProjectId}`);
    setDetail(updated);
  };

  const p = detail?.project;
  const sched = detail?.scheduleSummary;
  const phases: any[] = detail?.phases || [];
  const currentPhase =
    phases.find((ph) => ph.status === 'in_progress') ||
    phases.find((ph) => ph.actual_progress < 100) ||
    phases[phases.length - 1] ||
    null;

  const photos: any[] = detail?.galleryPhotos || [];
  const uniquePhases = Array.from(new Set(photos.map((ph) => ph.phase)));
  const filteredPhotos = phaseFilter === 'all' ? photos : photos.filter((ph) => ph.phase === phaseFilter);

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      {/* Dedicated Client Portal Header (3-zone Top Bar Contract) */}
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-8 py-4">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <Building2 className="h-5 w-5 text-amber-600" />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              BuildCore Client Portal
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {[
              ['overview', 'Project Overview'],
              ['timeline', 'Construction Timeline'],
              ['gallery', 'Photo Gallery'],
              ['revisions', 'Revision Requests'],
              ['messages', 'Project Messages'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as any)}
                className={`whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-amber-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            {onExitToInternal && !user?.is_client_role && (
              <button
                type="button"
                onClick={onExitToInternal}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Internal CBMS
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="flex md:hidden items-center gap-2 overflow-x-auto border-t border-stone-100 px-4 py-2 text-xs">
          {[
            ['overview', 'Overview'],
            ['timeline', 'Timeline'],
            ['gallery', 'Photos'],
            ['revisions', 'Revisions'],
            ['messages', 'Messages'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as any)}
              className={`rounded-md px-3 py-1.5 font-medium whitespace-nowrap ${
                activeTab === key ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-8 py-8 space-y-8">
        {/* Portfolio Strip for Client */}
        {overview && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-amber-700">
                Welcome, {user?.full_name} · Private Client Workspace
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5">
                {p?.name || 'Assigned Construction Projects'}
              </h1>
            </div>

            {overview.projects?.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600">Select Project:</label>
                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
                >
                  {overview.projects.map((proj: any) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.ref_number} · {proj.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {banner && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner('')} className="underline">Dismiss</button>
          </div>
        )}

        {loading && !overview ? (
          <div className="h-64 animate-pulse rounded-2xl bg-white border border-stone-200" />
        ) : !p ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center text-sm text-slate-600">
            No construction projects are currently assigned to your client account.
          </div>
        ) : (
          <>
            {/* TAB: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-8">
                {/* Hero Overview Card */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 rounded-2xl border border-stone-200 bg-white overflow-hidden">
                  <div className="relative min-h-[220px] bg-slate-900">
                    {p.hero_image && (
                      <img
                        src={p.hero_image}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-5 right-5 text-white">
                      <div className="font-mono text-xs text-amber-300">{p.ref_number}</div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-200 mt-1">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>{p.location}</span>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-2 p-6 sm:p-8 flex flex-col justify-between gap-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                      <div className="space-y-2 max-w-xl">
                        <div className="flex items-center gap-3">
                          <StatusLabel status={sched?.healthStatus || p.status} />
                          <span className="text-xs text-slate-500 font-mono">
                            As of {sched?.asOfDate}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">{p.description}</p>
                        {p.delay_explanation && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
                            <strong>Schedule Notice:</strong> {p.delay_explanation}
                          </div>
                        )}
                      </div>
                      <CircularProgressRing
                        percentage={sched?.actualProgress || 0}
                        size={136}
                        strokeWidth={11}
                        label="Overall Complete"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-stone-100 pt-5 text-xs">
                      <div>
                        <div className="text-slate-500">Commencement</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-900">{p.start_date}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Expected Completion</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-900">
                          {p.expected_completion_date}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Planned vs Actual</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                          {sched?.plannedProgress?.toFixed(1)}% / {sched?.actualProgress?.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Project Manager</div>
                        <div className="mt-0.5 font-semibold text-slate-900">{p.pm_contact?.name}</div>
                        {p.pm_contact?.phone && (
                          <div className="inline-flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                            <Phone className="h-3 w-3" /> {p.pm_contact.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Current Construction Phase Spotlight */}
                {currentPhase && (
                  <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                          Current Construction Phase
                        </div>
                        <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
                          {currentPhase.name}
                        </h2>
                        <p className="text-xs text-slate-500 font-mono mt-1">
                          {currentPhase.start_date} → {currentPhase.end_date}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                          {Number(currentPhase.actual_progress).toFixed(0)}%
                        </div>
                        <StatusLabel status={currentPhase.status} />
                      </div>
                    </div>
                    <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden">
                      <div
                        className="h-full bg-amber-600 rounded-full"
                        style={{ width: `${Math.min(100, currentPhase.actual_progress)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Milestones & Published Updates */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Project Milestones ({sched?.completedMilestones}/{sched?.totalMilestones})
                    </h3>
                    <div className="divide-y divide-stone-100 text-xs">
                      {(detail?.milestones || []).map((ms: any) => (
                        <div key={ms.id} className="flex items-center justify-between py-3 gap-3">
                          <div>
                            <div className="font-medium text-slate-900">{ms.name}</div>
                            <div className="font-mono text-[11px] text-slate-500">Target: {ms.end_date}</div>
                          </div>
                          <StatusLabel status={ms.milestone_status === 'completed' ? 'completed' : 'upcoming'} />
                        </div>
                      ))}
                      {(detail?.milestones || []).length === 0 && (
                        <p className="py-4 text-slate-500">No milestones recorded in active schedule.</p>
                      )}
                    </div>

                    {detail?.clientDocuments?.length > 0 && (
                      <div className="border-t border-stone-100 pt-4 space-y-2">
                        <h4 className="font-display text-sm font-semibold text-slate-900">
                          Client-Approved Documents
                        </h4>
                        {detail.clientDocuments.map((doc: any) => (
                          <div key={doc.id} className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-xs">
                            <span className="font-medium text-slate-800 truncate">{doc.title}</span>
                            <a
                              href={`/api/documents/${doc.id}/download?token=${encodeURIComponent(getApiToken() || '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:text-amber-800 shrink-0"
                            >
                              <Download className="h-3.5 w-3.5" /> Download
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Approved Progress Updates
                    </h3>
                    <div className="space-y-4">
                      {(detail?.publishedUpdates || []).map((upd: any) => (
                        <div key={upd.id} className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 space-y-2 text-xs">
                          <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                            <span>Report Date: {upd.report_date}</span>
                            <span>Published by {upd.published_by_name}</span>
                          </div>
                          <p className="text-sm text-slate-800 font-medium leading-relaxed">
                            {upd.client_summary}
                          </p>
                          {upd.client_completed_activities && (
                            <div className="text-slate-600">
                              <strong>Completed:</strong> {upd.client_completed_activities}
                            </div>
                          )}
                          {upd.client_next_activities && (
                            <div className="text-slate-600">
                              <strong>Next Up:</strong> {upd.client_next_activities}
                            </div>
                          )}
                        </div>
                      ))}
                      {(detail?.publishedUpdates || []).length === 0 && (
                        <p className="text-xs text-slate-500">No client updates have been published yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CONSTRUCTION TIMELINE */}
            {activeTab === 'timeline' && (
              <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Construction Phase Timeline
                    </h2>
                    <p className="text-xs text-slate-500">
                      Generated dynamically from the approved project schedule · Planned vs Actual comparison as of {sched?.asOfDate}
                    </p>
                  </div>
                  <div className="font-mono text-xs text-slate-700 tabular-nums">
                    Variance: {(sched?.progressVariance || 0) >= 0 ? '+' : ''}
                    {sched?.progressVariance?.toFixed(1)}%
                  </div>
                </div>

                {/* Desktop Horizontal / Mobile Vertical Timeline */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {phases.map((ph, idx) => (
                    <div
                      key={ph.id}
                      className={`rounded-xl border p-4 space-y-3 ${
                        ph.status === 'in_progress'
                          ? 'border-amber-400 bg-amber-50/40'
                          : ph.status === 'completed'
                          ? 'border-emerald-200 bg-emerald-50/30'
                          : 'border-stone-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-slate-500">Phase {idx + 1}</span>
                        <StatusLabel status={ph.status} />
                      </div>
                      <div className="font-display text-sm font-bold text-slate-900">{ph.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {ph.start_date} → {ph.end_date}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-mono tabular-nums">
                          <span>Actual: {Number(ph.actual_progress).toFixed(0)}%</span>
                          <span className="text-slate-500">Plan: {Number(ph.planned_progress).toFixed(0)}%</span>
                        </div>
                        <div className="h-2 w-full rounded bg-stone-200 overflow-hidden">
                          <div
                            className={`h-full rounded ${
                              ph.status === 'completed' ? 'bg-emerald-600' : 'bg-amber-600'
                            }`}
                            style={{ width: `${Math.min(100, ph.actual_progress)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: PHOTO GALLERY */}
            {activeTab === 'gallery' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Approved Construction Photo Gallery
                  </h2>
                  <div className="flex flex-wrap items-center gap-1 rounded-lg bg-stone-200/70 p-1">
                    <button
                      type="button"
                      onClick={() => setPhaseFilter('all')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        phaseFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      All Phases
                    </button>
                    {uniquePhases.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        onClick={() => setPhaseFilter(ph)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          phaseFilter === ph ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                        }`}
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredPhotos.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center text-xs text-slate-500">
                    No approved progress photographs available yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredPhotos.map((photo, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setLightboxPhoto(photo)}
                        className="text-left rounded-2xl border border-stone-200 bg-white overflow-hidden hover:shadow-md transition-shadow"
                      >
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                          <img
                            src={photo.url}
                            alt={photo.caption}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="p-4 space-y-1 text-xs">
                          <div className="font-mono text-[11px] text-amber-700">
                            {photo.date} · {photo.phase}
                          </div>
                          <div className="font-medium text-slate-900 line-clamp-2">{photo.caption}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: REVISION & CHANGE REQUESTS */}
            {activeTab === 'revisions' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <form onSubmit={handleSubmitRevision} className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4 text-xs h-fit">
                  <div className="space-y-1">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Submit Revision / Change Request
                    </h3>
                    <p className="text-slate-500 leading-relaxed">
                      Requests undergo technical feasibility, cost evaluation, and management approval before any contract or schedule modification.
                    </p>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Category</label>
                    <select
                      value={revCategory}
                      onChange={(e) => setRevCategory(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
                    >
                      {[
                        'Design changes',
                        'Plans and drawings',
                        'Materials',
                        'Specifications',
                        'Additional work',
                        'Scope changes',
                        'Finishes',
                        'Construction concerns',
                        'Other project-related requests',
                      ].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Description *</label>
                    <textarea
                      required
                      rows={3}
                      value={revDesc}
                      onChange={(e) => setRevDesc(e.target.value)}
                      placeholder="Describe the requested modification..."
                      className="w-full rounded-lg border border-stone-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Reason / Objective</label>
                    <input
                      value={revReason}
                      onChange={(e) => setRevReason(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Preferred Implementation Date</label>
                    <input
                      type="date"
                      value={revPrefDate}
                      onChange={(e) => setRevPrefDate(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-3 py-2 font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2.5 font-semibold text-white hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" /> Submit Change Request
                  </button>
                </form>

                <div className="lg:col-span-2 space-y-4">
                  {(detail?.revisions || []).map((rev: any) => (
                    <div key={rev.id} className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                        <div>
                          <span className="font-mono font-semibold text-amber-700">{rev.ref_number}</span>
                          <span className="mx-2 text-slate-300">·</span>
                          <span className="font-semibold text-slate-900">{rev.category}</span>
                        </div>
                        <StatusLabel status={rev.status} />
                      </div>
                      <p className="text-sm text-slate-800 leading-relaxed">{rev.description}</p>
                      {(rev.cost_impact !== null || rev.schedule_impact_days !== null || rev.change_order_ref) && (
                        <div className="grid grid-cols-3 gap-3 rounded-lg bg-stone-50 p-3 font-mono">
                          <div>
                            <div className="text-[11px] font-sans text-slate-500">Est. Cost Impact</div>
                            <div className="font-semibold">{rev.cost_impact !== null ? formatCurrency(rev.cost_impact) : 'Pending'}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-slate-500">Schedule Impact</div>
                            <div className="font-semibold">{rev.schedule_impact_days !== null ? `+${rev.schedule_impact_days} days` : 'Pending'}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-slate-500">Change Order Ref</div>
                            <div className="font-semibold">{rev.change_order_ref || '—'}</div>
                          </div>
                        </div>
                      )}
                      {rev.history?.length > 0 && (
                        <div className="space-y-1.5 border-t border-stone-100 pt-3">
                          <div className="font-semibold text-slate-700">Change-Control Audit History</div>
                          {rev.history.map((h: any, i: number) => (
                            <div key={i} className="text-[11px] text-slate-600 flex items-center justify-between">
                              <span>
                                <strong>{h.new_status.replace(/_/g, ' ')}</strong> — {h.remarks} ({h.actor_name})
                              </span>
                              <span className="font-mono text-slate-400">{h.created_at?.slice(0, 10)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(detail?.revisions || []).length === 0 && (
                    <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-xs text-slate-500">
                      No revision requests submitted for this project.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: CLIENT MESSAGES */}
            {activeTab === 'messages' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <form onSubmit={handleSendMessage} className="rounded-2xl border border-stone-200 bg-white p-6 space-y-3 text-xs h-fit">
                  <h3 className="font-display text-base font-semibold text-slate-900">Message Project Team</h3>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Subject</label>
                    <input
                      value={msgSubject}
                      onChange={(e) => setMsgSubject(e.target.value)}
                      placeholder="Inquiry or concern"
                      className="w-full rounded-lg border border-stone-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Message *</label>
                    <textarea
                      required
                      rows={4}
                      value={msgBody}
                      onChange={(e) => setMsgBody(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-3 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2.5 font-semibold text-white hover:bg-slate-800"
                  >
                    <Send className="h-3.5 w-3.5" /> Send Message
                  </button>
                </form>

                <div className="lg:col-span-2 space-y-3">
                  {(detail?.clientMessages || []).map((m: any) => (
                    <div key={m.id} className="rounded-2xl border border-stone-200 bg-white p-5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{m.subject || 'Project Update'}</span>
                        <span className="font-mono text-[11px] text-slate-500">{m.created_at?.slice(0, 16)}</span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{m.body}</p>
                      <div className="text-[11px] text-slate-500">
                        {m.sender_name} · {m.sender_role}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl rounded-2xl bg-white overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3 text-xs">
              <span className="font-mono font-semibold text-amber-700">
                {lightboxPhoto.date} · {lightboxPhoto.phase}
              </span>
              <button type="button" onClick={() => setLightboxPhoto(null)} className="text-slate-500 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={lightboxPhoto.url}
              alt={lightboxPhoto.caption}
              referrerPolicy="no-referrer"
              className="w-full max-h-[70vh] object-contain bg-slate-950"
            />
            <div className="p-4 text-sm text-slate-800">{lightboxPhoto.caption}</div>
          </div>
        </div>
      )}
    </div>
  );
};
