/**
 * Text-only Chroma Direct Integration (Python Bridge)
 *
 * Queries a persisted Chroma DB directly via Python.
 * Intended for rapid iteration on text retrieval quality.
 */

import { spawn } from 'bun';
import type { RAGResponse, RetrievedDocument, TextDbConfig } from '@/types';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';

interface TextQueryOptions {
  k?: number;
  enableFiltering?: boolean;
  targetDocs?: number;
  includeImageTypes?: boolean;
  enableCache?: boolean;
  retrievalMethod?: 'vector' | 'bm25' | 'tf' | 'hybrid';
  bm25Variant?: 'bm25' | 'bm25_no_idf' | 'tf';
  where?: Record<string, string>;
}

const DEFAULT_CONFIG: TextDbConfig = {
  chromaPath: process.env.TEXT_CHROMA_PATH || process.env.CHROMA_PATH || './data/text_dbs',
};

export class TextChromaDirectClient {
  private pythonPath: string;
  private defaultChromaPath: string;

  constructor(config?: Partial<TextDbConfig>) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const venvPython = join(process.cwd(), '.venv-textdb', 'bin', 'python');
    this.pythonPath = process.env.PYTHON_PATH || (existsSync(venvPython) ? venvPython : 'python3');
    this.defaultChromaPath = mergedConfig.chromaPath || DEFAULT_CONFIG.chromaPath!;
  }

  private cache = new Map<string, { at: number; value: RAGResponse }>();
  private cacheTtlMs = 5 * 60 * 1000;

  private resolveChromaPath(): string {
    const envPath = process.env.TEXT_CHROMA_PATH || process.env.CHROMA_PATH;
    if (envPath) return envPath;

    const textDbsDir = process.env.TEXTDBS_DIR || './data/text_dbs';
    const activeFile = join(textDbsDir, 'active.json');
    if (existsSync(activeFile)) {
      try {
        const raw = JSON.parse(readFileSync(activeFile, 'utf-8')) as { activeDbPath?: string };
        if (raw.activeDbPath) return raw.activeDbPath;
      } catch {
        // ignore
      }
    }

    return this.defaultChromaPath;
  }

  async checkSetup(): Promise<{ ready: boolean; error?: string }> {
    try {
      const pythonCheck = spawn([this.pythonPath, '--version']);
      const pythonResult = await pythonCheck.exited;
      if (pythonResult !== 0) {
        return { ready: false, error: `Python not found: ${this.pythonPath}` };
      }

      const fs = await import('fs');
      const chromaPath = this.resolveChromaPath();
      if (!fs.existsSync(chromaPath)) {
        return { ready: false, error: `Chroma DB path not found: ${chromaPath}` };
      }

      const scriptPath = `${process.cwd()}/python/text_rag/query_text.py`;
      if (!fs.existsSync(scriptPath)) {
        return { ready: false, error: `Text query script not found: ${scriptPath}` };
      }

      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async query(queryText: string, options?: TextQueryOptions): Promise<RAGResponse> {
    const startTime = performance.now();
    const k = options?.k || 10;
    const enableFiltering = options?.enableFiltering || false;
    const targetDocs = options?.targetDocs;
    const includeImageTypes = options?.includeImageTypes;
    const enableCache = options?.enableCache || false;
    const retrievalMethod = options?.retrievalMethod || 'vector';
    const bm25Variant = options?.bm25Variant || 'bm25';
    const where = options?.where;

    try {
      const scriptPath = `${process.cwd()}/python/text_rag/query_text.py`;
      const chromaPath = this.resolveChromaPath();

      const cacheKey = JSON.stringify({
        chromaPath,
        queryText,
        k,
        enableFiltering,
        targetDocs,
        includeImageTypes,
        retrievalMethod,
        bm25Variant,
        where,
      });
      if (enableCache) {
        const hit = this.cache.get(cacheKey);
        if (hit && (Date.now() - hit.at) < this.cacheTtlMs) {
          return hit.value;
        }
      }

      const proc = spawn([
        this.pythonPath,
        scriptPath,
        '--chroma-path',
        chromaPath,
        '--query',
        queryText,
        '--k',
        k.toString(),
        ...(enableFiltering ? ['--enable-filtering'] : []),
        ...(targetDocs ? ['--target-docs', targetDocs.toString()] : []),
        ...(includeImageTypes ? ['--include-image-types'] : []),
        ...(where ? ['--where-json', JSON.stringify(where)] : []),
        '--retrieval-method',
        retrievalMethod,
        '--bm25-variant',
        bm25Variant,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // Ensure python can import `text_rag.*` from our repo.
          PYTHONPATH: `${process.cwd()}/python`,
        },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      const retrievalTime = performance.now() - startTime;

      if (exitCode !== 0) {
        throw new Error(`Text query script failed (${exitCode}): ${stderr || stdout}`);
      }

      const raw = JSON.parse(stdout.trim()) as Record<string, unknown>;
      const out = this.transformResponse(queryText, raw, retrievalTime);
      if (enableCache) {
        this.cache.set(cacheKey, { at: Date.now(), value: out });
      }
      return out;
    } catch (error) {
      const retrievalTime = performance.now() - startTime;
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

  private transformResponse(query: string, raw: Record<string, unknown>, retrievalTimeMs: number): RAGResponse {
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

    return {
      query,
      enhancedQuery: raw.enhanced_query as string | undefined,
      response: '', // text-only retrieval mode (generation happens elsewhere)
      documents,
      images: [],
      retrievalTimeMs,
      metadata: {
        contextSources: raw.context_sources as number | undefined,
        postProcessingApplied: raw.post_processing_applied as boolean | undefined,
      },
    };
  }
}

export const textChromaDirect = new TextChromaDirectClient();

