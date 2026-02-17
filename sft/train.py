#!/usr/bin/env python3
"""
SIBYL SFT Training — LoRA fine-tuning with MLX

Usage:
  python3 train.py [options]

Options:
  --model <name>     Base model (default: mlx-community/Qwen2.5-1.5B-Instruct-4bit)
  --data <path>      Training JSONL (default: data/sft-train.jsonl)
  --output <path>    Adapter output dir (default: adapters/)
  --epochs <n>       Training epochs (default: 5)
  --batch-size <n>   Batch size (default: 1)
  --lr <float>       Learning rate (default: 1e-5)
  --lora-rank <n>    LoRA rank (default: 8)

Requires: uv sync
"""

import argparse
import json
import os
import subprocess
import sys


def check_deps():
    try:
        import mlx_lm  # noqa: F401
    except ImportError:
        print("❌ mlx-lm not installed. Run:")
        print("   pip install mlx mlx-lm")
        sys.exit(1)


def convert_jsonl_to_mlx_format(input_path: str, output_dir: str):
    """Convert chat-completion JSONL to MLX LoRA format."""
    os.makedirs(output_dir, exist_ok=True)

    examples = []
    with open(input_path) as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))

    if not examples:
        print("❌ No examples found in", input_path)
        sys.exit(1)

    # MLX LoRA expects {"text": "..."} format with chat template applied
    # Or we can use the chat format directly with mlx_lm.lora
    # Using the messages format which mlx_lm supports natively

    # Split 90/10 train/valid
    split = max(1, int(len(examples) * 0.9))
    train = examples[:split]
    valid = examples[split:]

    train_path = os.path.join(output_dir, "train.jsonl")
    valid_path = os.path.join(output_dir, "valid.jsonl")

    for path, data in [(train_path, train), (valid_path, valid)]:
        with open(path, "w") as f:
            for ex in data:
                f.write(json.dumps(ex) + "\n")

    print(f"  Train: {len(train)} examples → {train_path}")
    print(f"  Valid: {len(valid)} examples → {valid_path}")
    return train_path, valid_path


def main():
    parser = argparse.ArgumentParser(description="SIBYL SFT Training with MLX")
    parser.add_argument("--model", default="mlx-community/Qwen2.5-1.5B-Instruct-4bit")
    parser.add_argument("--data", default="data/sft-train.jsonl")
    parser.add_argument("--output", default="adapters")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--lora-rank", type=int, default=8)
    args = parser.parse_args()

    check_deps()

    print("SIBYL SFT Training")
    print("══════════════════")
    print(f"  Model:      {args.model}")
    print(f"  Data:       {args.data}")
    print(f"  Output:     {args.output}")
    print(f"  Epochs:     {args.epochs}")
    print(f"  Batch size: {args.batch_size}")
    print(f"  LR:         {args.lr}")
    print(f"  LoRA rank:  {args.lora_rank}")
    print()

    if not os.path.exists(args.data):
        print(f"❌ Training data not found: {args.data}")
        print("   Run: npm run convert")
        sys.exit(1)

    # Prepare data
    print("→ Preparing data...")
    data_dir = os.path.join(args.output, "data")
    convert_jsonl_to_mlx_format(args.data, data_dir)
    print()

    # Run mlx_lm.lora
    print("→ Starting LoRA fine-tuning...")
    cmd = [
        sys.executable, "-m", "mlx_lm.lora",
        "--model", args.model,
        "--train",
        "--data", data_dir,
        "--adapter-path", args.output,
        "--iters", str(args.epochs * 100),  # rough: epochs * steps
        "--batch-size", str(args.batch_size),
        "--learning-rate", str(args.lr),
        "--lora-layers", "8",
        "--lora-rank", str(args.lora_rank),
    ]

    print(f"  Command: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd)

    if result.returncode == 0:
        print()
        print(f"✅ Training complete! Adapter saved to {args.output}/")
        print()
        print("Next steps:")
        print(f"  Test:  python3 infer.py --adapter {args.output}")
        print(f"  Fuse:  python3 -m mlx_lm.fuse --model {args.model} --adapter-path {args.output}")
    else:
        print(f"❌ Training failed (exit code {result.returncode})")
        sys.exit(1)


if __name__ == "__main__":
    main()
