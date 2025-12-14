/**
 * Generation Metrics Implementation
 * 
 * Wrapper around LLM Judge for evaluating generation quality:
 * - Faithfulness
 * - Answer Relevancy
 * - Answer Correctness
 */

import { LLMJudge, aggregateGenerationMetrics } from '../llm-judge';
import type { GenerationMetrics, RAGResponse, GroundTruth } from '@/types';

/**
 * Evaluate generation metrics for a single RAG response
 */
export async function evaluateGenerationMetrics(
  ragResponse: RAGResponse,
  groundTruth: GroundTruth,
  judge?: LLMJudge
): Promise<GenerationMetrics | null> {
  const llmJudge = judge || new LLMJudge();

  if (!llmJudge.isAvailable()) {
    console.warn('LLM Judge not available - skipping generation metrics');
    return null;
  }

  // Combine retrieved document content as context
  const context = ragResponse.documents
    .map((doc, i) => `[Document ${i + 1}]\n${doc.content}`)
    .join('\n\n');

  // Use the RAG response as the answer
  const answer = ragResponse.response;

  // Use reference answer from ground truth if available
  const referenceAnswer = groundTruth.referenceAnswer;

  return llmJudge.evaluateGeneration(
    ragResponse.query,
    answer,
    context,
    referenceAnswer
  );
}

/**
 * Batch evaluate generation metrics for multiple responses
 * Includes rate limiting to avoid overwhelming the API
 */
export async function batchEvaluateGenerationMetrics(
  responses: Array<{ ragResponse: RAGResponse; groundTruth: GroundTruth }>,
  judge?: LLMJudge,
  options?: {
    concurrency?: number;
    delayMs?: number;
  }
): Promise<Array<GenerationMetrics | null>> {
  const llmJudge = judge || new LLMJudge();
  const concurrency = options?.concurrency || 2; // Conservative default
  const delayMs = options?.delayMs || 500;

  const results: Array<GenerationMetrics | null> = [];

  // Process in batches to respect rate limits
  for (let i = 0; i < responses.length; i += concurrency) {
    const batch = responses.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(({ ragResponse, groundTruth }) =>
        evaluateGenerationMetrics(ragResponse, groundTruth, llmJudge)
      )
    );

    results.push(...batchResults);

    // Add delay between batches
    if (i + concurrency < responses.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// Re-export aggregation function
export { aggregateGenerationMetrics };

