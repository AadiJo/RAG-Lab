#!/usr/bin/env python3
"""
Text-only query runner for a persisted Chroma database.

Design goals:
- Domain-agnostic text retrieval
- HuggingFaceEmbeddings (configurable via env)
- Chroma similarity_search with optional BM25/hybrid
- Optional lightweight post-processing filter
- Pluggable query enhancement via modules

Output: JSON on stdout.
"""

import argparse
import json
import os
import sys
import re
from typing import Any, Dict, List, Optional, Tuple

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

from text_rag.post_processor import SimplePostProcessor

try:
    from rank_bm25 import BM25Okapi  # type: ignore
except Exception:
    BM25Okapi = None


DEFAULT_EXCLUDED_TYPES = {
    "image_context",
    "enhanced_image_context",
    "image_text",
    "enhanced_image_text",
    "enhanced_image_info",
}


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _get_embedding_model() -> Tuple[str, str]:
    model_name = os.getenv("TEXT_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5")
    device = os.getenv("TEXT_EMBEDDING_DEVICE", "cpu")
    return model_name, device


def _load_db(chroma_path: str) -> Chroma:
    model_name, device = _get_embedding_model()
    embeddings = HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs={"device": device},
    )
    return Chroma(persist_directory=chroma_path, embedding_function=embeddings)


def _enhance_query(query: str, enable: bool) -> Tuple[str, List[str]]:
    """
    Query enhancement stub.
    
    Domain-specific query enhancement should be implemented via modules.
    This function is kept for API compatibility but does nothing by default.
    """
    # Query enhancement is now handled by modules
    # This stub returns the query unchanged for backwards compatibility
    return query, []


def _exclude_image_docs(results: List[Any], exclude_types: bool) -> List[Any]:
    if not exclude_types:
        return results
    filtered = []
    for doc in results:
        try:
            doc_type = (doc.metadata or {}).get("type")
            if doc_type in DEFAULT_EXCLUDED_TYPES:
                continue
        except Exception:
            pass
        filtered.append(doc)
    return filtered


def _apply_post_filter(
    query: str,
    docs: List[Any],
    k: int,
    enable_filtering: bool,
    target_docs: int,
) -> Tuple[List[Any], Dict[str, Any]]:
    if not enable_filtering:
        return docs[:k], {"post_processing_applied": False}

    post = SimplePostProcessor(min_relevance_score=float(os.getenv("TEXT_MIN_RELEVANCE_SCORE", "0.3")))
    context_parts = [d.page_content for d in docs]
    filtered_parts, avg_score = post.filter_documents(query=query, documents=context_parts, target_count=target_docs)

    if not filtered_parts:
        # Fall back to original top-k if filtering removes everything
        return docs[:k], {
            "post_processing_applied": True,
            "initial_doc_count": len(docs),
            "filtered_doc_count": min(k, len(docs)),
            "avg_relevance_score": avg_score,
            "fallback_used": True,
        }

    # Re-map filtered text back to Document objects, preserving order
    out_docs: List[Any] = []
    for content in filtered_parts:
        for d in docs:
            if d.page_content == content:
                out_docs.append(d)
                break

    return out_docs[:k], {
        "post_processing_applied": True,
        "initial_doc_count": len(docs),
        "filtered_doc_count": len(out_docs[:k]),
        "avg_relevance_score": avg_score,
        "fallback_used": False,
    }


