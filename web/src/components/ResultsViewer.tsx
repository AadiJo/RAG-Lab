import { useState, useEffect } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Download,
  Copy,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
  Search,
  ArrowRight,
  Sparkles,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { listResults, getResult, getRunSuggestion, type EvaluationResultSummary, type EvaluationResult } from '../lib/api';

const EVAL_DRAFT_STORAGE_KEY = 'rag-lab.evalDraft';

type SuggestionSection =
  | 'Diagnosis'
  | 'EvaluationConfig patch'
  | 'What this changes in our query processor'
  | 'Why these settings help';

function normLine(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ');
}

function canonicalSectionTitle(line: string): SuggestionSection | null {
  const t = normLine(line).replace(/:$/, '').toLowerCase();
  const candidates: Array<[SuggestionSection, string[]]> = [
    ['Diagnosis', ['diagnosis']],
    ['EvaluationConfig patch', ['evaluationconfig patch', 'evaluation config patch', 'evaluationconfig patch (copy/paste)', 'evaluationconfig patch (copy paste)', 'evaluationconfig patch copy/paste']],
    ['What this changes in our query processor', ['what this changes in our query processor', 'what this changes']],
    ['Why these settings help', ['why these settings help', 'why this helps', 'why these help']],
  ];
  for (const [canonical, alts] of candidates) {
    if (alts.includes(t)) return canonical;
  }
  return null;
}

function isFence(line: string): boolean {
  return line.trim().startsWith('```');
}

function isListish(line: string): boolean {
  const t = line.trim();
  return /^([-*+]|(\d+[\.\)]))\s+/.test(t);
}

function tryExtractJsonBlock(lines: string[], startIdx: number): { jsonLines: string[]; endIdx: number } | null {
  let i = startIdx;
  while (i < lines.length && (lines[i] ?? '').trim().length === 0) i++;
  if (i >= lines.length) return null;
  if (isFence(lines[i] ?? '')) return null;
  if (!((lines[i] ?? '').trim().startsWith('{'))) return null;

  const out: string[] = [];
  let depth = 0;
  let started = false;

  for (let j = i; j < lines.length; j++) {
    const ln = lines[j] ?? '';
    out.push(ln);
    for (const ch of ln) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (started && depth <= 0) return { jsonLines: out, endIdx: j };
  }
  return null;
}

function formatSuggestionMarkdownForDisplay(md: string): string {
  const input = (md || '').replace(/\r\n/g, '\n').trim();
  if (!input) return '';

  // Log what frontend receives from API
  console.log('=== FRONTEND: Received from API (before frontend formatting) ===');
  console.log(input);
  console.log('=== END FRONTEND INPUT ===\n');

  const rawLines = input.split('\n');
  const out: string[] = [];
  let inCodeFence = false;
  let currentSection: SuggestionSection | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i] ?? '';

    if (isFence(line)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }

    if (!inCodeFence) {
      const section = canonicalSectionTitle(line);
      if (section) {
        if (out.length > 0 && (out[out.length - 1] ?? '').trim() !== '') out.push('');
        out.push(`## ${section}`);
        out.push('');
        currentSection = section;
        continue;
      }

      if (currentSection === 'EvaluationConfig patch') {
        const extracted = tryExtractJsonBlock(rawLines, i);
        if (extracted) {
          if (out.length > 0 && (out[out.length - 1] ?? '').trim() !== '') out.push('');
          out.push('```json');
          out.push(...extracted.jsonLines);
          out.push('```');
          out.push('');
          i = extracted.endIdx;
          continue;
        }
      }

      if (
        (currentSection === 'What this changes in our query processor' || currentSection === 'Why these settings help') &&
        line.trim() !== '' &&
        !isListish(line) &&
        !/^##\s+/.test(line.trim())
      ) {
        line = `- ${line.trim()}`;
      }
    }

    out.push(line);
  }

  const formatted = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  
  // Log what frontend outputs after formatting
  console.log('=== FRONTEND: After formatting (what ReactMarkdown will render) ===');
  console.log(formatted);
  console.log('=== END FRONTEND OUTPUT ===\n');
  
  return formatted;
}

