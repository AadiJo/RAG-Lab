import type { EvaluationResult } from '@/types';
import { getLocalSettings } from './settings';

export interface RunSuggestion {
  id: string;
  createdAt: string;
  model: string;
  content: string;
}

type SuggestionSection =
  | 'Diagnosis'
  | 'EvaluationConfig patch'
  | 'What this changes in our query processor'
  | 'Why these settings help';

const SECTION_TITLES: SuggestionSection[] = [
  'Diagnosis',
  'EvaluationConfig patch',
  'What this changes in our query processor',
  'Why these settings help',
];

function normLine(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ');
}

function canonicalSectionTitle(line: string): SuggestionSection | null {
  const t = normLine(line).replace(/:$/, '').toLowerCase();
  const candidates: Array<[SuggestionSection, string[]]> = [
    ['Diagnosis', ['diagnosis']],
    ['EvaluationConfig patch', ['evaluationconfig patch', 'evaluation config patch', 'evaluationconfig patch (copy/paste)', 'evaluationconfig patch (copy paste)', 'evaluationconfig patch copy/paste']],
    ['What this changes in our query processor', ['what this changes in our query processor', 'what this changes']],
    ['Why these settings help', ['why these settings help', 'why this helps', 'why these help']],
  ];
  for (const [canonical, alts] of candidates) {
    if (alts.includes(t)) return canonical;
  }
  return null;
}

function isFence(line: string): boolean {
  return line.trim().startsWith('```');
}

function isListish(line: string): boolean {
  const t = line.trim();
  return /^([-*+]|(\d+[\.\)]))\s+/.test(t);
}

function tryExtractJsonBlock(lines: string[], startIdx: number): { jsonLines: string[]; endIdx: number } | null {
  // Finds a JSON-looking block starting at or after startIdx by brace balancing.
  let i = startIdx;
  while (i < lines.length && lines[i] !== undefined && lines[i]!.trim().length === 0) i++;
  if (i >= lines.length) return null;
  if ((lines[i] || '').trim().startsWith('```')) return null; // already fenced
  if ((lines[i] || '').trim().startsWith('{') === false) return null;

  const out: string[] = [];
  let depth = 0;
  let started = false;

  for (let j = i; j < lines.length; j++) {
    const ln = lines[j] ?? '';
    out.push(ln);

    // naive brace balance (good enough for our patch JSON)
    for (const ch of ln) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
      }
    }

    if (started && depth <= 0) {
      return { jsonLines: out, endIdx: j };
    }
  }
  return null;
}

function formatSuggestionMarkdown(md: string): string {
  const input = (md || '').replace(/\r\n/g, '\n').trim();
  if (!input) return '';

  const rawLines = input.split('\n');
  const out: string[] = [];
  let inCodeFence = false;
  let currentSection: SuggestionSection | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i] ?? '';

    if (isFence(line)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }

    if (!inCodeFence) {
      const section = canonicalSectionTitle(line);
      if (section) {
        // ensure blank line before
        if (out.length > 0 && out[out.length - 1]?.trim() !== '') out.push('');
        out.push(`## ${section}`);
        out.push('');
        currentSection = section;
        continue;
      }

      // If we are in "EvaluationConfig patch" and the model forgot code fences, fence the JSON.
      if (currentSection === 'EvaluationConfig patch') {
        const extracted = tryExtractJsonBlock(rawLines, i);
        if (extracted) {
          if (out.length > 0 && out[out.length - 1]?.trim() !== '') out.push('');
          out.push('```json');
          out.push(...extracted.jsonLines);
          out.push('```');
          out.push('');
          i = extracted.endIdx;
          continue;
        }
      }

      // Bullets for these sections if the model returns plain lines
      if (
        (currentSection === 'What this changes in our query processor' || currentSection === 'Why these settings help') &&
        line.trim() !== '' &&
        !isListish(line) &&
        !/^##\s+/.test(line.trim())
      ) {
        line = `- ${line.trim()}`;
      }
    }

    out.push(line);
  }

  // Normalize spacing: collapse 3+ blank lines to 2, keep final newline.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function pickK(result: EvaluationResult): number | null {
  const keys = Object.keys(result.aggregateMetrics || {}).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (keys.length === 0) return null;
  return keys.includes(10) ? 10 : keys[Math.floor(keys.length / 2)]!;
}

export async function generateRunSuggestion(result: EvaluationResult): Promise<RunSuggestion> {
  const settings = getLocalSettings();
  const baseUrl = `${settings.ollama.host}:${settings.ollama.port}`;
  const k = pickK(result);
  const m = k !== null ? result.aggregateMetrics[k] : null;

  const summary = {
    id: result.id,
    datasetName: result.datasetName,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    config: result.config,
    primaryK: k,
    metrics: m,
    // Keep prompt small: include headline numbers only.
    headline: k !== null ? {
      precision: m?.retrieval.avgPrecision,
      recall: m?.retrieval.avgRecall,
      f1: m?.retrieval.avgF1,
      mrr: m?.retrieval.avgMRR,
      ndcg: m?.retrieval.avgNDCG,
      hitRate: m?.retrieval.hitRate,
      generation: m?.generation,
      image: m?.image,
      performance: m?.performance,
    } : null,
  };

  const system = `You are an expert RAG evaluation coach for THIS repo (rag-lab).
Given one run summary (JSON), produce a SHORT, actionable course of action that directly maps to features we already have.

Available knobs/features (use these exact names when relevant):
- integrationMode: text
- enableFiltering (post-filter) + queryOptions.targetDocs
- queryOptions.enableGamePieceEnhancement
- queryOptions.enableCache
- queryOptions.enableStructuredQuery (LLM → {search, filter: {season, team, doc_id}})
- queryOptions.retrievalMethod: vector | bm25 | tf | hybrid
- queryOptions.bm25Variant: bm25 | bm25_no_idf | tf
- DB build knobs: chunk_size, chunk_overlap, representation (raw/structured), embedding_model

Output ONLY Markdown with this exact structure. USE "## " FOR HEADERS. ENSURE BLANK LINES BETWEEN SECTIONS.

## Diagnosis
(1 sentence)

## EvaluationConfig patch
Provide a JSON code block with ONLY the fields to change (ex: enableFiltering, queryOptions.*).

## What this changes in our query processor
3 bullets that reference file/feature names (no code blocks here).

## Why these settings help
Up to 3 bullets; each bullet must name the metric(s) that should move.

Important:
- Do not say “improve X” without naming a concrete change (e.g., “switch retrievalMethod to bm25”).
- If latency is high, always propose enableCache and/or bm25.
- If recall is low, propose increasing K and/or hybrid and/or structured filters, and suggest chunk_size changes.
- Prefer settings that can be done in the UI first.
- Keep it under ~120 lines total.`;

  const prompt = `Run summary JSON:
${JSON.stringify(summary, null, 2)}`;

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
        temperature: 0.2,
        num_predict: 450,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Ollama suggestion error: ${resp.status} - ${t}`);
  }

  const data = await resp.json() as { message?: { content?: string } };
  const rawContent = (data.message?.content || '').trim();
  
  // Log raw model output
  console.log('=== RAW OLLAMA OUTPUT (before formatting) ===');
  console.log(rawContent);
  console.log('=== END RAW OUTPUT ===\n');
  
  const content = formatSuggestionMarkdown(rawContent);
  
  // Log formatted output
  console.log('=== FORMATTED OUTPUT (after processing) ===');
  console.log(content);
  console.log('=== END FORMATTED OUTPUT ===\n');

  return {
    id: result.id,
    createdAt: new Date().toISOString(),
    model: settings.ollama.model,
    content,
  };
}


