"""
FRC Game Piece Mapper

A query preprocessor that maps generic terms (like "ball", "cube") to
FRC-specific game piece names based on season.

This helps improve retrieval quality when users use common terms instead
of the official game piece names.

Example:
    Query: "How do I pick up the ball?"
    Enhanced: "How do I pick up the ball Algae 2025 Note 2024 Cargo 2022"
    
    The enhanced query now includes terms that will match documents from
    multiple seasons.
"""

import re
from typing import Any, Dict, List, Tuple

import sys
sys.path.insert(0, '.')

from rag_bench.modules.base import QueryPreprocessor, ModuleConfig


class GamePieceMapperPreprocessor(QueryPreprocessor):
    """
    Maps generic game piece terms to FRC-specific terminology.
    
    This preprocessor maintains a database of FRC game pieces by season
    and enhances queries by adding relevant game piece names when generic
    terms are detected.
    
    Configuration:
        - seasons: Comma-separated list of seasons to include (default: all)
        - include_physical_properties: Add physical descriptions (default: false)
    """
    
    MODULE_ID = "frc-game-piece-mapper"
    MODULE_NAME = "FRC Game Piece Mapper"
    MODULE_DESCRIPTION = "Expands queries with FRC game piece terminology by season"
    MODULE_VERSION = "1.0.0"
    MODULE_AUTHOR = "RAG-Lab / FRC Community"
    MODULE_TAGS = ["frc", "robotics", "game-piece", "query-expansion"]
    ENABLED_BY_DEFAULT = False  # Domain-specific, so off by default
    
    # Complete FRC game piece database
    GAME_PIECES: Dict[str, Dict[str, Any]] = {
        # 2025 - Reefscape
        "algae": {
            "season": "2025",
            "game": "Reefscape",
            "generic_names": ["ball", "sphere", "round object", "green ball", "orb"],
            "official_name": "Algae",
            "description": "Green spherical ball game piece",
            "synonyms": ["algae ball", "green sphere", "reefscape ball"],
        },
        "coral": {
            "season": "2025",
            "game": "Reefscape",
            "generic_names": ["block", "cube", "rectangular object", "orange block"],
            "official_name": "Coral",
            "description": "Orange rectangular coral piece",
            "synonyms": ["coral block", "orange cube", "reefscape coral"],
        },
        # 2024 - Crescendo
        "note": {
            "season": "2024",
            "game": "Crescendo",
            "generic_names": ["ring", "donut", "circular object", "orange ring", "disc"],
            "official_name": "Note",
            "description": "Orange foam ring",
            "synonyms": ["crescendo note", "orange ring", "foam ring", "music note"],
        },
        # 2023 - Charged Up
        "cone": {
            "season": "2023",
            "game": "Charged Up",
            "generic_names": ["cone", "yellow cone", "triangular object", "traffic cone"],
            "official_name": "Cone",
            "description": "Yellow traffic cone-shaped game piece",
            "synonyms": ["traffic cone", "yellow cone", "charged up cone"],
        },
        "cube": {
            "season": "2023",
            "game": "Charged Up",
            "generic_names": ["cube", "purple cube", "block", "square object", "box"],
            "official_name": "Cube",
            "description": "Purple cube-shaped game piece",
            "synonyms": ["purple cube", "foam cube", "charged up cube"],
        },
        # 2022 - Rapid React
        "cargo": {
            "season": "2022",
            "game": "Rapid React",
            "generic_names": ["ball", "sphere", "round object", "red ball", "blue ball"],
            "official_name": "Cargo",
            "description": "Red and blue foam balls",
            "synonyms": ["cargo ball", "foam ball", "rapid react ball"],
        },
        # 2020/2021 - Infinite Recharge
        "power_cell": {
            "season": "2020/2021",
            "game": "Infinite Recharge",
            "generic_names": ["ball", "sphere", "round object", "yellow ball", "fuel"],
            "official_name": "Power Cell",
            "description": "Yellow foam balls",
            "synonyms": ["power cell ball", "yellow ball", "infinite recharge ball"],
        },
    }
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        return [
            ModuleConfig(
                key="seasons",
                type="string",
                label="Seasons to Include",
                description="Comma-separated list of seasons (e.g., '2024,2025'). Leave empty for all.",
                default="",
                required=False,
            ),
            ModuleConfig(
                key="include_physical_properties",
                type="boolean",
                label="Include Physical Descriptions",
                description="Add physical property descriptions to expanded queries",
                default=False,
                required=False,
            ),
        ]
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        
        # Parse seasons filter
        seasons_str = config.get("seasons", "")
        if seasons_str:
            self.allowed_seasons = set(s.strip() for s in seasons_str.split(","))
        else:
            self.allowed_seasons = None  # All seasons
        
        self.include_descriptions = config.get("include_physical_properties", False)
        
        # Build lookup maps
        self.generic_to_pieces: Dict[str, List[str]] = {}
        self.synonym_to_piece: Dict[str, str] = {}
        
        for piece_id, piece_data in self.GAME_PIECES.items():
            # Skip if season filtered out
            if self.allowed_seasons and piece_data["season"] not in self.allowed_seasons:
                continue
            
            for generic_name in piece_data["generic_names"]:
                self.generic_to_pieces.setdefault(generic_name.lower(), []).append(piece_id)
            
            for synonym in piece_data.get("synonyms", []):
                self.synonym_to_piece[synonym.lower()] = piece_id
    
    def process(self, query: str, context: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Enhance query with game piece terminology.
        
        Args:
            query: The input query
            context: Processing context
        
        Returns:
            Tuple of (enhanced_query, updated_context)
        """
        query_lower = query.lower()
        matched_pieces: List[str] = []
        expansions: List[str] = []
        
        # Check for synonym matches
        for synonym, piece_id in self.synonym_to_piece.items():
            if synonym in query_lower:
                if piece_id not in matched_pieces:
                    matched_pieces.append(piece_id)
        
        # Check for generic term matches
        for generic_term, piece_ids in self.generic_to_pieces.items():
            pattern = r"\b" + re.escape(generic_term) + r"\b"
            if re.search(pattern, query_lower, re.IGNORECASE):
                for pid in piece_ids:
                    if pid not in matched_pieces:
                        matched_pieces.append(pid)
                        piece_data = self.GAME_PIECES[pid]
                        expansion = f"{piece_data['official_name']} {piece_data['season']}"
                        if self.include_descriptions:
                            expansion += f" {piece_data['description']}"
                        expansions.append(expansion)
        
        # Build enhanced query
        if expansions:
            enhanced_query = query + " " + " ".join(expansions)
        else:
            enhanced_query = query
        
        # Update context
        updated_context = {
            **context,
            "game_piece_mapper": {
                "matched_pieces": matched_pieces,
                "expansions": expansions,
                "original_query": query,
            },
        }
        
        # Track preprocessing applied
        preprocessing_applied = context.get("preprocessing_applied", [])
        preprocessing_applied.append(self.MODULE_ID)
        updated_context["preprocessing_applied"] = preprocessing_applied
        
        return enhanced_query, updated_context
