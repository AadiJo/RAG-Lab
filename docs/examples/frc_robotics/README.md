# FRC Robotics Module

This module provides FIRST Robotics Competition (FRC) specific enhancements for RAG queries.

## Components

### 1. Game Piece Mapper (Preprocessor)

**ID:** `frc-game-piece-mapper`

Expands queries with FRC game piece terminology. When users ask about generic terms like "the ball" or "the cube", this maps them to specific game piece names for each season.

**Example:**
- Input: "How do I pick up the ball?"
- Enhanced: "How do I pick up the ball Algae 2025 Note 2024 Cargo 2022"

**Configuration:**
| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `seasons` | string | Comma-separated seasons to include | All |
| `include_physical_properties` | boolean | Add physical descriptions | false |

**Supported Game Pieces:**
- **2025 (Reefscape):** Algae, Coral
- **2024 (Crescendo):** Note
- **2023 (Charged Up):** Cone, Cube
- **2022 (Rapid React):** Cargo
- **2020/2021 (Infinite Recharge):** Power Cell

### 2. FRC Relevance Filter

**ID:** `frc-relevance-filter`

Filters and reranks documents based on FRC-specific keywords. Documents containing terms like "motor", "drivetrain", "swerve" are boosted.

**Configuration:**
| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `min_relevance_score` | number | Minimum score to keep (0-1) | 0.1 |
| `high_value_weight` | number | Weight for high-value keywords | 3.0 |
| `medium_value_weight` | number | Weight for medium-value keywords | 2.0 |
| `rerank_only` | boolean | Only rerank, don't filter | false |

**High-Value Keywords:**
motor, gear, ratio, wheel, sensor, encoder, gyro, autonomous, teleop, programming, pid, control, feedback, intake, shooter, drivetrain, elevator, arm, chassis, swerve, tank, camera, vision, apriltag, pathfinding, neo, falcon, kraken, cim, redline

**Medium-Value Keywords:**
design, build, material, aluminum, weight, strength, power, battery, pneumatic, mechanical, electrical, cad, onshape, solidworks, fabrication, manufacturing, strategy, match, competition, alliance, scoring

## Installation

This module is provided as an example. To use it:

1. Copy the `frc_robotics` folder to `<project_root>/modules/`
2. Restart the RAG-Lab server
3. Enable the modules from the frontend

## Customization

Use this module as a template for creating your own domain-specific modules. Key files:

- `__init__.py` - Module registration
- `game_piece_mapper.py` - Query preprocessor example
- `relevance_filter.py` - Document filter example

## License

MIT - Part of RAG-Lab
