## Text-only Retrieval Mode

RAG-Lab includes a domain-agnostic text retrieval system for evaluating document retrieval quality.

### Overview

The text retrieval system provides:

- **Vector search**: Dense embedding similarity (Chroma + HuggingFace embeddings)
- **Lexical search**: BM25 sparse retrieval
- **Hybrid search**: Combined vector + lexical scoring
- **Post-processing**: Optional relevance filtering

### Components

- **Python query script**: `python/text_rag/query_text.py`
  - Loads a persisted Chroma DB
  - Supports multiple retrieval methods
  - Optionally applies post-filtering
  - Extensible via modules

- **Bun integration**: `src/integrations/text-chroma-direct.ts`
  - `text` integration mode
  - Works with the evaluation pipeline

- **DB builder**: `python/text_rag/build_text_db.py`
  - Ingest PDFs into Chroma DB
  - Configurable chunking and embeddings

### Configuration

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `TEXT_CHROMA_PATH` | `./data/text_dbs` | Path to vector database |
| `CHROMA_PATH` | (fallback for above) | Alternative path variable |
| `TEXT_EMBEDDING_MODEL` | `BAAI/bge-large-en-v1.5` | HuggingFace embedding model |
| `TEXT_EMBEDDING_DEVICE` | `cpu` | Device for embeddings |
| `PYTHON_PATH` | (auto-detect) | Python interpreter path |

### Quick Start

**1. Install Python dependencies:**

```bash
python3 -m venv .venv-textdb
source .venv-textdb/bin/activate
pip install -r python/requirements-text.txt
```

**2. Build a vector database from PDFs:**

```bash
python python/text_rag/build_text_db.py \
  --input-dir ./data/pdfs \
  --output-dir ./data/text_dbs/my-corpus
```

Notes:
- `--input-dir` defaults to `./data/pdfs` (or `TEXTDB_PDF_INPUT_DIR`) if omitted.
- In the web UI (Text Databases → New Database), the **Input Directory** defaults to `data/pdfs` and the **Browse** button lets you pick a folder under `./data/`.

**3. Run a query:**

```bash
bun run text:query --query "Your search query" --k 10
```

**4. Run an evaluation:**

```bash
bun run evaluate --dataset my-dataset --mode text --k 5,10
```

### Extending with Modules

The text retrieval system is designed to be extended via modules:

- **Query Preprocessors**: Transform queries before retrieval (e.g., query expansion)
- **Relevance Filters**: Rerank/filter results after retrieval

See `docs/module-development.md` for creating custom modules.
