import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  Download,
  Lock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wrench,
} from 'lucide-react';
import { StatusLabel } from '../components/Charts';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { apiRequest, formatCurrency, getApiToken } from '../lib/api';

// --- Global Tasks Board ---
export const TasksGlobalView: React.FC = () => {
  const { syncVersion } = useSync();
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');

  const load = () => {
    apiRequest('/api/tasks').then((r) => setTasks(r.tasks || [])).catch(() => {});
  };
  useEffect(load, [syncVersion]);

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">All Assigned Tasks</h1>
          <p className="text-xs text-slate-500">Cross-project task queue scoped to your assigned projects.</p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="all">All Statuses</option>
          {['pending', 'in_progress', 'for_review', 'overdue', 'completed'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-2.5">Ref</th>
              <th className="px-4 py-2.5">Project</th>
              <th className="px-4 py-2.5">Task &amp; Instructions</th>
              <th className="px-4 py-2.5">Assigned Employee</th>
              <th className="px-4 py-2.5">Priority</th>
              <th className="px-4 py-2.5">Deadline</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((t) => {
              const pColor =
                t.priority === 'high' || t.priority === 'critical'
                  ? 'text-red-700 font-semibold'
                  : t.priority === 'low'
                  ? 'text-slate-500'
                  : 'text-amber-700 font-medium';
              return (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-slate-600">{t.ref_number}</td>
                  <td className="px-4 py-3 text-slate-700">{t.project_name}</td>
                  <td className="px-4 py-3 max-w-md">
                    <div className="font-semibold text-slate-900">{t.title}</div>
                    {t.description && (
                      <p className="mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
                        {t.description}
                      </p>
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
                  <td className={`px-4 py-3 capitalize ${pColor}`}>{t.priority || 'medium'}</td>
                  <td className="px-4 py-3 font-mono">{t.deadline}</td>
                  <td className="px-4 py-3"><StatusLabel status={t.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <select
                      value={t.status}
                      onChange={async (e) => {
                        await apiRequest(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: e.target.value } });
                        load();
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      {['pending', 'acknowledged', 'in_progress', 'for_review', 'completed', 'on_hold'].map((st) => (
                        <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Procurement Hub ---
export const ProcurementGlobalView: React.FC = () => {
  const { hasPerm } = useAuth();
  const { syncVersion } = useSync();
  const [prs, setPrs] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);

  const load = () => {
    apiRequest('/api/purchase-requests')
      .then((r) => {
        setPrs(r.purchaseRequests || []);
        setPos(r.purchaseOrders || []);
      })
      .catch(() => {});
  };
  useEffect(load, [syncVersion]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Procurement & Purchase Requests</h1>
        <p className="text-xs text-slate-500">
          Multi-stage PR approvals create tracked commitments; receiving settles actual expenditure without double-counting.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-2.5">PR Ref</th>
              <th className="px-4 py-2.5">Project</th>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5 text-right">Est. Cost</th>
              <th className="px-4 py-2.5 text-right">Commitment</th>
              <th className="px-4 py-2.5 text-right">Settled</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Workflow</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {prs.map((pr) => (
              <tr key={pr.id}>
                <td className="px-4 py-2.5 font-mono">{pr.ref_number}</td>
                <td className="px-4 py-2.5">{pr.project_name}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{pr.item_description}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(pr.estimated_total_cost)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-800">{formatCurrency(pr.commitment_amount)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700">{formatCurrency(pr.settled_amount)}</td>
                <td className="px-4 py-2.5"><StatusLabel status={pr.status} /></td>
                <td className="px-4 py-2.5 text-right space-x-1.5">
                  {['submitted', 'under_review', 'endorsed'].includes(pr.status) && hasPerm('procurement', 'approve') && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/purchase-requests/${pr.id}/workflow`, {
                          method: 'PATCH',
                          body: { status: 'approved', remarks: 'Approved from Procurement Hub' },
                        });
                        load();
                      }}
                      className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      Approve
                    </button>
                  )}
                  {pr.status === 'approved' && hasPerm('procurement', 'edit') && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/purchase-requests/${pr.id}/workflow`, {
                          method: 'PATCH',
                          body: { status: 'ordered' },
                        });
                        load();
                      }}
                      className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white"
                    >
                      Issue PO
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <div className="border-b border-slate-200 px-4 py-3 font-display text-sm font-semibold text-slate-900">
            Purchase Orders & Receiving
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">PO #</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5 text-right">Ordered / Delivered</th>
                <th className="px-4 py-2.5 text-right">Actual Total</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pos.map((po) => (
                <tr key={po.id}>
                  <td className="px-4 py-2.5 font-mono">{po.po_number}</td>
                  <td className="px-4 py-2.5">{po.supplier_name}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{po.ordered_qty} / {po.delivered_qty}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(po.actual_total_cost)}</td>
                  <td className="px-4 py-2.5"><StatusLabel status={po.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// --- Personnel & Attendance ---
export const PersonnelAttendanceView: React.FC = () => {
  const { hasPerm } = useAuth();
  const { mutateWithOfflineQueue, syncVersion } = useSync();
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [banner, setBanner] = useState('');

  const [newEmp, setNewEmp] = useState({
    employeeCode: `EMP-${Math.floor(100 + Math.random() * 899)}`,
    fullName: '',
    position: '',
    tradeSkill: '',
    assignedProjectId: '',
  });
  const [attForm, setAttForm] = useState({
    projectId: '',
    personnelId: '',
    workDate: new Date().toISOString().slice(0, 10),
    timeIn: '07:30',
    timeOut: '17:00',
    status: 'present',
  });

  const load = () => {
    apiRequest('/api/personnel').then((r) => {
      setPersonnel(r.personnel || []);
      if (r.personnel?.length && !attForm.personnelId) {
        setAttForm((p) => ({ ...p, personnelId: String(r.personnel[0].id) }));
      }
    }).catch(() => {});
    apiRequest('/api/attendance').then((r) => setAttendance(r.attendance || [])).catch(() => {});
    apiRequest('/api/projects').then((r) => {
      setProjects(r.projects || []);
      if (r.projects?.length && !attForm.projectId) {
        setAttForm((p) => ({ ...p, projectId: String(r.projects[0].id) }));
      }
    }).catch(() => {});
  };
  useEffect(load, [syncVersion]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Personnel Directory & Site Attendance</h1>
        <p className="text-xs text-slate-500">Attendance logging supports offline field capture with automatic sync.</p>
      </div>
      {banner && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{banner}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {hasPerm('personnel', 'create') && (
          <div className="space-y-5">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await mutateWithOfflineQueue({
                  method: 'POST',
                  url: '/api/attendance',
                  body: {
                    ...attForm,
                    projectId: Number(attForm.projectId),
                    personnelId: Number(attForm.personnelId),
                  },
                  label: `Attendance ${attForm.workDate}`,
                });
                setBanner(res.queued ? 'Offline: Attendance queued for sync.' : 'Attendance recorded.');
                if (!res.queued) load();
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs"
            >
              <h3 className="font-display text-sm font-semibold text-slate-900">Record Daily Attendance</h3>
              <select
                value={attForm.projectId}
                onChange={(e) => setAttForm({ ...attForm, projectId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={attForm.personnelId}
                onChange={(e) => setAttForm({ ...attForm, personnelId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {personnel.map((per) => (
                  <option key={per.id} value={per.id}>{per.employee_code} · {per.full_name}</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input type="date" value={attForm.workDate} onChange={(e) => setAttForm({ ...attForm, workDate: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5 font-mono" />
                <input type="time" value={attForm.timeIn} onChange={(e) => setAttForm({ ...attForm, timeIn: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5 font-mono" />
                <input type="time" value={attForm.timeOut} onChange={(e) => setAttForm({ ...attForm, timeOut: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5 font-mono" />
              </div>
              <select value={attForm.status} onChange={(e) => setAttForm({ ...attForm, status: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5">
                {['present', 'late', 'half_day', 'overtime', 'absent', 'on_leave'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button type="submit" className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white">Save Attendance</button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest('/api/personnel', { method: 'POST', body: newEmp });
                setNewEmp({ ...newEmp, employeeCode: `EMP-${Math.floor(100 + Math.random() * 899)}`, fullName: '', position: '', tradeSkill: '' });
                load();
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs"
            >
              <h3 className="font-display text-sm font-semibold text-slate-900">Add Personnel</h3>
              <input required placeholder="Employee Code" value={newEmp.employeeCode} onChange={(e) => setNewEmp({ ...newEmp, employeeCode: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono" />
              <input required placeholder="Full Name" value={newEmp.fullName} onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              <input required placeholder="Position" value={newEmp.position} onChange={(e) => setNewEmp({ ...newEmp, position: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              <input required placeholder="Trade / Skill" value={newEmp.tradeSkill} onChange={(e) => setNewEmp({ ...newEmp, tradeSkill: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5" />
              <button type="submit" className="w-full rounded-lg border border-slate-300 bg-white py-2 font-semibold text-slate-800 hover:bg-slate-50">Add Worker</button>
            </form>
          </div>
        )}

        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <div className="border-b border-slate-200 px-4 py-3 font-display text-sm font-semibold text-slate-900">Personnel Roster</div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Position / Trade</th>
                  <th className="px-4 py-2">Assigned Site</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {personnel.map((per) => (
                  <tr key={per.id}>
                    <td className="px-4 py-2 font-mono">{per.employee_code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{per.full_name}</td>
                    <td className="px-4 py-2">{per.position} · {per.trade_skill}</td>
                    <td className="px-4 py-2">{per.project_name || 'Pool'}</td>
                    <td className="px-4 py-2"><StatusLabel status={per.employment_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <div className="border-b border-slate-200 px-4 py-3 font-display text-sm font-semibold text-slate-900">Recent Attendance Logs</div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Worker</th>
                  <th className="px-4 py-2">Site</th>
                  <th className="px-4 py-2 text-right">Hours / OT</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {attendance.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 font-mono">{a.work_date}</td>
                    <td className="px-4 py-2 font-medium">{a.full_name}</td>
                    <td className="px-4 py-2">{a.project_name}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{a.total_hours}h / {a.overtime_hours}h</td>
                    <td className="px-4 py-2"><StatusLabel status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Equipment & Inventory ---
export const EquipmentInventoryView: React.FC = () => {
  const { hasPerm } = useAuth();
  const { syncVersion } = useSync();
  const [equipment, setEquipment] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [tab, setTab] = useState<'equipment' | 'inventory'>('equipment');

  const load = () => {
    apiRequest('/api/equipment').then((r) => setEquipment(r.equipment || [])).catch(() => {});
    apiRequest('/api/inventory').then((r) => {
      setInventory(r.items || []);
      setTxs(r.transactions || []);
    }).catch(() => {});
  };
  useEffect(load, [syncVersion]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Equipment Fleet & Material Inventory</h1>
          <p className="text-xs text-slate-500">Asset utilization, maintenance scheduling, and material movement ledger.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          <button type="button" onClick={() => setTab('equipment')} className={`rounded-md px-3 py-1.5 font-medium ${tab === 'equipment' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>Equipment</button>
          <button type="button" onClick={() => setTab('inventory')} className={`rounded-md px-3 py-1.5 font-medium ${tab === 'inventory' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>Inventory</button>
        </div>
      </div>

      {tab === 'equipment' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Equipment</th>
                <th className="px-4 py-2.5">Ownership</th>
                <th className="px-4 py-2.5">Site / Location</th>
                <th className="px-4 py-2.5 text-right">Op. Hours</th>
                <th className="px-4 py-2.5">Condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {equipment.map((eq) => (
                <tr key={eq.id}>
                  <td className="px-4 py-2.5 font-mono">{eq.equipment_code}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{eq.name} <span className="text-slate-500 font-normal">({eq.brand_model})</span></td>
                  <td className="px-4 py-2.5 capitalize">{eq.ownership_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5">{eq.project_name || eq.current_location}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{eq.operating_hours}h</td>
                  <td className="px-4 py-2.5"><StatusLabel status={eq.condition_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">SKU</th>
                  <th className="px-4 py-2.5">Material</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5 text-right">Stock Qty</th>
                  <th className="px-4 py-2.5 text-right">Min Level</th>
                  <th className="px-4 py-2.5 text-right">Quick Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {inventory.map((it) => {
                  const low = it.current_qty <= it.min_stock_level;
                  return (
                    <tr key={it.id} className={low ? 'bg-amber-50/50' : ''}>
                      <td className="px-4 py-2.5 font-mono">{it.sku}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{it.name} {low && <span className="text-amber-700 font-semibold ml-1">· Low Stock</span>}</td>
                      <td className="px-4 py-2.5">{it.storage_location}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{it.current_qty} {it.unit}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{it.min_stock_level}</td>
                      <td className="px-4 py-2.5 text-right space-x-1.5">
                        {hasPerm('equipment', 'edit') && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiRequest(`/api/inventory/${it.id}/transaction`, { method: 'POST', body: { txType: 'receive', quantity: 10, notes: 'Warehouse restock' } });
                                load();
                              }}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50"
                            >
                              +10 Receive
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiRequest(`/api/inventory/${it.id}/transaction`, { method: 'POST', body: { txType: 'issue', quantity: 5, notes: 'Issued to site' } });
                                load();
                              }}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50"
                            >
                              -5 Issue
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {txs.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <div className="font-semibold text-slate-900 mb-2">Recent Inventory Transactions</div>
              <div className="divide-y divide-slate-100">
                {txs.slice(0, 8).map((tx) => (
                  <div key={tx.id} className="flex justify-between py-2">
                    <span>{tx.sku} · {tx.item_name} ({tx.tx_type}: {tx.quantity})</span>
                    <span className="font-mono text-slate-500">{tx.performed_by_name} · {tx.created_at?.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Internal Client Revision Requests Review & Quotations ---
export const RevisionsAndQuotesView: React.FC<{ mode: 'revisions' | 'quotations' }> = ({ mode }) => {
  const { syncVersion } = useSync();
  const [revisions, setRevisions] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);

  const load = () => {
    if (mode === 'revisions') {
      apiRequest('/api/revisions').then((r) => setRevisions(r.revisions || [])).catch(() => {});
    } else {
      apiRequest('/api/quotations').then((r) => setQuotes(r.quotations || [])).catch(() => {});
    }
  };
  useEffect(load, [mode, syncVersion]);

  if (mode === 'revisions') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Client Revision & Change Control</h1>
          <p className="text-xs text-slate-500">
            Client requests require technical feasibility, cost evaluation, and management approval. Never auto-modifies approved contracts or schedules.
          </p>
        </div>
        <div className="space-y-4">
          {revisions.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold text-amber-700">{r.ref_number}</span> · <strong>{r.project_name}</strong> · Submitted by {r.client_name}
                </div>
                <StatusLabel status={r.status} />
              </div>
              <p className="text-sm text-slate-800">{r.description}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  value={r.status}
                  onChange={async (e) => {
                    await apiRequest(`/api/revisions/${r.id}/workflow`, {
                      method: 'PATCH',
                      body: { status: e.target.value, remarks: `Workflow stage set to ${e.target.value}` },
                    });
                    load();
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  {[
                    'submitted',
                    'received',
                    'under_technical_review',
                    'under_cost_evaluation',
                    'awaiting_management_approval',
                    'approved',
                    'rejected',
                    'awaiting_client_confirmation',
                    'in_progress',
                    'completed',
                  ].map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Quotation & Estimating Foundation (Phase 6)</h1>
        <p className="text-xs text-slate-500">
          Architectural schema and quotation-to-project conversion workflow ready. Actual estimating formulas will be implemented strictly from the company Excel workbook upon inspection.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-2.5">Quote #</th>
              <th className="px-4 py-2.5">Title</th>
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5">Validity</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {quotes.map((q) => (
              <tr key={q.id}>
                <td className="px-4 py-2.5 font-mono">{q.quote_number}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{q.title}</td>
                <td className="px-4 py-2.5">{q.client_name}</td>
                <td className="px-4 py-2.5 font-mono">{q.validity_date}</td>
                <td className="px-4 py-2.5"><StatusLabel status={q.status} /></td>
                <td className="px-4 py-2.5 text-slate-600">{q.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- System Admin, RBAC, Modules & Maintenance ---
type AdminTabKey = 'users' | 'clients' | 'roles' | 'modules' | 'audit' | 'maintenance';

export const AdminConsoleView: React.FC<{ initialTab?: AdminTabKey }> = ({ initialTab = 'users' }) => {
  const [tab, setTab] = useState<AdminTabKey>(initialTab);
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [maint, setMaint] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [banner, setBanner] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [editingClientId, setEditingClientId] = useState<number | null>(null);

  const emptyClientForm = {
    companyName: '',
    primaryContact: '',
    representativeTitle: '',
    email: '',
    phone: '',
    secondaryContact: '',
    address: '',
    notes: '',
  };
  const [clientForm, setClientForm] = useState(emptyClientForm);

  const [newUser, setNewUser] = useState({
    email: '',
    fullName: '',
    password: '',
    roleId: '',
    assignedProjectIds: [] as number[],
    clientId: '',
  });

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadAll = async () => {
    const [u, r, m, a, mt, p, c] = await Promise.all([
      apiRequest('/api/admin/users').catch(() => ({ users: [] })),
      apiRequest('/api/admin/roles').catch(() => ({ roles: [] })),
      apiRequest('/api/admin/modules').catch(() => ({ modules: [] })),
      apiRequest('/api/admin/audit-logs').catch(() => ({ logs: [] })),
      apiRequest('/api/admin/maintenance').catch(() => null),
      apiRequest('/api/projects').catch(() => ({ projects: [] })),
      apiRequest('/api/admin/clients').catch(() => ({ clients: [] })),
    ]);
    setUsers(u.users || []);
    setRoles(r.roles || []);
    setModules(m.modules || []);
    setAuditLogs(a.logs || []);
    setMaint(mt);
    setProjects(p.projects || []);
    setClients(c.clients || []);
    if (r.roles?.length && !newUser.roleId) {
      setNewUser((prev) => ({ ...prev, roleId: String(r.roles[0].id) }));
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredClients = clients.filter((c) => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return true;
    return [c.company_name, c.primary_contact, c.representative_title, c.email, c.phone, c.address]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner('');
    setErrorBanner('');
    try {
      if (editingClientId) {
        await apiRequest(`/api/admin/clients/${editingClientId}`, {
          method: 'PATCH',
          body: clientForm,
        });
        setBanner(`Client profile updated: ${clientForm.companyName}`);
      } else {
        await apiRequest('/api/admin/clients', {
          method: 'POST',
          body: clientForm,
        });
        setBanner(`Client added to directory: ${clientForm.companyName}`);
      }
      setEditingClientId(null);
      setClientForm(emptyClientForm);
      await loadAll();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to save client record');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">System Administration &amp; Maintenance</h1>
          <p className="text-xs text-slate-500">
            Manage users, client directory &amp; representatives, 14-role RBAC permissions, modules, audit trail, and backups.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          {[
            ['users', 'Users'],
            ['clients', 'Clients & Reps'],
            ['roles', 'Roles & RBAC'],
            ['modules', 'Modules'],
            ['audit', 'Audit Trail'],
            ['maintenance', 'Maintenance & Backups'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k as AdminTabKey)}
              className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {banner && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{banner}</div>}
      {errorBanner && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">{errorBanner}</div>}

      {tab === 'users' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/api/admin/users', {
                method: 'POST',
                body: {
                  ...newUser,
                  roleId: Number(newUser.roleId),
                  clientId: newUser.clientId ? Number(newUser.clientId) : undefined,
                },
              });
              setNewUser({ ...newUser, email: '', fullName: '', password: '' });
              setBanner('User account created with server-side scrypt hash.');
              loadAll();
            }}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit"
          >
            <h3 className="font-display text-sm font-semibold text-slate-900">Create Staff or Client Account</h3>
            <input required placeholder="Full Name" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <input type="email" required placeholder="Email Address" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <input type="password" required minLength={8} placeholder="Password (min 8 chars)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <select value={newUser.roleId} onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Client Company (if Client Rep)</label>
              <select value={newUser.clientId} onChange={(e) => setNewUser({ ...newUser, clientId: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="">— Internal Staff (None) —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Assigned Projects</label>
              <div className="max-h-28 overflow-y-auto space-y-1 rounded-lg border border-slate-200 p-2">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newUser.assignedProjectIds.includes(p.id)}
                      onChange={(e) => {
                        setNewUser((prev) => ({
                          ...prev,
                          assignedProjectIds: e.target.checked
                            ? [...prev.assignedProjectIds, p.id]
                            : prev.assignedProjectIds.filter((id) => id !== p.id),
                        }));
                      }}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white">Create User</button>
          </form>

          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Projects</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{u.full_name}</div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2.5">{u.role_name}</td>
                    <td className="px-4 py-2.5 font-mono">{u.assigned_project_ids?.length || 0}</td>
                    <td className="px-4 py-2.5">{u.is_active ? <span className="text-emerald-700 font-medium">Active</span> : <span className="text-red-700">Inactive</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          await apiRequest(`/api/admin/users/${u.id}`, {
                            method: 'PATCH',
                            body: { isActive: !u.is_active },
                          });
                          loadAll();
                        }}
                        className="rounded border border-slate-300 px-2.5 py-1 text-[11px] hover:bg-slate-50"
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'clients' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <form
            onSubmit={handleSaveClient}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs h-fit"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-amber-600" />
                {editingClientId ? 'Edit Client Information' : 'Add Client Information'}
              </h3>
              {editingClientId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingClientId(null);
                    setClientForm(emptyClientForm);
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Company / Client Name *</label>
              <input
                required
                placeholder="e.g., Meridian Commercial Holdings"
                value={clientForm.companyName}
                onChange={(e) => setClientForm({ ...clientForm, companyName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Client Representative *</label>
                <input
                  required
                  placeholder="Full name"
                  value={clientForm.primaryContact}
                  onChange={(e) => setClientForm({ ...clientForm, primaryContact: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Representative Title</label>
                <input
                  placeholder="e.g., VP Capital Projects"
                  value={clientForm.representativeTitle}
                  onChange={(e) => setClientForm({ ...clientForm, representativeTitle: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="rep@clientcompany.com"
                  value={clientForm.email}
                  onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contact Phone *</label>
                <input
                  required
                  placeholder="+1 (555) 010-2000"
                  value={clientForm.phone}
                  onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Secondary / Billing Contact</label>
              <input
                placeholder="Alternate contact person, phone, or billing email"
                value={clientForm.secondaryContact}
                onChange={(e) => setClientForm({ ...clientForm, secondaryContact: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Client Office / Billing Address *</label>
              <textarea
                rows={2}
                required
                placeholder="Street, suite, city, state/province, postal code"
                value={clientForm.address}
                onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Account Notes</label>
              <textarea
                rows={2}
                placeholder="Contract terms, billing preferences, or site coordination notes"
                value={clientForm.notes}
                onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
            >
              {editingClientId ? 'Update Client Record' : 'Save Client'}
            </button>
          </form>

          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="text-xs font-semibold text-slate-900">
                Client Directory <span className="font-mono text-slate-500">({filteredClients.length})</span>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search client, rep, address..."
                  className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Company &amp; Address</th>
                    <th className="px-4 py-2.5">Client Representative</th>
                    <th className="px-4 py-2.5">Contact Information</th>
                    <th className="px-4 py-2.5 text-right">Projects</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        No client records match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredClients.map((c) => (
                      <tr key={c.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{c.company_name}</div>
                          <div className="text-[11px] text-slate-600 mt-0.5">{c.address || 'No address specified'}</div>
                          {c.notes && <div className="text-[11px] text-slate-400 mt-0.5 italic">{c.notes}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{c.primary_contact}</div>
                          {c.representative_title && (
                            <div className="text-[11px] text-slate-500">{c.representative_title}</div>
                          )}
                          {Array.isArray(c.portal_users) && c.portal_users.length > 0 && (
                            <div className="mt-1 text-[11px] text-emerald-700">
                              Portal: {c.portal_users.map((pu: any) => pu.full_name).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-900">{c.email}</div>
                          <div className="font-mono text-[11px] text-slate-600 mt-0.5">{c.phone || '—'}</div>
                          {c.secondary_contact && (
                            <div className="text-[11px] text-slate-500 mt-0.5">Alt: {c.secondary_contact}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                          {c.project_count ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingClientId(c.id);
                              setClientForm({
                                companyName: c.company_name || '',
                                primaryContact: c.primary_contact || '',
                                representativeTitle: c.representative_title || '',
                                email: c.email || '',
                                phone: c.phone || '',
                                secondaryContact: c.secondary_contact || '',
                                address: c.address || '',
                                notes: c.notes || '',
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Role Name</th>
                <th className="px-4 py-2.5">Scope</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5 text-right">Granted Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{r.name}</td>
                  <td className="px-4 py-2.5">{r.is_client_role ? 'Client Portal Only' : 'Internal CBMS'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.description}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.permissions?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'modules' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.slug} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4 text-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-slate-900">{m.name}</span>
                  <span className="font-mono text-slate-500">v{m.version}</span>
                </div>
                <p className="mt-1.5 text-slate-600 leading-relaxed">{m.description}</p>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className={m.is_enabled ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
                  {m.is_enabled ? 'Enabled' : 'Disabled (Data Retained)'}
                </span>
                {m.slug !== 'projects' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiRequest(`/api/admin/modules/${m.slug}/toggle`, {
                        method: 'PATCH',
                        body: { isEnabled: !m.is_enabled },
                      });
                      loadAll();
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-800 hover:bg-slate-50"
                  >
                    {m.is_enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Module / Action</th>
                <th className="px-4 py-2.5">Record</th>
                <th className="px-4 py-2.5">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{log.created_at}</td>
                  <td className="px-4 py-2.5">{log.user_email}</td>
                  <td className="px-4 py-2.5 font-mono">{log.module} · {log.action}</td>
                  <td className="px-4 py-2.5 font-mono">{log.record_type} ({log.record_ref})</td>
                  <td className="px-4 py-2.5 text-slate-600">{log.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'maintenance' && maint && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 text-xs">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">System Health & Scheduled Jobs</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">App Version:</span> <strong className="font-mono">{maint.appVersion}</strong></div>
              <div><span className="text-slate-500">Runtime:</span> <strong className="font-mono">{maint.runtime}</strong></div>
              <div><span className="text-slate-500">Migrations Applied:</span> <strong className="font-mono">{maint.migrations?.length}</strong></div>
              <div><span className="text-slate-500">Audit Records:</span> <strong className="font-mono">{maint.counts?.auditLogs}</strong></div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  const res = await apiRequest<{ overdueMarked: number }>('/api/admin/cron/run', { method: 'POST' });
                  setBanner(`Manual Cron executed: ${res.overdueMarked} overdue task(s) updated & notified.`);
                  loadAll();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-medium text-white hover:bg-slate-800"
              >
                <Play className="h-3.5 w-3.5" /> Run Scheduled Cron Tasks Now
              </button>
              <a
                href={`/api/admin/backup/export?token=${encodeURIComponent(getApiToken() || '')}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-800 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> Export Database Backup (JSON)
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-slate-900">Recent Login Activity</h3>
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {(maint.recentLogins || []).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium text-slate-900">{l.email}</span>
                    <span className="ml-2 text-slate-500">{l.reason}</span>
                  </div>
                  <span className={`font-mono ${l.success ? 'text-emerald-700' : 'text-red-700'}`}>
                    {l.created_at}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
