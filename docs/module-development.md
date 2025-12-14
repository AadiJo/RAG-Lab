# Module Development Guide

This guide explains how to create custom modules for RAG Bench.

## Overview

RAG Bench modules extend the query pipeline with domain-specific logic. There are three types of modules:

1. **Query Preprocessors** - Transform queries before retrieval
2. **Document Filters** - Filter/rerank documents after retrieval
3. **Search Types** - Custom retrieval strategies

## Quick Start

### 1. Create Module Directory

```bash
mkdir -p modules/my_module
```

### 2. Create Module Files

```
modules/my_module/
├── __init__.py          # Registration
├── my_preprocessor.py   # Preprocessor implementation
├── my_filter.py         # Filter implementation (optional)
└── README.md            # Documentation
```

### 3. Implement Module

```python
# modules/my_module/my_preprocessor.py

import sys
sys.path.insert(0, '.')

from rag_bench.modules.base import QueryPreprocessor, ModuleConfig
from typing import Any, Dict, List, Tuple

class MyPreprocessor(QueryPreprocessor):
    """
    Brief description of what this preprocessor does.
    """
    
    # Required: Unique identifier (lowercase, hyphens)
    MODULE_ID = "my-preprocessor"
    
    # Required: Human-readable name
    MODULE_NAME = "My Preprocessor"
    
    # Required: Description for UI
    MODULE_DESCRIPTION = "Enhances queries with custom logic"
    
    # Optional metadata
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "Your Name"
    MODULE_TAGS = ["custom", "enhancement"]
    ENABLED_BY_DEFAULT = False
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        """Define configuration options shown in the UI."""
        return [
            ModuleConfig(
                key="intensity",
                type="number",
                label="Enhancement Intensity",
                description="How aggressively to enhance queries (0-1)",
                default=0.5,
                min=0.0,
                max=1.0,
            ),
            ModuleConfig(
                key="mode",
                type="select",
                label="Enhancement Mode",
                description="Which enhancement strategy to use",
                default="balanced",
                options=[
                    {"value": "aggressive", "label": "Aggressive"},
                    {"value": "balanced", "label": "Balanced"},
                    {"value": "conservative", "label": "Conservative"},
                ],
            ),
        ]
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize with user configuration."""
        super().__init__(config)
        self.intensity = config.get("intensity", 0.5)
        self.mode = config.get("mode", "balanced")
    
    def process(self, query: str, context: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Process the query.
        
        Args:
            query: Input query (may be modified by previous preprocessors)
            context: Shared context dict
        
        Returns:
            Tuple of (enhanced_query, updated_context)
        """
        # Your enhancement logic here
        enhanced = self._enhance(query)
        
        # Update context with metadata
        context["my_preprocessor"] = {
            "original": query,
            "enhanced": enhanced,
            "intensity": self.intensity,
        }
        
        # Track that this preprocessor ran
        applied = context.get("preprocessing_applied", [])
        applied.append(self.MODULE_ID)
        context["preprocessing_applied"] = applied
        
        return enhanced, context
    
    def _enhance(self, query: str) -> str:
        """Internal enhancement logic."""
        # Implement your logic
        return query + " enhanced"
```

### 4. Register Module

```python
# modules/my_module/__init__.py

from .my_preprocessor import MyPreprocessor

def register(registry):
    """Called automatically during module discovery."""
    registry.register(MyPreprocessor)
```

### 5. Restart & Test

```bash
# Restart the server
bun run dev

# Or call the refresh endpoint
curl -X POST http://localhost:3100/api/modules/refresh
```

## Configuration Options

### ModuleConfig Types

| Type | UI Element | Value Type |
|------|------------|------------|
| `string` | Text input | `str` |
| `number` | Number input | `float` |
| `boolean` | Checkbox | `bool` |
| `select` | Dropdown | `str` |
| `multiselect` | Multi-select | `list[str]` |

### Example Configurations

```python
# String input
ModuleConfig(
    key="api_key",
    type="string",
    label="API Key",
    description="Your API key",
    required=True,
)

# Number with range
ModuleConfig(
    key="threshold",
    type="number",
    label="Threshold",
    default=0.5,
    min=0.0,
    max=1.0,
)

# Boolean toggle
ModuleConfig(
    key="verbose",
    type="boolean",
    label="Verbose Mode",
    default=False,
)

# Select dropdown
ModuleConfig(
    key="model",
    type="select",
    label="Model",
    default="gpt-4",
    options=[
        {"value": "gpt-4", "label": "GPT-4"},
        {"value": "gpt-3.5", "label": "GPT-3.5"},
    ],
)
```

## Creating Filters

Document filters process the retrieved documents:

