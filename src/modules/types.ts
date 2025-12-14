/**
 * Module System Type Definitions
 * 
 * These types mirror the Python module system and are used for:
 * - API communication between frontend and backend
 * - Module discovery and configuration in the UI
 * - Type-safe module management
 */

/**
 * Types of modules supported by RAG-Lab
 */
export type ModuleType = 'preprocessor' | 'filter' | 'search_type';

/**
 * Configuration option exposed by a module
 * 
 * These are displayed in the frontend settings panel and allow users
 * to customize module behavior without modifying code.
 */
export interface ModuleConfigOption {
  /** Unique identifier for this config option */
  key: string;
  
  /** Data type: "string", "number", "boolean", "select", "multiselect" */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  
  /** Human-readable label for the UI */
  label: string;
  
  /** Detailed description/help text */
  description?: string;
  
  /** Default value if not specified */
  default?: unknown;
  
  /** Whether this option must be provided */
  required?: boolean;
  
  /** For "select"/"multiselect" types, the available choices */
  options?: Array<{ value: string | number; label: string }>;
  
  /** For "number" type, minimum value */
  min?: number;
  
  /** For "number" type, maximum value */
  max?: number;
}

/**
 * Search type variant (e.g., BM25 has "bm25", "bm25_no_idf", "tf")
 */
export interface SearchVariant {
  id: string;
  name: string;
}

/**
 * Complete manifest describing a module
 * 
 * This is received from the Python backend and used to render
 * the module configuration UI.
 */
export interface ModuleManifest {
  /** Unique module identifier (e.g., "frc-game-piece-mapper") */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Detailed description of what the module does */
  description: string;
  
  /** The module type */
  type: ModuleType;
  
  /** Semantic version string */
  version: string;
  
  /** Module author/maintainer */
  author?: string;
  
  /** Whether this module is enabled by default */
  enabledByDefault: boolean;
  
  /** Configuration schema for the module */
  configSchema: ModuleConfigOption[];
  
  /** Searchable tags for categorization */
  tags: string[];
  
  /** For search types: available variants */
  variants?: SearchVariant[];
}

/**
 * Search type descriptor for the dropdown
 */
export interface SearchTypeDescriptor {
  id: string;
  name: string;
  description: string;
  variants: SearchVariant[];
}

/**
 * Module configuration state (per-module)
 */
export interface ModuleState {
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Complete module configuration for a query/evaluation
 */
export interface ModuleConfiguration {
  /** Map of module ID to its state */
  modules: Record<string, ModuleState>;
  
  /** Selected search type ID */
  searchType: string;
  
  /** Selected search variant (optional) */
  searchVariant?: string;
  
  /** Search type configuration */
  searchConfig?: Record<string, unknown>;
}

/**
 * Default module configuration
 */
export function getDefaultModuleConfiguration(): ModuleConfiguration {
  return {
    modules: {},
    searchType: 'vector',
  };
}

/**
 * Build module config object for Python query
 * 
 * Converts the frontend ModuleConfiguration to the format expected
 * by the Python module registry.
 */
export function buildPythonModuleConfig(
  config: ModuleConfiguration,
  manifests: ModuleManifest[],
): Record<string, { enabled: boolean; config: Record<string, unknown> }> {
  const result: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {};
  
  for (const manifest of manifests) {
    const state = config.modules[manifest.id];
    
    if (state) {
      result[manifest.id] = {
        enabled: state.enabled,
        config: state.config,
      };
    } else {
      // Use default
      result[manifest.id] = {
        enabled: manifest.enabledByDefault,
        config: {},
      };
    }
  }
  
  return result;
}
