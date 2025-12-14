import { BookOpen, Target, MessageSquareText, Image as ImageIcon } from 'lucide-react';

function MetricCard({
  title,
  description,
  items,
  icon: Icon,
}: {
  title: string;
  description: string;
  items: Array<{ name: string; meaning: string }>;
  icon: React.ElementType;
}) {
  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
          <Icon size={18} />
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <p className="text-sm text-zinc-500 mb-5">{description}</p>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.name} className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800">
            <div className="text-sm font-semibold text-zinc-200">{it.name}</div>
            <div className="text-xs text-zinc-500 mt-1">{it.meaning}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DocsView() {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-4">
          Documentation
        </h1>
        <p className="text-zinc-500 max-w-2xl mx-auto">
          What each metric means and how to interpret evaluation results.
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
            <BookOpen size={18} />
          </div>
          <h2 className="text-lg font-semibold text-white">Text Retrieval</h2>
        </div>
        <div className="space-y-3 text-sm text-zinc-400">
          <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800">
            RAG Lab queries a local, text-only Chroma DB for retrieval evaluation. Use the <span className="text-zinc-200">Text DBs</span> page to build and manage databases from your PDF documents.
          </div>
          <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800">
            Supports multiple retrieval methods: <span className="text-zinc-200 font-semibold">vector</span> (semantic similarity), <span className="text-zinc-200 font-semibold">BM25</span> (lexical), <span className="text-zinc-200 font-semibold">TF</span> (term frequency), and <span className="text-zinc-200 font-semibold">hybrid</span> (combination).
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Retrieval metrics"
          description="How well the retriever surfaces relevant information in the top-K results."
          icon={Target}
          items={[
            { name: 'Precision@K', meaning: 'Of the top K retrieved chunks, how many were relevant.' },
            { name: 'Recall@K', meaning: 'Of all relevant chunks (per ground truth keywords/snippets), how many were retrieved in top K.' },
            { name: 'Hit Rate@K', meaning: 'Whether at least one relevant chunk appears in the top K.' },
            { name: 'MRR', meaning: 'Mean Reciprocal Rank: rewards retrieving a relevant chunk earlier (higher is better).' },
            { name: 'NDCG', meaning: 'Position-weighted relevance metric; higher ranks matter more.' },
            { name: 'F1@K', meaning: 'Harmonic mean of precision and recall at K.' },
          ]}
        />

        <MetricCard
          title="Generation metrics (LLM judge)"
          description="Only computed if enabled and an LLM is configured."
          icon={MessageSquareText}
          items={[
            { name: 'Faithfulness', meaning: 'Is the answer grounded in the retrieved context, with minimal hallucination?' },
            { name: 'Answer Relevancy', meaning: 'Does the generated answer actually address the query?' },
            { name: 'Answer Correctness', meaning: 'Matches factual content vs the reference answer (if provided in the dataset).' },
          ]}
        />

        <MetricCard
          title="Image metrics"
          description="Only computed when images are returned and image metrics are enabled."
          icon={ImageIcon}
          items={[
            { name: 'Image Relevance Rate', meaning: 'Fraction of retrieved images that match expected images/patterns.' },
            { name: 'Image-Query Alignment', meaning: 'Semantic alignment between query text and image context/metadata.' },
            { name: 'Image Context Coverage', meaning: 'Heuristic for whether images add information beyond text.' },
          ]}
        />
      </div>
    </div>
  );
}

