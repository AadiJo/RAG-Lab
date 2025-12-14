"""
Game Piece Mapper Stub

This is a no-op stub for domain-agnostic text retrieval.
Domain-specific query enhancement should be implemented as modules
in the `modules/` directory.

See: docs/examples/ for example modules.
"""

from typing import List, Tuple


class GamePieceMapper:
    """
    No-op game piece mapper for domain-agnostic retrieval.
    
    This stub always returns the query unchanged. For domain-specific
    query enhancement, create a custom module extending QueryPreprocessor.
    """
    
    def __init__(self):
        pass
    
    def enhance_query(self, query: str) -> Tuple[str, List[str]]:
        """
        Returns the query unchanged with no matched pieces.
        
        Args:
            query: The input query string
        
        Returns:
            Tuple of (unchanged_query, empty_list_of_matched_pieces)
        """
        return query, []
