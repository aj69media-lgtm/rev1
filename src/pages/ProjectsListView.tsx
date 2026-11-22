import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Building2, Mail, MapPin, Phone, Plus, User, X } from 'lucide-react';
import { StatusLabel } from '../components/Charts';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { apiRequest, formatCurrency } from '../lib/api';

export const ProjectsListView: React.FC<{
  onOpenProject: (id: number) => void;
  onOpenAdminClients?: () => void;
}> = ({ onOpenProject, onOpenAdminClients }) => {
  const { hasPerm } = useAuth();
  const { fetchWithCache, syncVersion } = useSync();
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [loadingRef, setLoadingRef] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    refNumber: '',
    name: '',
    clientId: '',
    location: '',
    description: '',
    scope: '',
    contractAmount: '',
    approvedBudget: '',
    startDate: new Date().toISOString().slice(0, 10),
    originalEndDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWithCache<{ projects: any[] }>('projects_list', '/api/projects');
      setProjects(res.data.projects || []);
      if (hasPerm('projects', 'create')) {
        const cRes = await apiRequest<{ clients: any[] }>('/api/admin/clients').catch(() => ({ clients: [] }));
        setClients(cRes.clients || []);
        if (cRes.clients?.length > 0 && !form.clientId) {
          setForm((prev) => ({ ...prev, clientId: String(cRes.clients[0].id) }));
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [syncVersion]);

  const openCreateModal = async () => {
    setError('');
    setShowCreate(true);
    setLoadingRef(true);
    try {
      const [refRes, clientRes] = await Promise.all([
        apiRequest<{ refNumber: string }>('/api/projects/next-ref').catch(() => ({ refNumber: '' })),
        apiRequest<{ clients: any[] }>('/api/admin/clients').catch(() => ({ clients: [] })),
      ]);
      const freshClients = clientRes.clients || [];
      if (freshClients.length > 0) setClients(freshClients);
      setForm((prev) => ({
        ...prev,
        refNumber: refRes.refNumber || prev.refNumber || 'Auto-assigned on save',
        clientId:
          prev.clientId && freshClients.some((c) => String(c.id) === prev.clientId)
            ? prev.clientId
            : freshClients[0]
            ? String(freshClients[0].id)
            : '',
      }));
    } finally {
      setLoadingRef(false);
    }
  };

  const selectedClient = clients.find((c) => String(c.id) === String(form.clientId)) || null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ id: number; refNumber?: string }>('/api/projects', {
        method: 'POST',
        body: {
          ...form,
          refNumber: 'AUTO',
          clientId: Number(form.clientId),
          contractAmount: Number(form.contractAmount || 0),
          approvedBudget: Number(form.approvedBudget || 0),
        },
      });
      setShowCreate(false);
      onOpenProject(res.id);
    } catch (err: any) {
      setError(err?.message || 'Unable to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Construction Projects</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Project-level permissions enforced. Select a project to open its dedicated workspace.
          </p>
        </div>
        {hasPerm('projects', 'create') && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</div>
      )}

      {loading && projects.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white overflow-hidden transition-shadow hover:shadow-md"
            >
              <div>
                <div className="relative h-36 bg-slate-900 overflow-hidden">
                  {p.hero_image && (
                    <img
                      src={p.hero_image}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-85"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/30 to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4 text-white">
                    <div className="font-mono text-[11px] text-amber-300">{p.ref_number}</div>
                    <div className="font-display text-base font-bold leading-snug truncate">{p.name}</div>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 text-slate-600 truncate">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      {p.location}
                    </span>
                    <StatusLabel status={p.schedule?.healthStatus || p.status} />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Progress (Actual / Planned)</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {p.schedule?.actualProgress?.toFixed(1)}% / {p.schedule?.plannedProgress?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-amber-600 rounded"
                        style={{ width: `${Math.min(100, p.schedule?.actualProgress || 0)}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
                    <div>
                      <div className="text-slate-500">Approved Budget</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(p.financials?.revisedBudget)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Actual Spent</div>
                      <div className="font-mono font-semibold text-amber-700 tabular-nums">
                        {formatCurrency(p.financials?.actualExpenses)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 flex items-center justify-between text-xs">
                <div className="min-w-0 pr-2">
                  <div className="text-slate-700 font-medium truncate">{p.client_name}</div>
                  {p.client_representative && (
                    <div className="text-[11px] text-slate-500 truncate">Rep: {p.client_representative}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-amber-700 whitespace-nowrap shrink-0"
                >
                  Open Workspace
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="font-display text-base font-semibold text-slate-900">Create Construction Project</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium text-slate-700">Reference Number</label>
                    <span className="text-[11px] font-medium text-emerald-700">Auto-generated</span>
                  </div>
                  <input
                    readOnly
                    value={loadingRef ? 'Generating...' : form.refNumber || 'PRJ-AUTO'}
                    aria-readonly="true"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-700 cursor-default focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium text-slate-700">Client *</label>
                    {onOpenAdminClients && hasPerm('admin', 'view') && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreate(false);
                          onOpenAdminClients();
                        }}
                        className="text-[11px] font-medium text-amber-700 hover:text-amber-800 hover:underline"
                      >
                        Manage Clients in Admin
                      </button>
                    )}
                  </div>
                  <select
                    required
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name} — Rep: {c.primary_contact}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedClient && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                      <Building2 className="h-3.5 w-3.5 text-slate-500" />
                      {selectedClient.company_name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {selectedClient.project_count ?? 0} existing project(s)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[11px] text-slate-700">
                    <div className="flex items-start gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-slate-500">Client Representative: </span>
                        <span className="font-medium text-slate-900">{selectedClient.primary_contact}</span>
                        {selectedClient.representative_title && (
                          <span className="text-slate-500"> ({selectedClient.representative_title})</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-slate-500">Phone: </span>
                        <span className="font-mono text-slate-900">{selectedClient.phone || 'Not specified'}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div className="truncate">
                        <span className="text-slate-500">Email: </span>
                        <span className="text-slate-900">{selectedClient.email}</span>
                        {selectedClient.secondary_contact && (
                          <span className="block text-slate-500">Alt: {selectedClient.secondary_contact}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-slate-500">Address: </span>
                        <span className="text-slate-900">{selectedClient.address || 'No address on file'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Project Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Site Location *</label>
                <input
                  required
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contract Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.contractAmount}
                    onChange={(e) => setForm({ ...form, contractAmount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Approved Budget ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.approvedBudget}
                    onChange={(e) => setForm({ ...form, approvedBudget: e.target.value })}
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
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Expected Completion *</label>
                  <input
                    type="date"
                    required
                    value={form.originalEndDate}
                    onChange={(e) => setForm({ ...form, originalEndDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Project Scope</label>
                <textarea
                  rows={2}
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
