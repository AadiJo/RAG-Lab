/**
 * RAG Integration Module
 * 
 * Provides unified interface for text-only Chroma retrieval.
 */

import { TextChromaDirectClient, textChromaDirect } from './text-chroma-direct';
import type { RAGResponse } from '@/types';

export { TextChromaDirectClient, textChromaDirect } from './text-chroma-direct';

interface UnifiedQueryOptions {
  k?: number;
  enableFiltering?: boolean;
  targetDocs?: number;
  includeImageTypes?: boolean;
  enableCache?: boolean;
  retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
  bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
  where?: Record<string, string>;
}

/**
 * Unified RAG client for text-only Chroma retrieval
 */
export class UnifiedRAGClient {
  private textClient: TextChromaDirectClient;

  constructor() {
    this.textClient = textChromaDirect;
  }

  /**
   * Check health/readiness of the text retrieval system
   */
  async checkHealth(): Promise<{ ready: boolean; error?: string }> {
    return this.textClient.checkSetup();
  }

  /**
   * Query the RAG system
   */
  async query(
    queryText: string,
    options?: UnifiedQueryOptions
  ): Promise<RAGResponse> {
    return this.textClient.query(queryText, {
      k: options?.k,
      enableFiltering: options?.enableFiltering,
      targetDocs: options?.targetDocs,
      includeImageTypes: options?.includeImageTypes,
      enableCache: options?.enableCache,
      retrievalMethod: options?.retrievalMethod,
      bm25Variant: options?.bm25Variant,
      where: options?.where,
    });
  }

  /**
   * Set the default mode (kept for API compatibility, but only 'text' is supported)
   */
  setDefaultMode(_mode: string): void {
    // No-op: only text mode is supported now
  }
}

// Export singleton
export const ragClient = new UnifiedRAGClient();

