/**
 * RAG Lab - Main Server Entry Point
 * 
 * Research-grade RAG evaluation and experimentation platform
 */

import { app } from './api/routes';

const PORT = parseInt(process.env.PORT || '3100', 10);
const HOST = process.env.HOST || 'localhost';

console.log('🚀 Starting RAG Lab Server...');
console.log(`📊 Version: 1.0.0`);
console.log(`🌐 Host: ${HOST}:${PORT}`);

console.log('\n📋 Configuration:');
console.log(`   LLM Judge: Ollama (configure model in Settings)`);
console.log(`   Text DBs Dir: ${process.env.TEXTDBS_DIR || './data/text_dbs'}`);
console.log(`   Datasets Dir: ${process.env.DATASETS_DIR || './datasets'}`);
console.log(`   Results Dir: ${process.env.RESULTS_DIR || './results'}`);

console.log('\n' + '='.repeat(50));

// Start server
export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};

console.log(`\n✅ Server running at http://${HOST}:${PORT}`);
console.log('\n📚 Available endpoints:');
console.log('   GET  /health              - Health check');
console.log('   GET  /api/datasets        - List datasets');
console.log('   GET  /api/datasets/:id    - Get dataset');
console.log('   POST /api/evaluations/start - Start evaluation');
console.log('   GET  /api/evaluations/:id/status - Get status');
console.log('   GET  /api/evaluations/results - List results');
console.log('   GET  /api/evaluations/results/:id - Get result');
console.log('\n' + '='.repeat(50) + '\n');

