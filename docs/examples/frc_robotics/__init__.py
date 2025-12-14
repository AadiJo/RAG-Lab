"""
FRC Robotics Module - Example

This is an example module demonstrating how to create domain-specific
enhancements for RAG Bench.

Copy this folder to the modules/ directory to use it:
    cp -r docs/examples/frc_robotics modules/

Components:
    - GamePieceMapperPreprocessor: Expands queries with FRC game piece terminology
    - FRCRelevanceFilter: Filters documents using FRC-specific keywords

See README.md for detailed documentation.
"""

from .game_piece_mapper import GamePieceMapperPreprocessor
from .relevance_filter import FRCRelevanceFilter


def register(registry):
    """
    Register this module's components with the RAG Bench registry.
    
    This function is called automatically during module discovery.
    """
    registry.register(GamePieceMapperPreprocessor)
    registry.register(FRCRelevanceFilter)


__all__ = [
    "GamePieceMapperPreprocessor",
    "FRCRelevanceFilter",
    "register",
]
