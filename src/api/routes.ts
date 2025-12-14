/**
 * API Route Definitions
 * 
 * Main router combining all API endpoints
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { evaluationRoutes } from './evaluation';
import { datasetRoutes } from './datasets';
import { textDbRoutes } from './textdb';
import { settingsRoutes } from './settings';
import { moduleRoutes } from './modules';
import { imageEmbeddingRoutes } from './image-embedding';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API info
app.get('/', (c) => {
  return c.json({
    name: 'RAG Lab API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      datasets: 'GET /api/datasets',
      dataset: 'GET /api/datasets/:id',
      evaluate: 'POST /api/evaluate',
      evaluationStatus: 'GET /api/evaluations/:id',
      results: 'GET /api/results',
      result: 'GET /api/results/:id',
      modules: 'GET /api/modules',
      searchTypes: 'GET /api/modules/search-types',
    },
  });
});

// Mount route groups
app.route('/api/evaluations', evaluationRoutes);
app.route('/api/datasets', datasetRoutes);
app.route('/api/textdb', textDbRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/modules', moduleRoutes);
app.route('/api/image-embedding', imageEmbeddingRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json(
    {
      error: err.message || 'Internal server error',
      timestamp: new Date().toISOString(),
    },
    500
  );
});

export { app };

