/**
 * Modules Configuration Component
 * 
 * Displays available modules (preprocessors and filters) with enable/disable
 * toggles and configuration options. Also shows search type selection.
 */

import { useState, useEffect } from 'react';
import {
  Package,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  Zap,
  RefreshCw,
  Info,
  Settings2,
} from 'lucide-react';
import {
  listModules,
  refreshModules,
  type ModuleManifest,
  type SearchTypeDescriptor,
  type ModuleState,
} from '../lib/api';

interface ModulesConfigProps {
  /** Current module configuration state */
  moduleConfig: Record<string, ModuleState>;
  /** Callback when module configuration changes */
  onModuleConfigChange: (config: Record<string, ModuleState>) => void;
  /** Currently selected search type */
  searchType: string;
  /** Callback when search type changes */
  onSearchTypeChange: (searchType: string) => void;
  /** Currently selected search variant */
  searchVariant?: string;
  /** Callback when search variant changes */
  onSearchVariantChange: (variant: string | undefined) => void;
  /** Whether the config is disabled (e.g., during evaluation) */
  disabled?: boolean;
}

export default function ModulesConfig({
  moduleConfig,
  onModuleConfigChange,
  searchType,
  onSearchTypeChange,
  searchVariant,
  onSearchVariantChange,
  disabled = false,
}: ModulesConfigProps) {
  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [searchTypes, setSearchTypes] = useState<SearchTypeDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Load modules on mount
  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listModules();
      setModules(result.modules || []);
      setSearchTypes(result.searchTypes || []);
      
      // Initialize module config with defaults
      const newConfig = { ...moduleConfig };
      for (const mod of result.modules || []) {
        if (!(mod.id in newConfig)) {
          newConfig[mod.id] = {
            enabled: mod.enabledByDefault,
            config: Object.fromEntries(
              mod.configSchema.map(opt => [opt.key, opt.default])
            ),
          };
        }
      }
      onModuleConfigChange(newConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshModules();
      setModules(result.modules || []);
      setSearchTypes(result.searchTypes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const toggleModule = (moduleId: string) => {
    const current = moduleConfig[moduleId] || { enabled: false, config: {} };
    onModuleConfigChange({
      ...moduleConfig,
      [moduleId]: { ...current, enabled: !current.enabled },
    });
  };

  const updateModuleConfig = (moduleId: string, key: string, value: unknown) => {
    const current = moduleConfig[moduleId] || { enabled: false, config: {} };
    onModuleConfigChange({
      ...moduleConfig,
      [moduleId]: {
        ...current,
        config: { ...current.config, [key]: value },
      },
    });
  };

  const toggleExpanded = (moduleId: string) => {
    const next = new Set(expandedModules);
    if (next.has(moduleId)) {
      next.delete(moduleId);
    } else {
      next.add(moduleId);
    }
    setExpandedModules(next);
  };

  const preprocessors = modules.filter(m => m.type === 'preprocessor');
  const filters = modules.filter(m => m.type === 'filter');

  // Get variants for selected search type
  const selectedSearchType = searchTypes.find(st => st.id === searchType);
  const variants = selectedSearchType?.variants || [];

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-zinc-800 rounded w-1/3 mb-4" />
        <div className="h-4 bg-zinc-800 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
            <Package size={20} />
          </div>
          <h3 className="text-lg font-semibold text-white">Modules & Search</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={disabled || refreshing}
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          title="Refresh modules"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Search Type Selection */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Search size={14} />
          <span>Search Type</span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {searchTypes.map(st => (
            <button
              key={st.id}
              onClick={() => {
                onSearchTypeChange(st.id);
                // Reset variant when search type changes
                onSearchVariantChange(st.variants[0]?.id);
              }}
              disabled={disabled}
              className={`p-3 rounded-xl border text-left transition-all ${
                searchType === st.id
                  ? 'border-purple-500/50 bg-purple-500/10 text-white'
                  : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <p className="font-medium text-sm">{st.name}</p>
              <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{st.description}</p>
            </button>
          ))}
        </div>

        {/* Variant Selection */}
        {variants.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Variant:</span>
            <select
              value={searchVariant || variants[0]?.id}
              onChange={(e) => onSearchVariantChange(e.target.value)}
              disabled={disabled}
              className="flex-1 text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            >
              {variants.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Preprocessors */}
      {preprocessors.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Zap size={14} />
            <span>Query Preprocessors</span>
            <span className="text-xs text-zinc-600">({preprocessors.length})</span>
          </div>
          
          <div className="space-y-2">
            {preprocessors.map(mod => (
              <ModuleCard
                key={mod.id}
                module={mod}
                state={moduleConfig[mod.id] || { enabled: mod.enabledByDefault, config: {} }}
                expanded={expandedModules.has(mod.id)}
                onToggle={() => toggleModule(mod.id)}
                onExpand={() => toggleExpanded(mod.id)}
                onConfigChange={(key, value) => updateModuleConfig(mod.id, key, value)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      {filters.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Filter size={14} />
            <span>Document Filters</span>
            <span className="text-xs text-zinc-600">({filters.length})</span>
          </div>
          
          <div className="space-y-2">
            {filters.map(mod => (
              <ModuleCard
                key={mod.id}
                module={mod}
                state={moduleConfig[mod.id] || { enabled: mod.enabledByDefault, config: {} }}
                expanded={expandedModules.has(mod.id)}
                onToggle={() => toggleModule(mod.id)}
                onExpand={() => toggleExpanded(mod.id)}
                onConfigChange={(key, value) => updateModuleConfig(mod.id, key, value)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      )}

      {/* No modules message */}
      {preprocessors.length === 0 && filters.length === 0 && (
        <div className="text-center py-8 text-zinc-500">
          <Package size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No modules installed</p>
          <p className="text-xs mt-1">
            Add modules to the <code className="text-zinc-400">modules/</code> directory
          </p>
        </div>
      )}
    </div>
  );
}

// Individual module card component
interface ModuleCardProps {
  module: ModuleManifest;
  state: ModuleState;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onConfigChange: (key: string, value: unknown) => void;
  disabled: boolean;
}

function ModuleCard({
  module,
  state,
  expanded,
  onToggle,
  onExpand,
  onConfigChange,
  disabled,
}: ModuleCardProps) {
  const hasConfig = module.configSchema.length > 0;
  
  return (
    <div className={`rounded-xl border transition-all ${
      state.enabled
        ? 'border-purple-500/30 bg-purple-500/5'
        : 'border-zinc-800 bg-zinc-900/20'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        {/* Expand button (if has config) */}
        {hasConfig && (
          <button
            onClick={onExpand}
            disabled={disabled}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        
        {/* Module info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium text-sm ${state.enabled ? 'text-white' : 'text-zinc-400'}`}>
              {module.name}
            </span>
            <span className="text-xs text-zinc-600">v{module.version}</span>
          </div>
          <p className="text-xs text-zinc-500 truncate">{module.description}</p>
        </div>
        
        {/* Toggle */}
        <button
          onClick={onToggle}
          disabled={disabled}
          className={`relative w-10 h-6 rounded-full transition-colors ${
            state.enabled ? 'bg-purple-500' : 'bg-zinc-700'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
            state.enabled ? 'left-5' : 'left-1'
          }`} />
        </button>
      </div>
      
      {/* Config panel */}
      {hasConfig && expanded && (
        <div className="border-t border-zinc-800/50 p-3 space-y-3">
          {module.configSchema.map(opt => (
            <ConfigOption
              key={opt.key}
              option={opt}
              value={state.config[opt.key]}
              onChange={(value) => onConfigChange(opt.key, value)}
              disabled={disabled || !state.enabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Config option input component
interface ConfigOptionProps {
  option: {
    key: string;
    type: string;
    label: string;
    description?: string;
    default?: unknown;
    options?: Array<{ value: string | number; label: string }>;
    min?: number;
    max?: number;
  };
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

function ConfigOption({ option, value, onChange, disabled }: ConfigOptionProps) {
  const currentValue = value ?? option.default;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-zinc-400">{option.label}</label>
        {option.description && (
          <div className="group relative">
            <Info size={12} className="text-zinc-600 cursor-help" />
            <div className="absolute right-0 bottom-full mb-1 w-48 p-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              {option.description}
            </div>
          </div>
        )}
      </div>
      
      {option.type === 'boolean' && (
        <input
          type="checkbox"
          checked={Boolean(currentValue)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-purple-500"
        />
      )}
      
      {option.type === 'number' && (
        <input
          type="number"
          value={Number(currentValue) || 0}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          min={option.min}
          max={option.max}
          disabled={disabled}
          className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 disabled:opacity-50"
        />
      )}
      
      {option.type === 'string' && (
        <input
          type="text"
          value={String(currentValue || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 disabled:opacity-50"
        />
      )}
      
      {option.type === 'select' && option.options && (
        <select
          value={String(currentValue || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 disabled:opacity-50"
        >
          {option.options.map(opt => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
