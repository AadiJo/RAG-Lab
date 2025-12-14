"""
RAG-Lab Module System

This module provides the core abstractions for extending RAG-Lab with custom
preprocessing, post-processing, and search type implementations.

Architecture Overview:
    - QueryPreprocessor: Transforms queries before retrieval (e.g., query expansion)
    - RelevanceFilter: Filters/reranks documents after retrieval
    - SearchType: Different retrieval strategies (vector, BM25, hybrid)

All modules are discovered automatically from the `modules/` directory at the
project root. Each module is a Python package with a `manifest.json` file.

Example module structure:
    modules/
        my_custom_module/
            manifest.json      # Module metadata and configuration schema
            __init__.py        # Must export `register(registry)`
            preprocessor.py    # Optional: QueryPreprocessor implementations
            filter.py          # Optional: RelevanceFilter implementations
            search.py          # Optional: SearchType implementations
"""

from .base import (
    ModuleType,
    BaseModule,
    QueryPreprocessor,
    RelevanceFilter,
    SearchType,
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
    "ModuleConfig",
    "ModuleManifest",
    # Registry
    "ModuleRegistry",
    "get_registry",
]