function extractPatchObjectFromSuggestion(md: string): Record<string, any> | null {
  const formatted = formatSuggestionMarkdownForDisplay(md);
  const fenceRe = /```json\s*([\s\S]*?)```/i;
  const m = formatted.match(fenceRe);
  if (m && m[1]) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // fallthrough
    }
  }

  // Fallback: brace-balance from first '{'
  const lines = formatted.split('\n');
  const start = lines.findIndex(l => l.trim().startsWith('{'));
  if (start >= 0) {
    const extracted = tryExtractJsonBlock(lines, start);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted.jsonLines.join('\n'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function deepMerge(base: any, patch: any): any {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return patch.slice();
  if (typeof patch !== 'object') return patch;
  const out: any = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = deepMerge(out[k], v);
  }
  return out;
}

function getMetricClass(value: number): string {
  if (value >= 0.8) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (value >= 0.6) return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  if (value >= 0.4) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function ResultsViewer() {
  const [results, setResults] = useState<EvaluationResultSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<EvaluationResult | null>(null);
  const [suggestionById, setSuggestionById] = useState<Record<string, { status: 'idle'|'loading'|'ready'|'error'; content?: string; error?: string; model?: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadResults = async () => {
      try {
        const { results: r } = await listResults();
        setResults(r);
      } catch (error) {
        console.error('Failed to load results:', error);
      } finally {
        setLoading(false);
      }
    };
    loadResults();
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedResult(null);
      return;
    }

    setExpandedId(id);
    try {
      const result = await getResult(id);
      setExpandedResult(result);
      // Only fetch suggestion if we don't already have it in memory.
      if (!suggestionById[id] || suggestionById[id]?.status === 'error') {
        setSuggestionById(prev => ({ ...prev, [id]: { status: 'loading' } }));
        try {
          const s = await getRunSuggestion(id);
          if ((s as any).status === 'generating') {
            setSuggestionById(prev => ({ ...prev, [id]: { status: 'loading' } }));
          } else if ((s as any).error) {
            setSuggestionById(prev => ({ ...prev, [id]: { status: 'error', error: (s as any).error } }));
          } else {
            setSuggestionById(prev => ({ ...prev, [id]: { status: 'ready', content: (s as any).content, model: (s as any).model } }));
          }
        } catch (e) {
          setSuggestionById(prev => ({ ...prev, [id]: { status: 'error', error: e instanceof Error ? e.message : 'Failed to load suggestion' } }));
        }
      }
    } catch (error) {
      console.error('Failed to load result:', error);
    }
  };

  const handleRegenerateSuggestion = async (id: string) => {
    setSuggestionById(prev => ({ ...prev, [id]: { status: 'loading' } }));
    try {
      const s = await getRunSuggestion(id, { force: true });
      if ((s as any).status === 'generating') {
        // We'll poll below when expanded.
        setSuggestionById(prev => ({ ...prev, [id]: { status: 'loading' } }));
      } else if ((s as any).error) {
        setSuggestionById(prev => ({ ...prev, [id]: { status: 'error', error: (s as any).error } }));
      } else {
        setSuggestionById(prev => ({ ...prev, [id]: { status: 'ready', content: (s as any).content, model: (s as any).model } }));
      }
    } catch (e) {
      setSuggestionById(prev => ({ ...prev, [id]: { status: 'error', error: e instanceof Error ? e.message : 'Failed to regenerate suggestion' } }));
    }
  };

  // Poll suggestion while expanded & loading (server returns 202 while generating)
  useEffect(() => {
    if (!expandedId) return;
    const st = suggestionById[expandedId]?.status;
    if (st !== 'loading') return;

    const t = setInterval(async () => {
      try {
        const s = await getRunSuggestion(expandedId);
        if ((s as any).status === 'generating') return;
        if ((s as any).error) {
          setSuggestionById(prev => ({ ...prev, [expandedId]: { status: 'error', error: (s as any).error } }));
          return;
        }
        setSuggestionById(prev => ({ ...prev, [expandedId]: { status: 'ready', content: (s as any).content, model: (s as any).model } }));
      } catch {
        // ignore transient
      }
    }, 1200);

    return () => clearInterval(t);
  }, [expandedId, suggestionById]);

  const handleCopySettings = (result: EvaluationResult) => {
    try {
      const payload = {
        datasetId: (result as any).datasetId,
        config: (result as any).config,
      };
      localStorage.setItem(EVAL_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('rag-lab:navigate', { detail: { view: 'evaluate' } }));
    } catch {
      // ignore
    }
  };

  const handleApplySuggestionPatch = (result: EvaluationResult) => {
    try {
      const raw = suggestionById[result.id]?.content || '';
      const patch = extractPatchObjectFromSuggestion(raw);
      if (!patch) {
        alert('Could not find a valid JSON patch in the AI suggestion.');
        return;
      }
      const merged = deepMerge((result as any).config || {}, patch);
      const payload = {
        datasetId: (result as any).datasetId,
        config: merged,
      };
      localStorage.setItem(EVAL_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('rag-lab:navigate', { detail: { view: 'evaluate' } }));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to apply suggestion patch');
    }
  };

  const handleExport = (result: EvaluationResult) => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Prepare chart data for expanded result
  const chartData = expandedResult
    ? Object.entries(expandedResult.aggregateMetrics)
        .map(([k, metrics]) => ({
          k: `K=${k}`,
          precision: (metrics.retrieval.avgPrecision * 100),
          recall: (metrics.retrieval.avgRecall * 100),
          f1: (metrics.retrieval.avgF1 * 100),
          mrr: (metrics.retrieval.avgMRR * 100),
          ndcg: (metrics.retrieval.avgNDCG * 100),
        }))
        .sort((a, b) => parseInt(a.k.slice(2)) - parseInt(b.k.slice(2)))
    : [];

  const generationRows = expandedResult?.results
    ?.filter(r => r.metrics?.generation && !r.error)
    .map(r => ({
      id: r.testCaseId,
      query: r.query,
      faithfulness: r.metrics.generation!.faithfulness,
      relevancy: r.metrics.generation!.answerRelevancy,
      correctness: r.metrics.generation!.answerCorrectness,
      details: r.metrics.generation!.judgmentDetails,
    })) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Run History</h2>
          <p className="text-zinc-500">Archive of all past evaluation sessions</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
          <input 
            type="text" 
            placeholder="Search runs..." 
            className="pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-300 focus:outline-none focus:border-indigo-500/50 transition-colors w-64"
          />
        </div>
      </div>

      {results.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center border-dashed border-2 border-zinc-800">
          <div className="w-16 h-16 rounded-full bg-zinc-900 mx-auto flex items-center justify-center mb-4">
            <Clock size={32} className="text-zinc-600" />
          </div>
          <p className="text-zinc-500">No evaluation results found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((result) => (
            <div 
              key={result.id} 
              className={`glass-panel rounded-xl transition-all duration-300 overflow-hidden ${
                expandedId === result.id ? 'border-indigo-500/30 ring-1 ring-indigo-500/10' : 'hover:border-zinc-700'
              }`}
            >
              {/* Summary Row */}
              <button
                onClick={() => handleExpand(result.id)}
                className="w-full p-4 flex items-center gap-6 hover:bg-white/5 transition-colors"
              >
                <div className={`p-2 rounded-lg ${
                  result.summary.failedQueries === 0 
                    ? 'bg-emerald-500/10 text-emerald-500' 
                    : 'bg-amber-500/10 text-amber-500'
                }`}>
                  {result.summary.failedQueries === 0 ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                </div>

                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-zinc-200">{result.datasetName}</h3>
                  <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500 font-mono">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={12} />
                      {new Date(result.startedAt).toLocaleDateString()}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} />
                      {new Date(result.startedAt).toLocaleTimeString()}
                    </span>
                    <span>ID: {result.id.slice(0, 8)}...</span>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-sm">
                  {result.headline && (
                    <div className="hidden lg:flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/40 text-zinc-400 font-mono">
                        K={result.headline.k}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getMetricClass(result.headline.retrieval.avgF1)}`}>
                        F1 {(result.headline.retrieval.avgF1 * 100).toFixed(0)}%
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getMetricClass(result.headline.retrieval.avgMRR)}`}>
                        MRR {(result.headline.retrieval.avgMRR * 100).toFixed(0)}%
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getMetricClass(result.headline.retrieval.avgNDCG)}`}>
                        NDCG {(result.headline.retrieval.avgNDCG * 100).toFixed(0)}%
                      </span>
                      {result.headline.generation && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getMetricClass(result.headline.generation.avgFaithfulness)}`}>
                          Faith {(result.headline.generation.avgFaithfulness * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">Duration</p>
                    <p className="font-mono text-zinc-300">{formatDuration(result.summary.totalDurationMs)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">Success</p>
                    <p className="font-mono text-zinc-300">
                      {result.summary.successfulQueries}/{result.summary.totalQueries}
                    </p>
                  </div>
                  <div className={`transition-transform duration-300 ${expandedId === result.id ? 'rotate-180' : ''}`}>
                    <ChevronDown size={20} className="text-zinc-600" />
                  </div>
                </div>
              </button>

              {/* Expanded Details */}
              {expandedId === result.id && expandedResult && (
                <div className="border-t border-zinc-800 bg-black/20 animate-fadeIn">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="font-semibold text-white">Detailed Metrics</h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopySettings(expandedResult);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors"
                          title="Copy settings to a new evaluation"
                        >
                          <Copy size={14} />
                          Copy settings
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExport(expandedResult);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors"
                        >
                          <Download size={14} />
                          Export JSON
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Chart */}
                      <div className="lg:col-span-2 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                              <XAxis dataKey="k" stroke="#71717a" fontSize={12} axisLine={false} tickLine={false} dy={10} />
                              <YAxis stroke="#71717a" fontSize={12} domain={[0, 100]} axisLine={false} tickLine={false} dx={-10} />
                              <Tooltip
                                contentStyle={{
                                  background: '#18181b',
                                  border: '1px solid #27272a',
                                  borderRadius: '8px',
                                  color: '#fafafa'
                                }}
                              />
                              <Legend />
                              <Line type="monotone" dataKey="precision" name="Precision" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                              <Line type="monotone" dataKey="recall" name="Recall" stroke="#10b981" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="mrr" name="MRR" stroke="#f59e0b" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Config & Meta */}
                      <div className="space-y-4">
                        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                          <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Configuration</h5>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-zinc-400">Mode</span>
                              <span className="text-white">{expandedResult.config.integrationMode}</span>
                            </div>
                             <div className="flex justify-between">
                              <span className="text-zinc-400">Image Metrics</span>
                              <span className="text-white">{expandedResult.config.enableImageMetrics ? 'Yes' : 'No'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-400">LLM Metrics</span>
                              <span className="text-white">{expandedResult.config.enableGenerationMetrics ? 'Yes' : 'No'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
                           <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Top Performer</h5>
                           <div className="text-center">
                              <div className="text-2xl font-bold text-white mb-1">K=10</div>
                              <div className="text-xs text-zinc-500">Best balance of Precision/Recall</div>
                           </div>
                        </div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-800">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-900/80 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                          <tr>
                            <th className="px-4 py-3 text-left">Depth</th>
                            <th className="px-4 py-3 text-left">Precision</th>
                            <th className="px-4 py-3 text-left">Recall</th>
                            <th className="px-4 py-3 text-left">F1</th>
                            <th className="px-4 py-3 text-left">MRR</th>
                            <th className="px-4 py-3 text-left">NDCG</th>
                            <th className="px-4 py-3 text-right">Avg Latency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800 bg-zinc-900/20">
                          {Object.entries(expandedResult.aggregateMetrics)
                            .sort(([a], [b]) => parseInt(a) - parseInt(b))
                            .map(([k, metrics]) => (
                              <tr key={k} className="hover:bg-white/5 transition-colors">
                                <td className="px-4 py-3 font-mono text-zinc-300">K={k}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getMetricClass(metrics.retrieval.avgPrecision)}`}>
                                    {(metrics.retrieval.avgPrecision * 100).toFixed(1)}%
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-300">{(metrics.retrieval.avgRecall * 100).toFixed(1)}%</td>
                                <td className="px-4 py-3 text-zinc-300">{(metrics.retrieval.avgF1 * 100).toFixed(1)}%</td>
                                <td className="px-4 py-3 text-zinc-300">{(metrics.retrieval.avgMRR * 100).toFixed(1)}%</td>
                                <td className="px-4 py-3 text-zinc-300">{(metrics.retrieval.avgNDCG * 100).toFixed(1)}%</td>
                                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                                  {formatDuration(metrics.performance.avgTotalTimeMs)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {generationRows.length > 0 && (
                      <div className="mt-6">
                        <details className="rounded-xl border border-zinc-800 bg-zinc-900/20 overflow-hidden">
                          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-200 flex items-center justify-between">
                            <span>LLM Judge reasoning (per query)</span>
                            <span className="text-xs text-zinc-500 font-mono">{generationRows.length} judged</span>
                          </summary>
                          <div className="p-4 space-y-3">
                            {generationRows.slice(0, 25).map((row, idx) => (
                              <details key={`${row.id}_${idx}`} className="rounded-lg border border-zinc-800 bg-black/20">
                                <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-200 flex items-center justify-between">
                                  <span className="truncate max-w-[70%]">{row.query}</span>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    F {Math.round(row.faithfulness * 100)} • R {Math.round(row.relevancy * 100)} • C {row.correctness === undefined ? '—' : Math.round(row.correctness * 100)}
                                  </span>
                                </summary>
                                <div className="p-3 text-xs text-zinc-400 space-y-2">
                                  {row.details?.faithfulnessReasoning && (
                                    <div>
                                      <div className="text-zinc-300 font-semibold">Faithfulness reasoning</div>
                                      <div className="whitespace-pre-wrap">{row.details.faithfulnessReasoning}</div>
                                    </div>
                                  )}
                                  {row.details?.relevancyReasoning && (
                                    <div>
                                      <div className="text-zinc-300 font-semibold">Relevancy reasoning</div>
                                      <div className="whitespace-pre-wrap">{row.details.relevancyReasoning}</div>
                                    </div>
                                  )}
                                  {row.details?.correctnessReasoning && (
                                    <div>
                                      <div className="text-zinc-300 font-semibold">Correctness reasoning</div>
                                      <div className="whitespace-pre-wrap">{row.details.correctnessReasoning}</div>
                                    </div>
                                  )}
                                </div>
                              </details>
                            ))}
                            {generationRows.length > 25 && (
                              <div className="text-xs text-zinc-500">
                                Showing first 25. Export JSON to view all reasonings.
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    )}

                    {expandedId === result.id && (
                      <div className="mt-6">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 overflow-hidden">
                          <div className="px-4 py-3 flex items-center justify-between">
                            <div className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                              <Sparkles size={16} className="text-indigo-400" />
                              AI suggested course of action
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleRegenerateSuggestion(result.id)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
                                disabled={suggestionById[result.id]?.status === 'loading'}
                                title="Regenerate suggestion"
                              >
                                <RefreshCw size={14} className={suggestionById[result.id]?.status === 'loading' ? 'animate-spin' : ''} />
                              </button>
                              <button
                                onClick={() => handleApplySuggestionPatch(expandedResult)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200"
                                disabled={suggestionById[result.id]?.status !== 'ready' || !extractPatchObjectFromSuggestion(suggestionById[result.id]?.content || '')}
                                title="Apply AI patch to a new evaluation"
                              >
                                <ArrowRight size={14} />
                              </button>
                              <div className="text-xs text-zinc-500 font-mono">
                                {suggestionById[result.id]?.model ? `model: ${suggestionById[result.id].model}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="p-4 text-sm text-zinc-300">
                            {suggestionById[result.id]?.status === 'loading' && (
                              <div className="flex items-center gap-2 text-zinc-400">
                                <Loader2 size={16} className="animate-spin" />
                                <span className="animate-pulse">Generating…</span>
                              </div>
                            )}
                            {suggestionById[result.id]?.status === 'error' && (
                              <span className="text-red-400">{suggestionById[result.id]?.error || 'Failed to generate suggestion'}</span>
                            )}
                            {suggestionById[result.id]?.status === 'ready' && (
                              <div className="markdown-content">
                                <ReactMarkdown 
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    h2: ({node, ...props}) => (
                                      <h2 className="text-lg font-bold text-white mt-6 mb-3 first:mt-0" {...props} />
                                    ),
                                    p: ({node, ...props}) => (
                                      <p className="my-4 text-zinc-300" {...props} />
                                    ),
                                    ul: ({node, ...props}) => (
                                      <ul className="my-4 ml-6 list-disc space-y-2 text-zinc-300" {...props} />
                                    ),
                                    ol: ({node, ...props}) => (
                                      <ol className="my-4 ml-6 list-decimal space-y-2 text-zinc-300" {...props} />
                                    ),
                                    li: ({node, ...props}) => (
                                      <li className="my-2" {...props} />
                                    ),
                                    code: ({node, inline, ...props}: any) => {
                                      if (inline) {
                                        return <code className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-200 text-sm font-mono" {...props} />;
                                      }
                                      return <code {...props} />;
                                    },
                                    pre: ({node, ...props}) => (
                                      <pre className="my-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800 overflow-x-auto" {...props} />
                                    ),
                                  }}
                                >
                                  {formatSuggestionMarkdownForDisplay(suggestionById[result.id]?.content || '')}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
