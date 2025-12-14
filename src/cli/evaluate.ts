/**
 * CLI runner for dataset evaluations (local, no web UI required).
 *
 * Usage:
 *   bun run src/cli/evaluate.ts --dataset frc-eval-dataset --mode text --k 5,10 --filter
 */

import { Evaluator } from '@/core/evaluator';
import { datasetManager } from '@/core/dataset';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function main() {
  const datasetId = getArg('--dataset') || getArg('-d');
  if (!datasetId) {
    console.error('Missing --dataset');
    process.exit(1);
  }

  const mode = (getArg('--mode') || 'api') as 'api' | 'direct' | 'text';
  const kArg = getArg('--k') || '';
  const kValues = kArg
    ? kArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
    : undefined;
  const enableFiltering = hasFlag('--filter') || hasFlag('--enable-filtering');

  const dataset = await datasetManager.loadDataset(datasetId);
  if (!dataset) {
    console.error(`Dataset not found: ${datasetId}`);
    process.exit(2);
  }

  const evaluator = new Evaluator({
    integrationMode: mode,
    enableFiltering,
    kValues: kValues || [5, 10, 15, 20],
  });

  const readiness = await evaluator.checkReadiness();
  if (!readiness.ready) {
    console.error('System not ready:');
    readiness.errors.forEach(e => console.error(`- ${e}`));
    process.exit(3);
  }

  console.log(`Running evaluation: dataset=${dataset.id} mode=${mode} filter=${enableFiltering}`);
  const result = await evaluator.evaluateDataset(dataset, (p) => {
    if (p.status === 'running' && p.currentQuery) {
      process.stdout.write(`\r${p.completed}/${p.total}  K=${p.currentK ?? ''}  ${p.currentQuery}`);
    }
  });
  console.log('\nDone.');

  const resultsDir = process.env.RESULTS_DIR || './results';
  await ensureDir(resultsDir);
  const outPath = join(resultsDir, `${result.id}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`Saved: ${outPath}`);
}

await main();



