/**
 * Main Evaluation Orchestrator
 * 
 * Coordinates the evaluation process, combining retrieval metrics,
 * generation metrics, and image metrics for comprehensive RAG evaluation.
 */

import type {
  EvaluationConfig,
  EvaluationDataset,
  EvaluationResult,
  SingleQueryResult,
  AggregateMetrics,
  TestCase,
  QueryMetrics,
  RAGResponse,
} from '@/types';

import { calculateRetrievalMetrics, aggregateRetrievalMetrics } from './metrics/retrieval';
import { evaluateGenerationMetrics, aggregateGenerationMetrics } from './metrics/generation';
import { calculateImageMetrics, aggregateImageMetrics } from './metrics/image';
import { LLMJudge } from './llm-judge';
import { ragClient } from '../integrations';
import { structuredQueryFromOllama } from './structured-query';

const DEFAULT_CONFIG: EvaluationConfig = {
  kValues: [5, 10, 15, 20],
  enableGenerationMetrics: true,
  enableImageMetrics: false,
  integrationMode: 'text',
  enableFiltering: false,
  concurrency: 1,
  queryTimeoutMs: 60000,
};

export interface EvaluationProgress {
  completed: number;
  total: number;
  currentQuery?: string;
  currentK?: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

type ProgressCallback = (progress: EvaluationProgress) => void;

/**
 * Main Evaluator class
 */
export class Evaluator {
  private config: EvaluationConfig;
  private llmJudge: LLMJudge;
  private abortController: AbortController | null = null;

  constructor(config?: Partial<EvaluationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llmJudge = new LLMJudge();
    
    // Set integration mode
    ragClient.setDefaultMode(this.config.integrationMode);
  }

