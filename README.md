# RAG-Lab

A modular, research-grade evaluation and experimentation platform for Retrieval-Augmented Generation (RAG) pipelines. Built with Bun, TypeScript, React, and Python for high-performance evaluation of retrieval quality.

## ✨ Key Features

- **Modular Architecture**: Extend with custom preprocessors, filters, and search types
- **Multiple Search Types**: Vector, BM25, and Hybrid search out of the box
- **Comprehensive Metrics**: Precision, Recall, MRR, NDCG, and LLM-judged metrics
- **Beautiful Dashboard**: Modern React UI for configuration and visualization
- **Domain Agnostic**: Works with any RAG system via pluggable modules

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- Python 3.10+ with pip
- (Optional) Ollama for LLM-judged metrics

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/rag-lab.git
cd rag-lab

# Install dependencies
bun install

# Set up Python environment
python -m venv .venv-textdb
source .venv-textdb/bin/activate  # or .venv-textdb\Scripts\activate on Windows
pip install -r python/requirements-text.txt

# Start the servers
bun run dev           # Backend on :3100
cd web && bun run dev # Frontend on :3101
```

Visit `http://localhost:3101` to access the dashboard.

## 📊 Metrics

### Retrieval Metrics (Computed)
| Metric | Description |
|--------|-------------|
| **Precision@K** | Proportion of retrieved documents that are relevant |
| **Recall@K** | Proportion of relevant documents that were retrieved |
| **Hit Rate@K** | Whether at least one relevant document exists in top K |
| **MRR** | Mean Reciprocal Rank - average of 1/rank of first relevant |
| **NDCG** | Normalized Discounted Cumulative Gain |
| **F1@K** | Harmonic mean of precision and recall |

### Generation Metrics (LLM-Judged)
| Metric | Description |
|--------|-------------|
| **Faithfulness** | Is the answer grounded in retrieved context? |
| **Answer Relevancy** | Does the answer address the query? |
| **Answer Correctness** | Is the answer factually accurate? |

## 🧩 Module System

RAG-Lab uses a pluggable module system for extensibility. Modules are discovered automatically from the `modules/` directory.

### Module Types

1. **Query Preprocessors** - Transform queries before retrieval
   - Query expansion, synonym mapping, intent detection

2. **Document Filters** - Filter/rerank documents after retrieval  
   - Relevance scoring, deduplication, domain filtering

3. **Search Types** - Different retrieval strategies
   - Vector (dense), BM25 (sparse), Hybrid (combined)

### Creating a Module

```python
# modules/my_module/my_preprocessor.py

from rag_bench.modules.base import QueryPreprocessor, ModuleConfig

class MyPreprocessor(QueryPreprocessor):
    MODULE_ID = "my-preprocessor"
    MODULE_NAME = "My Preprocessor"
    MODULE_DESCRIPTION = "Enhances queries with custom logic"
    
    @classmethod
    def get_config_schema(cls):
        return [
            ModuleConfig(
                key="intensity",
                type="number",
                label="Intensity",
                default=0.5,
                min=0.0,
                max=1.0,
            ),
        ]
    
    def process(self, query, context):
        enhanced = self._enhance(query)
        return enhanced, context
```

```python
# modules/my_module/__init__.py

from .my_preprocessor import MyPreprocessor

def register(registry):
    registry.register(MyPreprocessor)
```

See [Module Development Guide](docs/module-development.md) for complete documentation.

## 🔍 Search Types

### Vector Search (Default)
Dense embedding similarity search using cosine similarity.

```python
# Best for semantic understanding
search_type: "vector"
```

### BM25 Search
Sparse lexical search using the BM25 algorithm.

```python
# Best for keyword matching
search_type: "bm25"
variants: ["bm25", "bm25_no_idf", "tf"]
```

### Hybrid Search
Combines vector and BM25 for best results.

```python
# Best overall performance
search_type: "hybrid"
variants: ["weighted", "rrf"]
config:
  vector_weight: 0.5
  lexical_weight: 0.5
```

## 📁 Project Structure

```
RAG-Lab/
├── src/                    # TypeScript API server
│   ├── api/                # REST endpoints
│   ├── core/               # Evaluation engine
│   ├── modules/            # Module system (TS)
│   └── integrations/       # Backend integrations
│
├── python/                 # Python runtime
│   └── rag_bench/
│       ├── modules/        # Module system core
│       ├── search/         # Built-in search types
│       └── query.py        # Query runner
│
├── modules/                # User modules (gitignored)
│
├── web/                    # React dashboard
│   └── src/
│       ├── components/     # UI components
│       └── lib/            # API client
│
├── datasets/               # Evaluation datasets
│   └── general/            # General benchmarks
│
├── data/                   # Runtime data
│   └── text_dbs/           # Vector stores
│
└── docs/                   # Documentation
    ├── architecture.md     # System architecture
    ├── module-development.md
    └── agent-instructions.md
```

## 📖 Documentation

- [Architecture Overview](docs/architecture.md)
- [Module Development Guide](docs/module-development.md)
- [AGENTS.md](AGENTS.md) - Instructions for AI assistants working on this codebase

## 🔌 API Endpoints

### Modules
```
GET  /api/modules              # List all modules
GET  /api/modules/search-types # List search types
POST /api/modules/refresh      # Re-discover modules
```

### Evaluations
```
POST /api/evaluations/start    # Start evaluation
GET  /api/evaluations/:id/status
GET  /api/evaluations/results
```

### Datasets
```
GET  /api/datasets             # List datasets
GET  /api/datasets/:id/summary
```

### Text DBs
```
GET  /api/textdb/list          # List vector stores
POST /api/textdb/build         # Build new store
POST /api/textdb/active        # Set active store
```

## Dataset Format

```json
{
  "id": "my-dataset",
  "name": "My Evaluation Dataset",
  "testCases": [
    {
      "id": "test-1",
      "query": "How do I implement feature X?",
      "category": "features",
      "difficulty": "medium",
      "groundTruth": {
        "expectedKeywords": ["feature", "implement", "X"],
        "relevantChunks": ["feature documentation"],
        "referenceAnswer": "To implement feature X..."
      }
    }
  ]
}
```

## Configuration

### Environment Variables

```env
# Ollama (for LLM metrics)
OLLAMA_HOST=http://localhost
OLLAMA_PORT=11434
OLLAMA_MODEL=mistral:latest

# Embeddings
TEXT_EMBEDDING_MODEL=BAAI/bge-large-en-v1.5
TEXT_EMBEDDING_DEVICE=cpu

# Server
PORT=3100
```

### Evaluation Config

```typescript
{
  kValues: [5, 10, 15, 20],
  enableGenerationMetrics: true,
  integrationMode: 'text',
  searchType: 'vector',
  moduleConfig: {
    "my-preprocessor": {
      enabled: true,
      config: { intensity: 0.8 }
    }
  }
}
```

## Use Cases

1. **A/B Testing** - Compare retrieval strategies
2. **Hyperparameter Tuning** - Find optimal K, chunk sizes
3. **Model Comparison** - Evaluate embedding models
4. **Regression Testing** - Ensure changes don't degrade quality
5. **Domain Adaptation** - Create domain-specific modules

## Development

```bash
# Run backend with hot reload
bun run dev

# Run frontend
cd web && bun run dev

# Type checking
bun run typecheck

# Build for production
bun run build
cd web && bun run build
```