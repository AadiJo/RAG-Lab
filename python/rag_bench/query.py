"""
Query Runner - Modular RAG Query Execution

This module provides the main query execution interface that integrates
with the module system. It handles:

1. Loading the vector store
2. Running the preprocessing pipeline
3. Executing the search (using the configured search type)
4. Running the post-processing pipeline
5. Formatting the response

Usage:
    ```python
    from rag_bench.query import QueryRunner
    
    runner = QueryRunner(chroma_path="/path/to/db")
    
    # Simple query
    result = runner.query("How do I build an intake?", k=10)
    
    # Query with module configuration
    result = runner.query(
        "How do I build an intake?",
        k=10,
        module_config={
            "my-preprocessor": {"enabled": True, "config": {...}},
            "my-filter": {"enabled": True, "config": {...}},
        },
        search_type="hybrid",
        search_variant="weighted",
    )
    ```
"""

import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

from rag_bench.modules import get_registry


# Default excluded document types (image-only chunks)
DEFAULT_EXCLUDED_TYPES = {
    "image_context",
    "enhanced_image_context",
    "image_text",
    "enhanced_image_text",
    "enhanced_image_info",
}


class QueryRunner:
    """
    Main query execution engine with module support.
    
    The QueryRunner orchestrates the entire query pipeline:
    1. Query preprocessing (via enabled preprocessor modules)
    2. Document retrieval (via configured search type)
    3. Post-processing (via enabled filter modules)
    
    Attributes:
        chroma_path: Path to the Chroma vector store
        embedding_model: HuggingFace embedding model name
        embedding_device: Device for embeddings ("cpu", "cuda", etc.)
    """
    
    def __init__(
        self,
        chroma_path: str,
        embedding_model: Optional[str] = None,
        embedding_device: Optional[str] = None,
    ):
        """
        Initialize the query runner.
        
        Args:
            chroma_path: Path to the Chroma vector store directory
            embedding_model: HuggingFace embedding model name
                            (default: env TEXT_EMBEDDING_MODEL or BAAI/bge-large-en-v1.5)
            embedding_device: Device for embeddings
                             (default: env TEXT_EMBEDDING_DEVICE or "cpu")
        """
        self.chroma_path = chroma_path
        self.embedding_model = embedding_model or os.getenv(
            "TEXT_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5"
        )
        self.embedding_device = embedding_device or os.getenv(
            "TEXT_EMBEDDING_DEVICE", "cpu"
        )
        
        self._db: Optional[Chroma] = None
        self._registry = get_registry()
    
    def _load_db(self) -> Chroma:
        """Lazy-load the vector store."""
        if self._db is None:
            embeddings = HuggingFaceEmbeddings(
                model_name=self.embedding_model,
                model_kwargs={"device": self.embedding_device},
            )
            self._db = Chroma(
                persist_directory=self.chroma_path,
                embedding_function=embeddings,
            )
        return self._db
    
    def query(
        self,
        query_text: str,
        k: int = 10,
        module_config: Optional[Dict[str, Dict[str, Any]]] = None,
        search_type: str = "vector",
        search_variant: Optional[str] = None,
        search_config: Optional[Dict[str, Any]] = None,
        where: Optional[Dict[str, Any]] = None,
        exclude_image_types: bool = True,
        target_docs: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Execute a query through the full pipeline.
        
        Args:
            query_text: The user's query
            k: Number of documents to retrieve
            module_config: Configuration for modules:
                {
                    "module-id": {
                        "enabled": True/False,
                        "config": {"key": "value", ...}
                    },
                    ...
                }
            search_type: Search type ID ("vector", "bm25", "hybrid")
            search_variant: Search variant (e.g., "bm25_no_idf")
            search_config: Additional config for the search type
            where: Metadata filter for retrieval
            exclude_image_types: Filter out image-only document types
            target_docs: Target number of docs after filtering
        
        Returns:
            Query result dictionary with:
                - query: Original query
                - enhanced_query: Query after preprocessing
                - documents: Retrieved and filtered documents
                - context_parts: Document contents as list
                - metadata: Processing metadata
        """
        if not os.path.exists(self.chroma_path):
            return {"error": f"Chroma DB path not found: {self.chroma_path}"}
        
        db = self._load_db()
        module_config = module_config or {}
        
        # --- Preprocessing Pipeline ---
        context: Dict[str, Any] = {
            "where": where,
            "variant": search_variant,
        }
        
        enhanced_query, context = self._registry.run_preprocessors(
            query_text,
            module_config,
            initial_context=context,
        )
        
        # --- Search ---
        search_cfg = search_config or {}
        search_instance = self._registry.get_search_type(search_type, search_cfg)
        
        if search_instance is None:
            # Fall back to built-in search types
            from rag_bench.search import VectorSearch, BM25Search, HybridSearch
            
            search_map = {
                "vector": VectorSearch,
                "bm25": BM25Search,
                "hybrid": HybridSearch,
            }
            search_cls = search_map.get(search_type, VectorSearch)
            search_instance = search_cls(search_cfg)
        
        # Fetch extra docs if we're going to filter
        initial_k = k * 2 if target_docs else k
        
        documents, context = search_instance.search(
            enhanced_query,
            db,
            initial_k,
            context,
        )
        
        # Handle search errors
        if "error" in context:
            return {
                "query": query_text,
                "enhanced_query": enhanced_query,
                "error": context["error"],
                "documents": [],
                "context_parts": [],
                "metadata": context,
            }
        
        # --- Exclude image types ---
        if exclude_image_types:
            documents = [
                doc for doc in documents
                if doc.get("metadata", {}).get("type") not in DEFAULT_EXCLUDED_TYPES
            ]
        
        # --- Post-processing Pipeline ---
        documents, context = self._registry.run_filters(
            enhanced_query,
            documents,
            module_config,
            context,
        )
        
        # Apply target_docs limit
        if target_docs and len(documents) > target_docs:
            documents = documents[:target_docs]
        
        # Limit to k
        documents = documents[:k]
        
        # --- Format Response ---
        context_parts = [doc.get("content", "") for doc in documents]
        
        return {
            "query": query_text,
            "original_query": query_text,
            "enhanced_query": enhanced_query,
            "documents": documents,
            "context_parts": context_parts,
            "context_sources": len(documents),
            "search_type": search_type,
            "search_variant": search_variant or context.get("variant"),
            "metadata": {
                "preprocessing": context.get("preprocessing_applied", []),
                "filters_applied": context.get("filters_applied", []),
                "search_metadata": {
                    k: v for k, v in context.items()
                    if k not in ("where", "variant", "original_query")
                },
            },
        }
    
    def list_modules(self) -> List[Dict[str, Any]]:
        """
        List all available modules.
        
        Returns:
            List of module manifests
        """
        return self._registry.list_modules()
    
    def list_search_types(self) -> List[Dict[str, Any]]:
        """
        List available search types.
        
        Returns:
            List of search type descriptors with variants
        """
        return self._registry.list_search_types()


def main():
    """CLI entry point for query runner."""
    import argparse
    
    parser = argparse.ArgumentParser(description="RAG Bench Query Runner")
    parser.add_argument("--chroma-path", required=True, help="Path to Chroma DB")
    parser.add_argument("--query", required=True, help="Query text")
    parser.add_argument("--k", type=int, default=10, help="Number of documents")
    parser.add_argument("--search-type", default="vector", help="Search type ID")
    parser.add_argument("--search-variant", default=None, help="Search variant")
    parser.add_argument("--where-json", default="", help="Metadata filter as JSON")
    parser.add_argument("--module-config-json", default="", help="Module config as JSON")
    parser.add_argument("--target-docs", type=int, default=None, help="Target docs after filter")
    parser.add_argument("--include-image-types", action="store_true")
    parser.add_argument("--list-modules", action="store_true", help="List available modules")
    parser.add_argument("--list-search-types", action="store_true", help="List search types")
    
    args = parser.parse_args()
    
    runner = QueryRunner(chroma_path=args.chroma_path)
    
    if args.list_modules:
        print(json.dumps(runner.list_modules(), indent=2))
        return
    
    if args.list_search_types:
        print(json.dumps(runner.list_search_types(), indent=2))
        return
    
    # Parse JSON arguments
    where = None
    if args.where_json:
        try:
            where = json.loads(args.where_json)
        except Exception:
            pass
    
    module_config = {}
    if args.module_config_json:
        try:
            module_config = json.loads(args.module_config_json)
        except Exception:
            pass
    
    result = runner.query(
        query_text=args.query,
        k=args.k,
        module_config=module_config,
        search_type=args.search_type,
        search_variant=args.search_variant,
        where=where,
        exclude_image_types=not args.include_image_types,
        target_docs=args.target_docs,
    )
    
    print(json.dumps(result, default=str))
    
    if "error" in result:
        sys.exit(2)


if __name__ == "__main__":
    main()
