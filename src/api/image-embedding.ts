/**
 * Image Embedding Studio API
 * 
 * Endpoints for managing image embedding configurations and building databases
 * with custom image embedding settings.
 */

import { Hono } from 'hono';
import { readdir, readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, isAbsolute, relative } from 'path';
import { spawn } from 'bun';

export const imageEmbeddingRoutes = new Hono();

const CONFIGS_DIR = process.env.IMAGE_EMBEDDING_CONFIGS_DIR || './data/image_embedding_configs';
const DEFAULT_PDF_INPUT_DIR = process.env.TEXTDB_PDF_INPUT_DIR || './data/pdfs';
const TEXTDBS_DIR = process.env.TEXTDBS_DIR || './data/text_dbs';

// Ensure configs directory exists
async function ensureConfigsDir(): Promise<void> {
  if (!existsSync(CONFIGS_DIR)) {
    await mkdir(CONFIGS_DIR, { recursive: true });
  }
}

// Image embedding configuration schema
export interface ImageEmbeddingConfig {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  // Model selection
  embeddingModel: 'clip' | 'blip' | 'custom';
  customModelName?: string;
  // Context extraction
  includeContext: boolean;
  contextSource: 'before' | 'after' | 'both' | 'page' | 'none';
  contextChars: number; // Number of characters to include
  // OCR options
  enableOCR: boolean;
  ocrModel?: string;
  // Captioning options
  enableCaptioning: boolean;
  captioningModel?: string;
  // Image processing
  imageMinSize?: number; // Minimum image size in pixels (width or height)
  imageMaxSize?: number; // Maximum image size in pixels
  // Metadata
  metadata?: Record<string, unknown>;
}

type BuildStatus = 'queued' | 'running' | 'completed' | 'failed';

interface ImageDbBuildJob {
  id: string;
  status: BuildStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    message?: string;
    current?: number;
    total?: number;
    currentPdf?: string;
  };
  inputDir: string;
  outputDir: string;
  configId: string;
  config: ImageEmbeddingConfig;
  logs: string;
  error?: string;
}

const buildJobs = new Map<string, ImageDbBuildJob>();

function resolvePythonPath(): string {
  const env = process.env.PYTHON_PATH;
  if (env) return env;
  const venvPython = join(process.cwd(), '.venv-textdb', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

function projectRootAbs(): string {
  return resolve(process.cwd());
}

function resolvePathFromCwd(relOrAbsPath: string): string {
  if (!relOrAbsPath) return projectRootAbs();
  return isAbsolute(relOrAbsPath) ? relOrAbsPath : resolve(projectRootAbs(), relOrAbsPath);
}

function formatPathForClient(absPath: string): string {
  const root = projectRootAbs();
  const rel = relative(root, absPath) || '.';
  return rel.startsWith('..') ? absPath : rel;
}

function appendLog(job: ImageDbBuildJob, chunk: string) {
  const next = (job.logs + chunk).slice(-50_000);
  job.logs = next;

  // Parse progress lines
  const m = chunk.match(/PROGRESS:\s+pdf\s+(\d+)\/(\d+)\s+(.*)/);
  if (m) {
    job.progress = {
      current: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      message: m[3],
      currentPdf: m[3],
    };
  }
}

// List all image embedding configs
imageEmbeddingRoutes.get('/configs', async (c) => {
  await ensureConfigsDir();
  const files = await readdir(CONFIGS_DIR);
  const configs: ImageEmbeddingConfig[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await readFile(join(CONFIGS_DIR, file), 'utf-8');
      const config = JSON.parse(content) as ImageEmbeddingConfig;
      configs.push(config);
    } catch (e) {
      console.error(`Failed to read config ${file}:`, e);
    }
  }

  return c.json({ configs: configs.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ) });
});

