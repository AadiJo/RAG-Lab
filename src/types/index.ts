/**
 * RAG Eval Bench - Type Definitions
 * 
 * Comprehensive type definitions for the evaluation and benchmarking system.
 */

// =============================================================================
// Core Evaluation Types
// =============================================================================

/**
 * A single test case in an evaluation dataset
 */
export interface TestCase {
  id: string;
  query: string;
  groundTruth: GroundTruth;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Ground truth data for evaluating retrieval and generation quality
 */
export interface GroundTruth {
  /** Keywords that should appear in relevant retrieved documents */
  expectedKeywords: string[];
  /** Expected relevant document identifiers or content snippets */
  relevantChunks?: string[];
  /** The ideal/reference answer for correctness evaluation */
  referenceAnswer?: string;
  /** Expected image filenames or patterns that should be retrieved */
  expectedImages?: string[];
  /** Keywords that should NOT appear (for negative testing) */
  excludedKeywords?: string[];
}

/**
 * An evaluation dataset containing multiple test cases
 */
export interface EvaluationDataset {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  testCases: TestCase[];
  metadata?: {
    domain?: string;
    source?: string;
    author?: string;
    [key: string]: unknown;
  };
}

// =============================================================================
// RAG Response Types
// =============================================================================

/**
 * A retrieved document from the RAG system
 */
export interface RetrievedDocument {
  id?: string;
  content: string;
  metadata?: {
    source?: string;
    page?: number;
    chunk_index?: number;
    [key: string]: unknown;
  };
  score?: number;
  rank: number;
}

/**
 * A retrieved image from the RAG system
 */
export interface RetrievedImage {
  filename: string;
  filePath: string;
  webPath?: string;
  page?: number | string;
  contextSummary?: string;
  ocrText?: string;
  score?: number;
  exists?: boolean;
}

/**
 * Response from the RAG system for a single query
 */
export interface RAGResponse {
  query: string;
  enhancedQuery?: string;
  response: string;
  documents: RetrievedDocument[];
  images: RetrievedImage[];
  retrievalTimeMs: number;
  generationTimeMs?: number;
  metadata?: {
    matchedPieces?: string[];
    contextSources?: number;
    postProcessingApplied?: boolean;
    [key: string]: unknown;
  };
}

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Retrieval quality metrics (computed without LLM)
 */
export interface RetrievalMetrics {
  /** Precision@K: Proportion of retrieved docs that are relevant */
  precisionAtK: number;
  /** Recall@K: Proportion of relevant docs that were retrieved */
  recallAtK: number;
  /** Hit Rate@K: Binary - at least one relevant doc in top K */
  hitRateAtK: boolean;
  /** Mean Reciprocal Rank: 1/rank of first relevant doc */
  mrr: number;
  /** Normalized Discounted Cumulative Gain */
  ndcg: number;
  /** F1 Score: Harmonic mean of precision and recall */
  f1AtK: number;
  /** Number of documents evaluated */
  k: number;
  /** Number of documents retrieved */
  documentsRetrieved: number;
}

/**
 * LLM-judged generation quality metrics
 */
export interface GenerationMetrics {
  /** Faithfulness: Is the answer grounded in retrieved context? (0-1) */
  faithfulness: number;
  /** Answer Relevancy: Does the answer address the query? (0-1) */
  answerRelevancy: number;
  /** Answer Correctness: Is the answer factually accurate? (0-1). Only available if a reference answer exists. */
  answerCorrectness?: number;
  /** Detailed reasoning from the LLM judge */
  judgmentDetails?: {
    faithfulnessReasoning?: string;
    relevancyReasoning?: string;
    correctnessReasoning?: string;
  };
}

/**
 * Image retrieval quality metrics
 */
export interface ImageMetrics {
  /** Number of images retrieved */
  imageCount: number;
  /** Number of relevant images */
  relevantImages: number;
  /** Proportion of retrieved images that are relevant */
  imageRelevanceRate: number;
  /** Average semantic similarity between query and retrieved images */
  avgImageQueryAlignment: number;
  /** Whether images add information beyond text context */
  imageContextCoverage: number;
}

/**
 * Combined metrics for a single query evaluation
 */
export interface QueryMetrics {
  retrieval: RetrievalMetrics;
  generation?: GenerationMetrics;
  image?: ImageMetrics;
}

// =============================================================================
// Evaluation Result Types
// =============================================================================

/**
 * Result of evaluating a single test case
 */
export interface SingleQueryResult {
  testCaseId: string;
  query: string;
  ragResponse: RAGResponse;
  metrics: QueryMetrics;
  timestamp: string;
  durationMs: number;
  error?: string;
}

/**
 * Aggregated metrics across multiple queries
 */
export interface AggregateMetrics {
  retrieval: {
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgMRR: number;
    avgNDCG: number;
    hitRate: number; // Percentage of queries with at least one hit
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

/**
 * Complete evaluation run result
 */
export interface EvaluationResult {
  id: string;
  datasetId: string;
  datasetName: string;
  startedAt: string;
  completedAt: string;
  config: EvaluationConfig;
  results: SingleQueryResult[];
  aggregateMetrics: Record<number, AggregateMetrics>; // keyed by K value
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    totalDurationMs: number;
  };
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for an evaluation run
 */
export interface EvaluationConfig {
  /** K values to evaluate (e.g., [5, 10, 15, 20]) */
  kValues: number[];
  /** Whether to run LLM-judged metrics (slower, costs API calls) */
  enableGenerationMetrics: boolean;
  /** Whether to evaluate image retrieval */
  enableImageMetrics: boolean;
  /** Integration mode: 'api' (HTTP), 'direct' (frc-rag python bridge), or 'text' (local text-only Chroma query) */
  integrationMode: 'api' | 'direct' | 'text';
  /** Whether to enable post-processing filtering in RAG */
  enableFiltering?: boolean;
  /**
   * Extra query-time knobs (primarily used by `integrationMode: 'text'`).
   * Safe to ignore for other modes.
   */
  queryOptions?: {
    /** Target number of docs after post-filtering (only meaningful when enableFiltering=true). */
    targetDocs?: number;
    /** Toggle game-piece query enhancement for text mode. */
    enableGamePieceEnhancement?: boolean;
    /** Include image-typed chunks in text retrieval (defaults to false). */
    includeImageTypes?: boolean;
    /** Cache query results in the Bun process (text mode only). */
    enableCache?: boolean;
    /** Use structured query parsing (LLM -> {search, filter}) before retrieval (text mode only). */
    enableStructuredQuery?: boolean;
    /** Retrieval method for text mode. */
    retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
    /** Lexical scoring variant. */
    bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
  };
  /** Maximum concurrent queries */
  concurrency?: number;
  /** Timeout per query in milliseconds */
  queryTimeoutMs?: number;
}

/**
 * Chutes AI LLM configuration
 */
export interface ChutesConfig {
  apiToken: string;
  apiUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * FRC-RAG integration configuration
 */
export interface FRCRAGConfig {
  /** API URL for remote connection */
  apiUrl?: string;
  /** Path to backend for direct Python bridge */
  backendPath?: string;
}

// =============================================================================
// API Types
// =============================================================================

/**
 * Request to start an evaluation run
 */
export interface StartEvaluationRequest {
  datasetId: string;
  config?: Partial<EvaluationConfig>;
}

/**
 * Status of a running evaluation
 */
export interface EvaluationStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    completed: number;
    total: number;
    currentQuery?: string;
  };
  startedAt: string;
  estimatedCompletionAt?: string;
  error?: string;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Relevance judgment for a document (used in metric calculations)
 */
export interface RelevanceJudgment {
  documentIndex: number;
  isRelevant: boolean;
  relevanceScore: number; // 0-1 scale
  matchedKeywords: string[];
}

/**
 * Comparison between two evaluation runs
 */
export interface EvaluationComparison {
  baselineId: string;
  comparisonId: string;
  improvements: Record<string, number>; // metric name -> improvement percentage
  regressions: Record<string, number>;
  unchanged: string[];
}


