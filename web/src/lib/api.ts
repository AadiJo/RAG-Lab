/**
 * API Client for RAG Lab
 */

const API_BASE = '/api';

export interface DatasetSummary {
  id: string;
  name: string;
  path: string;
  category: string;
}

export interface EvaluationStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    completed: number;
    total: number;
    currentQuery?: string;
  };
  startedAt: string;
  error?: string;
}

export interface EvaluationResultSummary {
  id: string;
  datasetId: string;
  datasetName: string;
  startedAt: string;
  completedAt: string;
  integrationMode?: string;
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    totalDurationMs: number;
  };
  headline?: {
    k: number;
    mode?: string;
    retrieval: {
      avgPrecision: number;
      avgRecall: number;
      avgF1: number;
      avgMRR: number;
      avgNDCG: number;
      hitRate: number;
    };
    generation?: {
      avgFaithfulness: number;
      avgRelevancy: number;
      avgCorrectness?: number;
    };
    image?: {
      avgImageCount: number;
      avgImageRelevanceRate: number;
      avgImageQueryAlignment: number;
    };
  };
}

export interface AggregateMetrics {
  retrieval: {
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgMRR: number;
    avgNDCG: number;
    hitRate: number;
  };
  generation?: {
    avgFaithfulness: number;
    avgRelevancy: number;
    avgCorrectness?: number;
  };
  image?: {
    avgImageCount: number;
    avgRelevantImages: number;
    avgImageRelevanceRate: number;
    avgImageQueryAlignment: number;
  };
  performance: {
    avgRetrievalTimeMs: number;
    avgGenerationTimeMs: number;
    avgTotalTimeMs: number;
  };
}

export interface EvaluationResult {
  id: string;
  datasetId: string;
  datasetName: string;
  startedAt: string;
  completedAt: string;
  config: {
    kValues: number[];
    enableGenerationMetrics: boolean;
    enableImageMetrics: boolean;
    integrationMode: 'api' | 'direct' | 'text' | string;
    enableFiltering?: boolean;
    queryOptions?: {
      targetDocs?: number;
      enableGamePieceEnhancement?: boolean;
      includeImageTypes?: boolean;
      enableCache?: boolean;
      enableStructuredQuery?: boolean;
      retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
      bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
    };
    concurrency?: number;
    queryTimeoutMs?: number;
  };
  aggregateMetrics: Record<number, AggregateMetrics>;
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    totalDurationMs: number;
  };
  results?: Array<{
    testCaseId: string;
    query: string;
    ragResponse: any;
    metrics: any;
    timestamp: string;
    durationMs: number;
    error?: string;
  }>;
}

// Health check
export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  const res = await fetch('/health');
  return res.json();
}

// Check evaluation readiness
export async function checkReadiness(): Promise<{
  ready: boolean;
  components: { ragIntegration: boolean; llmJudge: boolean };
  errors: string[];
}> {
  const res = await fetch(`${API_BASE}/evaluations/readiness`);
  return res.json();
}

// List datasets
export async function listDatasets(): Promise<{ datasets: DatasetSummary[] }> {
  const res = await fetch(`${API_BASE}/datasets`);
  return res.json();
}

// Get dataset summary
export async function getDatasetSummary(id: string): Promise<{
  id: string;
  name: string;
  description: string;
  testCaseCount: number;
  categories: Record<string, number>;
  difficulties: Record<string, number>;
}> {
  const res = await fetch(`${API_BASE}/datasets/${id}/summary`);
  return res.json();
}

