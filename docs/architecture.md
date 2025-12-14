# RAG Bench Architecture

This document provides a comprehensive overview of RAG Bench's modular architecture.

## Overview

RAG Bench is designed as a modular, extensible framework for evaluating Retrieval-Augmented Generation (RAG) systems. The architecture separates concerns into:

1. **Core Framework** - The evaluation engine, metrics, and API
2. **Module System** - Pluggable preprocessors, filters, and search types
3. **Frontend** - Web-based configuration and visualization
4. **Python Backend** - Query execution and module runtime

## Directory Structure

```
rag-lab/
├── src/                      # TypeScript API server
│   ├── api/                  # REST endpoints
│   ├── core/                 # Evaluation engine
│   ├── integrations/         # RAG backend integrations
│   ├── modules/              # TypeScript module types/manager
│   └── types/                # Shared type definitions
│
├── python/                   # Python runtime
│   └── rag_bench/
│       ├── modules/          # Module system core
│       │   ├── base.py       # Base classes
│       │   └── registry.py   # Module discovery
│       ├── search/           # Built-in search types
│       │   ├── vector.py     # Vector similarity search
│       │   ├── bm25.py       # BM25 lexical search
│       │   └── hybrid.py     # Hybrid search
│       └── query.py          # Query runner
│
├── modules/                  # User modules (GITIGNORED)
│   └── frc_robotics/         # Example: FRC domain module
│       ├── __init__.py
│       ├── game_piece_mapper.py
│       └── relevance_filter.py
│
├── web/                      # React frontend
│   └── src/
│       ├── components/       # UI components
│       └── lib/              # API client
│
├── datasets/                 # Evaluation datasets
│   ├── general/              # General RAG benchmarks
│   └── frc-specific/         # Domain-specific (gitignored)
│
├── data/                     # Runtime data
│   └── text_dbs/             # Vector stores
│
└── docs/                     # Documentation
```

## Module System

### Module Types

#### 1. Query Preprocessors
Transform queries before retrieval. Use cases:
- Query expansion (synonyms, related terms)
- Domain term mapping
- Query normalization
- Intent detection

```python
class QueryPreprocessor(BaseModule):
    def process(self, query: str, context: dict) -> tuple[str, dict]:
        # Return (enhanced_query, updated_context)
        pass
```

#### 2. Document Filters
Process documents after retrieval. Use cases:
- Relevance filtering
- Reranking
- Deduplication
- Score normalization

```python
class RelevanceFilter(BaseModule):
    def filter(self, query: str, documents: list, context: dict) -> tuple[list, dict]:
        # Return (filtered_documents, updated_context)
        pass
```

#### 3. Search Types
Define retrieval strategies. Built-in types:
- **Vector**: Dense embedding similarity
- **BM25**: Sparse lexical search
- **Hybrid**: Combined vector + lexical

```python
class SearchType(BaseModule):
    def search(self, query: str, db, k: int, context: dict) -> tuple[list, dict]:
        # Return (documents, updated_context)
        pass
```

### Module Discovery

Modules are discovered automatically from the `modules/` directory:

1. Each module is a Python package with an `__init__.py`
2. The `__init__.py` must define a `register(registry)` function
3. The function registers module classes with the registry

```python
# modules/my_module/__init__.py
from .my_preprocessor import MyPreprocessor

def register(registry):
    registry.register(MyPreprocessor)
```

### Query Pipeline

```
User Query
    │
    ▼
┌─────────────────────────┐
│   Preprocessor Chain    │  ← Enabled preprocessors run in sequence
│   (QueryPreprocessors)  │
└─────────────────────────┘
    │
    ▼ Enhanced Query
┌─────────────────────────┐
│     Search Type         │  ← Selected search type executes
│  (Vector/BM25/Hybrid)   │
└─────────────────────────┘
    │
    ▼ Retrieved Documents
┌─────────────────────────┐
│     Filter Chain        │  ← Enabled filters run in sequence
│  (RelevanceFilters)     │
└─────────────────────────┘
    │
    ▼ Final Results
```

## API Architecture

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/modules` | GET | List all modules |
| `/api/modules/search-types` | GET | List search types |
| `/api/modules/preprocessors` | GET | List preprocessors |
| `/api/modules/filters` | GET | List filters |
| `/api/modules/refresh` | POST | Re-discover modules |
| `/api/evaluations/start` | POST | Start evaluation |
| `/api/evaluations/:id/status` | GET | Get eval status |
| `/api/datasets` | GET | List datasets |
| `/api/textdb/list` | GET | List vector stores |

### Data Flow

1. **Frontend** sends configuration to API
2. **API** serializes config and calls Python
3. **Python** loads modules, runs pipeline
4. **Results** flow back through API to frontend

## Evaluation Engine

The evaluation engine orchestrates:

1. **Dataset Loading**: Load test cases from JSON files
2. **Query Execution**: Run each query through RAG pipeline
3. **Metric Calculation**: Compute retrieval/generation metrics
4. **Aggregation**: Combine metrics across queries

### Metrics

**Retrieval Metrics** (computed without LLM):
- Precision@K, Recall@K, F1@K
- Hit Rate@K
- MRR (Mean Reciprocal Rank)
- NDCG (Normalized Discounted Cumulative Gain)

**Generation Metrics** (LLM-judged):
- Faithfulness
- Answer Relevancy
- Answer Correctness

## Configuration

### Module Configuration Schema

Each module exposes a configuration schema:

```python
@classmethod
def get_config_schema(cls) -> list[ModuleConfig]:
    return [
        ModuleConfig(
            key="threshold",
            type="number",
            label="Score Threshold",
            description="Minimum score to keep",
            default=0.5,
            min=0.0,
            max=1.0,
        ),
    ]
```

### Evaluation Configuration

```typescript
interface EvaluationConfig {
  kValues: number[];                    // [5, 10, 15, 20]
  enableGenerationMetrics: boolean;     // Use LLM judge
  integrationMode: 'api' | 'direct' | 'text';
  moduleConfig: Record<string, ModuleState>;
  searchType: string;                   // 'vector', 'bm25', 'hybrid'
  searchVariant?: string;               // 'bm25_no_idf', etc.
}
```

## Extension Points

### Adding a New Module

1. Create folder: `modules/my_module/`
2. Implement module class extending base
3. Export `register()` function
4. Restart server or call refresh endpoint

### Adding a New Search Type

1. Create class extending `SearchType`
2. Implement `search()` method
3. Define `SEARCH_VARIANTS` for subtypes
4. Register in `__init__.py`

### Adding New Metrics

1. Add to `src/core/metrics/`
2. Integrate in evaluator
3. Update aggregation logic
4. Add to frontend display

## Performance Considerations

- **Module Caching**: Registry caches module classes
- **Query Caching**: Optional in-memory result cache
- **Lazy Loading**: Vector store loaded on first query
- **Batch Processing**: Metrics calculated in batches

## Security Notes

- Modules execute arbitrary Python code
- Only install modules from trusted sources
- The `modules/` directory is gitignored
- API doesn't expose filesystem beyond allowed paths