// Get a specific config
imageEmbeddingRoutes.get('/configs/:id', async (c) => {
  const id = c.req.param('id');
  const configPath = join(CONFIGS_DIR, `${id}.json`);

  if (!existsSync(configPath)) {
    return c.json({ error: 'Config not found' }, 404);
  }

  const content = await readFile(configPath, 'utf-8');
  const config = JSON.parse(content) as ImageEmbeddingConfig;
  return c.json({ config });
});

// Create or update a config
imageEmbeddingRoutes.post('/configs', async (c) => {
  await ensureConfigsDir();
  const body = await c.req.json().catch(() => ({}));
  
  const id = String((body as any).id || `config_${Date.now().toString(36)}`);
  const name = String((body as any).name || 'Untitled Config');
  const existingPath = join(CONFIGS_DIR, `${id}.json`);
  const exists = existsSync(existingPath);

  let config: ImageEmbeddingConfig;
  if (exists) {
    // Update existing
    const content = await readFile(existingPath, 'utf-8');
    config = JSON.parse(content) as ImageEmbeddingConfig;
    config.name = name;
    config.description = String((body as any).description || config.description || '');
    config.updatedAt = new Date().toISOString();
    
    // Update fields
    if ((body as any).embeddingModel !== undefined) {
      config.embeddingModel = (body as any).embeddingModel;
    }
    if ((body as any).customModelName !== undefined) {
      config.customModelName = (body as any).customModelName;
    }
    if ((body as any).includeContext !== undefined) {
      config.includeContext = Boolean((body as any).includeContext);
    }
    if ((body as any).contextSource !== undefined) {
      config.contextSource = (body as any).contextSource;
    }
    if ((body as any).contextChars !== undefined) {
      config.contextChars = Number((body as any).contextChars);
    }
    if ((body as any).enableOCR !== undefined) {
      config.enableOCR = Boolean((body as any).enableOCR);
    }
    if ((body as any).ocrModel !== undefined) {
      config.ocrModel = (body as any).ocrModel;
    }
    if ((body as any).enableCaptioning !== undefined) {
      config.enableCaptioning = Boolean((body as any).enableCaptioning);
    }
    if ((body as any).captioningModel !== undefined) {
      config.captioningModel = (body as any).captioningModel;
    }
    if ((body as any).imageMinSize !== undefined) {
      config.imageMinSize = (body as any).imageMinSize ? Number((body as any).imageMinSize) : undefined;
    }
    if ((body as any).imageMaxSize !== undefined) {
      config.imageMaxSize = (body as any).imageMaxSize ? Number((body as any).imageMaxSize) : undefined;
    }
  } else {
    // Create new
    config = {
      id,
      name,
      description: String((body as any).description || ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embeddingModel: (body as any).embeddingModel || 'clip',
      customModelName: (body as any).customModelName,
      includeContext: Boolean((body as any).includeContext ?? true),
      contextSource: (body as any).contextSource || 'both',
      contextChars: Number((body as any).contextChars ?? 500),
      enableOCR: Boolean((body as any).enableOCR ?? false),
      ocrModel: (body as any).ocrModel,
      enableCaptioning: Boolean((body as any).enableCaptioning ?? false),
      captioningModel: (body as any).captioningModel,
      imageMinSize: (body as any).imageMinSize ? Number((body as any).imageMinSize) : undefined,
      imageMaxSize: (body as any).imageMaxSize ? Number((body as any).imageMaxSize) : undefined,
      metadata: (body as any).metadata || {},
    };
  }

  await writeFile(join(CONFIGS_DIR, `${id}.json`), JSON.stringify(config, null, 2));
  return c.json({ config });
});

// Delete a config
imageEmbeddingRoutes.delete('/configs/:id', async (c) => {
  const id = c.req.param('id');
  const configPath = join(CONFIGS_DIR, `${id}.json`);

  if (!existsSync(configPath)) {
    return c.json({ error: 'Config not found' }, 404);
  }

  await unlink(configPath);
  return c.json({ ok: true });
});

// List PDFs in a directory
imageEmbeddingRoutes.get('/pdfs', async (c) => {
  const rawDir = String(c.req.query('dir') || '').trim();
  const inputDir = rawDir || DEFAULT_PDF_INPUT_DIR;
  const absDir = resolvePathFromCwd(inputDir);

  if (!existsSync(absDir)) {
    return c.json({ error: `Directory not found: ${inputDir}` }, 404);
  }

  const entries = await readdir(absDir, { withFileTypes: true });
  const pdfs = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
    .map(e => ({
      name: e.name,
      path: formatPathForClient(join(absDir, e.name)),
      absPath: join(absDir, e.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json({ pdfs, directory: formatPathForClient(absDir) });
});

// Extract images from a PDF
imageEmbeddingRoutes.get('/pdfs/:filename/images', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'));
  const rawDir = String(c.req.query('dir') || '').trim();
  const inputDir = rawDir || DEFAULT_PDF_INPUT_DIR;
  const absDir = resolvePathFromCwd(inputDir);
  const pdfPath = join(absDir, filename);

  if (!existsSync(pdfPath)) {
    return c.json({ error: `PDF not found: ${filename}` }, 404);
  }

  // Use Python script to extract images
  const pythonPath = resolvePythonPath();
  const scriptPath = join(process.cwd(), 'python', 'text_rag', 'extract_pdf_images.py');

  try {
    const proc = spawn([
      pythonPath,
      scriptPath,
      '--pdf',
      pdfPath,
      '--json',
      '--include-base64',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python:${process.cwd()}/modules`,
      },
    });

    let stdout = '';
    let stderr = '';

    const decoder = new TextDecoder();
    const streamToStdout = async (stream?: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) stdout += decoder.decode(value);
      }
    };

    const streamToStderr = async (stream?: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) stderr += decoder.decode(value);
      }
    };

    await Promise.all([
      streamToStdout(proc.stdout),
      streamToStderr(proc.stderr),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ error: `Failed to extract images: ${stderr}` }, 500);
    }

    const result = JSON.parse(stdout);
    return c.json({ images: result.images || [], pdfPath: formatPathForClient(pdfPath) });
  } catch (error) {
    return c.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      images: [],
    }, 500);
  }
});

// Get context preview for an image
imageEmbeddingRoutes.get('/pdfs/:filename/images/:page/:index/context', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'));
  const page = parseInt(c.req.param('page'), 10);
  const index = parseInt(c.req.param('index'), 10);
  const rawDir = String(c.req.query('dir') || '').trim();
  const configId = String(c.req.query('configId') || '').trim();
  const inputDir = rawDir || DEFAULT_PDF_INPUT_DIR;
  const absDir = resolvePathFromCwd(inputDir);
  const pdfPath = join(absDir, filename);

  if (!existsSync(pdfPath)) {
    return c.json({ error: `PDF not found: ${filename}` }, 404);
  }

  if (!configId) {
    return c.json({ error: 'configId is required' }, 400);
  }

  const configPath = join(CONFIGS_DIR, `${configId}.json`);
  if (!existsSync(configPath)) {
    return c.json({ error: `Config not found: ${configId}` }, 404);
  }

  // Extract images to get the bbox for this specific image
  const pythonPath = resolvePythonPath();
  const extractScriptPath = join(process.cwd(), 'python', 'text_rag', 'extract_pdf_images.py');
  
  let imageBbox: any = null;
  try {
    const extractProc = spawn([
      pythonPath,
      extractScriptPath,
      '--pdf',
      pdfPath,
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python:${process.cwd()}/modules`,
      },
    });

    let stdout = '';
    const decoder = new TextDecoder();
    const stdoutReader = extractProc.stdout?.getReader();

    if (stdoutReader) {
      while (true) {
        const { value, done } = await stdoutReader.read();
        if (done) break;
        if (value) stdout += decoder.decode(value);
      }
    }

    await extractProc.exited;
    const imagesData = JSON.parse(stdout);
    const image = imagesData.images?.find((img: any) => img.page === page && img.index === index);
    imageBbox = image?.bbox;
  } catch (err) {
    return c.json({ error: 'Failed to get image info' }, 500);
  }

  if (!imageBbox) {
    return c.json({ error: 'Image or bbox not found' }, 404);
  }

  // Use Python script to extract context
  const scriptPath = join(process.cwd(), 'python', 'text_rag', 'extract_image_context.py');
  const configContent = await readFile(configPath, 'utf-8');

  try {
    const proc = spawn([
      pythonPath,
      scriptPath,
      '--pdf',
      pdfPath,
      '--page',
      page.toString(),
      '--bbox',
      JSON.stringify(imageBbox),
      '--config',
      configContent,
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python:${process.cwd()}/modules`,
      },
    });

    let stdout = '';
    let stderr = '';

    const decoder = new TextDecoder();
    const streamToStdout = async (stream?: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) stdout += decoder.decode(value);
      }
    };

    const streamToStderr = async (stream?: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;
      const reader = stream.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) stderr += decoder.decode(value);
      }
    };

    await Promise.all([
      streamToStdout(proc.stdout),
      streamToStderr(proc.stderr),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ error: `Failed to extract context: ${stderr}` }, 500);
    }

    const result = JSON.parse(stdout);
    return c.json({ context: result.context || '', length: result.length || 0 });
  } catch (error) {
    return c.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      context: '',
    }, 500);
  }
});

// Start building a database with image embedding config
imageEmbeddingRoutes.post('/build', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const name = String((body as any).name || `imgdb_${Date.now().toString(36)}`);
  const rawInputDir = String((body as any).inputDir || '').trim();
  const inputDir = rawInputDir || DEFAULT_PDF_INPUT_DIR;
  const configId = String((body as any).configId || '');
  const setActive = Boolean((body as any).setActive ?? true);

  if (!configId) {
    return c.json({ error: 'configId is required' }, 400);
  }

  const configPath = join(CONFIGS_DIR, `${configId}.json`);
  if (!existsSync(configPath)) {
    return c.json({ error: `Config not found: ${configId}` }, 404);
  }

  const configContent = await readFile(configPath, 'utf-8');
  const config = JSON.parse(configContent) as ImageEmbeddingConfig;

  if (!existsSync(inputDir)) {
    return c.json({ error: `Input directory not found: ${inputDir}` }, 400);
  }

  await ensureConfigsDir();
  if (!existsSync(TEXTDBS_DIR)) {
    await mkdir(TEXTDBS_DIR, { recursive: true });
  }
  const outputDir = join(TEXTDBS_DIR, name);
  await mkdir(outputDir, { recursive: true });

  const id = `imgdb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: ImageDbBuildJob = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    inputDir,
    outputDir,
    configId,
    config,
    logs: '',
  };
  buildJobs.set(id, job);

  // Fire-and-forget build
  (async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    const pythonPath = resolvePythonPath();
    const scriptPath = join(process.cwd(), 'python', 'text_rag', 'build_image_db.py');

    const proc = spawn([
      pythonPath,
      scriptPath,
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--config',
      configPath,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/python:${process.cwd()}/modules`,
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
        const activeFile = join(TEXTDBS_DIR, 'active.json');
        await writeFile(activeFile, JSON.stringify({ activeDbPath: outputDir }, null, 2));
      }
    } else {
      job.status = 'failed';
      job.error = `Build failed with exit code ${exitCode}`;
    }
  })();

  return c.json({ id, status: job.status, outputDir });
});

// Get build status
imageEmbeddingRoutes.get('/build/:id', (c) => {
  const id = c.req.param('id');
  const job = buildJobs.get(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json(job);
});