```python
from rag_bench.modules.base import RelevanceFilter, ModuleConfig
from typing import Any, Dict, List, Tuple

class MyFilter(RelevanceFilter):
    MODULE_ID = "my-filter"
    MODULE_NAME = "My Filter"
    MODULE_DESCRIPTION = "Filters documents by custom criteria"
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return [
            ModuleConfig(
                key="min_score",
                type="number",
                label="Minimum Score",
                default=0.3,
                min=0.0,
                max=1.0,
            ),
        ]
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.min_score = config.get("min_score", 0.3)
    
    def filter(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Filter documents.
        
        Args:
            query: The search query
            documents: Retrieved documents, each with:
                - "content": Document text
                - "metadata": Dict of metadata
                - "score": Retrieval score (optional)
                - "rank": Current rank
            context: Shared context
        
        Returns:
            Tuple of (filtered_documents, updated_context)
        """
        # Score each document
        scored = []
        for doc in documents:
            score = self._score_document(query, doc)
            if score >= self.min_score:
                scored.append((doc, score))
        
        # Sort by score
        scored.sort(key=lambda x: x[1], reverse=True)
        
        # Update ranks
        result = []
        for rank, (doc, score) in enumerate(scored):
            result.append({**doc, "rank": rank, "filter_score": score})
        
        # Update context
        context["my_filter"] = {
            "before": len(documents),
            "after": len(result),
        }
        
        return result, context
    
    def _score_document(self, query: str, doc: Dict[str, Any]) -> float:
        """Score a document's relevance."""
        # Your scoring logic
        return 0.5
```

## Creating Search Types

Custom search types implement alternative retrieval strategies:

```python
from rag_bench.modules.base import SearchType, ModuleConfig
from typing import Any, Dict, List, Tuple

class MySearchType(SearchType):
    MODULE_ID = "my-search"
    MODULE_NAME = "My Search"
    MODULE_DESCRIPTION = "Custom retrieval strategy"
    
    # Define variants (shown in dropdown)
    SEARCH_VARIANTS = [
        {"id": "default", "name": "Default"},
        {"id": "fast", "name": "Fast Mode"},
        {"id": "accurate", "name": "Accurate Mode"},
    ]
    
    def search(
        self,
        query: str,
        db: Any,
        k: int,
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Execute search.
        
        Args:
            query: Search query
            db: Vector store (Chroma instance)
            k: Number of documents to retrieve
            context: Shared context with:
                - "variant": Selected variant ID
                - "where": Metadata filter
        
        Returns:
            Tuple of (documents, updated_context)
        """
        variant = context.get("variant", "default")
        where_filter = context.get("where")
        
        # Your search logic
        if variant == "fast":
            results = self._fast_search(query, db, k)
        else:
            results = self._default_search(query, db, k, where_filter)
        
        # Format results
        documents = []
        for rank, doc in enumerate(results):
            documents.append({
                "content": doc.page_content,
                "metadata": doc.metadata or {},
                "score": None,
                "rank": rank,
            })
        
        context["search_type"] = self.MODULE_ID
        context["variant"] = variant
        
        return documents, context
```

## Best Practices

### 1. Module Isolation

Modules should be self-contained:
- Don't modify global state
- Don't depend on other modules' internals
- Handle errors gracefully

### 2. Configuration Validation

Validate config in `__init__`:

```python
def __init__(self, config: Dict[str, Any]):
    super().__init__(config)  # Validates required fields
    
    # Additional validation
    if self.config.get("threshold", 0) < 0:
        raise ValueError("threshold must be non-negative")
```

### 3. Context Usage

Use context to pass information between modules:

```python
# In preprocessor
context["entities"] = self.extract_entities(query)

# In filter (later in pipeline)
entities = context.get("entities", [])
```

### 4. Logging

Use print statements for debugging (shown in server logs):

```python
def process(self, query: str, context: Dict[str, Any]):
    print(f"[{self.MODULE_ID}] Processing query: {query[:50]}...")
```

### 5. Performance

- Cache expensive computations
- Avoid loading large files in `__init__`
- Use lazy loading for models

```python
def __init__(self, config):
    super().__init__(config)
    self._model = None  # Lazy load

@property
def model(self):
    if self._model is None:
        self._model = self._load_model()
    return self._model
```

## Testing Modules

### Manual Testing

```bash
# List modules
curl http://localhost:3100/api/modules

# Check if your module appears
curl http://localhost:3100/api/modules | jq '.modules[] | select(.id == "my-module")'
```

### Python Testing

```python
# test_my_module.py
import sys
sys.path.insert(0, 'python')

from modules.my_module.my_preprocessor import MyPreprocessor

def test_preprocessor():
    config = {"intensity": 0.8}
    preprocessor = MyPreprocessor(config)
    
    query = "test query"
    context = {}
    
    result, ctx = preprocessor.process(query, context)
    
    assert result != query
    assert "my_preprocessor" in ctx
```

## Distributing Modules

### Package Structure

For distributable modules, include:

```
my_module/
├── __init__.py
├── my_preprocessor.py
├── README.md
├── requirements.txt    # Additional dependencies
└── examples/
    └── usage.py
```

### Installation Instructions

1. Copy folder to `modules/`
2. Install dependencies: `pip install -r modules/my_module/requirements.txt`
3. Restart server

## Troubleshooting

### Module Not Appearing

1. Check `__init__.py` has `register()` function
2. Check for syntax errors: `python -c "import modules.my_module"`
3. Check server logs for errors
4. Call refresh endpoint

### Config Not Working

1. Verify config schema matches expected types
2. Check config key names match exactly
3. Ensure defaults are correct type

### Import Errors

Add path handling at top of module files:

```python
import sys
sys.path.insert(0, '.')
```
