import React, { useState } from 'react';
import { Building2, Lock, ShieldCheck } from 'lucide-react';
import { PWAInstallButton } from '../components/PWAComponents';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

export const AuthViews: React.FC = () => {
  const { authStatus, login, bootstrapAdmin } = useAuth();

  // Bootstrap admin state
  const [companyName, setCompanyName] = useState('BuildCore Construction Group');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [seedDemoData, setSeedDemoData] = useState(true);
  const [demoStaffPassword, setDemoStaffPassword] = useState('');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await bootstrapAdmin({
        fullName: adminName,
        email: adminEmail,
        password: adminPassword,
        companyName,
        seedDemoData,
        demoStaffPassword: demoStaffPassword || adminPassword,
      });
    } catch (err: any) {
      setError(err?.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMsg('');
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/request-reset', {
        method: 'POST',
        body: { email: resetEmail },
      });
      setResetMsg(res.message);
    } catch (err: any) {
      setResetMsg(err?.message || 'Unable to process request');
    }
  };

  const isBootstrap = authStatus?.requiresBootstrap;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Visual Architecture Panel */}
      <div className="relative lg:w-1/2 bg-slate-900 text-white flex flex-col justify-between p-8 lg:p-12 overflow-hidden">
        <img
          src="/src/assets/images/hero_commercial_tower_1795251920498.jpg"
          alt="Commercial construction project site"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-amber-500" />
            <span className="font-display text-lg font-bold tracking-tight">
              {authStatus?.companyName || 'BuildCore CBMS'}
            </span>
          </div>
          <PWAInstallButton variant="dark" />
        </div>

        <div className="relative z-10 my-10 lg:my-0 max-w-xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-400">
            Construction Business Management System
          </p>
          <h1 className="font-display text-3xl lg:text-4xl font-bold leading-tight text-white [text-wrap:balance]">
            Centralized field execution, financial control, and client transparency.
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Unified project schedules, daily progress reports, purchase request commitments, earned value analytics, offline site sync, and an isolated Client Portal.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4 border-t border-white/15 pt-6 text-xs text-slate-300">
          <div>
            <div className="font-semibold text-white">Role-Scoped RBAC</div>
            <div className="mt-0.5 text-slate-400">14 configurable roles & project isolation</div>
          </div>
          <div>
            <div className="font-semibold text-white">Offline Site Sync</div>
            <div className="mt-0.5 text-slate-400">IndexedDB queue & PWA support</div>
          </div>
          <div>
            <div className="font-semibold text-white">cPanel Portable</div>
            <div className="mt-0.5 text-slate-400">MySQL & PHP 8.3 deployment package</div>
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          {isBootstrap ? (
            <>
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700">
                  <ShieldCheck className="h-4 w-4" />
                  <span>First-Run Administrator Setup</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900">Initialize CBMS Workspace</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Claim the initial System Administrator account. Once claimed, this setup route automatically locks.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleBootstrap} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Company Name</label>
                  <input
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Administrator Full Name</label>
                  <input
                    required
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="e.g. Jordan Mercer"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Administrator Email</label>
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@company.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Administrator Password (min 8 chars)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                  <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={seedDemoData}
                      onChange={(e) => setSeedDemoData(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="font-semibold">Populate sample construction projects & role accounts</strong>
                      <span className="block text-slate-500 mt-0.5">
                        Creates 3 projects, approved schedules, DPRs, budgets, PRs, equipment, QC defects, and sample role logins (`pm@buildcore.local`, `client@meridian-dev.local`, etc.).
                      </span>
                    </span>
                  </label>
                  {seedDemoData && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Password for sample staff & client test accounts (defaults to your admin password if blank)
                      </label>
                      <input
                        type="password"
                        minLength={8}
                        value={demoStaffPassword}
                        onChange={(e) => setDemoStaffPassword(e.target.value)}
                        placeholder="Optional separate test password (min 8 chars)"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {busy ? 'Initializing System...' : 'Claim Admin & Launch CBMS'}
                </button>
              </form>
            </>
          ) : showReset ? (
            <>
              <div className="space-y-1">
                <h2 className="font-display text-xl font-bold text-slate-900">Reset Account Password</h2>
                <p className="text-xs text-slate-600">Enter your work or client email to log a password reset request.</p>
              </div>
              {resetMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                  {resetMsg}
                </div>
              )}
              <form onSubmit={handleResetRequest} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Account Email</label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowReset(false)}
                    className="flex-1 rounded-lg border border-slate-300 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Back to Sign In
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Request Reset
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                  <span>Secure Workspace Access</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900">Sign in to CBMS</h2>
                <p className="text-xs text-slate-600">
                  Staff sign in to internal operations; Client Representatives are routed automatically to the isolated Client Portal.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">Password</label>
                    <button
                      type="button"
                      onClick={() => setShowReset(true)}
                      className="text-xs font-medium text-amber-700 hover:text-amber-800"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {busy ? 'Authenticating...' : 'Sign In'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
