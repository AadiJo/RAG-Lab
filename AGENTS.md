# AGENTS.md

Instructions for AI agents (Claude, GPT, Cursor, Copilot, etc.) working on this codebase.

## Project Overview

**RAG-Lab** is a modular RAG (Retrieval-Augmented Generation) evaluation framework.

**Tech Stack:**
- Backend: Bun + TypeScript (Hono framework)
- Frontend: React + Vite + TypeScript
- Query Runtime: Python 3.10+
- Vector Store: Chroma (via LangChain)

**Key Concept:** The module system allows users to extend functionality with custom preprocessors, filters, and search types without modifying core code.

## Directory Structure

```
RAG-Lab/
├── src/                    # TypeScript API server
│   ├── api/                # REST endpoints (Hono routes)
│   ├── core/               # Evaluation engine
│   ├── modules/            # TS module types & manager
│   └── integrations/       # RAG backend integrations
├── python/
│   └── rag_bench/          # Python module system
│       ├── modules/        # Base classes & registry
│       ├── search/         # Built-in search types
│       └── query.py        # Query runner
├── modules/                # USER MODULES (gitignored)
├── web/                    # React frontend
├── datasets/               # Evaluation datasets (JSON)
├── data/text_dbs/          # Vector stores (gitignored)
└── docs/                   # Documentation
```

## Common Tasks

### Creating a Module for the User

When asked to create a module, follow this structure:

1. **Create directory:** `modules/<module_name>/`

2. **Create module class** extending the appropriate base:
   - `QueryPreprocessor` for query transformation
   - `RelevanceFilter` for document filtering/reranking
   - `SearchType` for custom retrieval strategies
   - `DocumentProcessor` for document transformation during ingestion

3. **Required attributes:**
   ```python
   MODULE_ID = "my-module"           # lowercase, hyphens
   MODULE_NAME = "My Module"         # Display name
   MODULE_DESCRIPTION = "..."        # For UI
   ```

4. **Create `__init__.py`** with `register(registry)` function

5. **Create `README.md`** documenting the module

**Template locations:**
- `docs/examples/` - Example modules (for reference)
- `python/rag_bench/modules/base.py` - Base classes
- `python/rag_bench/search/` - Search type examples

### Adding API Endpoints

- Add routes in `src/api/` using Hono
- Register in `src/api/routes.ts`
- Add client functions in `web/src/lib/api.ts`

### Adding Frontend Components

- Components go in `web/src/components/`
- Use Tailwind CSS with the existing dark theme
- Follow the glass-panel styling pattern

### Modifying the Evaluation Pipeline

- Evaluator: `src/core/evaluator.ts`
- Metrics: `src/core/metrics/`
- Query execution: `python/rag_bench/query.py`

## Code Conventions

### Python

```python
# Module class template
class MyModule(QueryPreprocessor):
    MODULE_ID = "my-module"
    MODULE_NAME = "My Module"
    MODULE_DESCRIPTION = "Description"
    MODULE_VERSION = "1.0.0"
    ENABLED_BY_DEFAULT = False
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return [...]
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
    
    def process(self, query: str, context: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        # Implementation
        return query, context
```

### TypeScript

- Use `@/` path alias for imports from `src/`
- Types go in `src/types/index.ts`
- Use async/await, not callbacks

### React (Frontend)

- Functional components with hooks
- Tailwind CSS for styling
- Dark theme: `bg-zinc-900`, `text-zinc-100`, etc.

## Configuration Schema Types

When defining module config options:

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text input | API keys, file paths |
| `number` | Numeric input | Thresholds, weights |
| `boolean` | Checkbox | Enable/disable features |
| `select` | Dropdown | Mode selection |
| `multiselect` | Multi-select | Multiple options |

```python
ModuleConfig(
    key="threshold",
    type="number",
    label="Score Threshold",
    description="Minimum score to keep",
    default=0.5,
    min=0.0,
    max=1.0,
)
```

## Do NOT

- ❌ Modify files in `python/rag_bench/modules/base.py` unless asked
- ❌ Modify files in `python/rag_bench/search/` unless asked
- ❌ Hardcode absolute paths
- ❌ Put user modules anywhere except `modules/`
- ❌ Remove the `register()` function from module `__init__.py`
- ❌ Import from one user module to another

## Do

- ✅ Create modules in `modules/<name>/` directory
- ✅ Extend base classes from `rag_bench.modules.base`
- ✅ Include `README.md` in each module
- ✅ Use `get_config_schema()` for user-configurable options
- ✅ Handle errors gracefully (return original input on failure)
- ✅ Track applied modules in context dict

## Testing

```bash
# Check Python imports
PYTHONPATH=./python python3 -c "from rag_bench.modules import get_registry; print(get_registry().list_modules())"

# Check TypeScript
bun run typecheck

# Start servers
bun run dev          # Backend :3100
cd web && bun run dev # Frontend :3101
```

## Quick Reference

### Module Base Classes

| Class | Method to Implement | Use Case |
|-------|---------------------|----------|
| `QueryPreprocessor` | `process(query, context)` | Query expansion, normalization |
| `RelevanceFilter` | `filter(query, docs, context)` | Reranking, filtering |
| `SearchType` | `search(query, db, k, context)` | Custom retrieval |
| `DocumentProcessor` | `process_document(content, metadata, context)` | Metadata extraction, content transformation |

### Key Files

| File | Purpose |
|------|---------|
| `python/rag_bench/modules/base.py` | Base classes |
| `python/rag_bench/modules/registry.py` | Module discovery |
| `src/api/modules.ts` | Module API endpoints |
| `web/src/components/ModulesConfig.tsx` | Module UI |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/modules` | GET | List all modules |
| `/api/modules/refresh` | POST | Re-discover modules |
| `/api/modules/search-types` | GET | List search types |
| `/api/evaluations/start` | POST | Start evaluation |

## Example: Creating a Simple Preprocessor

```python
# modules/keyword_expander/__init__.py
from .expander import KeywordExpander
def register(registry):
    registry.register(KeywordExpander)

# modules/keyword_expander/expander.py
from rag_bench.modules.base import QueryPreprocessor, ModuleConfig

class KeywordExpander(QueryPreprocessor):
    MODULE_ID = "keyword-expander"
    MODULE_NAME = "Keyword Expander"
    MODULE_DESCRIPTION = "Adds related keywords to queries"
    
    @classmethod
    def get_config_schema(cls):
        return [
            ModuleConfig(
                key="keywords_file",
                type="string",
                label="Keywords JSON File",
                default="",
            ),
        ]
    
    def __init__(self, config):
        super().__init__(config)
        self.keywords = self._load_keywords()
    
    def process(self, query, context):
        expanded = self._expand(query)
        context["keyword_expander"] = {"added": [...]}
        return expanded, context
```
