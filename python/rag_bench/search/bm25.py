"""
BM25 Search Implementation

Sparse lexical search using the BM25 (Best Match 25) algorithm.
BM25 is a probabilistic retrieval model that ranks documents based on
term frequency and inverse document frequency.

Features:
- Works well for keyword-based queries
- Doesn't require embeddings
- Supports variants: BM25 (with IDF), BM25 without IDF, and raw TF

Dependencies:
    Requires `rank_bm25` package: pip install rank-bm25
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from rag_bench.modules.base import ModuleConfig, SearchType

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    BM25Okapi = None


class BM25Search(SearchType):
    """
    BM25 lexical search implementation.
    
    Retrieves the full corpus from the vector store and applies BM25 ranking
    in Python. This is useful for:
    - Keyword-based queries where exact term matching is important
    - Comparison experiments between dense and sparse retrieval
    - Hybrid retrieval systems
    
    Configuration:
        None required.
    
    Context Parameters:
        - variant: "bm25" (default), "bm25_no_idf", or "tf"
        - where: Optional filter dict for pre-filtering corpus
    """
    
    MODULE_ID = "bm25"
    MODULE_NAME = "BM25 Search"
    MODULE_DESCRIPTION = "Sparse lexical search using BM25 algorithm"
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "RAG-Lab"
    MODULE_TAGS = ["search", "lexical", "bm25", "sparse", "keyword"]
    ENABLED_BY_DEFAULT = True
    
    SEARCH_VARIANTS = [
        {"id": "bm25", "name": "BM25 (with IDF)"},
        {"id": "bm25_no_idf", "name": "BM25 (no IDF)"},
        {"id": "tf", "name": "Term Frequency only"},
    ]
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return []
    
    def _tokenize(self, text: str) -> List[str]:
        """Simple whitespace/punctuation tokenizer."""
        return re.findall(r"\b\w+\b", (text or "").lower())
    
    def search(
        self,
        query: str,
        db: Any,
        k: int,
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Perform BM25 lexical search.
        
        Args:
            query: The search query
            db: The Chroma vector store instance
            k: Number of documents to retrieve
            context: Search context with optional "variant" and "where"
        
        Returns:
            Tuple of (documents, updated_context)
        """
        variant = context.get("variant", "bm25")
        where_filter = context.get("where")
        
        # Fetch corpus from vector store
        try:
            got = db.get(where=where_filter, include=["documents", "metadatas"])
            corpus_docs = got.get("documents", []) or []
            corpus_metas = got.get("metadatas", []) or []
        except Exception as e:
            return [], {"error": f"Corpus fetch failed: {e}", "search_type": "bm25"}
        
        if not corpus_docs:
            return [], {"search_type": "bm25", "variant": variant, "corpus_size": 0}
        
        # Tokenize
        tokenized_corpus = [self._tokenize(doc) for doc in corpus_docs]
        query_tokens = self._tokenize(query)
        query_set = set(query_tokens)
        
        # Calculate scores based on variant
        scores: List[float] = []
        
        if variant == "tf":
            # Simple term frequency
            for tokens in tokenized_corpus:
                freq = sum(1 for t in tokens if t in query_set)
                scores.append(float(freq))
        elif variant == "bm25_no_idf":
            # BM25-style scoring without IDF (approximate with TF)
            for tokens in tokenized_corpus:
                freq = sum(1 for t in tokens if t in query_set)
                scores.append(float(freq))
        else:
            # Full BM25
            if BM25Okapi is None:
                return [], {
                    "error": "rank_bm25 not installed. Install with: pip install rank-bm25",
                    "search_type": "bm25",
                }
            bm25 = BM25Okapi(tokenized_corpus)
            scores = [float(s) for s in bm25.get_scores(query_tokens)]
        
        # Rank by score
        ranked_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        
        documents = []
        for rank, idx in enumerate(ranked_indices[:k]):
            documents.append({
                "content": corpus_docs[idx],
                "metadata": corpus_metas[idx] if idx < len(corpus_metas) else {},
                "score": scores[idx],
                "rank": rank,
            })
        
        return documents, {
            **context,
            "search_type": "bm25",
            "variant": variant,
            "corpus_size": len(corpus_docs),
        }
