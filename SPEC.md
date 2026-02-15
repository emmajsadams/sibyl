# SIBYL — Spec

## Concept
Turn-based grid tactics game where units are controlled by AI agents powered by player-written prompts. Instead of direct control, players craft instructions that define how their units think and act. The better your prompts, the smarter your squad.

## Core Loop
1. **Draft** — Write/edit prompts for your units before the round
2. **Execute** — All units (player + enemy) act simultaneously based on their prompts
3. **Observe** — Watch how agents interpreted your instructions
4. **Adapt** — Refine prompts for the next round

## Key Principles
- **Real AI** — Units are LLM-powered, not simulated. Prompts are actually interpreted.
- **Free-form prompts** — No template or structured input (at least initially). Write whatever you want.
- **Fog of war on prompts** — Enemy prompts are hidden by default. You only see their behavior and infer intent.
- **CLI-first** — Focus on core gameplay loop before any visual platform.

## Units & Abilities (Early Ideas)
- **Hacker** — Must get behind an enemy unit. Can read and *modify* their prompt. Tactical social engineering.
- **Scanner** — Can reveal enemy prompts at range. Intel-gathering role.
- More TBD.

## Grid & Movement
- Turn-based on a 2D grid
- Cover system (half/full)
- Line of sight
- Standard tactical staples — elevation, flanking bonuses, etc.

## AI Agent Design
- Each unit gets: system prompt (class/abilities/stats) + player prompt (orders) + game state (visible grid, nearby units, health, etc.)
- Agent returns: action for the turn (move, attack, ability, wait)
- Actions are validated against rules (can't walk through walls, range limits, etc.)

## Enemy AI
- Also prompt-driven — campaign levels have hand-crafted enemy prompts
- Difficulty = quality of enemy prompts
- Could potentially support PvP (prompt vs prompt)

## Open Questions
- Prompt scope: per-unit vs squad-level vs hybrid?
- How many actions per turn? One action, or action + move?
- Permadeath?
- Unit progression / prompt templates you unlock?
- Token/cost management for LLM calls
- How to handle prompt injection attacks (player trying to jailbreak enemy units via hacker ability — feature or bug?)

## Tech
- Language: TBD
- LLM: TBD (needs to be fast + cheap for many calls per turn)
- CLI interface for v0

## Status
- **Phase:** Concept / early spec
