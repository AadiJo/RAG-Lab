/**
 * FRC-RAG Direct Integration (Python Bridge)
 * 
 * Uses Bun.spawn() to directly call the FRC-RAG Python modules.
 * Use this mode for faster local evaluation without needing to run the server.
 */

import { spawn } from 'bun';
import type { RAGResponse, RetrievedDocument, RetrievedImage, FRCRAGConfig } from '@/types';

const DEFAULT_CONFIG: FRCRAGConfig = {
  backendPath: process.env.FRC_RAG_BACKEND_PATH || '/home/aadi/L-Projects/frc-rag/backend',
};

interface DirectQueryOptions {
  k?: number;
  enableFiltering?: boolean;
}

/**
 * Python script that we'll execute to query the RAG system directly
 */
const QUERY_SCRIPT = `
import sys
import json
import os

# Add the backend to path
backend_path = sys.argv[1]
sys.path.insert(0, backend_path)
sys.path.insert(0, os.path.join(backend_path, 'src'))

from core.query_processor import QueryProcessor
from server.config import get_config

Config = get_config()

# Initialize query processor
qp = QueryProcessor(
    Config.CHROMA_PATH,
    Config.IMAGES_PATH,
    enable_cache=False,  # Disable cache for evaluation
    enable_post_processing=True
)

# Parse query parameters
query = sys.argv[2]
k = int(sys.argv[3])
enable_filtering = sys.argv[4].lower() == 'true'

# Execute query
result = qp.process_query(query, k=k, enable_filtering=enable_filtering)

# Output as JSON
print(json.dumps(result, default=str))
`;

/**
 * FRC-RAG Direct Python Bridge Client
 */
export class FRCRAGDirectClient {
  private backendPath: string;
  private pythonPath: string;

  constructor(config?: Partial<FRCRAGConfig>) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    this.backendPath = mergedConfig.backendPath || DEFAULT_CONFIG.backendPath!;
    this.pythonPath = process.env.PYTHON_PATH || 'python3';
  }

  /**
   * Check if the Python environment is properly set up
   */
  async checkSetup(): Promise<{ ready: boolean; error?: string }> {
    try {
      // Check if Python is available
      const pythonCheck = spawn(['python3', '--version']);
      const pythonResult = await pythonCheck.exited;
      if (pythonResult !== 0) {
        return { ready: false, error: 'Python3 not found' };
      }

      // Check if backend path exists
      const fs = await import('fs');
      if (!fs.existsSync(this.backendPath)) {
        return { ready: false, error: `Backend path not found: ${this.backendPath}` };
      }

      // Check if required modules exist
      const queryProcessorPath = `${this.backendPath}/src/core/query_processor.py`;
      if (!fs.existsSync(queryProcessorPath)) {
        return { ready: false, error: 'query_processor.py not found' };
      }

      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Query the FRC-RAG system directly via Python
   */
  async query(
    queryText: string,
    options?: DirectQueryOptions
  ): Promise<RAGResponse> {
    const startTime = performance.now();
    const k = options?.k || 10;
    const enableFiltering = options?.enableFiltering || false;

    try {
      // Write the query script to a temp file
      const tempScriptPath = '/tmp/rag_eval_query.py';
      await Bun.write(tempScriptPath, QUERY_SCRIPT);

      // Execute Python with the script
      const proc = spawn([
        this.pythonPath,
        tempScriptPath,
        this.backendPath,
        queryText,
        k.toString(),
        enableFiltering.toString(),
      ], {
        cwd: this.backendPath,
        env: {
          ...process.env,
          PYTHONPATH: `${this.backendPath}:${this.backendPath}/src`,
        },
      });

      // Collect stdout
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      const exitCode = await proc.exited;
      const retrievalTime = performance.now() - startTime;

      if (exitCode !== 0) {
        console.error('Python script stderr:', stderr);
        throw new Error(`Python script failed with exit code ${exitCode}: ${stderr}`);
      }

      // Parse the JSON output
      const rawResult = JSON.parse(stdout.trim());
      return this.transformResponse(queryText, rawResult, retrievalTime);

    } catch (error) {
      const retrievalTime = performance.now() - startTime;
      console.error('Direct query failed:', error);

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
   * Transform Python output to standardized format
   */
  private transformResponse(
    query: string,
    raw: Record<string, unknown>,
    retrievalTimeMs: number
  ): RAGResponse {
    // Extract documents
    const documents: RetrievedDocument[] = [];
    const contextParts = raw.context_parts as string[] | undefined;
    const rawDocs = raw.documents as Array<Record<string, unknown>> | undefined;

    if (contextParts && contextParts.length > 0) {
      contextParts.forEach((content, index) => {
        documents.push({
          content: String(content),
          rank: index,
        });
      });
    } else if (rawDocs && rawDocs.length > 0) {
      rawDocs.forEach((doc, index) => {
        documents.push({
          content: String(doc.page_content || doc.content || ''),
          metadata: doc.metadata as Record<string, unknown> | undefined,
          rank: index,
        });
      });
    }

    // Extract images
    const rawImages = raw.related_images as Array<Record<string, unknown>> | undefined;
    const images: RetrievedImage[] = (rawImages || []).map((img) => ({
      filename: String(img.filename || ''),
      filePath: String(img.file_path || ''),
      webPath: String(img.web_path || img.file_path || ''),
      page: img.page as number | string | undefined,
      contextSummary: img.context_summary as string | undefined,
      ocrText: img.ocr_text as string | undefined,
      score: img.score as number | undefined,
      exists: img.exists as boolean | undefined,
    }));

    return {
      query,
      enhancedQuery: raw.enhanced_query as string | undefined,
      response: String(raw.response || ''),
      documents,
      images,
      retrievalTimeMs,
      metadata: {
        matchedPieces: raw.matched_pieces as string[] | undefined,
        contextSources: raw.context_sources as number | undefined,
        postProcessingApplied: raw.post_processing_applied as boolean | undefined,
      },
    };
  }
}

// Export singleton with default config
export const frcRagDirect = new FRCRAGDirectClient();

