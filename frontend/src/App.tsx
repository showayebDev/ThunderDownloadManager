import React, { useState, useEffect } from 'react';
import { DownloadProvider, useDownloadContext } from './context/DownloadContext';
import { AppearanceProvider } from './context/AppearanceContext';
import { TooltipProvider } from './components/ui/tooltip';
import { Header } from './components/layout/Header';
import { Toolbar } from './components/layout/Toolbar';
import { Sidebar } from './components/layout/Sidebar';
import { DownloadTable } from './components/downloads/DownloadTable';
import { StatusBar } from './components/layout/StatusBar';
import { NewDownloadModal } from './components/modals/NewDownloadModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { QueueManagerModal } from './components/modals/QueueManagerModal';
import { DeleteConfirmModal } from './components/modals/DeleteConfirmModal';
import { OpenSourceLicensesModal } from './components/modals/OpenSourceLicensesModal';
import { AboutModal } from './components/modals/AboutModal';
import { BatchDownloadModal } from './components/modals/BatchDownloadModal';
import { PerHostSettingsModal } from './components/modals/PerHostSettingsModal';
import { Quit } from './utils/tauriBridge';
import DownloadStartConfirmation from './components/window/DownloadStartConfirmation';
import RealTimeDownloadProgress from './components/window/RealTimeDownloadProgress';
import DownloadCompleted from './components/window/DownloadCompleted';
import { listen } from './utils/tauriBridge';
import './App.css';

const MainLayout: React.FC = () => {
  const { activeModal, closeModal } = useDownloadContext();

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background font-sans antialiased text-foreground select-none">
      {/* App Header (Menu, Search & Window Controls) */}
      <Header />

      {/* Action Toolbar */}
      <Toolbar />

      {/* Main Workspace (Sidebar + Downloads Table) */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <DownloadTable />
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Active In-Page Modals */}
      {activeModal === 'newDownload' && <NewDownloadModal />}
      {activeModal === 'batchDownload' && <BatchDownloadModal />}
      {activeModal === 'settings' && <SettingsModal />}
      {activeModal === 'perHostSettings' && <PerHostSettingsModal onClose={() => closeModal()} />}
      {activeModal === 'queues' && <QueueManagerModal />}
      {activeModal === 'deleteConfirm' && <DeleteConfirmModal onClose={() => closeModal()} />}
      {activeModal === 'openSourceLicenses' && <OpenSourceLicensesModal onClose={() => closeModal()} />}
      {activeModal === 'about' && <AboutModal onClose={() => closeModal()} />}
    </div>
  );
};

const AppContent: React.FC = () => {
  const getRouteFromHash = () => {
    const hash = window.location.hash || '';
    if (hash.includes('download-confirmation') || hash.includes('add-download')) {
      return 'download-confirmation';
    } else if (hash.includes('realtime-progress') || hash.includes('progress')) {
      return 'realtime-progress';
    } else if (hash.includes('download-completed')) {
      return 'download-completed';
    } else if (hash.includes('delete-confirm')) {
      return 'delete-confirm';
    }
    return 'main';
  };

  const [route, setRoute] = useState<string>(getRouteFromHash());

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);

    // Listen for backend route changes
    let unlisten: any;
    listen('navigate-route', (event: any) => {
      setRoute(event.payload);
      window.location.hash = event.payload;
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      if (unlisten) unlisten();
    };
  }, []);

  if (route === 'download-confirmation') {
    return <DownloadStartConfirmation />;
  }

  if (route === 'realtime-progress') {
    return <RealTimeDownloadProgress />;
  }

  if (route === 'download-completed') {
    return <DownloadCompleted />;
  }

  if (route === 'delete-confirm') {
    return (
      <DeleteConfirmModal onClose={async () => {
        try {
          Quit();
        } catch {}
      }} />
    );
  }

  return <MainLayout />;
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[App] React ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-foreground p-6 text-center select-none font-sans">
          <div className="p-3 bg-destructive/20 border border-destructive/30 rounded-2xl text-destructive mb-3">
            <span className="text-xl font-bold">⚠️</span>
          </div>
          <h2 className="text-sm font-bold text-foreground mb-1">Window View Error</h2>
          <p className="text-xs text-muted-foreground mb-4 max-w-xs">
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-1.5 bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs rounded-xl transition-colors cursor-pointer"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppearanceProvider>
        <DownloadProvider>
          <TooltipProvider delayDuration={200}>
            <AppContent />
          </TooltipProvider>
        </DownloadProvider>
      </AppearanceProvider>
    </ErrorBoundary>
  );
}
