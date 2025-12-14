import { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Database,
  Sliders,
  Package,
} from 'lucide-react';
import { 
  listDatasets, 
  getDatasetSummary,
  startEvaluation, 
  getEvaluationStatus,
  cancelEvaluation,
  listTextDbs,
  setActiveTextDb,
  type DatasetSummary,
  type EvaluationStatus,
  type ModuleState,
} from '../lib/api';
import ModulesConfig from './ModulesConfig';

const RUNNING_EVAL_STORAGE_KEY = 'rag-lab.runningEvalId';

interface EvaluationConfig {
  kValues: number[];
  enableGenerationMetrics: boolean;
  enableImageMetrics: boolean;
  integrationMode: 'api' | 'direct' | 'text';
  enableFiltering: boolean;
  // Module system configuration
  moduleConfig?: Record<string, ModuleState>;
  searchType?: string;
  searchVariant?: string;
  queryOptions?: {
    targetDocs?: number;
    enableGamePieceEnhancement?: boolean;
    includeImageTypes?: boolean;
    enableCache?: boolean;
    enableStructuredQuery?: boolean;
    retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
    bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
  };
}

const DEFAULT_CONFIG: EvaluationConfig = {
  kValues: [5, 10, 15, 20],
  enableGenerationMetrics: true,
  enableImageMetrics: false,
  integrationMode: 'text',
  enableFiltering: false,
  moduleConfig: {},
  searchType: 'vector',
  searchVariant: undefined,
  queryOptions: {
    targetDocs: 8,
    enableGamePieceEnhancement: false, // Deprecated, now handled by modules
    includeImageTypes: false,
    enableCache: true,
    enableStructuredQuery: false,
    retrievalMethod: 'vector', // Kept for backwards compat, but searchType takes precedence
    bm25Variant: 'bm25',
  },
};

