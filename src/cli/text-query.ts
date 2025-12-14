/**
 * Local text-only query CLI
 *
 * Usage:
 *   bun run src/cli/text-query.ts --query "How do I tune PID?" --k 10 --filter
 *
 * Env:
 *   TEXT_CHROMA_PATH=/path/to/db
 *   TEXT_EMBEDDING_MODEL=BAAI/bge-large-en-v1.5
 */

import { textChromaDirect } from '@/integrations';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const query = getArg('--query') || getArg('-q');
  if (!query) {
    console.error('Missing --query');
    process.exit(1);
  }

  const k = parseInt(getArg('--k') || '10', 10);
  const enableFiltering = hasFlag('--filter') || hasFlag('--enable-filtering');

  const health = await textChromaDirect.checkSetup();
  if (!health.ready) {
    console.error(`Text mode not ready: ${health.error || 'unknown error'}`);
    process.exit(2);
  }

  const res = await textChromaDirect.query(query, { k, enableFiltering });
  if (res.metadata?.error) {
    console.error(`Query error: ${String(res.metadata.error)}`);
    process.exit(3);
  }

  console.log(`query: ${res.query}`);
  if (res.enhancedQuery) console.log(`enhancedQuery: ${res.enhancedQuery}`);
  console.log(`retrievalTimeMs: ${res.retrievalTimeMs.toFixed(1)}`);
  console.log(`documents: ${res.documents.length}`);
  console.log('');

  res.documents.forEach((d, i) => {
    console.log(`--- #${i + 1} ---`);
    const preview = d.content.length > 800 ? `${d.content.slice(0, 800)}...` : d.content;
    console.log(preview);
    console.log('');
  });
}

await main();



