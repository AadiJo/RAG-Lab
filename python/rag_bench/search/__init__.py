"""
Built-in Search Type Implementations

This module provides the core search type implementations that ship with RAG Bench:

- **VectorSearch**: Dense embedding similarity search using the vector store
- **BM25Search**: Sparse lexical search using BM25 algorithm
- **HybridSearch**: Combines vector and lexical search with configurable weights

These search types are automatically registered with the module registry.
Custom search types can be added by placing modules in the `modules/` directory.

Usage:
    Search types are typically accessed through the registry:
    
    ```python
    from rag_bench.modules import get_registry
    
    registry = get_registry()
    search_types = registry.list_search_types()
    
    # Or get an instance directly
    vector_search = registry.get_search_type("vector", {})
    results = vector_search.search(query, db, k=10, context={})
    ```
"""

from .vector import VectorSearch
from .bm25 import BM25Search
from .hybrid import HybridSearch

__all__ = [
    "VectorSearch",
    "BM25Search",
    "HybridSearch",
]


def register_builtin_search_types(registry):
    """
    Register all built-in search types with the registry.
    
    This is called automatically during registry initialization.
    
    Args:
        registry: The ModuleRegistry instance
    """
    registry.register_search_type(VectorSearch)
    registry.register_search_type(BM25Search)
    registry.register_search_type(HybridSearch)
