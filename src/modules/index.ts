/**
 * Module System
 * 
 * This module provides the TypeScript interface to the Python module system.
 * It handles:
 * - Module discovery via the Python backend
 * - Module configuration management
 * - Type definitions for the frontend
 * 
 * Architecture:
 * - Modules are defined in Python (in the modules/ directory)
 * - This TypeScript code discovers and configures them via the API
 * - The frontend displays module options based on their manifests
 */

export * from './types';
export * from './manager';
