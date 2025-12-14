/**
 * FRC-RAG API Integration
 * 
 * HTTP client for connecting to a running FRC-RAG backend instance.
 * Use this mode when the backend is already running (e.g., in development or production).
 */

import type { RAGResponse, RetrievedDocument, RetrievedImage, FRCRAGConfig } from '@/types';

const DEFAULT_CONFIG: FRCRAGConfig = {
  apiUrl: process.env.FRC_RAG_API_URL || 'http://localhost:5002',
};

interface FRCRAGQueryOptions {
  k?: number;
  enableFiltering?: boolean;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface FRCRAGRawResponse {
  response?: string;
  context_parts?: string[];
  documents?: Array<{
    page_content?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
  related_images?: Array<{
    filename?: string;
    file_path?: string;
    web_path?: string;
    page?: number | string;
    context_summary?: string;
    ocr_text?: string;
    score?: number;
    exists?: boolean;
  }>;
  enhanced_query?: string;
  matched_pieces?: string[];
  context_sources?: number;
  post_processing_applied?: boolean;
  error?: string;
}

/**
 * FRC-RAG API Client
 */
export class FRCRAGApiClient {
  private apiUrl: string;
  private timeout: number;

  constructor(config?: Partial<FRCRAGConfig>) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    this.apiUrl = mergedConfig.apiUrl || DEFAULT_CONFIG.apiUrl!;
    this.timeout = 60000; // 60 second timeout
  }

  /**
   * Check if the FRC-RAG backend is healthy
   */
  async checkHealth(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { healthy: false };
      }

      const data = await response.json() as { status?: string; [key: string]: unknown };
      return {
        healthy: data.status === 'healthy' || data.status === 'degraded',
        details: data,
      };
    } catch (error) {
      // This is polled frequently by the UI; avoid noisy logs when FRC-RAG isn't running.
      if (process.env.LOG_EXTERNAL_HEALTH === '1') {
        console.error('FRC-RAG health check failed:', error);
      }
      return { healthy: false };
    }
  }

  /**
   * Query the FRC-RAG system
   */
  async query(
    queryText: string,
    options?: FRCRAGQueryOptions
  ): Promise<RAGResponse> {
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.apiUrl}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: queryText,
          k: options?.k || 10,
          enable_filtering: options?.enableFiltering || false,
          conversation_history: options?.conversationHistory || [],
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const retrievalTime = performance.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FRC-RAG API error: ${response.status} - ${errorText}`);
      }

      const rawData = await response.json() as FRCRAGRawResponse;

      if (rawData.error) {
        throw new Error(`FRC-RAG query error: ${rawData.error}`);
      }

      return this.transformResponse(queryText, rawData, retrievalTime);
    } catch (error) {
      const retrievalTime = performance.now() - startTime;
      console.error('FRC-RAG query failed:', error);

      return {
        query: queryText,
        response: '',
        documents: [],
        images: [],
        retrievalTimeMs: retrievalTime,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Transform raw FRC-RAG response to standardized format
   */
  private transformResponse(
    query: string,
    raw: FRCRAGRawResponse,
    retrievalTimeMs: number
  ): RAGResponse {
    // Extract documents from various possible formats
    const documents: RetrievedDocument[] = [];

    if (raw.context_parts && raw.context_parts.length > 0) {
      raw.context_parts.forEach((content, index) => {
        documents.push({
          content,
          rank: index,
        });
      });
    } else if (raw.documents && raw.documents.length > 0) {
      raw.documents.forEach((doc, index) => {
        documents.push({
          content: doc.page_content || doc.content || '',
          metadata: doc.metadata,
          rank: index,
        });
      });
    }

    // Transform images
    const images: RetrievedImage[] = (raw.related_images || []).map((img) => ({
      filename: img.filename || '',
      filePath: img.file_path || '',
      webPath: img.web_path || img.file_path || '',
      page: img.page,
      contextSummary: img.context_summary,
      ocrText: img.ocr_text,
      score: img.score,
      exists: img.exists,
    }));

    return {
      query,
      enhancedQuery: raw.enhanced_query,
      response: raw.response || '',
      documents,
      images,
      retrievalTimeMs,
      metadata: {
        matchedPieces: raw.matched_pieces,
        contextSources: raw.context_sources,
        postProcessingApplied: raw.post_processing_applied,
      },
    };
  }

  /**
   * Query with streaming response (for generation timing)
   * Note: This doesn't return the streamed text, just timing info
   */
  async queryWithTiming(
    queryText: string,
    options?: FRCRAGQueryOptions
  ): Promise<RAGResponse & { generationTimeMs: number }> {
    // For now, use regular query
    // TODO: Implement streaming endpoint parsing for accurate generation timing
    const result = await this.query(queryText, options);
    return {
      ...result,
      generationTimeMs: 0, // Would need streaming to measure this accurately
    };
  }

  /**
   * Get available configuration options from the backend
   */
  async getConfig(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const data = await response.json() as Record<string, unknown>;
      return data;
    } catch {
      return null;
    }
  }
}

// Export singleton with default config
export const frcRagApi = new FRCRAGApiClient();

