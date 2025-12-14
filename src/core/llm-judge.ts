/**
 * LLM Judge - Ollama Integration
 *
 * Uses a local Ollama server to evaluate generation quality metrics:
 * - Faithfulness: Is the answer grounded in the retrieved context?
 * - Answer Relevancy: Does the answer address the query?
 * - Answer Correctness: Is the answer factually accurate vs ground truth?
 */

import type { GenerationMetrics } from '@/types';
import { getLocalSettings } from './settings';

interface JudgmentResult {
  score: number;
  reasoning: string;
}

/**
 * LLM Judge class for evaluating RAG generation quality
 */
export class LLMJudge {
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor() {
    const settings = getLocalSettings();
    this.baseUrl = `${settings.ollama.host}:${settings.ollama.port}`;
    this.model = settings.ollama.model;
    this.temperature = settings.ollama.temperature;
    this.maxTokens = settings.ollama.maxTokens;
  }

  /**
   * Make a request to the Chutes API
   */
  private async chatCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { message?: { content?: string } };
    return result.message?.content || '';
  }

  /**
   * Parse a judgment response from the LLM
   * Expected format: Score on first line, reasoning on subsequent lines
   */
  private parseJudgment(response: string): JudgmentResult {
    const lines = response.trim().split('\n');
    
    // Try to extract score from various formats
    let score = 0;
    let reasoning = response;

    // Try patterns like "Score: 0.8", "8/10", "0.8", etc.
    const scorePatterns = [
      /score[:\s]*([0-9.]+)/i,
      /([0-9.]+)\s*\/\s*10/i,
      /([0-9.]+)\s*\/\s*1/i,
      /^([0-9.]+)/m,
    ];

    for (const pattern of scorePatterns) {
      const match = response.match(pattern);
      if (match) {
        const parsed = parseFloat(match[1]);
        // Normalize to 0-1 scale
        score = parsed > 1 ? parsed / 10 : parsed;
        score = Math.max(0, Math.min(1, score)); // Clamp to 0-1
        break;
      }
    }

    // Extract reasoning (everything after score line)
    const reasoningMatch = response.match(/reasoning[:\s]*(.*)/is);
    if (reasoningMatch) {
      reasoning = reasoningMatch[1].trim();
    } else if (lines.length > 1) {
      reasoning = lines.slice(1).join('\n').trim();
    }

    return { score, reasoning };
  }

  /**
   * Evaluate Faithfulness
   * Measures whether the answer is grounded in the retrieved context
   */
  async evaluateFaithfulness(
    answer: string,
    context: string
  ): Promise<JudgmentResult> {
    const systemPrompt = `You are an expert evaluator assessing whether an AI-generated answer is faithful to the provided context. 
An answer is faithful if all its claims can be verified from the context. 
Penalize hallucinations, made-up facts, or claims not supported by the context.`;

    const prompt = `Evaluate the faithfulness of the following answer based on the given context.

CONTEXT:
${context}

ANSWER:
${answer}

Rate the faithfulness on a scale from 0 to 1 where:
- 1.0 = Completely faithful, all claims supported by context
- 0.7-0.9 = Mostly faithful with minor unsupported details
- 0.4-0.6 = Partially faithful, some hallucinations
- 0.1-0.3 = Mostly unfaithful, many unsupported claims
- 0.0 = Completely unfaithful or contradicts context

Respond in this format:
Score: [0-1]
Reasoning: [Your explanation]`;

    try {
      const response = await this.chatCompletion(prompt, systemPrompt);
      return this.parseJudgment(response);
    } catch (error) {
      console.error('Faithfulness evaluation failed:', error);
      return { score: 0, reasoning: `Evaluation failed: ${error}` };
    }
  }

  /**
   * Evaluate Answer Relevancy
   * Measures whether the answer addresses the original query
   */
  async evaluateRelevancy(query: string, answer: string): Promise<JudgmentResult> {
    const systemPrompt = `You are an expert evaluator assessing whether an AI-generated answer is relevant to the user's query.
An answer is relevant if it directly addresses what the user asked for.
Penalize off-topic responses, excessive irrelevant information, or answers that miss the point.`;

    const prompt = `Evaluate how relevant the following answer is to the query.

QUERY:
${query}

ANSWER:
${answer}

Rate the relevancy on a scale from 0 to 1 where:
- 1.0 = Perfectly relevant, directly answers the query
- 0.7-0.9 = Mostly relevant with some tangential information
- 0.4-0.6 = Partially relevant, misses key aspects
- 0.1-0.3 = Mostly irrelevant, barely addresses the query
- 0.0 = Completely irrelevant or off-topic

Respond in this format:
Score: [0-1]
Reasoning: [Your explanation]`;

    try {
      const response = await this.chatCompletion(prompt, systemPrompt);
      return this.parseJudgment(response);
    } catch (error) {
      console.error('Relevancy evaluation failed:', error);
      return { score: 0, reasoning: `Evaluation failed: ${error}` };
    }
  }

  /**
   * Evaluate Answer Correctness
   * Measures factual accuracy against a reference answer
   */
  async evaluateCorrectness(
    answer: string,
    referenceAnswer: string
  ): Promise<JudgmentResult> {
    const systemPrompt = `You are an expert evaluator assessing the factual correctness of an AI-generated answer compared to a reference answer.
Focus on factual accuracy, not writing style or verbosity.
The answer doesn't need to be identical to the reference, just factually consistent.`;

    const prompt = `Evaluate the correctness of the following answer compared to the reference answer.

REFERENCE ANSWER (Ground Truth):
${referenceAnswer}

GENERATED ANSWER:
${answer}

Rate the correctness on a scale from 0 to 1 where:
- 1.0 = Fully correct, all facts match reference
- 0.7-0.9 = Mostly correct with minor inaccuracies
- 0.4-0.6 = Partially correct, some errors
- 0.1-0.3 = Mostly incorrect
- 0.0 = Completely incorrect or contradicts reference

Respond in this format:
Score: [0-1]
Reasoning: [Your explanation]`;

    try {
      const response = await this.chatCompletion(prompt, systemPrompt);
      return this.parseJudgment(response);
    } catch (error) {
      console.error('Correctness evaluation failed:', error);
      return { score: 0, reasoning: `Evaluation failed: ${error}` };
    }
  }

  /**
   * Evaluate all generation metrics for a single query
   */
  async evaluateGeneration(
    query: string,
    answer: string,
    context: string,
    referenceAnswer?: string
  ): Promise<GenerationMetrics> {
    // Run evaluations in parallel for efficiency
    const [faithfulnessResult, relevancyResult] = await Promise.all([
      this.evaluateFaithfulness(answer, context),
      this.evaluateRelevancy(query, answer),
    ]);

    // Correctness is optional (requires reference answer)
    let correctnessResult: JudgmentResult | undefined;
    if (referenceAnswer && referenceAnswer.trim().length > 0) {
      correctnessResult = await this.evaluateCorrectness(answer, referenceAnswer);
    }

    return {
      faithfulness: faithfulnessResult.score,
      answerRelevancy: relevancyResult.score,
      answerCorrectness: correctnessResult?.score,
      judgmentDetails: {
        faithfulnessReasoning: faithfulnessResult.reasoning,
        relevancyReasoning: relevancyResult.reasoning,
        correctnessReasoning: correctnessResult?.reasoning,
      },
    };
  }

  /**
   * Check if the LLM judge is available (API token configured)
   */
  isAvailable(): boolean {
    return !!this.model;
  }

  /**
   * Test the connection to Chutes API
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return false;
      const data = await response.json() as { models?: Array<{ name?: string }> };
      const names = (data.models || []).map(m => m.name || '');
      return names.some((n) => n === this.model || n.startsWith(`${this.model}:`));
    } catch (error) {
      // Readiness is polled frequently by the UI; avoid noisy logs unless explicitly enabled.
      if (process.env.LOG_EXTERNAL_HEALTH === '1') {
        console.error('Ollama connection test failed:', error);
      }
      return false;
    }
  }
}

/**
 * Aggregate generation metrics across multiple results
 */
export function aggregateGenerationMetrics(
  results: GenerationMetrics[]
): {
  avgFaithfulness: number;
  avgRelevancy: number;
  avgCorrectness?: number;
} {
  if (results.length === 0) {
    return { avgFaithfulness: 0, avgRelevancy: 0 };
  }

  const sum = results.reduce(
    (acc, r) => ({
      faithfulness: acc.faithfulness + r.faithfulness,
      relevancy: acc.relevancy + r.answerRelevancy,
      correctness: acc.correctness + (r.answerCorrectness ?? 0),
      correctnessCount: acc.correctnessCount + (r.answerCorrectness !== undefined ? 1 : 0),
    }),
    { faithfulness: 0, relevancy: 0, correctness: 0, correctnessCount: 0 }
  );

  const count = results.length;

  const out: { avgFaithfulness: number; avgRelevancy: number; avgCorrectness?: number } = {
    avgFaithfulness: sum.faithfulness / count,
    avgRelevancy: sum.relevancy / count,
  };

  if (sum.correctnessCount > 0) {
    out.avgCorrectness = sum.correctness / sum.correctnessCount;
  }

  return out;
}

// Export singleton instance with default config
export const llmJudge = new LLMJudge();