  /**
   * Generate a unique evaluation ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `eval_${timestamp}_${random}`;
  }

  /**
   * Evaluate a single test case at a specific K value
   */
  async evaluateSingleQuery(
    testCase: TestCase,
    k: number
  ): Promise<SingleQueryResult> {
    const startTime = performance.now();

    try {
      let where: Record<string, string> | undefined;
      let queryForRetrieval = testCase.query;

      if (this.config.integrationMode === 'text' && this.config.queryOptions?.enableStructuredQuery) {
        try {
          const sq = await structuredQueryFromOllama(testCase.query);
          queryForRetrieval = sq.search || testCase.query;
          where = sq.filter;
        } catch (e) {
          // Don't fail the query; just fall back to raw query
          console.warn('Structured query parsing failed, falling back:', e);
        }
      }

      // Query the RAG system
      const ragResponse = await ragClient.query(queryForRetrieval, {
        k,
        enableFiltering: this.config.enableFiltering,
        mode: this.config.integrationMode,
        targetDocs: this.config.queryOptions?.targetDocs,
        enableGamePieceEnhancement: this.config.queryOptions?.enableGamePieceEnhancement,
        includeImageTypes: this.config.queryOptions?.includeImageTypes,
        enableCache: this.config.queryOptions?.enableCache,
        retrievalMethod: this.config.queryOptions?.retrievalMethod,
        bm25Variant: this.config.queryOptions?.bm25Variant,
        where,
      });

      // Check for errors in response
      if (ragResponse.metadata?.error) {
        throw new Error(ragResponse.metadata.error as string);
      }

      // Calculate metrics
      const metrics = await this.calculateAllMetrics(ragResponse, testCase, k);

      const durationMs = performance.now() - startTime;

      return {
        testCaseId: testCase.id,
        query: testCase.query,
        ragResponse,
        metrics,
        timestamp: new Date().toISOString(),
        durationMs,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      console.error(`Failed to evaluate query "${testCase.query.substring(0, 50)}...":`, error);

      return {
        testCaseId: testCase.id,
        query: testCase.query,
        ragResponse: {
          query: testCase.query,
          response: '',
          documents: [],
          images: [],
          retrievalTimeMs: 0,
        },
        metrics: {
          retrieval: {
            precisionAtK: 0,
            recallAtK: 0,
            hitRateAtK: false,
            mrr: 0,
            ndcg: 0,
            f1AtK: 0,
            k,
            documentsRetrieved: 0,
          },
        },
        timestamp: new Date().toISOString(),
        durationMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Calculate all metrics for a RAG response
   */
  private async calculateAllMetrics(
    ragResponse: RAGResponse,
    testCase: TestCase,
    k: number
  ): Promise<QueryMetrics> {
    const metrics: QueryMetrics = {
      retrieval: calculateRetrievalMetrics(
        ragResponse.documents,
        testCase.groundTruth,
        k
      ),
    };

    // Calculate generation metrics if enabled
    if (this.config.enableGenerationMetrics && this.llmJudge.isAvailable()) {
      try {
        const generationMetrics = await evaluateGenerationMetrics(
          ragResponse,
          testCase.groundTruth,
          this.llmJudge
        );
        if (generationMetrics) {
          metrics.generation = generationMetrics;
        }
      } catch (error) {
        console.warn('Generation metrics failed:', error);
      }
    }

    // Calculate image metrics if enabled
    if (this.config.enableImageMetrics && ragResponse.images.length > 0) {
      const textContext = ragResponse.documents.map(d => d.content).join(' ');
      metrics.image = calculateImageMetrics(
        ragResponse.images,
        ragResponse.query,
        testCase.groundTruth,
        textContext
      );
    }

    return metrics;
  }

  /**
   * Aggregate metrics across all results for a specific K value
   */
  private aggregateMetricsForK(results: SingleQueryResult[]): AggregateMetrics {
    const validResults = results.filter(r => !r.error);

    const retrievalMetrics = validResults.map(r => r.metrics.retrieval);
    const generationMetrics = validResults
      .filter(r => r.metrics.generation)
      .map(r => r.metrics.generation!);
    const imageMetrics = validResults
      .filter(r => r.metrics.image)
      .map(r => r.metrics.image!);

    const aggRetrieval = aggregateRetrievalMetrics(retrievalMetrics);
    const aggGeneration = generationMetrics.length > 0
      ? aggregateGenerationMetrics(generationMetrics)
      : undefined;
    const aggImage = imageMetrics.length > 0
      ? aggregateImageMetrics(imageMetrics)
      : undefined;

    // Calculate performance metrics
    const avgRetrievalTime = validResults.length > 0
      ? validResults.reduce((sum, r) => sum + r.ragResponse.retrievalTimeMs, 0) / validResults.length
      : 0;
    const avgGenerationTime = validResults.length > 0
      ? validResults.reduce((sum, r) => sum + (r.ragResponse.generationTimeMs || 0), 0) / validResults.length
      : 0;
    const avgTotalTime = validResults.length > 0
      ? validResults.reduce((sum, r) => sum + r.durationMs, 0) / validResults.length
      : 0;

    return {
      retrieval: aggRetrieval,
      generation: aggGeneration,
      image: aggImage,
      performance: {
        avgRetrievalTimeMs: avgRetrievalTime,
        avgGenerationTimeMs: avgGenerationTime,
        avgTotalTimeMs: avgTotalTime,
      },
    };
  }

  /**
   * Run a full evaluation on a dataset
   */
  async evaluateDataset(
    dataset: EvaluationDataset,
    onProgress?: ProgressCallback
  ): Promise<EvaluationResult> {
    const startedAt = new Date().toISOString();
    const evalId = this.generateId();
    this.abortController = new AbortController();

    const allResults: SingleQueryResult[] = [];
    const aggregateMetrics: Record<number, AggregateMetrics> = {};

    const totalOperations = dataset.testCases.length * this.config.kValues.length;
    let completedOperations = 0;

    try {
      // Evaluate each K value
      for (const k of this.config.kValues) {
        const kResults: SingleQueryResult[] = [];

        // Evaluate each test case
        for (const testCase of dataset.testCases) {
          // Check for abort
          if (this.abortController.signal.aborted) {
            throw new Error('Evaluation cancelled');
          }

          // Report progress
          if (onProgress) {
            onProgress({
              completed: completedOperations,
              total: totalOperations,
              currentQuery: testCase.query.substring(0, 50) + '...',
              currentK: k,
              status: 'running',
            });
          }

          const result = await this.evaluateSingleQuery(testCase, k);
          kResults.push(result);
          allResults.push(result);
          completedOperations++;
        }

        // Aggregate metrics for this K
        aggregateMetrics[k] = this.aggregateMetricsForK(kResults);
      }

      // Final progress
      if (onProgress) {
        onProgress({
          completed: totalOperations,
          total: totalOperations,
          status: 'completed',
        });
      }

      const completedAt = new Date().toISOString();
      const successfulQueries = allResults.filter(r => !r.error).length;
      const failedQueries = allResults.filter(r => r.error).length;

      return {
        id: evalId,
        datasetId: dataset.id,
        datasetName: dataset.name,
        startedAt,
        completedAt,
        config: this.config,
        results: allResults,
        aggregateMetrics,
        summary: {
          totalQueries: allResults.length,
          successfulQueries,
          failedQueries,
          totalDurationMs: allResults.reduce((sum, r) => sum + r.durationMs, 0),
        },
      };
    } catch (error) {
      if (onProgress) {
        onProgress({
          completed: completedOperations,
          total: totalOperations,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel a running evaluation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if the evaluator is ready (integrations available)
   */
  async checkReadiness(): Promise<{
    ready: boolean;
    ragIntegration: boolean;
    llmJudge: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Check RAG integration
    const ragHealth = await ragClient.checkHealth(this.config.integrationMode);
    if (!ragHealth.ready) {
      errors.push(`RAG integration (${this.config.integrationMode}) not available: ${ragHealth.error || 'unknown error'}`);
    }

    // Check LLM Judge (only if generation metrics enabled)
    let llmJudgeReady = true;
    if (this.config.enableGenerationMetrics) {
      llmJudgeReady = this.llmJudge.isAvailable() && await this.llmJudge.testConnection();
      if (!llmJudgeReady) {
        errors.push('LLM Judge not available - Ollama not reachable or model not available (check Settings)');
      }
    }

    return {
      ready: ragHealth.ready && (llmJudgeReady || !this.config.enableGenerationMetrics),
      ragIntegration: ragHealth.ready,
      llmJudge: llmJudgeReady,
      errors,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EvaluationConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.integrationMode) {
      ragClient.setDefaultMode(config.integrationMode);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): EvaluationConfig {
    return { ...this.config };
  }
}

// Export singleton with default config
export const evaluator = new Evaluator();

