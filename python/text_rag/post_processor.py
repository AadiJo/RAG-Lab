"""
Simple post-processing filter for text retrieval.

A lightweight, domain-agnostic relevance filter based on query-document
term overlap. For domain-specific relevance scoring, create a custom
RelevanceFilter module.
"""

import re
from typing import List, Tuple

import numpy as np


class SimplePostProcessor:
    """
    Lightweight post-processing filter for improving retrieval precision.
    
    Uses query-document term overlap for relevance scoring.
    Domain-specific keyword boosting can be added via modules.
    """

    def __init__(self, min_relevance_score: float = 0.3):
        self.min_relevance_score = min_relevance_score

    def calculate_relevance_score(self, query: str, document: str) -> float:
        """
        Calculate relevance score between query and document.
        
        Uses term overlap between query and document, with a length penalty
        for very short or very long documents.
        """
        query_lower = query.lower()
        doc_lower = document.lower()

        query_words = set(re.findall(r"\b\w+\b", query_lower))
        doc_words = set(re.findall(r"\b\w+\b", doc_lower))

        if not query_words:
            return 0.0

        overlap = len(query_words.intersection(doc_words))
        keyword_score = overlap / len(query_words)

        # Length penalty: prefer medium-length documents
        doc_length = len(document.split())
        length_penalty = 1.0
        if doc_length < 50:
            length_penalty = 0.7
        elif doc_length > 1000:
            length_penalty = 0.8

        relevance_score = keyword_score * length_penalty
        return float(min(relevance_score, 1.0))

    def filter_documents(self, query: str, documents: List[str], target_count: int = 10) -> Tuple[List[str], float]:
        """
        Filter documents based on relevance score.

        Returns (filtered_docs, avg_score_for_docs_passing_threshold).
        """
        if not documents:
            return [], 0.0

        scored_docs = []
        for doc in documents:
            score = self.calculate_relevance_score(query, doc)
            if score >= self.min_relevance_score:
                scored_docs.append((doc, score))

        scored_docs.sort(key=lambda x: x[1], reverse=True)
        filtered_docs = [doc for doc, _ in scored_docs[:target_count]]

        avg_score = float(np.mean([s for _, s in scored_docs])) if scored_docs else 0.0
        return filtered_docs, avg_score



