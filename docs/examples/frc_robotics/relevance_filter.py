"""
FRC Relevance Filter

A document filter that scores and filters documents based on FRC-specific
keywords and terminology.

This helps improve precision by boosting documents that contain relevant
FRC technical terms and demoting generic or off-topic documents.
"""

import re
from typing import Any, Dict, List, Tuple

import sys
sys.path.insert(0, '.')

from rag_bench.modules.base import RelevanceFilter, ModuleConfig


class FRCRelevanceFilter(RelevanceFilter):
    """
    Filters and reranks documents based on FRC-specific keywords.
    
    Documents containing high-value FRC terms (motor, drivetrain, swerve)
    are boosted, while documents missing relevant terms are demoted.
    
    Configuration:
        - min_relevance_score: Minimum score to keep document (0-1)
        - high_value_weight: Weight multiplier for high-value keywords
        - medium_value_weight: Weight multiplier for medium-value keywords
    """
    
    MODULE_ID = "frc-relevance-filter"
    MODULE_NAME = "FRC Relevance Filter"
    MODULE_DESCRIPTION = "Filters documents using FRC-specific keyword scoring"
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "RAG-Lab / FRC Community"
    MODULE_TAGS = ["frc", "robotics", "filter", "relevance", "rerank"]
    ENABLED_BY_DEFAULT = False
    
    # High-value FRC keywords (weighted more heavily)
    HIGH_VALUE_KEYWORDS = [
        "motor", "gear", "ratio", "wheel", "sensor", "encoder", "gyro",
        "autonomous", "teleop", "programming", "pid", "control", "feedback",
        "intake", "shooter", "drivetrain", "elevator", "arm", "chassis",
        "swerve", "tank", "camera", "vision", "apriltag", "pathfinding",
        "neo", "falcon", "kraken", "cim", "redline",
    ]
    
    # Medium-value keywords
    MEDIUM_VALUE_KEYWORDS = [
        "design", "build", "material", "aluminum", "weight", "strength",
        "power", "battery", "pneumatic", "mechanical", "electrical",
        "cad", "onshape", "solidworks", "fabrication", "manufacturing",
        "strategy", "match", "competition", "alliance", "scoring",
    ]
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return [
            ModuleConfig(
                key="min_relevance_score",
                type="number",
                label="Minimum Relevance Score",
                description="Documents below this score are filtered out (0-1)",
                default=0.1,
                min=0.0,
                max=1.0,
                required=False,
            ),
            ModuleConfig(
                key="high_value_weight",
                type="number",
                label="High-Value Keyword Weight",
                description="Score multiplier for high-value keywords",
                default=3.0,
                min=1.0,
                max=10.0,
                required=False,
            ),
            ModuleConfig(
                key="medium_value_weight",
                type="number",
                label="Medium-Value Keyword Weight",
                description="Score multiplier for medium-value keywords",
                default=2.0,
                min=1.0,
                max=10.0,
                required=False,
            ),
            ModuleConfig(
                key="rerank_only",
                type="boolean",
                label="Rerank Only (No Filtering)",
                description="Only rerank documents, don't filter any out",
                default=False,
                required=False,
            ),
        ]
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        
        self.min_score = config.get("min_relevance_score", 0.1)
        self.high_weight = config.get("high_value_weight", 3.0)
        self.medium_weight = config.get("medium_value_weight", 2.0)
        self.rerank_only = config.get("rerank_only", False)
    
    def _calculate_relevance_score(self, query: str, document: str) -> float:
        """
        Calculate a relevance score for a document.
        
        Args:
            query: The search query
            document: Document content
        
        Returns:
            Relevance score between 0 and 1
        """
        query_lower = query.lower()
        doc_lower = document.lower()
        
        # Word overlap score
        query_words = set(re.findall(r"\b\w+\b", query_lower))
        doc_words = set(re.findall(r"\b\w+\b", doc_lower))
        overlap = len(query_words.intersection(doc_words))
        keyword_score = overlap / len(query_words) if query_words else 0.0
        
        # FRC keyword score
        high_matches = sum(1 for kw in self.HIGH_VALUE_KEYWORDS if kw in doc_lower)
        medium_matches = sum(1 for kw in self.MEDIUM_VALUE_KEYWORDS if kw in doc_lower)
        frc_score = (high_matches * self.high_weight + medium_matches * self.medium_weight) / 100.0
        
        # Document length penalty
        doc_length = len(document.split())
        length_penalty = 1.0
        if doc_length < 50:
            length_penalty = 0.7
        elif doc_length > 1000:
            length_penalty = 0.8
        
        # Combined score
        relevance_score = (keyword_score * 0.5 + frc_score * 0.5) * length_penalty
        return min(relevance_score, 1.0)
    
    def filter(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Filter and rerank documents based on FRC relevance.
        
        Args:
            query: The search query
            documents: Retrieved documents
            context: Processing context
        
        Returns:
            Tuple of (filtered_documents, updated_context)
        """
        if not documents:
            return documents, context
        
        # Score all documents
        scored_docs = []
        for doc in documents:
            content = doc.get("content", "")
            score = self._calculate_relevance_score(query, content)
            scored_docs.append((doc, score))
        
        # Filter by minimum score (unless rerank_only)
        if not self.rerank_only:
            scored_docs = [(doc, score) for doc, score in scored_docs if score >= self.min_score]
        
        # Sort by score (descending)
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        # Update ranks
        result_docs = []
        for rank, (doc, score) in enumerate(scored_docs):
            updated_doc = {**doc, "rank": rank, "frc_relevance_score": score}
            result_docs.append(updated_doc)
        
        # Calculate stats
        scores = [s for _, s in scored_docs]
        avg_score = sum(scores) / len(scores) if scores else 0.0
        
        # Update context
        updated_context = {
            **context,
            "frc_relevance_filter": {
                "docs_before": len(documents),
                "docs_after": len(result_docs),
                "avg_relevance_score": avg_score,
                "min_score_threshold": self.min_score,
            },
        }
        
        # Track filters applied
        filters_applied = context.get("filters_applied", [])
        filters_applied.append(self.MODULE_ID)
        updated_context["filters_applied"] = filters_applied
        
        return result_docs, updated_context
