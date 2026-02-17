# SIBYL SFT — Fine-Tuning Pipeline

Convert SIBYL game data into training examples and fine-tune a small model to play tactics.

## Quick Start

```bash
# 1. Install Python deps
cd sft && uv sync && cd ..

# 2. Convert training data → SFT format
bun run sft:convert

# 3. Check dataset stats
bun run sft:stats

# 4. Train (LoRA on Qwen 1.5B, ~10 min on Mac mini)
bun run sft:train

# 5. Test inference — compare base vs fine-tuned
cd sft && uv run python3 infer.py --adapter adapters/ --compare
```

## Commands

All TypeScript commands run from the repo root via bun:

### `bun run sft:convert` — Convert training data

Reads `training/training-*.json` and produces `sft/data/sft-train.jsonl`.

```bash
# Winners only (default)
bun run sft/src/convert.ts

# Both sides
bun run sft/src/convert.ts --all-sides

# Only v0.5.3+ games
bun run sft/src/convert.ts --min-version 0.5.3
```

### `bun run sft:stats` — Dataset statistics

Shows class distribution, round distribution, token estimates.

### `bun run sft:train` — LoRA fine-tuning

```bash
# Defaults: Qwen 1.5B, 5 epochs, LoRA rank 8
cd sft && uv run python3 train.py

# Larger model
cd sft && uv run python3 train.py --model mlx-community/Llama-3.2-3B-Instruct-4bit

# Tune hyperparams
cd sft && uv run python3 train.py --epochs 10 --lr 2e-5 --lora-rank 16
```

### Inference

```bash
cd sft

# Random example, fine-tuned model
uv run python3 infer.py --adapter adapters/

# Compare base vs fine-tuned
uv run python3 infer.py --adapter adapters/ --compare

# Interactive mode
uv run python3 infer.py --adapter adapters/ --interactive
```

## How It Works

### Data Conversion

Each SIBYL game produces events. The converter:

1. Finds each `turn_start` → `agent_decision` pair
2. Serializes the board state into a text prompt (positions, HP, status effects)
3. Captures the agent's reasoning and actions as the target output
4. Filters to winning-side decisions only (by default)

Output format (chat-completion JSONL):
```json
{
  "messages": [
    {"role": "system", "content": "SIBYL tactical AI. You control Wraith, a specter..."},
    {"role": "user", "content": "=== ROUND 3 ===\nYour prompt: ..."},
    {"role": "assistant", "content": "{\"thinking\": \"...\", \"firstAction\": {...}, \"secondAction\": {...}}"}
  ]
}
```

### Training

Uses MLX LoRA — Apple Silicon native, fast, low memory. Fine-tunes attention layers while keeping the base model frozen.

Recommended models (all run on Mac mini M-series):
| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| Qwen2.5-1.5B-Instruct-4bit | ~1 GB | Fast | Good for learning |
| Llama-3.2-3B-Instruct-4bit | ~2 GB | Medium | Better reasoning |
| Qwen2.5-7B-Instruct-4bit | ~4 GB | Slow | Best quality |

### What to Expect

With ~140 winning-side examples (current dataset):
- The model will learn the output format (JSON with thinking/actions)
- It will pick up basic patterns (cloak turn 1, heal wounded allies)
- It won't play well — too few examples for real tactical reasoning
- **That's fine** — the goal is learning the pipeline

To improve: run more games with `bun run src/main.ts --auto` to build up the dataset, then re-convert and retrain.

## Python Tests

```bash
cd sft
uv run pytest           # run tests
uv run ruff check .     # lint
uv run ruff format .    # format
```

## File Structure

```
sft/
├── src/
│   ├── convert.ts    # Training data → SFT JSONL
│   └── stats.ts      # Dataset statistics
├── tests/            # Python tests (pytest)
├── train.py          # MLX LoRA fine-tuning
├── infer.py          # Test inference + compare
├── pyproject.toml    # Python deps (uv)
├── data/             # Generated training data (gitignored)
├── adapters/         # LoRA adapters (gitignored)
└── README.md
```
