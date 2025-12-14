/**
 * Module Manager
 * 
 * Handles module discovery and provides module information to the frontend.
 * Modules are implemented in Python; this manager queries the Python backend
 * for available modules and their configurations.
 */

import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ModuleManifest, SearchTypeDescriptor } from './types';

/**
 * Cache for module discovery results
 */
interface ModuleCache {
  modules: ModuleManifest[];
  searchTypes: SearchTypeDescriptor[];
  lastUpdated: number;
}

let moduleCache: ModuleCache | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Get the Python interpreter path
 */
function getPythonPath(): string {
  const envPath = process.env.PYTHON_PATH;
  if (envPath) return envPath;
  
  const venvPython = join(process.cwd(), '.venv-textdb', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  
  return 'python3';
}

/**
 * Discover available modules from the Python backend
 * 
 * This calls the Python module registry to get all available modules
 * with their manifests.
 */
export async function discoverModules(): Promise<{
  modules: ModuleManifest[];
  searchTypes: SearchTypeDescriptor[];
}> {
  // Check cache
  if (moduleCache && (Date.now() - moduleCache.lastUpdated) < CACHE_TTL_MS) {
    return {
      modules: moduleCache.modules,
      searchTypes: moduleCache.searchTypes,
    };
  }
  
  const pythonPath = getPythonPath();
  
  // We'll use a simple Python script to query the registry
  const script = `
import sys
import json
sys.path.insert(0, '${process.cwd()}/python')

from rag_bench.modules import get_registry

registry = get_registry()
result = {
    "modules": registry.list_modules(),
    "searchTypes": registry.list_search_types(),
}
print(json.dumps(result))
`;
  
  try {
    const proc = spawn([pythonPath, '-c', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python`,
      },
    });
    
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      console.error('Module discovery failed:', stderr);
      return { modules: [], searchTypes: getBuiltinSearchTypes() };
    }
    
    const result = JSON.parse(stdout.trim()) as {
      modules: ModuleManifest[];
      searchTypes: SearchTypeDescriptor[];
    };
    
    // Update cache
    moduleCache = {
      modules: result.modules,
      searchTypes: result.searchTypes,
      lastUpdated: Date.now(),
    };
    
    return result;
  } catch (error) {
    console.error('Module discovery error:', error);
    return { modules: [], searchTypes: getBuiltinSearchTypes() };
  }
}

/**
 * Get built-in search types (fallback if Python discovery fails)
 */
function getBuiltinSearchTypes(): SearchTypeDescriptor[] {
  return [
    {
      id: 'vector',
      name: 'Vector Search',
      description: 'Dense embedding similarity search',
      variants: [{ id: 'cosine', name: 'Cosine Similarity' }],
    },
    {
      id: 'bm25',
      name: 'BM25 Search',
      description: 'Sparse lexical search using BM25',
      variants: [
        { id: 'bm25', name: 'BM25 (with IDF)' },
        { id: 'bm25_no_idf', name: 'BM25 (no IDF)' },
        { id: 'tf', name: 'Term Frequency only' },
      ],
    },
    {
      id: 'hybrid',
      name: 'Hybrid Search',
      description: 'Combines vector and BM25 search',
      variants: [
        { id: 'weighted', name: 'Weighted Combination' },
        { id: 'rrf', name: 'Reciprocal Rank Fusion' },
      ],
    },
  ];
}

/**
 * Clear the module cache (force re-discovery)
 */
export function clearModuleCache(): void {
  moduleCache = null;
}

/**
 * Get modules by type
 */
export async function getModulesByType(type: 'preprocessor' | 'filter' | 'search_type' | 'document_processor'): Promise<ModuleManifest[]> {
  const { modules } = await discoverModules();
  return modules.filter(m => m.type === type);
}

/**
 * Get preprocessor modules
 */
export async function getPreprocessors(): Promise<ModuleManifest[]> {
  return getModulesByType('preprocessor');
}

/**
 * Get filter modules
 */
export async function getFilters(): Promise<ModuleManifest[]> {
  return getModulesByType('filter');
}

/**
 * Get search type modules
 */
export async function getSearchTypes(): Promise<SearchTypeDescriptor[]> {
  const { searchTypes } = await discoverModules();
  return searchTypes.length > 0 ? searchTypes : getBuiltinSearchTypes();
}

/**
 * Get document processor modules
 */
export async function getDocumentProcessors(): Promise<ModuleManifest[]> {
  return getModulesByType('document_processor');
}
