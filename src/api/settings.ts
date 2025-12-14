/**
 * Settings API Endpoints
 *
 * Persists local settings (gitignored) like Ollama model selection.
 */

import { Hono } from 'hono';
import { getLocalSettings, updateLocalSettings } from '@/core/settings';

export const settingsRoutes = new Hono();

settingsRoutes.get('/', (c) => {
  return c.json(getLocalSettings());
});

settingsRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const next = await updateLocalSettings(body);
  return c.json(next);
});



