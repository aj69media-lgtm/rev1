/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AppShell, NavSection } from './components/AppShell';
import { OfflineIndicator } from './components/PWAComponents';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { AuthViews } from './pages/AuthViews';
import { ClientPortalView } from './pages/ClientPortalView';
import { ExecutiveDashboard } from './pages/ExecutiveDashboard';
import {
  AdminConsoleView,
  EquipmentInventoryView,
  PersonnelAttendanceView,
  ProcurementGlobalView,
  RevisionsAndQuotesView,
  TasksGlobalView,
} from './pages/GlobalOperationsViews';
import { ProjectWorkspaceView } from './pages/ProjectWorkspaceView';
import { ProjectsListView } from './pages/ProjectsListView';
import { ReportsView } from './pages/ReportsView';

const RootRouter: React.FC = () => {
  const { user, loading, hasPerm } = useAuth();
  const [section, setSection] = useState<NavSection>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [clientPortalMode, setClientPortalMode] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.pathname.startsWith('/client-portal')
  );

  // Pick a safe landing module based on the signed-in user's role permissions
  useEffect(() => {
    if (!user) return;
    if (user.is_client_role) {
      setClientPortalMode(true);
      return;
    }
    if (!hasPerm('projects', 'view')) {
      if (hasPerm('tasks', 'view')) setSection('tasks');
      else if (hasPerm('procurement', 'view')) setSection('procurement');
      else if (hasPerm('personnel', 'view')) setSection('personnel');
      else if (hasPerm('equipment', 'view')) setSection('equipment');
    }
  }, [user, hasPerm]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300 text-sm">
        Initializing BuildCore CBMS...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthViews />
        <OfflineIndicator />
      </>
    );
  }

  // Client representatives are strictly isolated in ClientPortalView
  if (user.is_client_role || clientPortalMode) {
    return (
      <>
        <ClientPortalView
          onExitToInternal={
            user.is_client_role
              ? undefined
              : () => {
                  setClientPortalMode(false);
                  if (window.location.pathname.startsWith('/client-portal')) {
                    window.history.replaceState({}, '', '/');
                  }
                }
          }
        />
        <OfflineIndicator />
      </>
    );
  }

  const handleOpenProject = (projectId: number) => {
    setSelectedProjectId(projectId);
    setSection('projects');
  };

  const handleNavigate = (target: string) => {
    setSelectedProjectId(null);
    if (
      target === 'dashboard' ||
      target === 'projects' ||
      target === 'tasks' ||
      target === 'procurement' ||
      target === 'personnel' ||
      target === 'equipment' ||
      target === 'revisions' ||
      target === 'reports' ||
      target === 'quotations' ||
      target === 'admin'
    ) {
      setSection(target);
    }
  };

  const renderPage = () => {
    if (section === 'projects' && selectedProjectId !== null) {
      return (
        <ProjectWorkspaceView
          projectId={selectedProjectId}
          onBack={() => setSelectedProjectId(null)}
        />
      );
    }

    switch (section) {
      case 'dashboard':
        return <ExecutiveDashboard onOpenProject={handleOpenProject} onNavigate={handleNavigate} />;
      case 'projects':
        return <ProjectsListView onOpenProject={handleOpenProject} />;
      case 'tasks':
        return <TasksGlobalView />;
      case 'procurement':
        return <ProcurementGlobalView />;
      case 'personnel':
        return <PersonnelAttendanceView />;
      case 'equipment':
        return <EquipmentInventoryView />;
      case 'revisions':
        return <RevisionsAndQuotesView mode="revisions" />;
      case 'reports':
        return <ReportsView />;
      case 'quotations':
        return <RevisionsAndQuotesView mode="quotations" />;
      case 'admin':
        return <AdminConsoleView />;
      default:
        return <ExecutiveDashboard onOpenProject={handleOpenProject} onNavigate={handleNavigate} />;
    }
  };

  return (
    <>
      <AppShell
        activeSection={section}
        selectedProjectId={selectedProjectId}
        onSelectSection={(next) => setSection(next)}
        onClearProject={() => setSelectedProjectId(null)}
        onOpenClientPortal={() => setClientPortalMode(true)}
      >
        {renderPage()}
      </AppShell>
      <OfflineIndicator />
    </>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <RootRouter />
      </SyncProvider>
    </AuthProvider>
  );
}