// Start evaluation
export async function startEvaluation(
  datasetId: string,
  config?: {
    kValues?: number[];
    enableGenerationMetrics?: boolean;
    enableImageMetrics?: boolean;
    integrationMode?: 'api' | 'direct' | 'text';
    enableFiltering?: boolean;
    queryOptions?: {
      targetDocs?: number;
      enableGamePieceEnhancement?: boolean;
      includeImageTypes?: boolean;
    };
  }
): Promise<{ id: string; status: string; message: string; totalQueries: number }> {
  const res = await fetch(`${API_BASE}/evaluations/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId, config }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Text DB (text-only Chroma) management
// ---------------------------------------------------------------------------

export interface TextDbManifest {
  schema: string;
  createdAt: string;
  config: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface TextDbEntry {
  name: string;
  path: string;
  manifest: TextDbManifest;
}

export async function listTextDbs(): Promise<{
  dbs: TextDbEntry[];
  active: { activeDbPath?: string } | null;
}> {
  const res = await fetch(`${API_BASE}/textdb/list`);
  return res.json();
}

export async function setActiveTextDb(name: string): Promise<{ ok: boolean; activeDbPath: string }> {
  const res = await fetch(`${API_BASE}/textdb/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function deleteTextDb(name: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/textdb/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function startTextDbBuild(payload: {
  name: string;
  inputDir: string;
  representation: 'raw' | 'structured';
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingDevice: string;
  includeFilenameBanner: boolean;
  setActive: boolean;
  enabledModules?: string[];
  moduleConfigs?: Record<string, Record<string, unknown>>;
}): Promise<{ id: string; status: string; outputDir: string }> {
  const res = await fetch(`${API_BASE}/textdb/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getTextDbBuild(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/textdb/build/${id}`);
  return res.json();
}

export async function browseTextDbDirectories(path?: string): Promise<{
  root: string;
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string; type?: 'directory' }>;
  files?: Array<{ name: string; path: string; type?: 'file' }>;
  defaultPdfInputDir: string;
}> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${API_BASE}/textdb/browse${qs}`);
  return res.json();
}

// Get evaluation status
export async function getEvaluationStatus(id: string): Promise<EvaluationStatus> {
  const res = await fetch(`${API_BASE}/evaluations/${id}/status`);
  return res.json();
}

// Cancel evaluation
export async function cancelEvaluation(id: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/evaluations/${id}/cancel`, { method: 'POST' });
  return res.json();
}

// List evaluation results
export async function listResults(): Promise<{ results: EvaluationResultSummary[] }> {
  const res = await fetch(`${API_BASE}/evaluations/results`);
  return res.json();
}

// Get evaluation result
export async function getResult(id: string): Promise<EvaluationResult> {
  const res = await fetch(`${API_BASE}/evaluations/results/${id}`);
  return res.json();
}

export type RunSuggestionResponse =
  | { id: string; createdAt: string; model: string; content: string }
  | { status: 'generating' }
  | { error: string };

export async function getRunSuggestion(id: string, opts?: { force?: boolean }): Promise<RunSuggestionResponse> {
  const qs = opts?.force ? '?force=1' : '';
  const res = await fetch(`${API_BASE}/evaluations/results/${id}/suggestion${qs}`);
  return res.json();
}

export async function clearAllSuggestions(): Promise<{ ok: boolean; deleted: number }> {
  const res = await fetch(`${API_BASE}/evaluations/suggestions`, { method: 'DELETE' });
  return res.json();
}

