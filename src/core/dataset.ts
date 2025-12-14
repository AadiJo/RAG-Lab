/**
 * Dataset Manager
 * 
 * Handles loading, saving, and managing evaluation datasets.
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import type { EvaluationDataset, TestCase } from '@/types';

const DATASETS_DIR = process.env.DATASETS_DIR || './datasets';

/**
 * Dataset Manager class
 */
export class DatasetManager {
  private datasetsPath: string;
  private cache: Map<string, EvaluationDataset> = new Map();

  constructor(datasetsPath?: string) {
    this.datasetsPath = datasetsPath || DATASETS_DIR;
  }

  /**
   * Ensure datasets directory exists
   */
  private async ensureDir(subdir?: string): Promise<void> {
    const dir = subdir ? join(this.datasetsPath, subdir) : this.datasetsPath;
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  /**
   * Discover all category directories dynamically
   */
  private async discoverCategories(): Promise<string[]> {
    if (!existsSync(this.datasetsPath)) return [];
    
    const entries = await readdir(this.datasetsPath, { withFileTypes: true });
    const categories: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        categories.push(entry.name);
      }
    }
    
    return categories;
  }

  /**
   * List all available datasets
   */
  async listDatasets(): Promise<Array<{ id: string; name: string; path: string; category: string }>> {
    const datasets: Array<{ id: string; name: string; path: string; category: string }> = [];

    // Dynamically discover categories
    const categories = await this.discoverCategories();

    for (const category of categories) {
      const categoryPath = join(this.datasetsPath, category);
      if (!existsSync(categoryPath)) continue;

      const files = await readdir(categoryPath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(categoryPath, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          const dataset = JSON.parse(content) as EvaluationDataset;
          datasets.push({
            id: dataset.id || basename(file, '.json'),
            name: dataset.name || file,
            path: filePath,
            category,
          });
        } catch (error) {
          console.warn(`Failed to read dataset ${file}:`, error);
        }
      }
    }

    return datasets;
  }

  /**
   * Load a dataset by ID
   */

  async loadDataset(datasetId: string): Promise<EvaluationDataset | null> {
    // Check cache first
    if (this.cache.has(datasetId)) {
      return this.cache.get(datasetId)!;
    }

    // Dynamically discover and search in all categories
    const categories = await this.discoverCategories();

    for (const category of categories) {
      const filePath = join(this.datasetsPath, category, `${datasetId}.json`);
      if (existsSync(filePath)) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const dataset = JSON.parse(content) as EvaluationDataset;
          this.cache.set(datasetId, dataset);
          return dataset;
        } catch (error) {
          console.error(`Failed to load dataset ${datasetId}:`, error);
          return null;
        }
      }
    }

    // Try loading from root datasets folder
    const rootPath = join(this.datasetsPath, `${datasetId}.json`);
    if (existsSync(rootPath)) {
      try {
        const content = await readFile(rootPath, 'utf-8');
        const dataset = JSON.parse(content) as EvaluationDataset;
        this.cache.set(datasetId, dataset);
        return dataset;
      } catch (error) {
        console.error(`Failed to load dataset ${datasetId}:`, error);
        return null;
      }
    }

    return null;
  }

  /**
   * Save a dataset
   */
  async saveDataset(dataset: EvaluationDataset, category: string = 'general'): Promise<boolean> {
    try {
      await this.ensureDir(category);
      const filePath = join(this.datasetsPath, category, `${dataset.id}.json`);
      
      // Update timestamps
      dataset.updatedAt = new Date().toISOString();
      if (!dataset.createdAt) {
        dataset.createdAt = dataset.updatedAt;
      }

      await writeFile(filePath, JSON.stringify(dataset, null, 2));
      this.cache.set(dataset.id, dataset);
      return true;
    } catch (error) {
      console.error(`Failed to save dataset ${dataset.id}:`, error);
      return false;
    }
  }

  /**
   * Create a new dataset
   */
  createDataset(
    id: string,
    name: string,
    description: string,
    testCases: TestCase[] = []
  ): EvaluationDataset {
    const now = new Date().toISOString();
    return {
      id,
      name,
      description,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
      testCases,
    };
  }

  /**
   * Add a test case to a dataset
   */
  async addTestCase(
    datasetId: string,
    testCase: TestCase
  ): Promise<boolean> {
    const dataset = await this.loadDataset(datasetId);
    if (!dataset) return false;

    dataset.testCases.push(testCase);
    dataset.updatedAt = new Date().toISOString();
    
    // Determine category from path
    const datasets = await this.listDatasets();
    const datasetInfo = datasets.find(d => d.id === datasetId);
    const category = datasetInfo?.category || 'general';

    return this.saveDataset(dataset, category);
  }

  /**
   * Remove a test case from a dataset
   */
  async removeTestCase(
    datasetId: string,
    testCaseId: string
  ): Promise<boolean> {
    const dataset = await this.loadDataset(datasetId);
    if (!dataset) return false;

    const index = dataset.testCases.findIndex(tc => tc.id === testCaseId);
    if (index === -1) return false;

    dataset.testCases.splice(index, 1);
    dataset.updatedAt = new Date().toISOString();

    const datasets = await this.listDatasets();
    const datasetInfo = datasets.find(d => d.id === datasetId);
    const category = datasetInfo?.category || 'general';

    return this.saveDataset(dataset, category);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton
export const datasetManager = new DatasetManager();

