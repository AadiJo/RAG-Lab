"""
FRC Game Piece Mapper (text-only mirror)

Copied/adapted from the external `frc-rag` backend to keep `rag-eval-bench`
independent while preserving query-enhancement behavior for text retrieval.
"""

import re
from typing import Dict, List, Tuple, Any


class GamePieceMapper:
    def __init__(self) -> None:
        # Game piece definitions with rich descriptors
        self.game_pieces: Dict[str, Dict[str, Any]] = {
            # 2025 - Reefscape
            "algae": {
                "season": "2025",
                "game": "Reefscape",
                "generic_names": ["ball", "sphere", "round object", "green ball", "orb"],
                "official_name": "Algae",
                "description": "Green spherical ball game piece from the 2025 Reefscape season",
                "physical_properties": {
                    "shape": "sphere",
                    "color": "green",
                    "material": "rubber/foam",
                    "diameter": "7 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": ["coral stations", "ground", "algae dispensers"],
                "scoring_locations": ["net", "basket", "reef"],
                "handling_methods": ["intake", "grabber", "shooter"],
                "synonyms": ["algae ball", "green sphere", "reefscape ball"],
            },
            "coral": {
                "season": "2025",
                "game": "Reefscape",
                "generic_names": ["block", "cube", "rectangular object", "orange block"],
                "official_name": "Coral",
                "description": "Orange rectangular coral piece from the 2025 Reefscape season",
                "physical_properties": {
                    "shape": "rectangular block",
                    "color": "orange",
                    "material": "foam/plastic",
                    "dimensions": "approximately 6x4x4 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": ["coral stations", "ground", "staging areas"],
                "scoring_locations": ["reef structure", "processors"],
                "handling_methods": ["intake", "claw", "gripper"],
                "synonyms": ["coral block", "orange cube", "reefscape coral"],
            },
            # 2024 - Crescendo
            "note": {
                "season": "2024",
                "game": "Crescendo",
                "generic_names": ["ring", "donut", "circular object", "orange ring", "disc"],
                "official_name": "Note",
                "description": "Orange foam ring from the 2024 Crescendo season",
                "physical_properties": {
                    "shape": "ring/torus",
                    "color": "orange",
                    "material": "foam",
                    "outer_diameter": "14 inches",
                    "inner_diameter": "4 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": ["centerline", "wing", "source", "ground"],
                "scoring_locations": ["speaker", "amp", "trap"],
                "handling_methods": ["intake", "shooter", "launcher"],
                "synonyms": ["crescendo note", "orange ring", "foam ring", "music note"],
            },
            # 2023 - Charged Up
            "cone": {
                "season": "2023",
                "game": "Charged Up",
                "generic_names": ["cone", "yellow cone", "triangular object", "traffic cone"],
                "official_name": "Cone",
                "description": "Yellow traffic cone-shaped game piece from the 2023 Charged Up season",
                "physical_properties": {
                    "shape": "cone",
                    "color": "yellow",
                    "material": "plastic/rubber",
                    "height": "approximately 12 inches",
                    "base_diameter": "6 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": [
                    "loading zone",
                    "ground",
                    "single substation",
                    "double substation",
                ],
                "scoring_locations": ["grid", "high node", "mid node", "low node"],
                "handling_methods": ["claw", "gripper", "intake"],
                "synonyms": ["traffic cone", "yellow cone", "charged up cone"],
            },
            "cube": {
                "season": "2023",
                "game": "Charged Up",
                "generic_names": ["cube", "purple cube", "block", "square object", "box"],
                "official_name": "Cube",
                "description": "Purple cube-shaped game piece from the 2023 Charged Up season",
                "physical_properties": {
                    "shape": "cube",
                    "color": "purple",
                    "material": "foam/plastic",
                    "dimensions": "approximately 9.5x9.5x9.5 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": [
                    "loading zone",
                    "ground",
                    "single substation",
                    "double substation",
                ],
                "scoring_locations": ["grid", "high node", "mid node", "low node"],
                "handling_methods": ["intake", "claw", "gripper"],
                "synonyms": ["purple cube", "foam cube", "charged up cube"],
            },
            # 2022 - Rapid React
            "cargo": {
                "season": "2022",
                "game": "Rapid React",
                "generic_names": ["ball", "sphere", "round object", "red ball", "blue ball"],
                "official_name": "Cargo",
                "description": "Red and blue foam balls from the 2022 Rapid React season",
                "physical_properties": {
                    "shape": "sphere",
                    "color": "red or blue (alliance specific)",
                    "material": "foam",
                    "diameter": "9.5 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": ["terminal", "ground", "hangar"],
                "scoring_locations": ["upper hub", "lower hub"],
                "handling_methods": ["intake", "shooter", "conveyor"],
                "synonyms": [
                    "cargo ball",
                    "foam ball",
                    "rapid react ball",
                    "red cargo",
                    "blue cargo",
                ],
            },
            # 2020/2021 - Infinite Recharge
            "power_cell": {
                "season": "2020/2021",
                "game": "Infinite Recharge",
                "generic_names": ["ball", "sphere", "round object", "yellow ball", "fuel"],
                "official_name": "Power Cell",
                "description": "Yellow foam balls from the 2020/2021 Infinite Recharge season",
                "physical_properties": {
                    "shape": "sphere",
                    "color": "yellow",
                    "material": "foam",
                    "diameter": "7 inches",
                    "weight": "lightweight",
                },
                "pickup_locations": ["loading bay", "ground", "trench"],
                "scoring_locations": ["power port", "upper goal", "lower goal"],
                "handling_methods": ["intake", "shooter", "conveyor"],
                "synonyms": [
                    "power cell ball",
                    "yellow ball",
                    "infinite recharge ball",
                    "fuel cell",
                ],
            },
        }

        self._build_lookup_maps()

    def _build_lookup_maps(self) -> None:
        """Build reverse lookup maps for efficient searching."""
        self.generic_to_specific: Dict[str, List[str]] = {}
        self.synonym_to_specific: Dict[str, str] = {}

        for piece_id, piece_data in self.game_pieces.items():
            for generic_name in piece_data["generic_names"]:
                self.generic_to_specific.setdefault(generic_name, []).append(piece_id)

            for synonym in piece_data["synonyms"]:
                self.synonym_to_specific[synonym.lower()] = piece_id

    def enhance_query(self, query: str) -> Tuple[str, List[str]]:
        """
        Enhance a user query by mapping generic terms to specific game pieces.
        Returns: (enhanced_query, matched_piece_ids)
        """
        enhanced_query = query.lower()
        matched_pieces: List[str] = []

        # Direct synonym matches
        for synonym, piece_id in self.synonym_to_specific.items():
            if synonym in enhanced_query:
                matched_pieces.append(piece_id)

        # Generic term matches
        for generic_term, piece_ids in self.generic_to_specific.items():
            pattern = r"\b" + re.escape(generic_term) + r"\b"
            if re.search(pattern, enhanced_query, re.IGNORECASE):
                matched_pieces.extend(piece_ids)
                for pid in piece_ids:
                    piece_data = self.game_pieces[pid]
                    enhanced_query += f" {piece_data['official_name']} {piece_data['season']}"

        matched_pieces = list(dict.fromkeys(matched_pieces))
        return enhanced_query, matched_pieces



