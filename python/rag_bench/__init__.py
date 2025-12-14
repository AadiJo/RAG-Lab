"""
RAG-Lab - A Modular RAG Evaluation Framework

RAG-Lab is a comprehensive framework for evaluating Retrieval-Augmented Generation
(RAG) systems. It provides:

1. **Modular Architecture**: Extend functionality with custom modules
2. **Search Types**: Pluggable retrieval strategies (vector, BM25, hybrid)
3. **Preprocessing**: Query enhancement and transformation pipelines
4. **Post-processing**: Document filtering and reranking
5. **Metrics**: Comprehensive evaluation metrics (precision, recall, MRR, NDCG)

Quick Start:
    ```python
    from rag_bench.query import QueryRunner
    from rag_bench.modules import get_registry
    
    # Get the module registry
    registry = get_registry()
    
    # List available modules
    modules = registry.list_modules()
    
    # Run a query with modules enabled
    runner = QueryRunner(chroma_path="/path/to/db")
    result = runner.query("How do I build an intake?", k=10)
    ```

For module development, see the `rag_bench.modules` package documentation.
"""

__version__ = "1.0.0"
__author__ = "RAG-Lab Contributors"

from .modules import get_registry, ModuleRegistry

__all__ = [
    "__version__",
    "get_registry",
    "ModuleRegistry",
]
