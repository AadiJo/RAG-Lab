/**
 * Local settings stored on disk (gitignored).
 *
 * These settings are used by server-side components like the Ollama-based LLM judge.
 */

import { existsSync, readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface LocalSettings {
  ollama: {
    host: string; // e.g. http://localhost
    port: number; // e.g. 11434
    model: string; // e.g. llama3.1:8b
    temperature: number;
    maxTokens: number;
  };
}

const DEFAULT_SETTINGS: LocalSettings = {
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost',
    port: parseInt(process.env.OLLAMA_PORT || '11434', 10),
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    temperature: 0.1,
    maxTokens: 2000,
  },
};

const DATA_DIR = process.env.DATA_DIR || './data';
const SETTINGS_PATH = process.env.SETTINGS_PATH || join(DATA_DIR, 'settings.local.json');

function deepMerge<T extends Record<string, any>>(base: T, patch: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (base as any)[k] === 'object') {
      out[k] = deepMerge((base as any)[k], v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function getLocalSettings(): LocalSettings {
  if (!existsSync(SETTINGS_PATH)) return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<LocalSettings>;
    return deepMerge(DEFAULT_SETTINGS, raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateLocalSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
  const current = getLocalSettings();
  const next = deepMerge(current, patch);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}



