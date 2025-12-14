/**
 * FRC-RAG Integration Module
 * 
 * Provides unified interface for both API and Direct integration modes.
 */

import { FRCRAGApiClient, frcRagApi } from './frc-rag-api';
import { FRCRAGDirectClient, frcRagDirect } from './frc-rag-direct';
import { TextChromaDirectClient, textChromaDirect } from './text-chroma-direct';
import type { RAGResponse } from '@/types';

export { FRCRAGApiClient, frcRagApi } from './frc-rag-api';
export { FRCRAGDirectClient, frcRagDirect } from './frc-rag-direct';
export { TextChromaDirectClient, textChromaDirect } from './text-chroma-direct';

type IntegrationMode = 'api' | 'direct' | 'text';

interface UnifiedQueryOptions {
  k?: number;
  enableFiltering?: boolean;
  targetDocs?: number;
  enableGamePieceEnhancement?: boolean;
  includeImageTypes?: boolean;
  enableCache?: boolean;
  retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
  bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
  where?: Record<string, string>;
  mode?: IntegrationMode;
}

/**
 * Unified RAG client that can use either API or Direct mode
 */
export class UnifiedRAGClient {
  private apiClient: FRCRAGApiClient;
  private directClient: FRCRAGDirectClient;
  private textClient: TextChromaDirectClient;
  private defaultMode: IntegrationMode;

  constructor(defaultMode: IntegrationMode = 'api') {
    this.apiClient = frcRagApi;
    this.directClient = frcRagDirect;
    this.textClient = textChromaDirect;
    this.defaultMode = defaultMode;
  }

  /**
   * Check health/readiness of the specified integration mode
   */
  async checkHealth(mode?: IntegrationMode): Promise<{ ready: boolean; error?: string }> {
    const useMode = mode || this.defaultMode;

    if (useMode === 'api') {
      const result = await this.apiClient.checkHealth();
      return { ready: result.healthy };
    } else if (useMode === 'direct') {
      return this.directClient.checkSetup();
    } else {
      return this.textClient.checkSetup();
    }
  }

  /**
   * Query the RAG system using the specified mode
   */
  async query(
    queryText: string,
    options?: UnifiedQueryOptions
  ): Promise<RAGResponse> {
    const mode = options?.mode || this.defaultMode;

    if (mode === 'api') {
      return this.apiClient.query(queryText, {
        k: options?.k,
        enableFiltering: options?.enableFiltering,
      });
    } else if (mode === 'direct') {
      return this.directClient.query(queryText, {
        k: options?.k,
        enableFiltering: options?.enableFiltering,
      });
    } else {
      return this.textClient.query(queryText, {
        k: options?.k,
        enableFiltering: options?.enableFiltering,
        targetDocs: options?.targetDocs,
        enableGamePieceEnhancement: options?.enableGamePieceEnhancement,
        includeImageTypes: options?.includeImageTypes,
        enableCache: options?.enableCache,
        retrievalMethod: options?.retrievalMethod,
        bm25Variant: options?.bm25Variant,
        where: options?.where,
      });
    }
  }

  /**
   * Get the current default mode
   */
  getDefaultMode(): IntegrationMode {
    return this.defaultMode;
  }

  /**
   * Set the default mode
   */
  setDefaultMode(mode: IntegrationMode): void {
    this.defaultMode = mode;
  }
}

// Export singleton
export const ragClient = new UnifiedRAGClient();