// Compare evaluations
export async function compareEvaluations(
  baselineId: string,
  comparisonId: string
): Promise<{
  baseline: { id: string; datasetName: string };
  comparison: { id: string; datasetName: string };
  comparisons: Record<number, Record<string, {
    baseline: number;
    comparison: number;
    change: number;
    changePercent: number;
  }>>;
}> {
  const res = await fetch(
    `${API_BASE}/evaluations/compare?baseline=${baselineId}&comparison=${comparisonId}`
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// Settings (gitignored local settings persisted by the server)
// ---------------------------------------------------------------------------

export interface LocalSettings {
  ollama: {
    host: string;
    port: number;
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

export async function getSettings(): Promise<LocalSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  return res.json();
}

export async function updateSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Modules API
// ---------------------------------------------------------------------------

export interface ModuleConfigOption {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
}

export interface SearchVariant {
  id: string;
  name: string;
}

export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  type: 'preprocessor' | 'filter' | 'search_type' | 'document_processor';
  version: string;
  author?: string;
  enabledByDefault: boolean;
  configSchema: ModuleConfigOption[];
  tags: string[];
  variants?: SearchVariant[];
}

export interface SearchTypeDescriptor {
  id: string;
  name: string;
  description: string;
  variants: SearchVariant[];
}

export interface ModuleState {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ModuleConfiguration {
  modules: Record<string, ModuleState>;
  searchType: string;
  searchVariant?: string;
  searchConfig?: Record<string, unknown>;
}

/**
 * List all available modules with their manifests
 */
export async function listModules(): Promise<{
  modules: ModuleManifest[];
  searchTypes: SearchTypeDescriptor[];
}> {
  const res = await fetch(`${API_BASE}/modules`);
  return res.json();
}

/**
 * Get available search types for the dropdown
 */
export async function getSearchTypes(): Promise<{ searchTypes: SearchTypeDescriptor[] }> {
  const res = await fetch(`${API_BASE}/modules/search-types`);
  return res.json();
}

/**
 * Refresh modules (force re-discovery)
 */
export async function refreshModules(): Promise<{
  ok: boolean;
  modules: ModuleManifest[];
  searchTypes: SearchTypeDescriptor[];
}> {
  const res = await fetch(`${API_BASE}/modules/refresh`, { method: 'POST' });
  return res.json();
}

/**
 * Get preprocessor modules only
 */
export async function getPreprocessors(): Promise<{ preprocessors: ModuleManifest[] }> {
  const res = await fetch(`${API_BASE}/modules/preprocessors`);
  return res.json();
}

/**
 * Get filter modules only
 */
export async function getFilters(): Promise<{ filters: ModuleManifest[] }> {
  const res = await fetch(`${API_BASE}/modules/filters`);
  return res.json();
}

/**
 * Get document processor modules only
 */
export async function getDocumentProcessors(): Promise<{ documentProcessors: ModuleManifest[] }> {
  const res = await fetch(`${API_BASE}/modules/document-processors`);
  return res.json();
}

/**
 * Get image filter modules only
 */
export async function getImageFilters(): Promise<{ imageFilters: ModuleManifest[] }> {
  const res = await fetch(`${API_BASE}/modules/image-filters`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Image Embedding Studio API
// ---------------------------------------------------------------------------

export interface ImageFilterConfig {
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface ImageEmbeddingConfig {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  embeddingModel: 'clip' | 'blip' | 'custom';
  customModelName?: string;
  includeContext: boolean;
  contextSource: 'before' | 'after' | 'both' | 'page' | 'none';
  contextChars: number;
  enableOCR: boolean;
  ocrModel?: string;
  enableCaptioning: boolean;
  captioningModel?: string;
  imageMinSize?: number;
  imageMaxSize?: number;
  imageFilters?: Record<string, ImageFilterConfig>;
  metadata?: Record<string, unknown>;
}

export interface PdfImage {
  page: number;
  index: number;
  xref: number;
  width: number;
  height: number;
  format: string;
  size_bytes: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  base64?: string;
}

export async function listImageEmbeddingConfigs(): Promise<{ configs: ImageEmbeddingConfig[] }> {
  const res = await fetch(`${API_BASE}/image-embedding/configs`);
  return res.json();
}

export async function getImageEmbeddingConfig(id: string): Promise<{ config: ImageEmbeddingConfig }> {
  const res = await fetch(`${API_BASE}/image-embedding/configs/${id}`);
  return res.json();
}

export async function saveImageEmbeddingConfig(config: Partial<ImageEmbeddingConfig> & { name: string }): Promise<{ config: ImageEmbeddingConfig }> {
  const res = await fetch(`${API_BASE}/image-embedding/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function deleteImageEmbeddingConfig(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/image-embedding/configs/${id}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function listPdfs(dir?: string): Promise<{ pdfs: Array<{ name: string; path: string; absPath: string }>; directory: string }> {
  const qs = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetch(`${API_BASE}/image-embedding/pdfs${qs}`);
  return res.json();
}

export async function getPdfImages(filename: string, dir?: string): Promise<{ images: PdfImage[]; pdfPath: string }> {
  const qs = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetch(`${API_BASE}/image-embedding/pdfs/${encodeURIComponent(filename)}/images${qs}`);
  return res.json();
}

export async function getImageContext(
  filename: string,
  page: number,
  index: number,
  configId: string,
  dir?: string
): Promise<{ context: string; length: number }> {
  const qs = new URLSearchParams();
  if (dir) qs.append('dir', dir);
  qs.append('configId', configId);
  const res = await fetch(
    `${API_BASE}/image-embedding/pdfs/${encodeURIComponent(filename)}/images/${page}/${index}/context?${qs}`
  );
  return res.json();
}

export async function startImageDbBuild(payload: {
  name: string;
  inputDir: string;
  configId: string;
  setActive?: boolean;
}): Promise<{ id: string; status: string; outputDir: string }> {
  const res = await fetch(`${API_BASE}/image-embedding/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getImageDbBuild(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/image-embedding/build/${id}`);
  return res.json();
}

