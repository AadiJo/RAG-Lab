"""
Hybrid Search Implementation

Combines vector (dense) and BM25 (sparse) search using Reciprocal Rank Fusion
or weighted score combination.

Features:
- Best of both worlds: semantic understanding + keyword matching
- Configurable weighting between vector and lexical scores
- Multiple fusion strategies

This is often the best choice for production RAG systems.
"""

import re
from typing import Any, Dict, List, Tuple

from rag_bench.modules.base import ModuleConfig, SearchType

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    BM25Okapi = None


class HybridSearch(SearchType):
    """
    Hybrid search combining vector and lexical retrieval.
    
    Performs both vector similarity search and BM25 search, then combines
    the results using a configurable fusion strategy.
    
    Configuration:
        - vector_weight: Weight for vector search scores (0-1, default 0.5)
        - lexical_weight: Weight for lexical search scores (0-1, default 0.5)
        - fusion_method: "weighted" (default) or "rrf" (Reciprocal Rank Fusion)
    
    Context Parameters:
        - where: Optional filter dict for metadata filtering
        - lexical_variant: BM25 variant ("bm25", "bm25_no_idf", "tf")
    """
    
    MODULE_ID = "hybrid"
    MODULE_NAME = "Hybrid Search"
    MODULE_DESCRIPTION = "Combines vector and BM25 search for best results"
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "RAG-Lab"
    MODULE_TAGS = ["search", "hybrid", "vector", "bm25", "fusion"]
    ENABLED_BY_DEFAULT = True
    
    SEARCH_VARIANTS = [
        {"id": "weighted", "name": "Weighted Combination"},
        {"id": "rrf", "name": "Reciprocal Rank Fusion"},
    ]
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return [
            ModuleConfig(
                key="vector_weight",
                type="number",
                label="Vector Weight",
                description="Weight for vector search scores (0-1)",
                default=0.5,
                min=0.0,
                max=1.0,
            ),
            ModuleConfig(
                key="lexical_weight",
                type="number",
                label="Lexical Weight",
                description="Weight for BM25 search scores (0-1)",
                default=0.5,
                min=0.0,
                max=1.0,
            ),
        ]
    
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
        Perform hybrid search.
        
        Args:
            query: The search query
            db: The Chroma vector store instance
            k: Number of documents to retrieve
            context: Search context
        
        Returns:
            Tuple of (documents, updated_context)
        """
        where_filter = context.get("where")
        variant = context.get("variant", "weighted")
        lexical_variant = context.get("lexical_variant", "bm25")
        
        vector_weight = self.config.get("vector_weight", 0.5)
        lexical_weight = self.config.get("lexical_weight", 0.5)
        
        # Fetch corpus for BM25
        try:
            got = db.get(where=where_filter, include=["documents", "metadatas"])
            corpus_docs = got.get("documents", []) or []
            corpus_metas = got.get("metadatas", []) or []
        except Exception as e:
            return [], {"error": f"Corpus fetch failed: {e}", "search_type": "hybrid"}
        
        if not corpus_docs:
            return [], {"search_type": "hybrid", "variant": variant, "corpus_size": 0}
        
        # Build content -> index map for merging results
        content_to_idx = {doc: i for i, doc in enumerate(corpus_docs)}
        
        # --- Vector Search ---
        vector_results = []
        try:
            vector_results = db.similarity_search(query, k=min(k * 2, len(corpus_docs)), filter=where_filter)
        except Exception:
            pass
        
        # Vector rank scores (1/rank)
        vector_scores: Dict[int, float] = {}
        for rank, doc in enumerate(vector_results):
            content = doc.page_content
            if content in content_to_idx:
                idx = content_to_idx[content]
                vector_scores[idx] = 1.0 / (rank + 1)
        
        # --- BM25 Search ---
        tokenized_corpus = [self._tokenize(doc) for doc in corpus_docs]
        query_tokens = self._tokenize(query)
        query_set = set(query_tokens)
        
        lexical_scores: List[float] = []
        if lexical_variant == "tf":
            for tokens in tokenized_corpus:
                freq = sum(1 for t in tokens if t in query_set)
                lexical_scores.append(float(freq))
        elif lexical_variant == "bm25_no_idf":
            for tokens in tokenized_corpus:
                freq = sum(1 for t in tokens if t in query_set)
                lexical_scores.append(float(freq))
        else:
            if BM25Okapi is None:
                return [], {
                    "error": "rank_bm25 not installed",
                    "search_type": "hybrid",
                }
            bm25 = BM25Okapi(tokenized_corpus)
            lexical_scores = [float(s) for s in bm25.get_scores(query_tokens)]
        
        # Normalize lexical scores to 0-1
        max_lex = max(lexical_scores) if lexical_scores else 1.0
        min_lex = min(lexical_scores) if lexical_scores else 0.0
        denom = (max_lex - min_lex) if (max_lex - min_lex) > 0 else 1.0
        norm_lexical = [(s - min_lex) / denom for s in lexical_scores]
        
        # --- Combine Scores ---
        combined_scores: List[float] = []
        
        if variant == "rrf":
            # Reciprocal Rank Fusion
            # RRF score = 1 / (k + rank_vector) + 1 / (k + rank_lexical)
            rrf_k = 60  # Standard RRF constant
            
            # Get lexical ranks
            lexical_ranks = sorted(range(len(lexical_scores)), key=lambda i: lexical_scores[i], reverse=True)
            idx_to_lex_rank = {idx: rank for rank, idx in enumerate(lexical_ranks)}
            
            for i in range(len(corpus_docs)):
                v_rank = 1.0 / (rrf_k + (1.0 / vector_scores[i] if i in vector_scores else 1000))
                l_rank = 1.0 / (rrf_k + idx_to_lex_rank.get(i, 1000))
                combined_scores.append(v_rank + l_rank)
        else:
            # Weighted combination
            for i in range(len(corpus_docs)):
                v_score = vector_scores.get(i, 0.0)
                l_score = norm_lexical[i]
                combined_scores.append(vector_weight * v_score + lexical_weight * l_score)
        
        # Rank by combined score
        ranked_indices = sorted(range(len(combined_scores)), key=lambda i: combined_scores[i], reverse=True)
        
        documents = []
        for rank, idx in enumerate(ranked_indices[:k]):
            documents.append({
                "content": corpus_docs[idx],
                "metadata": corpus_metas[idx] if idx < len(corpus_metas) else {},
                "score": combined_scores[idx],
                "rank": rank,
            })
        
        return documents, {
            **context,
            "search_type": "hybrid",
            "variant": variant,
            "vector_weight": vector_weight,
            "lexical_weight": lexical_weight,
            "corpus_size": len(corpus_docs),
        }
