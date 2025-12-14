import { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Play, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  HardDrive,
  Settings,
  Info,
  FolderOpen,
  ChevronUp,
  FileText
} from 'lucide-react';
import { 
  listTextDbs,
  setActiveTextDb,
  startTextDbBuild,
  getTextDbBuild,
  getDocumentProcessors,
  browseTextDbDirectories,
  type TextDbEntry,
  type ModuleManifest
} from '../lib/api';

export default function TextDbsView() {
  const [dbs, setDbs] = useState<TextDbEntry[]>([]);
  const [activeDbPath, setActiveDbPath] = useState<string | null>(null);
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<any>(null);
  const [showBuildForm, setShowBuildForm] = useState(false);
  const [documentProcessors, setDocumentProcessors] = useState<ModuleManifest[]>([]);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [dirPicker, setDirPicker] = useState<{
    root: string;
    path: string;
    parent: string | null;
    directories: Array<{ name: string; path: string; type?: 'directory' }>;
    files?: Array<{ name: string; path: string; type?: 'file' }>;
    defaultPdfInputDir: string;
  } | null>(null);
  const [dirPickerLoading, setDirPickerLoading] = useState(false);
  const [dirPickerError, setDirPickerError] = useState<string | null>(null);
  const [buildForm, setBuildForm] = useState({
    name: `textdb_${new Date().toISOString().slice(0, 10)}_${Date.now().toString(36).slice(-6)}`,
    inputDir: 'data/pdfs',
    representation: 'raw' as 'raw' | 'structured',
    chunkSize: 800,
    chunkOverlap: 200,
    embeddingModel: 'BAAI/bge-large-en-v1.5',
    embeddingDevice: 'cpu',
    includeFilenameBanner: true,
    setActive: true,
  });

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDirPicker = async (path?: string) => {
    setDirPickerLoading(true);
    setDirPickerError(null);
    try {
      const res = await browseTextDbDirectories(path);
      setDirPicker(res);
    } catch (e: any) {
      setDirPickerError(e?.message || 'Failed to browse directories');
    } finally {
      setDirPickerLoading(false);
    }
  };

  useEffect(() => {
    loadDbs();
    loadDocumentProcessors();
  }, []);

  const loadDocumentProcessors = async () => {
    try {
      const res = await getDocumentProcessors();
      setDocumentProcessors(res.documentProcessors || []);
    } catch (err) {
      console.error('Failed to load document processors:', err);
    }
  };

  const toggleModule = (moduleId: string) => {
    setEnabledModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!buildJobId) return;
    
    const t = setInterval(async () => {
      try {
        const status = await getTextDbBuild(buildJobId);
        setBuildStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(t);
          pollInterval.current = null;
          loadDbs();
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 1000);
    
    pollInterval.current = t;
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [buildJobId]);

  const loadDbs = async () => {
    try {
      const res = await listTextDbs();
      setDbs(res.dbs);
      setActiveDbPath(res.active?.activeDbPath || null);
    } catch (err) {
      console.error('Failed to load text DBs:', err);
    }
  };

  const handleSetActive = async (name: string) => {
    try {
      await setActiveTextDb(name);
      await loadDbs();
    } catch (err) {
      console.error('Failed to set active DB:', err);
    }
  };

  const handleStartBuild = async () => {
    try {
      const res = await startTextDbBuild({
        ...buildForm,
        enabledModules: Array.from(enabledModules),
        moduleConfigs: {}, // Could be extended to support per-module config
      });
      setBuildJobId(res.id);
      setBuildStatus({ status: 'running', progress: { current: 0, total: 0 } });
      setShowBuildForm(false);
    } catch (err) {
      console.error('Failed to start build:', err);
    }
  };

  const getProgressPercent = () => {
    if (!buildStatus?.progress) return 0;
    const { current, total } = buildStatus.progress;
    if (total === 0) return 0;
    return Math.round((current / total) * 100);
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-4">
            Text Databases
          </h1>
          <p className="text-zinc-500 max-w-2xl">
            Build and manage text-only Chroma databases for rapid retrieval testing. 
            Each DB variant can have different chunking, embedding, or representation settings.
          </p>
        </div>
        <button
          onClick={() => setShowBuildForm(!showBuildForm)}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-2"
        >
          <Database size={20} />
          {showBuildForm ? 'Cancel' : 'New Database'}
        </button>
      </div>

      {/* Build Form */}
      {showBuildForm && (
        <div className="glass-panel rounded-2xl p-6 space-y-6">
          <h3 className="text-xl font-semibold text-white flex items-center gap-2">
            <Settings size={20} />
            Build Configuration
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Database Name</span>
              <input
                type="text"
                value={buildForm.name}
                onChange={(e) => setBuildForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="my-text-db"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Input Directory (PDFs)</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={buildForm.inputDir}
                  onChange={(e) => setBuildForm(prev => ({ ...prev, inputDir: e.target.value }))}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setShowDirPicker(true);
                    await loadDirPicker(buildForm.inputDir || '');
                  }}
                  className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 text-zinc-200 transition-colors flex items-center gap-2"
                  title="Browse folders on the server filesystem"
                >
                  <FolderOpen size={16} />
                  Browse
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                Default: <span className="font-mono">data/pdfs</span> (relative to project root)
              </p>
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Representation</span>
              <select
                value={buildForm.representation}
                onChange={(e) => setBuildForm(prev => ({ ...prev, representation: e.target.value as 'raw' | 'structured' }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="raw">Raw (minimal processing)</option>
                <option value="structured">Structured (header/list detection)</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Embedding Model</span>
              <input
                type="text"
                value={buildForm.embeddingModel}
                onChange={(e) => setBuildForm(prev => ({ ...prev, embeddingModel: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Chunk Size</span>
              <input
                type="number"
                value={buildForm.chunkSize}
                onChange={(e) => setBuildForm(prev => ({ ...prev, chunkSize: parseInt(e.target.value || '0', 10) }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Chunk Overlap</span>
              <input
                type="number"
                value={buildForm.chunkOverlap}
                onChange={(e) => setBuildForm(prev => ({ ...prev, chunkOverlap: parseInt(e.target.value || '0', 10) }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Device</span>
              <select
                value={buildForm.embeddingDevice}
                onChange={(e) => setBuildForm(prev => ({ ...prev, embeddingDevice: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="cpu">CPU</option>
                <option value="cuda">CUDA (GPU)</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">After Build</span>
              <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 hover:border-zinc-700 transition-colors">
                <input
                  type="checkbox"
                  checked={buildForm.setActive}
                  onChange={(e) => setBuildForm(prev => ({ ...prev, setActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span className="text-sm text-zinc-300 select-none">Set Active After Build</span>
              </div>
            </label>
          </div>

          {/* Directory Picker Modal */}
          {showDirPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="glass-panel rounded-2xl w-full max-w-2xl border border-zinc-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">Select Input Directory</div>
                    <div className="text-xs text-zinc-500 truncate">
                      Browsing: <span className="font-mono">{dirPicker?.path || '...'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDirPicker(false)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 text-zinc-200 transition-colors"
                  >
                    Close
                  </button>
                </div>

                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!dirPicker?.parent || dirPickerLoading}
                      onClick={async () => {
                        if (dirPicker?.parent) await loadDirPicker(dirPicker.parent);
                      }}
                      className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 transition-colors flex items-center gap-2"
                      title="Go up one folder"
                    >
                      <ChevronUp size={16} />
                      Up
                    </button>
                    <div className="text-xs text-zinc-500">
                      Start: <span className="font-mono">{dirPicker?.root || '.'}</span>
                    </div>
                  </div>

                  {dirPickerError && (
                    <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-sm text-red-300">
                      {dirPickerError}
                    </div>
                  )}

                  <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-black/20">
                    {dirPickerLoading && (
                      <div className="p-4 text-sm text-zinc-400 flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-indigo-400" />
                        Loading folders…
                      </div>
                    )}
                    {!dirPickerLoading &&
                      (dirPicker?.directories?.length || 0) === 0 &&
                      (dirPicker?.files?.length || 0) === 0 && (
                        <div className="p-4 text-sm text-zinc-500">Empty directory.</div>
                      )}
                    {!dirPickerLoading && (
                      <div className="divide-y divide-zinc-800">
                        {dirPicker?.directories?.map((d) => (
                          <button
                            key={d.path}
                            type="button"
                            onClick={async () => {
                              await loadDirPicker(d.path);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-zinc-900/40 transition-colors flex items-center gap-2"
                          >
                            <FolderOpen size={16} className="text-zinc-400" />
                            <span className="text-sm text-zinc-200">{d.name}</span>
                            <span className="ml-auto text-xs font-mono text-zinc-500 truncate max-w-[50%]">
                              {d.path}
                            </span>
                          </button>
                        ))}
                        {dirPicker?.files?.map((f) => (
                          <div
                            key={f.path}
                            className="px-4 py-3 flex items-center gap-2 opacity-80"
                          >
                            <FileText size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-400">{f.name}</span>
                            <span className="ml-auto text-xs font-mono text-zinc-600 truncate max-w-[50%]">
                              {f.path}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-zinc-500">
                      Selecting sets the input directory relative to the project root.
                    </div>
                    <button
                      type="button"
                      disabled={!dirPicker?.path || dirPickerLoading}
                      onClick={() => {
                        if (dirPicker?.path) {
                          setBuildForm((prev) => ({ ...prev, inputDir: dirPicker.path }));
                        }
                        setShowDirPicker(false);
                      }}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Use This Folder
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Document Processors Section */}
          {documentProcessors.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Settings size={16} />
                Document Processors
              </h4>
              <p className="text-xs text-zinc-500">
                Enable modules to extract metadata or transform documents during ingestion.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {documentProcessors.map((mod) => (
                  <label
                    key={mod.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      enabledModules.has(mod.id)
                        ? 'bg-indigo-500/10 border-indigo-500/30'
                        : 'bg-zinc-900/30 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabledModules.has(mod.id)}
                      onChange={() => toggleModule(mod.id)}
                      className="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/30"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200">{mod.name}</div>
                      <div className="text-xs text-zinc-500 line-clamp-2">{mod.description}</div>
                      {mod.tags && mod.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {mod.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 text-xs rounded bg-zinc-800 text-zinc-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleStartBuild}
            disabled={!!buildJobId && buildStatus?.status === 'running'}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Play size={20} />
            Start Build
          </button>
        </div>
      )}

      {/* Active Build Status */}
      {buildJobId && buildStatus && (
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              {buildStatus.status === 'running' && <Loader2 size={20} className="animate-spin text-indigo-400" />}
              {buildStatus.status === 'completed' && <CheckCircle2 size={20} className="text-emerald-400" />}
              {buildStatus.status === 'failed' && <AlertCircle size={20} className="text-red-400" />}
              Build Status: {buildStatus.status}
            </h3>
            <span className="text-xs font-mono text-zinc-500">{buildJobId}</span>
          </div>

          {buildStatus.status === 'running' && buildStatus.progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Progress</span>
                <span className="text-zinc-300 font-medium">
                  {buildStatus.progress.current} / {buildStatus.progress.total} PDFs
                </span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full transition-all duration-300 relative overflow-hidden"
                  style={{ width: `${getProgressPercent()}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]" />
                </div>
              </div>
              {buildStatus.progress.message && (
                <p className="text-xs text-zinc-500">{buildStatus.progress.message}</p>
              )}
            </div>
          )}

          {buildStatus.status === 'completed' && buildStatus.config?.stats && (
            <div className="grid grid-cols-3 gap-4 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <div>
                <div className="text-xs text-zinc-500">PDFs Processed</div>
                <div className="text-lg font-semibold text-emerald-400">{buildStatus.config.stats.pdfCount}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Total Chunks</div>
                <div className="text-lg font-semibold text-emerald-400">{buildStatus.config.stats.chunks?.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Build Time</div>
                <div className="text-lg font-semibold text-emerald-400">
                  {buildStatus.config.stats.seconds ? formatDuration(buildStatus.config.stats.seconds) : 'N/A'}
                </div>
              </div>
            </div>
          )}

          {buildStatus.status === 'failed' && buildStatus.error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {buildStatus.error}
            </div>
          )}

          {buildStatus.logs && (
            <details className="mt-4">
              <summary className="text-sm text-zinc-400 cursor-pointer hover:text-zinc-300 mb-2">View Logs</summary>
              <pre className="max-h-60 overflow-auto bg-black/30 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 whitespace-pre-wrap">
                {buildStatus.logs}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Database List */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-white">Available Databases</h2>
        
        {dbs.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <HardDrive size={48} className="mx-auto mb-4 text-zinc-600" />
            <p className="text-zinc-400 mb-2">No databases yet</p>
            <p className="text-sm text-zinc-500">Create your first database to start evaluating text retrieval</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dbs.map((db) => {
              const isActive = activeDbPath === db.path;
              const stats = db.manifest?.stats;
              const config = db.manifest?.config;
              
              return (
                <div
                  key={db.name}
                  className={`glass-panel rounded-2xl p-6 border transition-all ${
                    isActive 
                      ? 'border-indigo-500/50 bg-indigo-500/5' 
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                        <Database size={18} />
                        {db.name}
                      </h3>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                          <CheckCircle2 size={12} />
                          Active
                        </span>
                      )}
                    </div>
                    {!isActive && (
                      <button
                        onClick={() => handleSetActive(db.name)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                      >
                        Set Active
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 text-sm">
                    {config && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-zinc-500">Chunk Size:</span>
                            <span className="text-zinc-300 ml-1">{config.chunk_size}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Overlap:</span>
                            <span className="text-zinc-300 ml-1">{config.chunk_overlap}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Representation:</span>
                            <span className="text-zinc-300 ml-1">{config.representation}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Model:</span>
                            <span className="text-zinc-300 ml-1 text-xs font-mono truncate">{config.embedding_model}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {stats && (
                      <div className="pt-3 border-t border-zinc-800 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-zinc-500">PDFs</div>
                          <div className="text-zinc-300 font-semibold">{stats.pdfCount}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Chunks</div>
                          <div className="text-zinc-300 font-semibold">{stats.chunks?.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Created</div>
                          <div className="text-zinc-300 font-semibold">
                            {db.manifest?.createdAt ? new Date(db.manifest.createdAt).toLocaleDateString() : 'N/A'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 text-xs text-zinc-500 font-mono truncate">
                      {db.path}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


