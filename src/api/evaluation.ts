/**
 * Evaluation API Endpoints
 * 
 * Endpoints for running and managing evaluations
 */

import { Hono } from 'hono';
import { Evaluator, type EvaluationProgress } from '../core/evaluator';
import { datasetManager } from '../core/dataset';
import type { EvaluationConfig, EvaluationResult, EvaluationStatus } from '@/types';
import { writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { generateRunSuggestion, type RunSuggestion } from '@/core/run-suggestions';

const evaluationRoutes = new Hono();

// In-memory store for running evaluations
const runningEvaluations = new Map<string, {
  status: EvaluationStatus;
  evaluator: Evaluator;
}>();

// In-memory store for suggestion generation (avoid long-running HTTP requests)
const suggestionJobs = new Map<string, { startedAt: number; error?: string }>();

// Results directory
const RESULTS_DIR = process.env.RESULTS_DIR || './results';

/**
 * Ensure results directory exists
 */
async function ensureResultsDir(): Promise<void> {
  if (!existsSync(RESULTS_DIR)) {
    await mkdir(RESULTS_DIR, { recursive: true });
  }
}

/**
 * Save evaluation result to file
 */
async function saveResult(result: EvaluationResult): Promise<void> {
  await ensureResultsDir();
  const filePath = join(RESULTS_DIR, `${result.id}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2));
}

async function loadSuggestion(id: string): Promise<RunSuggestion | null> {
  const filePath = join(RESULTS_DIR, `${id}.suggestion.json`);
  if (!existsSync(filePath)) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as RunSuggestion;
  } catch {
    return null;
  }
}

async function saveSuggestion(s: RunSuggestion): Promise<void> {
  await ensureResultsDir();
  const filePath = join(RESULTS_DIR, `${s.id}.suggestion.json`);
  await writeFile(filePath, JSON.stringify(s, null, 2));
}

async function deleteSuggestion(id: string): Promise<void> {
  const filePath = join(RESULTS_DIR, `${id}.suggestion.json`);
  if (!existsSync(filePath)) return;
  const { unlink } = await import('fs/promises');
  await unlink(filePath);
}

/**
 * Load evaluation result from file
 */
async function loadResult(id: string): Promise<EvaluationResult | null> {
  const filePath = join(RESULTS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function computeHeadline(result: EvaluationResult): Record<string, unknown> | null {
  try {
    const keys = Object.keys(result.aggregateMetrics || {}).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (keys.length === 0) return null;
    const preferredK = keys.includes(10) ? 10 : keys[Math.floor(keys.length / 2)]!;
    const metrics = (result.aggregateMetrics as any)[preferredK];
    if (!metrics) return null;

    return {
      k: preferredK,
      mode: (result.config as any)?.integrationMode,
      retrieval: {
        avgPrecision: metrics.retrieval?.avgPrecision ?? 0,
        avgRecall: metrics.retrieval?.avgRecall ?? 0,
        avgF1: metrics.retrieval?.avgF1 ?? 0,
        avgMRR: metrics.retrieval?.avgMRR ?? 0,
        avgNDCG: metrics.retrieval?.avgNDCG ?? 0,
        hitRate: metrics.retrieval?.hitRate ?? 0,
      },
      generation: metrics.generation ? {
        avgFaithfulness: metrics.generation.avgFaithfulness ?? 0,
        avgRelevancy: metrics.generation.avgRelevancy ?? 0,
        avgCorrectness: metrics.generation.avgCorrectness,
      } : undefined,
      image: metrics.image ? {
        avgImageCount: metrics.image.avgImageCount ?? 0,
        avgImageRelevanceRate: metrics.image.avgImageRelevanceRate ?? 0,
        avgImageQueryAlignment: metrics.image.avgImageQueryAlignment ?? 0,
      } : undefined,
    };
  } catch {
    return null;
  }
}

// Check system readiness
evaluationRoutes.get('/readiness', async (c) => {
  // Prefer checking local text mode if an active text DB exists.
  // This avoids noisy external health checks during UI polling.
  let evaluator: Evaluator;
  try {
    const TEXTDBS_DIR = process.env.TEXTDBS_DIR || './data/text_dbs';
    const ACTIVE_FILE = join(TEXTDBS_DIR, 'active.json');
    let hasActiveTextDb = false;
    if (existsSync(ACTIVE_FILE)) {
      try {
        const raw = JSON.parse(await readFile(ACTIVE_FILE, 'utf-8')) as { activeDbPath?: string };
        hasActiveTextDb = Boolean(raw?.activeDbPath);
      } catch {
        hasActiveTextDb = false;
      }
    }

    evaluator = hasActiveTextDb
      ? new Evaluator({ integrationMode: 'text', enableImageMetrics: false, enableGenerationMetrics: true })
      : new Evaluator();
  } catch {
    evaluator = new Evaluator();
  }
  const readiness = await evaluator.checkReadiness();
  
  return c.json({
    ready: readiness.ready,
    components: {
      ragIntegration: readiness.ragIntegration,
      llmJudge: readiness.llmJudge,
    },
    errors: readiness.errors,
    timestamp: new Date().toISOString(),
  });
});

// Start a new evaluation
evaluationRoutes.post('/start', async (c) => {
  try {
    const body = await c.req.json();
    const { datasetId, config } = body as {
      datasetId: string;
      config?: Partial<EvaluationConfig>;
    };

    if (!datasetId) {
      return c.json({ error: 'datasetId is required' }, 400);
    }

    // Load dataset
    const dataset = await datasetManager.loadDataset(datasetId);
    if (!dataset) {
      return c.json({ error: `Dataset not found: ${datasetId}` }, 404);
    }

    // Create evaluator with config
    const evaluator = new Evaluator(config);

    // Check readiness
    const readiness = await evaluator.checkReadiness();
    if (!readiness.ready) {
      return c.json({
        error: 'System not ready for evaluation',
        details: readiness.errors,
      }, 503);
    }

    // Generate evaluation ID
    const evalId = `eval_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    // Initialize status
    const status: EvaluationStatus = {
      id: evalId,
      status: 'pending',
      progress: {
        completed: 0,
        total: dataset.testCases.length * (config?.kValues?.length || 4),
      },
      startedAt: new Date().toISOString(),
    };

    runningEvaluations.set(evalId, { status, evaluator });

    // Start evaluation in background
    (async () => {
      const evalEntry = runningEvaluations.get(evalId)!;
      evalEntry.status.status = 'running';

      try {
        const result = await evaluator.evaluateDataset(dataset, (progress: EvaluationProgress) => {
          evalEntry.status.progress = {
            completed: progress.completed,
            total: progress.total,
            currentQuery: progress.currentQuery,
          };
        });

        // Save result
        await saveResult(result);

        evalEntry.status.status = 'completed';
        evalEntry.status.progress.completed = evalEntry.status.progress.total;
      } catch (error) {
        evalEntry.status.status = 'failed';
        evalEntry.status.error = error instanceof Error ? error.message : 'Unknown error';
      }
    })();

    return c.json({
      id: evalId,
      status: 'started',
      message: `Evaluation started for dataset: ${dataset.name}`,
      totalQueries: status.progress.total,
    });
  } catch (error) {
    console.error('Failed to start evaluation:', error);
    return c.json({ error: 'Failed to start evaluation' }, 500);
  }
});

