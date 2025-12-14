## Text-only DB + Query Isolation (from `frc-rag`)

This repo now contains a **text-only** querying path that mirrors the core of `frc-rag`’s retrieval logic, without importing or modifying the external `frc-rag` codebase.

### What `frc-rag` does for text retrieval (key facts)

- **Vector DB**: persisted Chroma database at `CHROMA_PATH` (default `backend/db`)
- **Embeddings**: `HuggingFaceEmbeddings(model_name="BAAI/bge-large-en-v1.5")`
- **Query**: `Chroma(...).similarity_search(query, k=K)` (retrieves `Document` objects with `page_content` + `metadata`)
- **Optional post-filter**: a lightweight relevance scoring filter (keyword overlap + FRC keyword boost) that can reduce noise

DB creation is primarily handled in `frc-rag/backend/src/utils/database_setup.py` via:
- `Chroma.from_documents(..., persist_directory=CHROMA_PATH)`
- plus an additional **image** collection (`image_embeddings`) which we intentionally ignore for text-only mode

### What this repo adds (text-only mode)

- **Python query script**: `python/text_rag/query_text.py`
  - Loads a persisted Chroma DB (same format as `frc-rag`)
  - Uses the same embedding model by default
  - Optionally applies post-filtering
  - **Excludes image-only chunk types by default** so text evaluation isn’t polluted by OCR/image contexts

- **Bun integration**: `src/integrations/text-chroma-direct.ts`
  - Adds a new integration mode: `text`
  - Works with the existing evaluator + metrics pipeline

### Configuration

- **DB path**:
  - `TEXT_CHROMA_PATH=/absolute/path/to/db`
  - or `CHROMA_PATH=/absolute/path/to/db`
  - default: `/home/aadi/L-Projects/frc-rag/backend/db`

- **Embedding model**:
  - `TEXT_EMBEDDING_MODEL=BAAI/bge-large-en-v1.5` (default)
  - `TEXT_EMBEDDING_DEVICE=cpu` (default)

### Quick usage

Install the python deps (recommended in a venv):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements-text.txt
```

If you want the **web UI DB builder** and **text mode querying** to use that venv, set:

```bash
export PYTHON_PATH="$(pwd)/.venv-textdb/bin/python"
```

Or create a repo-local venv at `.venv-textdb/` (auto-detected by the server):

```bash
python3 -m venv .venv-textdb
source .venv-textdb/bin/activate
pip install -r python/requirements-text.txt
```

Run a local text query:

```bash
TEXT_CHROMA_PATH=/home/aadi/L-Projects/frc-rag/backend/db \
bun run text:query --query "How do I tune a PID loop?" --k 10 --filter
```

Run an evaluation using the text-only mode:

```bash
bun run evaluate --dataset frc-eval-dataset --mode text --k 5,10 --filter
```