export default function EvaluationRunner() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [datasetInfo, setDatasetInfo] = useState<{
    testCaseCount: number;
    categories: Record<string, number>;
  } | null>(null);
  const [config, setConfig] = useState<EvaluationConfig>(DEFAULT_CONFIG);

  // Text DB state
  const [textDbs, setTextDbs] = useState<Array<{ name: string; path: string }>>([]);
  const [activeTextDb, setActiveTextDbState] = useState<string | null>(null);
  
  const [runningEvalId, setRunningEvalId] = useState<string | null>(null);
  const [status, setStatus] = useState<EvaluationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const didApplyDraft = useRef(false);

  useEffect(() => {
    if (didApplyDraft.current) return;
    didApplyDraft.current = true;
    try {
      const raw = localStorage.getItem('rag-lab.evalDraft');
      if (!raw) return;
      localStorage.removeItem('rag-lab.evalDraft');
      const parsed = JSON.parse(raw) as { datasetId?: string; config?: Partial<EvaluationConfig> };
      if (parsed.datasetId) setSelectedDataset(parsed.datasetId);
      if (parsed.config) setConfig(prev => ({ ...prev, ...parsed.config, queryOptions: { ...prev.queryOptions, ...(parsed.config.queryOptions || {}) } }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const loadDatasets = async () => {
      try {
        const { datasets: ds } = await listDatasets();
        setDatasets(ds);
        if (ds.length > 0 && !selectedDataset) {
          setSelectedDataset(ds[0].id);
        }
      } catch (err) {
        console.error('Failed to load datasets:', err);
      }
    };
    loadDatasets();
  }, []);

  useEffect(() => {
    const loadTextDbs = async () => {
      try {
        const res = await listTextDbs();
        setTextDbs(res.dbs.map(d => ({ name: d.name, path: d.path })));
        const activePath = res.active?.activeDbPath || null;
        setActiveTextDbState(activePath);
      } catch (err) {
        console.warn('Failed to load text DBs:', err);
      }
    };
    loadTextDbs();
  }, []);


  useEffect(() => {
    if (!selectedDataset) {
      setDatasetInfo(null);
      return;
    }
    
    const loadInfo = async () => {
      try {
        const info = await getDatasetSummary(selectedDataset);
        setDatasetInfo({
          testCaseCount: info.testCaseCount,
          categories: info.categories,
        });
      } catch (err) {
        console.error('Failed to load dataset info:', err);
      }
    };
    loadInfo();
  }, [selectedDataset]);

  useEffect(() => {
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, []);

  const startPolling = (evalId: string) => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
    }

    pollInterval.current = setInterval(async () => {
      try {
        const evalStatus = await getEvaluationStatus(evalId);
        setStatus(evalStatus);

        if (evalStatus.status === 'completed' || evalStatus.status === 'failed' || evalStatus.status === 'cancelled') {
          if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
          }
          localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
          setRunningEvalId(null);
        }
      } catch (err) {
        console.error('Failed to get status:', err);
      }
    }, 1000);
  };

  // Resume polling if a run is in progress and user navigates away/back.
  useEffect(() => {
    const storedId = localStorage.getItem(RUNNING_EVAL_STORAGE_KEY);
    if (!storedId) return;
    if (runningEvalId) return;

    (async () => {
      try {
        const evalStatus = await getEvaluationStatus(storedId);
        setRunningEvalId(storedId);
        setStatus(evalStatus);
        if (evalStatus.status === 'running' || evalStatus.status === 'pending') {
          startPolling(storedId);
        } else {
          localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
        }
      } catch {
        // If the server no longer knows this ID, clear it.
        localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (!selectedDataset) return;
    
    setError(null);
    
    try {
      const result = await startEvaluation(selectedDataset, config);
      setRunningEvalId(result.id);
      localStorage.setItem(RUNNING_EVAL_STORAGE_KEY, result.id);
      setStatus({
        id: result.id,
        status: 'pending',
        progress: { completed: 0, total: result.totalQueries },
        startedAt: new Date().toISOString(),
      });
      startPolling(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start evaluation');
    }
  };

  const handleSetActiveTextDb = async (name: string) => {
    try {
      await setActiveTextDb(name);
      const res = await listTextDbs();
      setActiveTextDbState(res.active?.activeDbPath || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set active DB');
    }
  };


  const handleCancel = async () => {
    if (!runningEvalId) return;
    
    try {
      await cancelEvaluation(runningEvalId);
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
      localStorage.removeItem(RUNNING_EVAL_STORAGE_KEY);
      setRunningEvalId(null);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const toggleKValue = (k: number) => {
    setConfig(prev => ({
      ...prev,
      kValues: prev.kValues.includes(k)
        ? prev.kValues.filter(v => v !== k)
        : [...prev.kValues, k].sort((a, b) => a - b),
    }));
  };

  const isRunning = status?.status === 'running' || status?.status === 'pending';
  const progress = status ? (status.progress.completed / status.progress.total) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero / Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-4">
          Start New Evaluation
        </h1>
        <p className="text-zinc-500 max-w-lg mx-auto">
          Configure and launch a comprehensive evaluation of your RAG pipeline against curated test datasets.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Col: Dataset & Config */}
        <div className="md:col-span-2 space-y-6">
          {/* Dataset Section */}
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Database size={20} />
              </div>
              <h3 className="text-lg font-semibold text-white">Select Dataset</h3>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {datasets.map(ds => (
                <button
                  key={ds.id}
                  onClick={() => setSelectedDataset(ds.id)}
                  disabled={isRunning}
                  className={`relative p-4 rounded-xl border text-left transition-all duration-300 group ${
                    selectedDataset === ds.id
                      ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                      : 'border-zinc-800 bg-black/20 hover:border-zinc-700 hover:bg-zinc-900'
                  } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <p className={`font-medium ${selectedDataset === ds.id ? 'text-white' : 'text-zinc-300'}`}>
                    {ds.name}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">
                    {ds.category}
                  </p>
                  
                  {selectedDataset === ds.id && (
                    <div className="absolute top-4 right-4 text-indigo-500">
                      <CheckCircle2 size={16} />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {datasetInfo && (
              <div className="mt-6 flex items-center gap-6 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">Test Cases</p>
                  <p className="text-xl font-mono text-white">{datasetInfo.testCaseCount}</p>
                </div>
                <div className="w-px h-8 bg-zinc-800" />
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">Est. Queries</p>
                  <p className="text-xl font-mono text-white">{datasetInfo.testCaseCount * config.kValues.length}</p>
                </div>
              </div>
            )}
          </div>

          {/* Config Section */}
          <div className="glass-panel rounded-2xl p-6">
             <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Sliders size={20} />
              </div>
              <h3 className="text-lg font-semibold text-white">Parameters</h3>
            </div>

            <div className="space-y-6">
              {/* K Values */}
              <div>
                <label className="text-sm text-zinc-400 mb-3 block">Retrieval Depth (K)</label>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 20, 25, 30].map(k => (
                    <button
                      key={k}
                      onClick={() => toggleKValue(k)}
                      disabled={isRunning}
                      className={`px-4 py-2 rounded-lg font-mono text-sm transition-all border ${
                        config.kValues.includes(k)
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                          : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      K={k}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-zinc-800" />

              {/* Toggles */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50 hover:border-zinc-700 transition-colors">
                    <span className="text-sm text-zinc-300">Integration Mode</span>
                    <select
                      value={config.integrationMode}
                      onChange={(e) => setConfig(prev => ({ ...prev, integrationMode: e.target.value as EvaluationConfig['integrationMode'] }))}
                      disabled={isRunning}
                      className="text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                      <option value="api">api (HTTP)</option>
                      <option value="direct">direct (frc-rag python)</option>
                      <option value="text">text (local chroma)</option>
                    </select>
                  </label>
                  <div className="px-3 pb-2 text-xs text-zinc-500 space-y-1">
                    {config.integrationMode === 'api' && (
                      <div>
                        <span className="text-zinc-400 font-medium">api:</span> Queries FRC-RAG backend via HTTP API. Requires running server at <code className="text-zinc-400">FRC_RAG_API_URL</code>.
                      </div>
                    )}
                    {config.integrationMode === 'direct' && (
                      <div>
                        <span className="text-zinc-400 font-medium">direct:</span> Calls FRC-RAG Python code directly via Bun.spawn. No server needed, but requires <code className="text-zinc-400">FRC_RAG_BACKEND_PATH</code>.
                      </div>
                    )}
                    {config.integrationMode === 'text' && (
                      <div>
                        <span className="text-zinc-400 font-medium">text:</span> Queries local Chroma DB directly (text-only, no images). Uses active DB from <span className="text-zinc-300">Text DBs</span> page. Fastest for rapid iteration.
                      </div>
                    )}
                  </div>
                </div>

                {config.integrationMode === 'text' && (
                  <div className="space-y-3 p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-zinc-300">Active Text DB</span>
                      <span className="text-xs font-mono text-zinc-500 truncate max-w-[220px]">
                        {activeTextDb ? textDbs.find(db => db.path === activeTextDb)?.name || 'unknown' : 'none'}
                      </span>
                    </div>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-500">Select DB</span>
                      <select
                        disabled={isRunning}
                        value={textDbs.find(db => db.path === activeTextDb)?.name || ''}
                        onChange={(e) => handleSetActiveTextDb(e.target.value)}
                        className="flex-1 text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      >
                        <option value="" disabled>Select a DB</option>
                        {textDbs.map(db => (
                          <option key={db.name} value={db.name}>{db.name}</option>
                        ))}
                      </select>
                    </label>

                    {textDbs.length === 0 && (
                      <div className="text-xs text-zinc-500 p-2 bg-zinc-900/30 rounded-lg">
                        No databases available. Create one in the <span className="text-zinc-300 font-medium">Text DBs</span> page.
                      </div>
                    )}

                    <div className="h-px bg-zinc-800/70" />

                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Target docs after filter</span>
                      <input
                        type="number"
                        value={config.queryOptions?.targetDocs ?? 8}
                        onChange={(e) => setConfig(prev => ({ ...prev, queryOptions: { ...prev.queryOptions, targetDocs: parseInt(e.target.value || '0', 10) } }))}
                        disabled={isRunning}
                        className="w-24 text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Include image-typed chunks</span>
                      <input
                        type="checkbox"
                        checked={config.queryOptions?.includeImageTypes ?? false}
                        onChange={(e) => setConfig(prev => ({ ...prev, queryOptions: { ...prev.queryOptions, includeImageTypes: e.target.checked } }))}
                        disabled={isRunning}
                        className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Cache query results</span>
                      <input
                        type="checkbox"
                        checked={config.queryOptions?.enableCache ?? true}
                        onChange={(e) => setConfig(prev => ({ ...prev, queryOptions: { ...prev.queryOptions, enableCache: e.target.checked } }))}
                        disabled={isRunning}
                        className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Structured query (LLM → filter)</span>
                      <input
                        type="checkbox"
                        checked={config.queryOptions?.enableStructuredQuery ?? false}
                        onChange={(e) => setConfig(prev => ({ ...prev, queryOptions: { ...prev.queryOptions, enableStructuredQuery: e.target.checked } }))}
                        disabled={isRunning}
                        className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500"
                      />
                    </label>
                  </div>
                )}
                
                {/* Module System Configuration */}
                {config.integrationMode === 'text' && (
                  <ModulesConfig
                    moduleConfig={config.moduleConfig || {}}
                    onModuleConfigChange={(moduleConfig) => setConfig(prev => ({ ...prev, moduleConfig }))}
                    searchType={config.searchType || 'vector'}
                    onSearchTypeChange={(searchType) => setConfig(prev => ({ 
                      ...prev, 
                      searchType,
                      // Sync with legacy queryOptions for backwards compatibility
                      queryOptions: { ...prev.queryOptions, retrievalMethod: searchType as any }
                    }))}
                    searchVariant={config.searchVariant}
                    onSearchVariantChange={(searchVariant) => setConfig(prev => ({ 
                      ...prev, 
                      searchVariant,
                      queryOptions: { ...prev.queryOptions, bm25Variant: searchVariant as any }
                    }))}
                    disabled={isRunning}
                  />
                )}

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50 cursor-pointer hover:border-zinc-700 transition-colors">
                  <span className="text-sm text-zinc-300">Enable Generation Metrics (LLM Judge)</span>
                  <input
                    type="checkbox"
                    checked={config.enableGenerationMetrics}
                    onChange={e => setConfig(prev => ({ ...prev, enableGenerationMetrics: e.target.checked }))}
                    disabled={isRunning}
                    className="w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/20"
                  />
                </label>
                 <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50 cursor-pointer hover:border-zinc-700 transition-colors">
                  <span className="text-sm text-zinc-300">Enable Image Retrieval Metrics</span>
                  <input
                    type="checkbox"
                    checked={config.enableImageMetrics}
                    onChange={e => setConfig(prev => ({ ...prev, enableImageMetrics: e.target.checked }))}
                    disabled={isRunning}
                    className="w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/20"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Action & Status */}
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 sticky top-24">
            <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>
            
            <div className="space-y-4 mb-8">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Target Dataset</span>
                <span className="text-white font-medium truncate max-w-[150px]">
                  {datasets.find(d => d.id === selectedDataset)?.name || '-'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Configs</span>
                <span className="text-white font-medium">{config.kValues.length} depths</span>
              </div>
               <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Mode</span>
                <span className="text-indigo-400 font-medium uppercase text-xs border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 rounded">
                  {config.integrationMode}
                </span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-sm text-red-400">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={!selectedDataset || config.kValues.length === 0}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
              >
                <Play size={20} className="fill-white" />
                Start Evaluation
              </button>
            ) : (
               <button
                onClick={handleCancel}
                className="w-full py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold border border-zinc-700 transition-all flex items-center justify-center gap-2"
              >
                <Square size={20} className="fill-white" />
                Cancel Run
              </button>
            )}

            {/* Progress Status */}
            {status && isRunning && (
              <div className="mt-6 pt-6 border-t border-white/5 animate-fadeIn">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-indigo-400 font-medium">Processing...</span>
                  <span className="text-xs font-mono text-zinc-400">
                    {Math.round(progress)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300 relative overflow-hidden" 
                    style={{ width: `${progress}%` }}
                  >
                     <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]" />
                  </div>
                </div>
                <p className="text-xs text-center text-zinc-500 mt-2">
                  {status.progress.completed} / {status.progress.total} queries
                </p>
              </div>
            )}
            
            {status?.status === 'completed' && (
              <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex flex-col items-center gap-2 text-emerald-400 animate-fadeIn">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 size={24} />
                </div>
                <p className="font-medium">Complete</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
