"""
Simple post-processing filter for text retrieval.

This mirrors the intent of `frc-rag`'s lightweight relevance filter but is kept
standalone so `rag-eval-bench` can evolve independently.
"""

import re
from typing import List, Tuple

import numpy as np


class SimplePostProcessor:
    """
    Lightweight post-processing filter for improving retrieval precision.
    """

    def __init__(self, min_relevance_score: float = 0.3):
        self.min_relevance_score = min_relevance_score

        # FRC-specific keywords for relevance scoring (kept to match existing domain behavior)
        self.high_value_keywords = [
            "motor",
            "gear",
            "ratio",
            "wheel",
            "sensor",
            "encoder",
            "gyro",
            "autonomous",
            "teleop",
            "programming",
            "pid",
            "control",
            "feedback",
            "intake",
            "shooter",
            "drivetrain",
            "elevator",
            "arm",
            "chassis",
            "swerve",
            "tank",
            "camera",
            "vision",
            "apriltag",
            "pathfinding",
        ]

        self.medium_value_keywords = [
            "design",
            "build",
            "material",
            "aluminum",
            "weight",
            "strength",
            "power",
            "battery",
            "pneumatic",
            "mechanical",
            "electrical",
        ]

    def calculate_relevance_score(self, query: str, document: str) -> float:
        """Calculate relevance score between query and document."""
        query_lower = query.lower()
        doc_lower = document.lower()

        query_words = set(re.findall(r"\b\w+\b", query_lower))
        doc_words = set(re.findall(r"\b\w+\b", doc_lower))

        overlap = len(query_words.intersection(doc_words))
        keyword_score = overlap / len(query_words) if query_words else 0.0

        high_value_matches = sum(1 for kw in self.high_value_keywords if kw in doc_lower)
        medium_value_matches = sum(1 for kw in self.medium_value_keywords if kw in doc_lower)
        frc_score = (high_value_matches * 3 + medium_value_matches * 2) / 100.0

        doc_length = len(document.split())
        length_penalty = 1.0
        if doc_length < 50:
            length_penalty = 0.7
        elif doc_length > 1000:
            length_penalty = 0.8

        relevance_score = (keyword_score * 0.5 + frc_score * 0.5) * length_penalty
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



