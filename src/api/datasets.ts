/**
 * Dataset API Endpoints
 * 
 * Endpoints for managing evaluation datasets
 */

import { Hono } from 'hono';
import { datasetManager } from '../core/dataset';
import type { EvaluationDataset, TestCase } from '@/types';

const datasetRoutes = new Hono();

// List all datasets
datasetRoutes.get('/', async (c) => {
  try {
    const datasets = await datasetManager.listDatasets();
    return c.json({ datasets });
  } catch (error) {
    console.error('Failed to list datasets:', error);
    return c.json({ error: 'Failed to list datasets' }, 500);
  }
});

// Get a specific dataset
datasetRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const dataset = await datasetManager.loadDataset(id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    return c.json(dataset);
  } catch (error) {
    console.error('Failed to load dataset:', error);
    return c.json({ error: 'Failed to load dataset' }, 500);
  }
});

// Get dataset summary (without full test cases)
datasetRoutes.get('/:id/summary', async (c) => {
  const id = c.req.param('id');
  
  try {
    const dataset = await datasetManager.loadDataset(id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    // Group test cases by category
    const categoryCounts: Record<string, number> = {};
    const difficultyCounts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    
    for (const tc of dataset.testCases) {
      const category = tc.category || 'uncategorized';
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      
      if (tc.difficulty) {
        difficultyCounts[tc.difficulty]++;
      }
    }
    
    return c.json({
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      version: dataset.version,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
      testCaseCount: dataset.testCases.length,
      categories: categoryCounts,
      difficulties: difficultyCounts,
      metadata: dataset.metadata,
    });
  } catch (error) {
    console.error('Failed to load dataset summary:', error);
    return c.json({ error: 'Failed to load dataset summary' }, 500);
  }
});

// Create a new dataset
datasetRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { id, name, description, testCases, category } = body as {
      id: string;
      name: string;
      description: string;
      testCases?: TestCase[];
      category?: string;
    };
    
    if (!id || !name) {
      return c.json({ error: 'id and name are required' }, 400);
    }
    
    // Check if dataset already exists
    const existing = await datasetManager.loadDataset(id);
    if (existing) {
      return c.json({ error: 'Dataset with this ID already exists' }, 409);
    }
    
    const dataset = datasetManager.createDataset(
      id,
      name,
      description || '',
      testCases || []
    );
    
    const success = await datasetManager.saveDataset(dataset, category || 'general');
    
    if (!success) {
      return c.json({ error: 'Failed to save dataset' }, 500);
    }
    
    return c.json({ message: 'Dataset created', dataset }, 201);
  } catch (error) {
    console.error('Failed to create dataset:', error);
    return c.json({ error: 'Failed to create dataset' }, 500);
  }
});

// Update a dataset
datasetRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const existing = await datasetManager.loadDataset(id);
    if (!existing) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    const body = await c.req.json();
    const updates = body as Partial<EvaluationDataset>;
    
    // Merge updates
    const updated: EvaluationDataset = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      updatedAt: new Date().toISOString(),
    };
    
    // Determine category
    const datasets = await datasetManager.listDatasets();
    const datasetInfo = datasets.find(d => d.id === id);
    const category = datasetInfo?.category || 'general';
    
    const success = await datasetManager.saveDataset(updated, category);
    
    if (!success) {
      return c.json({ error: 'Failed to update dataset' }, 500);
    }
    
    return c.json({ message: 'Dataset updated', dataset: updated });
  } catch (error) {
    console.error('Failed to update dataset:', error);
    return c.json({ error: 'Failed to update dataset' }, 500);
  }
});

// Add a test case to a dataset
datasetRoutes.post('/:id/test-cases', async (c) => {
  const datasetId = c.req.param('id');
  
  try {
    const testCase = await c.req.json() as TestCase;
    
    if (!testCase.id || !testCase.query) {
      return c.json({ error: 'Test case must have id and query' }, 400);
    }
    
    if (!testCase.groundTruth) {
      return c.json({ error: 'Test case must have groundTruth' }, 400);
    }
    
    const success = await datasetManager.addTestCase(datasetId, testCase);
    
    if (!success) {
      return c.json({ error: 'Failed to add test case' }, 500);
    }
    
    return c.json({ message: 'Test case added', testCase }, 201);
  } catch (error) {
    console.error('Failed to add test case:', error);
    return c.json({ error: 'Failed to add test case' }, 500);
  }
});

// Remove a test case from a dataset
datasetRoutes.delete('/:id/test-cases/:testCaseId', async (c) => {
  const datasetId = c.req.param('id');
  const testCaseId = c.req.param('testCaseId');
  
  try {
    const success = await datasetManager.removeTestCase(datasetId, testCaseId);
    
    if (!success) {
      return c.json({ error: 'Failed to remove test case' }, 500);
    }
    
    return c.json({ message: 'Test case removed' });
  } catch (error) {
    console.error('Failed to remove test case:', error);
    return c.json({ error: 'Failed to remove test case' }, 500);
  }
});

// Get a specific test case
datasetRoutes.get('/:id/test-cases/:testCaseId', async (c) => {
  const datasetId = c.req.param('id');
  const testCaseId = c.req.param('testCaseId');
  
  try {
    const dataset = await datasetManager.loadDataset(datasetId);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    const testCase = dataset.testCases.find(tc => tc.id === testCaseId);
    
    if (!testCase) {
      return c.json({ error: 'Test case not found' }, 404);
    }
    
    return c.json(testCase);
  } catch (error) {
    console.error('Failed to get test case:', error);
    return c.json({ error: 'Failed to get test case' }, 500);
  }
});

export { datasetRoutes };

