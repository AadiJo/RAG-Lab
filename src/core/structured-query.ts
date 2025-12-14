/**
 * Structured query helper (LLM -> { search, filter }).
 *
 * This is an experimental feature inspired by “structured queries” retrieval:
 * the model extracts metadata constraints (like season/team) as a filter, while
 * producing a cleaned search string for retrieval.
 */

import { getLocalSettings } from './settings';

export interface StructuredQueryResult {
  search: string;
  filter: Record<string, string>;
  raw?: string;
}

function sanitizeFilter(filter: unknown): Record<string, string> {
  if (!filter || typeof filter !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filter as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
  }
  // Only allow keys we actually index today
  const allowed = new Set(['season', 'team', 'doc_id']);
  for (const key of Object.keys(out)) {
    if (!allowed.has(key)) delete out[key];
  }
  return out;
}

export async function structuredQueryFromOllama(query: string): Promise<StructuredQueryResult> {
  const settings = getLocalSettings();
  const baseUrl = `${settings.ollama.host}:${settings.ollama.port}`;

  const system = `You convert a user question into a structured search request.
Return ONLY valid JSON with the schema:
{
  "search": "string",
  "filter": { "season"?: "YYYY", "team"?: "####", "doc_id"?: "string" }
}

Rules:
- "search" should keep the semantic intent, but remove filter-like constraints.
- "filter" should be empty if no constraints are confidently extractable.
- Only use season/team/doc_id keys.`;

  const prompt = `User query:
${query}

JSON:`;

  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollama.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        temperature: 0.0,
        num_predict: 512,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Ollama structured query error: ${resp.status} - ${t}`);
  }

  const data = await resp.json() as { message?: { content?: string } };
  const content = (data.message?.content || '').trim();

  // Try to parse JSON even if the model wraps it
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const jsonText = start >= 0 && end >= 0 ? content.slice(start, end + 1) : content;

  const parsed = JSON.parse(jsonText) as { search?: unknown; filter?: unknown };
  const search = typeof parsed.search === 'string' && parsed.search.trim() ? parsed.search.trim() : query;
  const filter = sanitizeFilter(parsed.filter);

  return { search, filter, raw: content };
}



