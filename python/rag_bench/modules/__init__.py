"""
RAG-Lab Module System

This module provides the core abstractions for extending RAG-Lab with custom
preprocessing, post-processing, search type, and document processing implementations.

Architecture Overview:
    - QueryPreprocessor: Transforms queries before retrieval (e.g., query expansion)
    - RelevanceFilter: Filters/reranks documents after retrieval
    - SearchType: Different retrieval strategies (vector, BM25, hybrid)
    - DocumentProcessor: Transforms documents during database ingestion

All modules are discovered automatically from the `modules/` directory at the
project root. Each module is a Python package with a `register(registry)` function.

Example module structure:
    modules/
        my_custom_module/
            __init__.py        # Must export `register(registry)`
            preprocessor.py    # Optional: QueryPreprocessor implementations
            filter.py          # Optional: RelevanceFilter implementations
            search.py          # Optional: SearchType implementations
            document.py        # Optional: DocumentProcessor implementations
"""

from .base import (
    ModuleType,
    BaseModule,
    QueryPreprocessor,
    RelevanceFilter,
    SearchType,
    DocumentProcessor,
    ModuleConfig,
    ModuleManifest,
)
from .registry import ModuleRegistry, get_registry

__all__ = [
    # Base classes
    "ModuleType",
    "BaseModule",
    "QueryPreprocessor",
    "RelevanceFilter",
    "SearchType",
    "DocumentProcessor",
    "ModuleConfig",
    "ModuleManifest",
    # Registry
    "ModuleRegistry",
    "get_registry",
]
