/**
 * Text DB Management Endpoints
 *
 * Build and manage text-only Chroma DB variants for ablation testing.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'bun';

export const textDbRoutes = new Hono();

const TEXTDBS_DIR = process.env.TEXTDBS_DIR || './data/text_dbs';
const ACTIVE_FILE = join(TEXTDBS_DIR, 'active.json');

type BuildStatus = 'queued' | 'running' | 'completed' | 'failed';

interface TextDbBuildJob {
  id: string;
  status: BuildStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    message?: string;
    current?: number;
    total?: number;
  };
  inputDir: string;
  outputDir: string;
  config: Record<string, unknown>;
  logs: string;
  error?: string;
}

const jobs = new Map<string, TextDbBuildJob>();

function resolvePythonPath(): string {
  const env = process.env.PYTHON_PATH;
  if (env) return env;
  const venvPython = join(process.cwd(), '.venv-textdb', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

async function ensureTextDbsDir(): Promise<void> {
  if (!existsSync(TEXTDBS_DIR)) {
    await mkdir(TEXTDBS_DIR, { recursive: true });
  }
}

async function listDbDirs(): Promise<string[]> {
  await ensureTextDbsDir();
  const entries = await readdir(TEXTDBS_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function appendLog(job: TextDbBuildJob, chunk: string) {
  const next = (job.logs + chunk).slice(-50_000); // keep last 50KB
  job.logs = next;

  // Parse simple progress lines:
  // PROGRESS: pdf i/n ...
  const m = chunk.match(/PROGRESS:\s+pdf\s+(\d+)\/(\d+)\s+(.*)/);
  if (m) {
    job.progress = {
      current: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      message: m[3],
    };
  }
}

async function setActiveDbPath(path: string): Promise<void> {
  await ensureTextDbsDir();
  await writeFile(ACTIVE_FILE, JSON.stringify({ activeDbPath: path }, null, 2));
}

// List DBs (directories containing _manifest.json)
textDbRoutes.get('/list', async (c) => {
  const dirs = await listDbDirs();
  const dbs = [];
  for (const d of dirs) {
    const manifestPath = join(TEXTDBS_DIR, d, '_manifest.json');
    const manifest = await readJsonIfExists(manifestPath);
    if (!manifest) continue;
    dbs.push({
      name: d,
      path: join(TEXTDBS_DIR, d),
      manifest,
    });
  }

  const active = await readJsonIfExists(ACTIVE_FILE);
  return c.json({ dbs, active });
});

// Set active DB by name
textDbRoutes.post('/active', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String((body as any).name || '');
  if (!name) return c.json({ error: 'name is required' }, 400);

  const path = join(TEXTDBS_DIR, name);
  if (!existsSync(path)) return c.json({ error: `DB not found: ${name}` }, 404);

  await setActiveDbPath(path);
  return c.json({ ok: true, activeDbPath: path });
});

// Start a build
textDbRoutes.post('/build', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const name = String((body as any).name || `db_${Date.now().toString(36)}`);
  const inputDir = String((body as any).inputDir || '/home/aadi/L-Projects/frc-rag/backend/data');
  const representation = String((body as any).representation || 'structured');
  const chunkSize = Number((body as any).chunkSize ?? 800);
  const chunkOverlap = Number((body as any).chunkOverlap ?? 200);
  const embeddingModel = String((body as any).embeddingModel || process.env.TEXT_EMBEDDING_MODEL || 'BAAI/bge-large-en-v1.5');
  const embeddingDevice = String((body as any).embeddingDevice || process.env.TEXT_EMBEDDING_DEVICE || 'cpu');
  const includeFilenameBanner = Boolean((body as any).includeFilenameBanner ?? true);
  const setActive = Boolean((body as any).setActive ?? true);

  await ensureTextDbsDir();
  const outputDir = join(TEXTDBS_DIR, name);
  await mkdir(outputDir, { recursive: true });

  const id = `textdb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: TextDbBuildJob = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    inputDir,
    outputDir,
    config: {
      name,
      representation,
      chunkSize,
      chunkOverlap,
      embeddingModel,
      embeddingDevice,
      includeFilenameBanner,
    },
    logs: '',
  };
  jobs.set(id, job);

  // Fire-and-forget build
  (async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    const pythonPath = resolvePythonPath();
    const scriptPath = `${process.cwd()}/python/text_rag/build_text_db.py`;

    const proc = spawn([
      pythonPath,
      scriptPath,
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--representation',
      representation,
      '--chunk-size',
      chunkSize.toString(),
      '--chunk-overlap',
      chunkOverlap.toString(),
      '--embedding-model',
      embeddingModel,
      '--embedding-device',
      embeddingDevice,
      ...(includeFilenameBanner ? ['--include-filename-banner'] : []),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python`,
      },
    });

    const streamToLogs = async (stream?: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) appendLog(job, decoder.decode(value));
      }
    };

    await Promise.all([
      streamToLogs(proc.stdout),
      streamToLogs(proc.stderr),
    ]);

    const exitCode = await proc.exited;
    job.completedAt = new Date().toISOString();

    if (exitCode === 0) {
      job.status = 'completed';
      if (setActive) {
        await setActiveDbPath(outputDir);
      }
    } else {
      job.status = 'failed';
      job.error = `Build failed with exit code ${exitCode}`;
    }
  })();

  return c.json({ id, status: job.status, outputDir });
});

// Build status
textDbRoutes.get('/build/:id', (c) => {
  const id = c.req.param('id');
  const job = jobs.get(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json(job);
});


