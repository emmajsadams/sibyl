# SIBYL SFT — Fine-Tuning Pipeline

Convert SIBYL game data into training examples and fine-tune a small model to play tactics.

## Quick Start

```bash
cd sft

# 1. Install JS deps (for converter)
npm install

# 2. Install Python deps (for training)
pip install mlx mlx-lm

# 3. Convert training data → SFT format
npm run convert

# 4. Check dataset stats
npm run stats

# 5. Train (LoRA on Qwen 1.5B, ~10 min on Mac mini)
npm run train

# 6. Test inference
python3 infer.py --adapter adapters/ --compare
```

## Commands

### `npm run convert` — Convert training data

Reads `../training/training-*.json` and produces `data/sft-train.jsonl`.

```bash
# Winners only (default)
npx tsx src/convert.ts

# Both sides
npx tsx src/convert.ts --all-sides

# Only v0.5.3+ games
npx tsx src/convert.ts --min-version 0.5.3

# Custom paths
npx tsx src/convert.ts --training-dir /path/to/training --output data/custom.jsonl
```

### `npm run stats` — Dataset statistics

Shows class distribution, round distribution, token estimates.

### `npm run train` — LoRA fine-tuning

```bash
# Defaults: Qwen 1.5B, 5 epochs, LoRA rank 8
python3 train.py

# Larger model
python3 train.py --model mlx-community/Llama-3.2-3B-Instruct-4bit

# Tune hyperparams
python3 train.py --epochs 10 --lr 2e-5 --lora-rank 16
```

### `python3 infer.py` — Test inference

```bash
# Random example, fine-tuned model
python3 infer.py --adapter adapters/

# Compare base vs fine-tuned
python3 infer.py --adapter adapters/ --compare

# Interactive mode
python3 infer.py --adapter adapters/ --interactive
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
    {"role": "user", "content": "=== ROUND 3 ===\nYour prompt: \"Cloak and breach...\"\n\nYou: Wraith (specter) at (2,3)..."},
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

With ~300 winning-side examples (current dataset):
- The model will learn the output format (JSON with thinking/actions)
- It will pick up basic patterns (cloak turn 1, heal wounded allies)
- It won't play well — too few examples for real tactical reasoning
- **That's fine** — the goal is learning the pipeline

To improve: run more games with `npx tsx src/main.ts --auto` in the main project, then re-convert and retrain.

## File Structure

```
sft/
├── src/
│   ├── convert.ts    # Training data → SFT JSONL
│   └── stats.ts      # Dataset statistics
├── train.py          # MLX LoRA fine-tuning
├── infer.py          # Test inference + compare
├── data/             # Generated training data (gitignored)
├── adapters/         # LoRA adapters (gitignored)
├── package.json
└── README.md
```
