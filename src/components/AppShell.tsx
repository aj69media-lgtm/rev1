import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Building2,
  Calculator,
  Check,
  CheckSquare,
  ChevronRight,
  FileSpreadsheet,
  FolderKanban,
  GitPullRequest,
  Globe,
  HardHat,
  LogOut,
  Menu,
  Package,
  Radio,
  Shield,
  ShoppingCart,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { PWAInstallButton } from './PWAComponents';

export type NavSection =
  | 'dashboard'
  | 'projects'
  | 'tasks'
  | 'procurement'
  | 'personnel'
  | 'equipment'
  | 'revisions'
  | 'reports'
  | 'quotations'
  | 'admin';

interface AppShellProps {
  activeSection: NavSection;
  selectedProjectId: number | null;
  onSelectSection: (section: NavSection) => void;
  onClearProject: () => void;
  onOpenClientPortal: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeSection,
  selectedProjectId,
  onSelectSection,
  onClearProject,
  onOpenClientPortal,
  children,
}) => {
  const { user, authStatus, logout, hasPerm } = useAuth();
  const {
    isOnline,
    wsConnected,
    onlineUsers,
    notifications,
    lastEventLabel,
    markNotificationRead,
  } = useSync();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const navGroups: Array<{
    group: string;
    items: Array<{ id: NavSection; label: string; icon: React.ReactNode; visible: boolean }>;
  }> = [
    {
      group: 'Overview',
      items: [
        {
          id: 'dashboard',
          label: 'Executive Dashboard',
          icon: <BarChart3 className="h-4 w-4" />,
          visible: hasPerm('projects', 'view'),
        },
        {
          id: 'projects',
          label: 'Projects & Workspaces',
          icon: <FolderKanban className="h-4 w-4" />,
          visible: hasPerm('projects', 'view'),
        },
      ],
    },
    {
      group: 'Operations & Control',
      items: [
        {
          id: 'tasks',
          label: 'Tasks Queue',
          icon: <CheckSquare className="h-4 w-4" />,
          visible: hasPerm('tasks', 'view'),
        },
        {
          id: 'procurement',
          label: 'Procurement & PRs',
          icon: <ShoppingCart className="h-4 w-4" />,
          visible: hasPerm('procurement', 'view'),
        },
        {
          id: 'revisions',
          label: 'Client Revisions',
          icon: <GitPullRequest className="h-4 w-4" />,
          visible: hasPerm('client_portal', 'view') || hasPerm('projects', 'edit'),
        },
      ],
    },
    {
      group: 'Site Resources',
      items: [
        {
          id: 'personnel',
          label: 'Personnel & Attendance',
          icon: <Users className="h-4 w-4" />,
          visible: hasPerm('personnel', 'view'),
        },
        {
          id: 'equipment',
          label: 'Equipment & Inventory',
          icon: <Package className="h-4 w-4" />,
          visible: hasPerm('equipment', 'view'),
        },
      ],
    },
    {
      group: 'Reporting & Estimating',
      items: [
        {
          id: 'reports',
          label: 'Reports & Export',
          icon: <FileSpreadsheet className="h-4 w-4" />,
          visible: hasPerm('financials', 'view') || hasPerm('projects', 'view'),
        },
        {
          id: 'quotations',
          label: 'Quotations & Estimating',
          icon: <Calculator className="h-4 w-4" />,
          visible: hasPerm('quotations', 'view'),
        },
      ],
    },
    {
      group: 'Administration',
      items: [
        {
          id: 'admin',
          label: 'Admin & Maintenance',
          icon: <Shield className="h-4 w-4" />,
          visible: user?.role_slug === 'system_admin' || hasPerm('admin', 'view'),
        },
      ],
    },
  ];

  const sectionLabels: Record<NavSection, string> = {
    dashboard: 'Executive Dashboard',
    projects: selectedProjectId ? 'Project Workspace' : 'Projects Directory',
    tasks: 'Tasks Queue',
    procurement: 'Procurement & Purchase Requests',
    personnel: 'Personnel & Attendance',
    equipment: 'Equipment & Inventory',
    revisions: 'Client Revision Requests',
    reports: 'Management Reports & Export',
    quotations: 'REV1 Quotation & Estimating',
    admin: 'System Administration & Maintenance',
  };

  const handleNavClick = (id: NavSection) => {
    onClearProject();
    onSelectSection(id);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0F172A] text-slate-300">
      <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white">
            <HardHat className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-bold text-white">
              {authStatus?.companyName || 'BuildCore CBMS'}
            </div>
            <div className="truncate text-[10px] uppercase tracking-wider text-slate-400">
              Operations Suite
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((i) => i.visible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.group}>
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.group}
              </div>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {hasPerm('client_portal', 'view') && (
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onOpenClientPortal();
              }}
              className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium text-amber-400 hover:border-amber-600/60 hover:bg-slate-800"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Client Portal View
              </span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </nav>

      <div className="border-t border-slate-800 p-3 space-y-2">
        <div className="flex items-center gap-2.5 rounded-lg bg-slate-900/70 px-2.5 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
            {user?.full_name
              ?.split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase() || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">{user?.full_name}</div>
            <div className="truncate text-[11px] text-slate-400">{user?.role_name}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowChangePw(true)}
            className="flex-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Password
          </button>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-rose-700 hover:bg-rose-950/60 hover:text-rose-200"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 w-64 max-w-[85vw]">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
              <Building2 className="hidden sm:block h-4 w-4 text-slate-400 shrink-0" />
              <span className="truncate font-semibold text-slate-900 text-sm">
                {sectionLabels[activeSection]}
              </span>
              {lastEventLabel && (
                <span className="hidden xl:inline text-[11px] text-slate-400 truncate">
                  · Sync: {lastEventLabel}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Connection & Presence */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium">
              {!isOnline ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <WifiOff className="h-3.5 w-3.5" />
                  Offline
                </span>
              ) : wsConnected ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Radio className="h-3.5 w-3.5" />
                  Live · {onlineUsers.length || 1} online
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sky-700">
                  <Radio className="h-3.5 w-3.5" />
                  Polling Sync
                </span>
              )}
            </div>

            <PWAInstallButton />

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                      <span className="text-xs font-semibold text-slate-900">Notifications</span>
                      <span className="text-[11px] text-slate-500">{unreadCount} unread</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-slate-500">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.slice(0, 15).map((n) => (
                          <div
                            key={n.id}
                            className={`px-4 py-2.5 text-xs ${n.is_read ? 'bg-white' : 'bg-amber-50/40'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-semibold text-slate-900">{n.title}</div>
                              {!n.is_read && (
                                <button
                                  type="button"
                                  onClick={() => markNotificationRead(n.id)}
                                  className="shrink-0 text-amber-700 hover:text-amber-900"
                                  title="Mark read"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <p className="mt-0.5 text-slate-600">{n.body}</p>
                            <div className="mt-1 text-[10px] text-slate-400">
                              {new Date(n.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
};

const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    setSaving(true);
    try {
      const { apiRequest } = await import('../lib/api');
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (error: any) {
      setErr(error?.message || 'Unable to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-slate-900">Change Account Password</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          {err && <div className="rounded-lg bg-rose-50 p-2.5 text-rose-700">{err}</div>}
          {msg && <div className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700">{msg}</div>}
          <div>
            <label className="block font-medium text-slate-700 mb-1">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">New Password (min 8 chars)</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