def run_query(
    chroma_path: str,
    query: str,
    k: int,
    enable_filtering: bool,
    target_docs: int,
    enable_game_piece_enhancement: bool,
    exclude_image_types: bool,
    where: Optional[Dict[str, Any]] = None,
    retrieval_method: str = "vector",
    bm25_variant: str = "bm25",
) -> Dict[str, Any]:
    if not os.path.exists(chroma_path):
        return {"error": f"Chroma DB path not found: {chroma_path}"}

    db = _load_db(chroma_path)

    enhanced_query, matched_pieces = _enhance_query(query, enable_game_piece_enhancement)

    initial_k = k * 2 if enable_filtering else k
    try:
        if retrieval_method == "vector":
            results = db.similarity_search(enhanced_query, k=initial_k, filter=where)
        else:
            results = []
    except Exception as e:
        return {"error": f"Search failed: {e}"}

    # Lexical retrieval (BM25/TF) uses Chroma.get to fetch candidate corpus, then ranks in Python.
    if retrieval_method in {"bm25", "tf", "hybrid"}:
        try:
            got = db.get(where=where, include=["documents", "metadatas"])
            corpus_docs = got.get("documents", []) or []
            corpus_metas = got.get("metadatas", []) or []
        except Exception as e:
            return {"error": f"Corpus fetch failed for lexical retrieval: {e}"}

        def tokenize(s: str) -> List[str]:
            return re.findall(r"\b\w+\b", (s or "").lower())

        tokenized_corpus = [tokenize(d) for d in corpus_docs]
        q_tokens = tokenize(enhanced_query)

        scores: List[float] = []
        if retrieval_method == "tf" or bm25_variant == "tf":
            q_set = set(q_tokens)
            for toks in tokenized_corpus:
                freq = 0
                for t in toks:
                    if t in q_set:
                        freq += 1
                scores.append(float(freq))
        else:
            if BM25Okapi is None:
                return {"error": "rank_bm25 not installed; install python/requirements-text.txt"}
            bm25 = BM25Okapi(tokenized_corpus)
            scores = [float(s) for s in bm25.get_scores(q_tokens)]
            if bm25_variant == "bm25_no_idf":
                # Approximate “no idf” by multiplying by a constant idf (i.e., treat terms equally)
                # Implemented as raw term frequency as a close proxy.
                q_set = set(q_tokens)
                scores = []
                for toks in tokenized_corpus:
                    freq = 0
                    for t in toks:
                        if t in q_set:
                            freq += 1
                    scores.append(float(freq))

        # Vector scores for hybrid: use initial vector retrieval ranks as weak signal
        vector_rank_score: Dict[int, float] = {}
        if retrieval_method == "hybrid":
            try:
                vres = db.similarity_search(enhanced_query, k=min(max(initial_k, 25), 200), filter=where)
                vres = _exclude_image_docs(vres, exclude_image_types)
                for r_idx, d in enumerate(vres):
                    # Use content match to locate index in corpus (best-effort)
                    try:
                        i = corpus_docs.index(d.page_content)
                        vector_rank_score[i] = 1.0 / float(r_idx + 1)
                    except ValueError:
                        continue
            except Exception:
                pass

        # Normalize and combine
        if retrieval_method == "hybrid":
            max_b = max(scores) if scores else 1.0
            min_b = min(scores) if scores else 0.0
            denom = (max_b - min_b) if (max_b - min_b) != 0 else 1.0
            hybrid_scores = []
            for i, s in enumerate(scores):
                b = (s - min_b) / denom
                v = vector_rank_score.get(i, 0.0)
                hybrid_scores.append(0.7 * b + 0.3 * v)
            scores = hybrid_scores

        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        # Build “results” as lightweight objects matching langchain Documents shape
        class _DocObj:
            def __init__(self, content: str, meta: Dict[str, Any]):
                self.page_content = content
                self.metadata = meta

        results = []
        for idx in ranked[:initial_k]:
            results.append(_DocObj(corpus_docs[idx], corpus_metas[idx] if idx < len(corpus_metas) else {}))

    results = _exclude_image_docs(results, exclude_image_types)

    final_docs, post_meta = _apply_post_filter(
        query=query,
        docs=results,
        k=k,
        enable_filtering=enable_filtering,
        target_docs=target_docs,
    )

    documents_out = []
    context_parts = []
    for i, d in enumerate(final_docs):
        context_parts.append(d.page_content)
        documents_out.append(
            {
                "page_content": d.page_content,
                "metadata": d.metadata,
                "rank": i,
            }
        )

    return {
        "query": query,
        "original_query": query,
        "enhanced_query": enhanced_query,
        "matched_pieces": matched_pieces,
        "where": where or {},
        "retrieval_method": retrieval_method,
        "bm25_variant": bm25_variant,
        "context_parts": context_parts,
        "documents": documents_out,
        "related_images": [],
        "context_sources": len(context_parts),
        "post_processing_applied": bool(post_meta.get("post_processing_applied")),
        **post_meta,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chroma-path", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--enable-filtering", action="store_true")
    parser.add_argument("--target-docs", type=int, default=8)
    parser.add_argument("--enable-game-piece-enhancement", action="store_true")
    parser.add_argument("--disable-game-piece-enhancement", action="store_true")
    parser.add_argument("--include-image-types", action="store_true")
    parser.add_argument("--where-json", default="")
    parser.add_argument("--retrieval-method", choices=["vector", "bm25", "tf", "hybrid"], default="vector")
    parser.add_argument("--bm25-variant", choices=["bm25", "bm25_no_idf", "tf"], default="bm25")
    args = parser.parse_args()

    # Game piece enhancement is deprecated in favor of modules.
    # Always disabled in core; domain-specific modules handle enhancement.
    enable_gpe = False

    where = None
    if args.where_json:
        try:
            where = json.loads(args.where_json)
            if not isinstance(where, dict):
                where = None
        except Exception:
            where = None

    result = run_query(
        chroma_path=args.chroma_path,
        query=args.query,
        k=args.k,
        enable_filtering=args.enable_filtering,
        target_docs=args.target_docs,
        enable_game_piece_enhancement=enable_gpe,
        exclude_image_types=not args.include_image_types,
        where=where,
        retrieval_method=args.retrieval_method,
        bm25_variant=args.bm25_variant,
    )

    print(json.dumps(result, default=str))

    if "error" in result:
        sys.exit(2)


if __name__ == "__main__":
    main()


