/**
 * Retrieval Metrics Implementation
 * 
 * Implements standard IR evaluation metrics:
 * - Precision@K
 * - Recall@K
 * - Hit Rate@K
 * - Mean Reciprocal Rank (MRR)
 * - Normalized Discounted Cumulative Gain (NDCG)
 * - F1@K
 */

import type {
  RetrievedDocument,
  GroundTruth,
  RetrievalMetrics,
  RelevanceJudgment,
} from '@/types';

/**
 * Normalize text for comparison (lowercase, collapse whitespace)
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Calculate keyword overlap between document and expected keywords
 */
function calculateKeywordMatches(
  documentContent: string,
  expectedKeywords: string[]
): { matchCount: number; matchedKeywords: string[] } {
  const normalizedDoc = normalizeText(documentContent);
  const matchedKeywords: string[] = [];

  for (const keyword of expectedKeywords) {
    const normalizedKeyword = keyword.toLowerCase().trim();
    if (normalizedDoc.includes(normalizedKeyword)) {
      matchedKeywords.push(keyword);
    }
  }

  return {
    matchCount: matchedKeywords.length,
    matchedKeywords,
  };
}

/**
 * Determine if a document is relevant based on ground truth
 * A document is considered relevant if it contains at least 20% of expected keywords
 * or matches any of the relevant chunks
 */
export function judgeRelevance(
  document: RetrievedDocument,
  groundTruth: GroundTruth,
  index: number
): RelevanceJudgment {
  const { expectedKeywords, relevantChunks, excludedKeywords } = groundTruth;
  const content = document.content;
  const normalizedContent = normalizeText(content);

  // Check for excluded keywords (negative relevance)
  if (excludedKeywords && excludedKeywords.length > 0) {
    for (const excluded of excludedKeywords) {
      if (normalizedContent.includes(excluded.toLowerCase())) {
        return {
          documentIndex: index,
          isRelevant: false,
          relevanceScore: 0,
          matchedKeywords: [],
        };
      }
    }
  }

  // Calculate keyword matches
  const { matchCount, matchedKeywords } = calculateKeywordMatches(
    content,
    expectedKeywords
  );

  // Calculate relevance score based on keyword coverage
  const keywordScore =
    expectedKeywords.length > 0 ? matchCount / expectedKeywords.length : 0;

  // Check for chunk matches (if provided)
  let chunkMatch = false;
  if (relevantChunks && relevantChunks.length > 0) {
    for (const chunk of relevantChunks) {
      const normalizedChunk = normalizeText(chunk);
      // Check for significant overlap (at least 50% of words match)
      const chunkWords = new Set(normalizedChunk.split(' '));
      const docWords = new Set(normalizedContent.split(' '));
      const overlap = [...chunkWords].filter((w) => docWords.has(w)).length;
      if (overlap / chunkWords.size >= 0.5) {
        chunkMatch = true;
        break;
      }
    }
  }

  // Document is relevant if:
  // 1. It matches at least 20% of expected keywords, OR
  // 2. It matches a relevant chunk
  const relevanceThreshold = Math.max(1, expectedKeywords.length * 0.2);
  const isRelevant = matchCount >= relevanceThreshold || chunkMatch;

  // Calculate final relevance score (0-1)
  const relevanceScore = chunkMatch
    ? Math.max(keywordScore, 0.8) // Chunk match gets at least 0.8
    : keywordScore;

  return {
    documentIndex: index,
    isRelevant,
    relevanceScore,
    matchedKeywords,
  };
}

/**
 * Calculate Precision@K
 * Proportion of retrieved documents that are relevant
 */
export function precisionAtK(
  judgments: RelevanceJudgment[],
  k: number
): number {
  if (k === 0) return 0;

  const topK = judgments.slice(0, k);
  const relevantCount = topK.filter((j) => j.isRelevant).length;

  return relevantCount / k;
}

/**
 * Calculate Recall@K
 * Proportion of expected keywords found in the top K documents
 */
export function recallAtK(
  documents: RetrievedDocument[],
  groundTruth: GroundTruth,
  k: number
): number {
  const { expectedKeywords } = groundTruth;
  if (expectedKeywords.length === 0) return 0;

  // Combine all content from top K documents
  const combinedContent = documents
    .slice(0, k)
    .map((d) => d.content)
    .join(' ');

  const { matchCount } = calculateKeywordMatches(combinedContent, expectedKeywords);

  return matchCount / expectedKeywords.length;
}

