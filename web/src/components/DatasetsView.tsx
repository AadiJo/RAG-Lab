import { useState, useEffect } from 'react';
import { 
  Database, 
  ChevronDown, 
  ChevronUp, 
  FileText,
  Tag,
  BarChart,
  Layers,
  Search
} from 'lucide-react';
import { listDatasets, getDatasetSummary, type DatasetSummary } from '../lib/api';

interface DatasetDetail {
  id: string;
  name: string;
  description: string;
  testCaseCount: number;
  categories: Record<string, number>;
  difficulties: Record<string, number>;
}

export default function DatasetsView() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<DatasetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDatasets = async () => {
      try {
        const { datasets: ds } = await listDatasets();
        setDatasets(ds);
      } catch (error) {
        console.error('Failed to load datasets:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDatasets();
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }

    setExpandedId(id);
    try {
      const detail = await getDatasetSummary(id);
      setExpandedDetail(detail);
    } catch (error) {
      console.error('Failed to load dataset detail:', error);
    }
  };

  const getDifficultyColor = (difficulty: string): string => {
    switch (difficulty) {
      case 'easy': return 'text-emerald-400';
      case 'medium': return 'text-amber-400';
      case 'hard': return 'text-red-400';
      default: return 'text-zinc-500';
    }
  };

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
          <h2 className="text-2xl font-bold text-white tracking-tight">Dataset Registry</h2>
          <p className="text-zinc-500">Manage and explore ground truth datasets</p>
        </div>
        <button className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-medium text-white hover:bg-zinc-800 transition-colors flex items-center gap-2">
          <Database size={16} />
          Import New
        </button>
      </div>

      {datasets.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center border-dashed border-2 border-zinc-800">
          <div className="w-16 h-16 rounded-full bg-zinc-900 mx-auto flex items-center justify-center mb-4">
            <Database size={32} className="text-zinc-600" />
          </div>
          <p className="text-zinc-500">No datasets found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {datasets.map((dataset) => (
            <div 
              key={dataset.id} 
              className={`glass-panel rounded-xl transition-all duration-300 overflow-hidden ${
                expandedId === dataset.id ? 'border-indigo-500/30 ring-1 ring-indigo-500/10' : 'hover:border-zinc-700'
              }`}
            >
              <button
                onClick={() => handleExpand(dataset.id)}
                className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors text-left"
              >
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 shadow-inner">
                    <Layers size={24} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{dataset.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                        {dataset.category}
                      </span>
                      <span className="text-xs text-zinc-500 font-mono">
                        ID: {dataset.id}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`p-2 rounded-full hover:bg-zinc-800 transition-colors ${expandedId === dataset.id ? 'rotate-180' : ''}`}>
                  <ChevronDown size={20} className="text-zinc-500" />
                </div>
              </button>

              {expandedId === dataset.id && expandedDetail && (
                <div className="border-t border-zinc-800 bg-black/20 animate-fadeIn">
                  <div className="p-6">
                    {expandedDetail.description && (
                      <p className="text-zinc-400 mb-8 max-w-3xl leading-relaxed">
                        {expandedDetail.description}
                      </p>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800">
                        <div className="flex items-center gap-2 text-zinc-500 mb-2 text-sm uppercase tracking-wider font-semibold">
                          <FileText size={16} />
                          Test Cases
                        </div>
                        <p className="text-3xl font-bold text-white tracking-tight">{expandedDetail.testCaseCount}</p>
                      </div>

                      <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800">
                        <div className="flex items-center gap-2 text-zinc-500 mb-2 text-sm uppercase tracking-wider font-semibold">
                          <Tag size={16} />
                          Categories
                        </div>
                        <p className="text-3xl font-bold text-white tracking-tight">
                          {Object.keys(expandedDetail.categories).length}
                        </p>
                      </div>

                      <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800">
                        <div className="flex items-center gap-2 text-zinc-500 mb-2 text-sm uppercase tracking-wider font-semibold">
                          <BarChart size={16} />
                          Difficulty Breakdown
                        </div>
                        <div className="flex gap-4 mt-2">
                          {Object.entries(expandedDetail.difficulties).map(([diff, count]) => (
                            count > 0 && (
                              <div key={diff}>
                                <div className={`text-sm font-bold ${getDifficultyColor(diff)}`}>{count}</div>
                                <div className="text-[10px] text-zinc-500 uppercase">{diff}</div>
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-8">
                      <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Topic Distribution</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(expandedDetail.categories).map(([category, count]) => (
                          <div
                            key={category}
                            className="px-3 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-lg flex items-center gap-2 hover:bg-zinc-800 transition-colors"
                          >
                            <span className="text-sm text-zinc-300">{category}</span>
                            <span className="text-xs font-mono text-zinc-500 bg-black/20 px-1.5 py-0.5 rounded">
                              {count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
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
