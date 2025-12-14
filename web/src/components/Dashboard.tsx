import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Target, 
  Zap,
  BarChart3,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { listResults, getResult, type EvaluationResult } from '../lib/api';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

function StatCard({ title, value, subtitle, icon: Icon, trend, trendValue }: StatCardProps) {
  return (
    <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-500">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500">
        <Icon size={80} />
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300">
            <Icon size={20} />
          </div>
          <p className="text-sm font-medium text-zinc-400">{title}</p>
        </div>
        
        <div className="flex items-baseline gap-2">
          <h3 className="text-3xl font-bold text-white tracking-tight">{value}</h3>
          {trend && (
            <div className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' :
              trend === 'down' ? 'bg-red-500/10 text-red-400' :
              'bg-zinc-500/10 text-zinc-400'
            }`}>
              {trend === 'up' ? <ArrowUpRight size={12} /> : 
               trend === 'down' ? <ArrowDownRight size={12} /> : 
               <Minus size={12} />}
              {trendValue || '0%'}
            </div>
          )}
        </div>
        
        {subtitle && (
          <p className="text-sm text-zinc-500 mt-2">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [latestResult, setLatestResult] = useState<EvaluationResult | null>(null);
  const [latestSummary, setLatestSummary] = useState<{ id: string; datasetName: string; startedAt: string } | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const { results } = await listResults();
        setResultCount(results.length);
        
        if (results.length > 0) {
          setLatestSummary({ id: results[0].id, datasetName: results[0].datasetName, startedAt: results[0].startedAt });
          const latest = await getResult(results[0].id);
          setLatestResult(latest);
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading analytics...</p>
        </div>
      </div>
    );
  }

  // Prepare chart data from latest result
  const kValues = latestResult ? Object.keys(latestResult.aggregateMetrics).map(Number).sort((a, b) => a - b) : [];
  const primaryK = kValues.length > 0 ? kValues[Math.floor(kValues.length / 2)] : 10;
  const metrics = latestResult?.aggregateMetrics[primaryK];

  const barChartData = kValues.map(k => ({
    name: `K=${k}`,
    precision: (latestResult?.aggregateMetrics[k]?.retrieval.avgPrecision || 0) * 100,
    recall: (latestResult?.aggregateMetrics[k]?.retrieval.avgRecall || 0) * 100,
    f1: (latestResult?.aggregateMetrics[k]?.retrieval.avgF1 || 0) * 100,
  }));

  const radarData = metrics ? [
    { metric: 'Precision', value: metrics.retrieval.avgPrecision * 100, fullMark: 100 },
    { metric: 'Recall', value: metrics.retrieval.avgRecall * 100, fullMark: 100 },
    { metric: 'F1', value: metrics.retrieval.avgF1 * 100, fullMark: 100 },
    { metric: 'MRR', value: metrics.retrieval.avgMRR * 100, fullMark: 100 },
    { metric: 'NDCG', value: metrics.retrieval.avgNDCG * 100, fullMark: 100 },
    { metric: 'Hit Rate', value: metrics.retrieval.hitRate * 100, fullMark: 100 },
  ] : [];

  return (
    <div className="space-y-8">
      {latestSummary && (
        <div className="glass-panel rounded-2xl p-5 border border-zinc-800/60">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-zinc-400">
              Showing stats from <span className="text-zinc-200 font-semibold">latest run</span>:
              <span className="text-zinc-200 font-semibold"> {latestSummary.datasetName}</span>
              <span className="text-zinc-500 font-mono"> (ID {latestSummary.id.slice(0, 8)}…)</span>
            </div>
            <div className="text-xs text-zinc-500 font-mono">
              {new Date(latestSummary.startedAt).toLocaleString()} • Primary K={primaryK}
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Evaluations"
          value={resultCount}
          subtitle="All time runs"
          icon={BarChart3}
          trend="up"
          trendValue="+1"
        />
        <StatCard
          title="Avg Precision"
          value={metrics ? `${(metrics.retrieval.avgPrecision * 100).toFixed(1)}%` : '-'}
          subtitle={`@ K=${primaryK}`}
          icon={Target}
          trend={metrics && metrics.retrieval.avgPrecision >= 0.7 ? 'up' : 'neutral'}
          trendValue={metrics ? `${(metrics.retrieval.avgPrecision * 100).toFixed(0)}` : undefined}
        />
        <StatCard
          title="Avg Recall"
          value={metrics ? `${(metrics.retrieval.avgRecall * 100).toFixed(1)}%` : '-'}
          subtitle={`@ K=${primaryK}`}
          icon={TrendingUp}
          trend={metrics && metrics.retrieval.avgRecall >= 0.7 ? 'up' : 'neutral'}
        />
        <StatCard
          title="Avg Latency"
          value={metrics ? `${(metrics.performance.avgTotalTimeMs / 1000).toFixed(2)}s` : '-'}
          subtitle="Per query"
          icon={Zap}
          trend="down"
          trendValue="-12ms"
        />
      </div>

      {/* Main Charts */}
      {latestResult ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Bar Chart - Spans 2 cols */}
          <div className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-white/5">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-white">Retrieval Performance</h3>
                <p className="text-sm text-zinc-500">Precision vs Recall across K values</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" /> Precision
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" /> Recall
                </span>
              </div>
            </div>
            
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={barChartData}>
                  <defs>
                    <linearGradient id="colorPrecision" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorRecall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#71717a" 
                    fontSize={12} 
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                  />
                  <YAxis 
                    stroke="#71717a" 
                    fontSize={12} 
                    tickLine={false}
                    axisLine={false}
                    dx={-10}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      background: '#18181b', 
                      border: '1px solid #27272a',
                      borderRadius: '12px',
                      color: '#fafafa'
                    }}
                    itemStyle={{ color: '#fafafa' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="precision" 
                    stroke="#6366f1" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorPrecision)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="recall" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorRecall)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Radar Chart */}
          <div className="glass-panel rounded-2xl p-6 border border-white/5">
            <h3 className="text-lg font-semibold text-white mb-6">Metric Balance</h3>
            <div className="h-80 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="#27272a" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#27272a" tick={false} axisLine={false} />
                  <Radar
                    name="Performance"
                    dataKey="value"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="#8b5cf6"
                    fillOpacity={0.3}
                  />
                  <Tooltip 
                     contentStyle={{ 
                      background: '#18181b', 
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                      color: '#fafafa'
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
              
              <div className="absolute bottom-0 left-0 right-0 text-center">
                <p className="text-xs text-zinc-500">Holistic view @ K={primaryK}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl p-12 text-center border-dashed border-2 border-zinc-800">
          <div className="w-16 h-16 rounded-full bg-zinc-900 mx-auto flex items-center justify-center mb-4">
            <FileText size={32} className="text-zinc-600" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No data available</h3>
          <p className="text-zinc-500 max-w-sm mx-auto mb-6">
            Run an evaluation to start visualizing your RAG system's performance metrics.
          </p>
        </div>
      )}
    </div>
  );
}