/**
 * Calculate Hit Rate@K
 * Binary indicator: is there at least one relevant document in top K?
 */
export function hitRateAtK(judgments: RelevanceJudgment[], k: number): boolean {
  const topK = judgments.slice(0, k);
  return topK.some((j) => j.isRelevant);
}

/**
 * Calculate Mean Reciprocal Rank (MRR)
 * Returns 1/rank of the first relevant document (0 if none found)
 */
export function meanReciprocalRank(judgments: RelevanceJudgment[]): number {
  for (let i = 0; i < judgments.length; i++) {
    if (judgments[i].isRelevant) {
      return 1 / (i + 1); // Rank is 1-indexed
    }
  }
  return 0;
}

/**
 * Calculate Discounted Cumulative Gain at position K
 */
function dcgAtK(judgments: RelevanceJudgment[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, judgments.length); i++) {
    const relevance = judgments[i].relevanceScore;
    // DCG formula: rel_i / log2(i + 2) (position is 1-indexed, so i+2 for log)
    dcg += relevance / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * Calculate Ideal DCG at position K
 * Assumes perfect ranking where all relevant docs come first
 */
function idealDcgAtK(judgments: RelevanceJudgment[], k: number): number {
  // Sort by relevance score descending
  const sorted = [...judgments].sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );
  return dcgAtK(sorted, k);
}

/**
 * Calculate Normalized Discounted Cumulative Gain (NDCG)
 * NDCG = DCG / IDCG (normalized to 0-1 scale)
 */
export function ndcgAtK(judgments: RelevanceJudgment[], k: number): number {
  const dcg = dcgAtK(judgments, k);
  const idcg = idealDcgAtK(judgments, k);

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Calculate F1@K (harmonic mean of precision and recall)
 */
export function f1AtK(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Calculate all retrieval metrics for a set of retrieved documents
 */
export function calculateRetrievalMetrics(
  documents: RetrievedDocument[],
  groundTruth: GroundTruth,
  k: number
): RetrievalMetrics {
  // Judge relevance for each document
  const judgments: RelevanceJudgment[] = documents.map((doc, index) =>
    judgeRelevance(doc, groundTruth, index)
  );

  // Calculate all metrics
  const precision = precisionAtK(judgments, k);
  const recall = recallAtK(documents, groundTruth, k);
  const hitRate = hitRateAtK(judgments, k);
  const mrr = meanReciprocalRank(judgments);
  const ndcg = ndcgAtK(judgments, k);
  const f1 = f1AtK(precision, recall);

  return {
    precisionAtK: precision,
    recallAtK: recall,
    hitRateAtK: hitRate,
    mrr,
    ndcg,
    f1AtK: f1,
    k,
    documentsRetrieved: documents.length,
  };
}

/**
 * Aggregate retrieval metrics across multiple query results
 */
export function aggregateRetrievalMetrics(
  results: RetrievalMetrics[]
): {
  avgPrecision: number;
  avgRecall: number;
  avgF1: number;
  avgMRR: number;
  avgNDCG: number;
  hitRate: number;
} {
  if (results.length === 0) {
    return {
      avgPrecision: 0,
      avgRecall: 0,
      avgF1: 0,
      avgMRR: 0,
      avgNDCG: 0,
      hitRate: 0,
    };
  }

  const sum = results.reduce(
    (acc, r) => ({
      precision: acc.precision + r.precisionAtK,
      recall: acc.recall + r.recallAtK,
      f1: acc.f1 + r.f1AtK,
      mrr: acc.mrr + r.mrr,
      ndcg: acc.ndcg + r.ndcg,
      hits: acc.hits + (r.hitRateAtK ? 1 : 0),
    }),
    { precision: 0, recall: 0, f1: 0, mrr: 0, ndcg: 0, hits: 0 }
  );

  const count = results.length;

  return {
    avgPrecision: sum.precision / count,
    avgRecall: sum.recall / count,
    avgF1: sum.f1 / count,
    avgMRR: sum.mrr / count,
    avgNDCG: sum.ndcg / count,
    hitRate: sum.hits / count,
  };
}