// Get evaluation status
evaluationRoutes.get('/:id/status', (c) => {
  const id = c.req.param('id');
  const evaluation = runningEvaluations.get(id);

  if (!evaluation) {
    return c.json({ error: 'Evaluation not found' }, 404);
  }

  return c.json(evaluation.status);
});

// Cancel a running evaluation
evaluationRoutes.post('/:id/cancel', (c) => {
  const id = c.req.param('id');
  const evaluation = runningEvaluations.get(id);

  if (!evaluation) {
    return c.json({ error: 'Evaluation not found' }, 404);
  }

  if (evaluation.status.status !== 'running') {
    return c.json({ error: 'Evaluation is not running' }, 400);
  }

  evaluation.evaluator.cancel();
  evaluation.status.status = 'cancelled';

  return c.json({ message: 'Evaluation cancelled' });
});

// List all evaluation results
evaluationRoutes.get('/results', async (c) => {
  await ensureResultsDir();
  
  try {
    const files = await readdir(RESULTS_DIR);
    const results = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = join(RESULTS_DIR, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const result = JSON.parse(content) as EvaluationResult;
        results.push({
          id: result.id,
          datasetId: result.datasetId,
          datasetName: result.datasetName,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          integrationMode: result.config.integrationMode,
          summary: result.summary,
          headline: computeHeadline(result),
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by date descending
    results.sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    return c.json({ results });
  } catch (error) {
    console.error('Failed to list results:', error);
    return c.json({ error: 'Failed to list results' }, 500);
  }
});

// Get specific evaluation result
evaluationRoutes.get('/results/:id', async (c) => {
  const id = c.req.param('id');
  const result = await loadResult(id);

  if (!result) {
    return c.json({ error: 'Result not found' }, 404);
  }

  return c.json(result);
});

// Get AI suggested course of action for a result (cached on disk)
evaluationRoutes.get('/results/:id/suggestion', async (c) => {
  const id = c.req.param('id');
  const result = await loadResult(id);
  if (!result) return c.json({ error: 'Result not found' }, 404);

  const force = (c.req.query('force') || '').toLowerCase() === '1' || (c.req.query('force') || '').toLowerCase() === 'true';
  if (!force) {
    const cached = await loadSuggestion(id);
    if (cached) return c.json(cached);
  } else {
    // Force mode: remove cache so we regenerate
    try { await deleteSuggestion(id); } catch { /* ignore */ }
  }

  // If already generating, return a quick response to avoid proxy timeouts.
  const existing = suggestionJobs.get(id);
  if (existing) {
    // If an error happened recently, surface it
    if (existing.error) {
      return c.json({ error: existing.error }, 500);
    }
    return c.json({ status: 'generating' }, 202);
  }

  // Start background generation
  suggestionJobs.set(id, { startedAt: Date.now() });
  (async () => {
    try {
      const suggestion = await generateRunSuggestion(result);
      await saveSuggestion(suggestion);
      suggestionJobs.delete(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate suggestion';
      suggestionJobs.set(id, { startedAt: Date.now(), error: msg });
      // Auto-clear job error after a short window so user can retry
      setTimeout(() => {
        const cur = suggestionJobs.get(id);
        if (cur?.error === msg) suggestionJobs.delete(id);
      }, 30_000);
    }
  })();

  return c.json({ status: 'generating' }, 202);
});

evaluationRoutes.delete('/results/:id/suggestion', async (c) => {
  const id = c.req.param('id');
  await deleteSuggestion(id);
  return c.json({ ok: true });
});

// Clear all cached suggestions
evaluationRoutes.delete('/suggestions', async (c) => {
  await ensureResultsDir();
  const files = await readdir(RESULTS_DIR);
  const { unlink } = await import('fs/promises');
  let deleted = 0;
  for (const f of files) {
    if (!f.endsWith('.suggestion.json')) continue;
    try {
      await unlink(join(RESULTS_DIR, f));
      deleted += 1;
    } catch {
      // ignore
    }
  }
  return c.json({ ok: true, deleted });
});

// Get aggregate metrics for a result
evaluationRoutes.get('/results/:id/metrics', async (c) => {
  const id = c.req.param('id');
  const result = await loadResult(id);

  if (!result) {
    return c.json({ error: 'Result not found' }, 404);
  }

  return c.json({
    id: result.id,
    datasetName: result.datasetName,
    config: result.config,
    aggregateMetrics: result.aggregateMetrics,
    summary: result.summary,
  });
});

// Compare two evaluation results
evaluationRoutes.get('/compare', async (c) => {
  const baselineId = c.req.query('baseline');
  const comparisonId = c.req.query('comparison');

  if (!baselineId || !comparisonId) {
    return c.json({ error: 'Both baseline and comparison IDs are required' }, 400);
  }

  const baseline = await loadResult(baselineId);
  const comparison = await loadResult(comparisonId);

  if (!baseline) {
    return c.json({ error: `Baseline result not found: ${baselineId}` }, 404);
  }
  if (!comparison) {
    return c.json({ error: `Comparison result not found: ${comparisonId}` }, 404);
  }

  // Compare metrics at each K value
  const comparisons: Record<number, Record<string, { baseline: number; comparison: number; change: number; changePercent: number }>> = {};

  for (const k of Object.keys(baseline.aggregateMetrics).map(Number)) {
    const baseMetrics = baseline.aggregateMetrics[k];
    const compMetrics = comparison.aggregateMetrics[k];

    if (!baseMetrics || !compMetrics) continue;

    comparisons[k] = {
      precision: {
        baseline: baseMetrics.retrieval.avgPrecision,
        comparison: compMetrics.retrieval.avgPrecision,
        change: compMetrics.retrieval.avgPrecision - baseMetrics.retrieval.avgPrecision,
        changePercent: ((compMetrics.retrieval.avgPrecision - baseMetrics.retrieval.avgPrecision) / baseMetrics.retrieval.avgPrecision) * 100,
      },
      recall: {
        baseline: baseMetrics.retrieval.avgRecall,
        comparison: compMetrics.retrieval.avgRecall,
        change: compMetrics.retrieval.avgRecall - baseMetrics.retrieval.avgRecall,
        changePercent: ((compMetrics.retrieval.avgRecall - baseMetrics.retrieval.avgRecall) / baseMetrics.retrieval.avgRecall) * 100,
      },
      f1: {
        baseline: baseMetrics.retrieval.avgF1,
        comparison: compMetrics.retrieval.avgF1,
        change: compMetrics.retrieval.avgF1 - baseMetrics.retrieval.avgF1,
        changePercent: ((compMetrics.retrieval.avgF1 - baseMetrics.retrieval.avgF1) / baseMetrics.retrieval.avgF1) * 100,
      },
      mrr: {
        baseline: baseMetrics.retrieval.avgMRR,
        comparison: compMetrics.retrieval.avgMRR,
        change: compMetrics.retrieval.avgMRR - baseMetrics.retrieval.avgMRR,
        changePercent: ((compMetrics.retrieval.avgMRR - baseMetrics.retrieval.avgMRR) / baseMetrics.retrieval.avgMRR) * 100,
      },
      ndcg: {
        baseline: baseMetrics.retrieval.avgNDCG,
        comparison: compMetrics.retrieval.avgNDCG,
        change: compMetrics.retrieval.avgNDCG - baseMetrics.retrieval.avgNDCG,
        changePercent: ((compMetrics.retrieval.avgNDCG - baseMetrics.retrieval.avgNDCG) / baseMetrics.retrieval.avgNDCG) * 100,
      },
    };
  }

  return c.json({
    baseline: { id: baselineId, datasetName: baseline.datasetName },
    comparison: { id: comparisonId, datasetName: comparison.datasetName },
    comparisons,
  });
});

export { evaluationRoutes };

