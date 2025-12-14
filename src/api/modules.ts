/**
 * Module API Endpoints
 * 
 * Provides REST API endpoints for module discovery and management.
 * The frontend uses these endpoints to:
 * - List available modules with their manifests
 * - Get search types for the dropdown
 * - Validate module configurations
 */

import { Hono } from 'hono';
import { 
  discoverModules, 
  getPreprocessors, 
  getFilters, 
  getSearchTypes,
  getDocumentProcessors,
  getImageFilters,
  clearModuleCache,
} from '../modules/manager';

export const moduleRoutes = new Hono();

/**
 * GET /api/modules
 * 
 * List all available modules with their complete manifests.
 * 
 * Response:
 * {
 *   modules: ModuleManifest[],
 *   searchTypes: SearchTypeDescriptor[]
 * }
 */
moduleRoutes.get('/', async (c) => {
  try {
    const result = await discoverModules();
    return c.json(result);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to discover modules',
      modules: [],
      searchTypes: [],
    }, 500);
  }
});

/**
 * GET /api/modules/preprocessors
 * 
 * List available preprocessor modules.
 */
moduleRoutes.get('/preprocessors', async (c) => {
  try {
    const preprocessors = await getPreprocessors();
    return c.json({ preprocessors });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get preprocessors',
      preprocessors: [],
    }, 500);
  }
});

/**
 * GET /api/modules/filters
 * 
 * List available filter modules.
 */
moduleRoutes.get('/filters', async (c) => {
  try {
    const filters = await getFilters();
    return c.json({ filters });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get filters',
      filters: [],
    }, 500);
  }
});

/**
 * GET /api/modules/search-types
 * 
 * List available search types with their variants.
 * This is used to populate the search type dropdown in the UI.
 */
moduleRoutes.get('/search-types', async (c) => {
  try {
    const searchTypes = await getSearchTypes();
    return c.json({ searchTypes });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get search types',
      searchTypes: [],
    }, 500);
  }
});

/**
 * GET /api/modules/document-processors
 * 
 * List available document processor modules.
 * These are used during database building to extract metadata or transform documents.
 */
moduleRoutes.get('/document-processors', async (c) => {
  try {
    const documentProcessors = await getDocumentProcessors();
    return c.json({ documentProcessors });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get document processors',
      documentProcessors: [],
    }, 500);
  }
});

/**
 * GET /api/modules/image-filters
 * 
 * List available image filter modules.
 * These are used during image database building to exclude irrelevant images.
 */
moduleRoutes.get('/image-filters', async (c) => {
  try {
    const imageFilters = await getImageFilters();
    return c.json({ imageFilters });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get image filters',
      imageFilters: [],
    }, 500);
  }
});

/**
 * POST /api/modules/refresh
 * 
 * Clear the module cache and force re-discovery.
 * Useful after adding new modules to the modules/ directory.
 */
moduleRoutes.post('/refresh', async (c) => {
  clearModuleCache();
  
  try {
    const result = await discoverModules();
    return c.json({
      ok: true,
      message: 'Module cache cleared and modules re-discovered',
      ...result,
    });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to refresh modules',
    }, 500);
  }
});

/**
 * GET /api/modules/:id
 * 
 * Get details for a specific module by ID.
 */
moduleRoutes.get('/:id', async (c) => {
  const moduleId = c.req.param('id');
  
  try {
    const { modules } = await discoverModules();
    const module = modules.find(m => m.id === moduleId);
    
    if (!module) {
      return c.json({ error: `Module not found: ${moduleId}` }, 404);
    }
    
    return c.json({ module });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get module',
    }, 500);
  }
});
