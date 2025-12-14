"""
Vector Search Implementation

Dense embedding similarity search using the vector store's native search.
This is the default search type for most RAG applications.

Features:
- Uses pre-computed embeddings in the vector store
- Supports metadata filtering via the `where` context parameter
- Fast for large document collections with proper indexing
"""

from typing import Any, Dict, List, Tuple

from rag_bench.modules.base import ModuleConfig, SearchType


class VectorSearch(SearchType):
    """
    Dense vector similarity search.
    
    Uses the vector store's native similarity_search method to find
    documents with embeddings most similar to the query embedding.
    
    Configuration:
        No additional configuration required.
    
    Context Parameters:
        - where: Optional filter dict for metadata filtering
    """
    
    MODULE_ID = "vector"
    MODULE_NAME = "Vector Search"
    MODULE_DESCRIPTION = "Dense embedding similarity search using cosine similarity"
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "RAG Bench"
    MODULE_TAGS = ["search", "vector", "embedding", "semantic"]
    ENABLED_BY_DEFAULT = True
    
    SEARCH_VARIANTS = [
        {"id": "cosine", "name": "Cosine Similarity (default)"},
    ]
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return []  # No configuration needed
    
    def search(
        self,
        query: str,
        db: Any,
        k: int,
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Perform vector similarity search.
        
        Args:
            query: The search query
            db: The Chroma vector store instance
            k: Number of documents to retrieve
            context: Search context with optional "where" filter
        
        Returns:
            Tuple of (documents, updated_context)
        """
        where_filter = context.get("where")
        
        try:
            results = db.similarity_search(query, k=k, filter=where_filter)
        except Exception as e:
            return [], {"error": str(e), "search_type": "vector"}
        
        documents = []
        for i, doc in enumerate(results):
            documents.append({
                "content": doc.page_content,
                "metadata": doc.metadata or {},
                "score": None,  # Chroma doesn't return scores by default
                "rank": i,
            })
        
        return documents, {
            **context,
            "search_type": "vector",
            "variant": context.get("variant", "cosine"),
        }
