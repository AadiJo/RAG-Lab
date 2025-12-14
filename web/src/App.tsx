import { useState, useEffect } from 'react';
import { 
  Database, 
  Play, 
  History,
  LayoutDashboard,
  FlaskConical,
  Search,
  BookOpen,
  Settings,
  Image as ImageIcon,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import EvaluationRunner from './components/EvaluationRunner';
import ResultsViewer from './components/ResultsViewer';
import DatasetsView from './components/DatasetsView';
import TextDbsView from './components/TextDbsView';
import DocsView from './components/DocsView';
import SettingsView from './components/SettingsView';
import ImageEmbeddingStudio from './components/ImageEmbeddingStudio';
import { checkHealth, checkReadiness, listTextDbs, getEvaluationStatus, getTextDbBuild } from './lib/api';

const RUNNING_EVAL_STORAGE_KEY = 'rag-lab.runningEvalId';
const EVAL_BADGE_STORAGE_KEY = 'rag-lab.evalBadge'; // { status: 'completed'|'failed', id, at }
const RUNNING_TEXTDB_BUILD_STORAGE_KEY = 'rag-lab.runningTextDbBuildId';
const TEXTDB_BUILD_BADGE_STORAGE_KEY = 'rag-lab.textDbBuildBadge'; // { status: 'completed'|'failed', id, at }

type View = 'dashboard' | 'evaluate' | 'textdbs' | 'image-embedding' | 'results' | 'datasets' | 'docs' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [serverStatus, setServerStatus] = useState<'checking' | 'healthy' | 'error'>('checking');
  const [evalBadge, setEvalBadge] = useState<null | { status: 'running' | 'completed' | 'failed'; id?: string }>(null);
  const [textDbBuildBadge, setTextDbBuildBadge] = useState<null | { status: 'running' | 'completed' | 'failed'; id?: string }>(null);
  const [readiness, setReadiness] = useState<{
    ready: boolean;
    ragIntegration: boolean;
    llmJudge: boolean;
    activeTextDb: boolean;
  } | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        await checkHealth();
        setServerStatus('healthy');
        
        const ready = await checkReadiness();
        const textDbs = await listTextDbs().catch(() => ({ active: null } as any));
        const activeTextDb = Boolean(textDbs?.active?.activeDbPath);
        setReadiness({
          ready: ready.ready,
          // Consider "RAG" connected if either the external RAG integration is up OR an active text DB exists.
          ragIntegration: ready.components.ragIntegration || activeTextDb,
          llmJudge: ready.components.llmJudge,
          activeTextDb,
        });
      } catch {
        setServerStatus('error');
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Allow child views to request navigation (e.g., History -> Evaluation after copying settings)
  useEffect(() => {
    const onNav = (e: Event) => {
      const ev = e as CustomEvent<{ view?: View }>;
      if (ev.detail?.view) setCurrentView(ev.detail.view);
    };
    window.addEventListener('rag-lab:navigate', onNav as EventListener);
    return () => window.removeEventListener('rag-lab:navigate', onNav as EventListener);
  }, []);

  // Global evaluation badge polling (so the sidebar can show a badge even if you leave the Evaluation tab)
  useEffect(() => {
    const tick = async () => {
      const runningId = localStorage.getItem(RUNNING_EVAL_STORAGE_KEY);
      if (runningId) {
        try {
          const st = await getEvaluationStatus(runningId);
          if (st.status === 'running' || st.status === 'pending') {
            setEvalBadge({ status: 'running', id: runningId });
            return;
          }
          // Completed/failed/cancelled → clear running marker and set notification badge
          localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
          const status = st.status === 'completed' ? 'completed' : 'failed';
          localStorage.setItem(EVAL_BADGE_STORAGE_KEY, JSON.stringify({ status, id: runningId, at: Date.now() }));
          setEvalBadge({ status, id: runningId });
          return;
        } catch {
          // Server doesn't know it anymore
          localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
        }
      }

      // If no running eval, show completion badge if present and user isn't on the eval tab
      try {
        const raw = localStorage.getItem(EVAL_BADGE_STORAGE_KEY);
        if (!raw) {
          setEvalBadge(null);
          return;
        }
        const parsed = JSON.parse(raw) as { status?: 'completed' | 'failed'; id?: string };
        if (!parsed.status) {
          setEvalBadge(null);
          return;
        }
        setEvalBadge({ status: parsed.status, id: parsed.id });
      } catch {
        setEvalBadge(null);
      }
    };

    tick();
    const interval = setInterval(tick, 2500);
    return () => clearInterval(interval);
  }, []);

  // Global text DB build badge polling (similar to evaluations)
  useEffect(() => {
    const tick = async () => {
      const runningId = localStorage.getItem(RUNNING_TEXTDB_BUILD_STORAGE_KEY);
      if (runningId) {
        try {
          const st = await getTextDbBuild(runningId);
          if (st.status === 'running' || st.status === 'queued') {
            setTextDbBuildBadge({ status: 'running', id: runningId });
            return;
          }
          // Completed/failed → clear running marker and set notification badge
          localStorage.removeItem(RUNNING_TEXTDB_BUILD_STORAGE_KEY);
          const status = st.status === 'completed' ? 'completed' : 'failed';
          localStorage.setItem(TEXTDB_BUILD_BADGE_STORAGE_KEY, JSON.stringify({ status, id: runningId, at: Date.now() }));
          setTextDbBuildBadge({ status, id: runningId });
          return;
        } catch {
          // Server doesn't know it anymore
          localStorage.removeItem(RUNNING_TEXTDB_BUILD_STORAGE_KEY);
        }
      }

      // If no running build, show completion badge if present and user isn't on the textdbs tab
      try {
        const raw = localStorage.getItem(TEXTDB_BUILD_BADGE_STORAGE_KEY);
        if (!raw) {
          setTextDbBuildBadge(null);
          return;
        }
        const parsed = JSON.parse(raw) as { status?: 'completed' | 'failed'; id?: string };
        if (!parsed.status) {
          setTextDbBuildBadge(null);
          return;
        }
        setTextDbBuildBadge({ status: parsed.status, id: parsed.id });
      } catch {
        setTextDbBuildBadge(null);
      }
    };

    tick();
    const interval = setInterval(tick, 2500);
    return () => clearInterval(interval);
  }, []);

  // Clear completion badge when user visits the Text DBs tab
  useEffect(() => {
    if (currentView === 'textdbs') {
      const raw = localStorage.getItem(TEXTDB_BUILD_BADGE_STORAGE_KEY);
      if (raw) localStorage.removeItem(TEXTDB_BUILD_BADGE_STORAGE_KEY);
      if (textDbBuildBadge && textDbBuildBadge.status !== 'running') setTextDbBuildBadge(null);
    }
  }, [currentView, textDbBuildBadge]);

  // Clear completion badge when user visits the History tab
  useEffect(() => {
    if (currentView === 'results') {
      const raw = localStorage.getItem(EVAL_BADGE_STORAGE_KEY);
      if (raw) localStorage.removeItem(EVAL_BADGE_STORAGE_KEY);
      if (evalBadge && evalBadge.status !== 'running') setEvalBadge(null);
    }
  }, [currentView, evalBadge]);

  const navItems = [
    { id: 'dashboard' as View, label: 'Overview', icon: LayoutDashboard },
    { id: 'evaluate' as View, label: 'Evaluation', icon: Play },
    { id: 'textdbs' as View, label: 'Text DBs', icon: Database },
    { id: 'image-embedding' as View, label: 'Image Studio', icon: ImageIcon },
    { id: 'docs' as View, label: 'Docs', icon: BookOpen },
    { id: 'results' as View, label: 'History', icon: History },
    { id: 'datasets' as View, label: 'Datasets', icon: Database },
    { id: 'settings' as View, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden flex">
      {/* Background Ambience */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-900/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[120px]" />
        {/* Multi-scale grain to reduce gradient banding in Chrome */}
        <div className="absolute inset-0 bg-noise-dither opacity-[0.07] mix-blend-overlay" />
      </div>

      {/* Sidebar */}
      <aside className="relative z-10 w-72 border-r border-white/5 bg-zinc-950/50 backdrop-blur-xl flex flex-col h-screen">
        {/* Logo */}
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <FlaskConical size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-white">RAG Lab</h1>
              <p className="text-xs text-zinc-500 font-medium">Evaluation Platform</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 px-2">Menu</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 group ${
                currentView === item.id
                  ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
              }`}
            >
              <item.icon size={18} className={`transition-colors ${currentView === item.id ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              <span className="font-medium text-sm">{item.label}</span>
              {item.id === 'evaluate' && evalBadge?.status === 'running' && currentView !== 'evaluate' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" title="Evaluation running" />
              )}
              {item.id === 'results' && evalBadge?.status === 'completed' && currentView !== 'results' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" title="New evaluation completed" />
              )}
              {item.id === 'results' && evalBadge?.status === 'failed' && currentView !== 'results' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" title="New evaluation failed" />
              )}
              {item.id === 'textdbs' && textDbBuildBadge?.status === 'running' && currentView !== 'textdbs' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" title="Database build running" />
              )}
              {item.id === 'textdbs' && textDbBuildBadge?.status === 'completed' && currentView !== 'textdbs' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" title="Database build completed" />
              )}
              {item.id === 'textdbs' && textDbBuildBadge?.status === 'failed' && currentView !== 'textdbs' && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" title="Database build failed" />
              )}
              {currentView === item.id && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
              )}
            </button>
          ))}
        </nav>

        {/* Status Footer */}
        <div className="p-4 border-t border-white/5 bg-black/20 backdrop-blur-md">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">System Status</span>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                serverStatus === 'healthy' 
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${serverStatus === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                {serverStatus === 'healthy' ? 'Online' : 'Offline'}
              </div>
            </div>

            {readiness && (
              <div className="grid grid-cols-2 gap-2">
                <div className={`p-2 rounded-lg border ${readiness.ragIntegration ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-amber-500/5 border-amber-500/10'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Database size={12} className={readiness.ragIntegration ? 'text-emerald-400' : 'text-amber-400'} />
                    <span className="text-[10px] font-semibold text-zinc-300">RAG</span>
                  </div>
                  <span className={`text-[10px] block ${readiness.ragIntegration ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {readiness.ragIntegration ? (readiness.activeTextDb ? 'Text DB' : 'Connected') : 'Error'}
                  </span>
                </div>
                <div className={`p-2 rounded-lg border ${readiness.llmJudge ? 'bg-indigo-500/5 border-indigo-500/10' : 'bg-zinc-800 border-zinc-700'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Search size={12} className={readiness.llmJudge ? 'text-indigo-400' : 'text-zinc-500'} />
                    <span className="text-[10px] font-semibold text-zinc-300">Judge</span>
                  </div>
                  <span className={`text-[10px] block ${readiness.llmJudge ? 'text-indigo-500' : 'text-zinc-500'}`}>
                    {readiness.llmJudge ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-auto h-screen bg-transparent">
        <header className="sticky top-0 z-20 px-8 py-4 bg-black/50 backdrop-blur-md border-b border-white/5 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white tracking-tight">
            {navItems.find(i => i.id === currentView)?.label}
          </h2>
          {/* Removed settings + profile icons (no settings/account system yet) */}
        </header>
        
        <div className="p-8 max-w-7xl mx-auto animate-fadeIn pb-20">
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'evaluate' && <EvaluationRunner />}
          {currentView === 'textdbs' && <TextDbsView />}
          {currentView === 'image-embedding' && <ImageEmbeddingStudio />}
          {currentView === 'docs' && <DocsView />}
          {currentView === 'results' && <ResultsViewer />}
          {currentView === 'datasets' && <DatasetsView />}
          {currentView === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}

export default App;
