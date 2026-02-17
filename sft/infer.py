#!/usr/bin/env python3
"""
SIBYL SFT Inference — test a fine-tuned model on a board state

Usage:
  python3 infer.py [options]

Options:
  --model <name>     Base model (default: mlx-community/Qwen2.5-1.5B-Instruct-4bit)
  --adapter <path>   LoRA adapter dir (default: adapters/)
  --data <path>      Test data JSONL — picks a random example (default: data/sft-train.jsonl)
  --interactive      Enter board states manually

Requires: uv sync
"""

import argparse
import json
import random
import sys


def check_deps():
    try:
        from mlx_lm import generate, load  # noqa: F401
    except ImportError:
        print("❌ mlx-lm not installed. Run:")
        print("   pip install mlx mlx-lm")
        sys.exit(1)


def load_model(model_name: str, adapter_path: str | None = None):
    from mlx_lm import load

    print(f"→ Loading model: {model_name}")
    if adapter_path:
        print(f"  Adapter: {adapter_path}")
        model, tokenizer = load(model_name, adapter_path=adapter_path)
    else:
        print("  (no adapter — base model)")
        model, tokenizer = load(model_name)
    return model, tokenizer


def run_inference(model, tokenizer, messages: list[dict], max_tokens: int = 512):
    from mlx_lm import generate

    # Apply chat template
    if hasattr(tokenizer, "apply_chat_template"):
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    else:
        # Fallback: concatenate
        prompt = "\n\n".join(f"[{m['role']}]\n{m['content']}" for m in messages)

    response = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens)
    return response


def main():
    parser = argparse.ArgumentParser(description="SIBYL SFT Inference")
    parser.add_argument("--model", default="mlx-community/Qwen2.5-1.5B-Instruct-4bit")
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--data", default="data/sft-train.jsonl")
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--compare", action="store_true", help="Compare base vs fine-tuned")
    args = parser.parse_args()

    check_deps()

    # Load a random example
    if not args.interactive:
        with open(args.data) as f:
            examples = [json.loads(line) for line in f if line.strip()]
        example = random.choice(examples)
        messages = example["messages"]

        print("SIBYL SFT Inference")
        print("═══════════════════")
        print()
        print("Board state:")
        print(messages[1]["content"])
        print()
        print("Expected response:")
        print(messages[2]["content"])
        print()

        if args.compare:
            # Run base model
            print("─── Base Model ───")
            model, tokenizer = load_model(args.model)
            response = run_inference(model, tokenizer, messages[:2])
            print(response)
            print()

            if args.adapter:
                # Run fine-tuned
                print("─── Fine-tuned ───")
                model, tokenizer = load_model(args.model, args.adapter)
                response = run_inference(model, tokenizer, messages[:2])
                print(response)
            print()
        else:
            model, tokenizer = load_model(args.model, args.adapter)
            print("─── Model Output ───")
            response = run_inference(model, tokenizer, messages[:2])
            print(response)
            print()

        # Try to parse as JSON
        try:
            parsed = json.loads(response)
            print("✅ Valid JSON output")
            print(f"   Thinking: {parsed.get('thinking', 'N/A')[:100]}")
            print(f"   Action 1: {parsed.get('firstAction', {}).get('type', 'N/A')}")
            print(f"   Action 2: {parsed.get('secondAction', {}).get('type', 'N/A')}")
        except (json.JSONDecodeError, TypeError):
            print("⚠️  Output is not valid JSON")
    else:
        model, tokenizer = load_model(args.model, args.adapter)
        print("\nInteractive mode — paste a board state, then press Enter twice to generate.")
        print("Type 'quit' to exit.\n")

        while True:
            lines = []
            print("Board state (empty line to submit):")
            while True:
                line = input()
                if line == "quit":
                    return
                if line == "":
                    break
                lines.append(line)

            if not lines:
                continue

            board = "\n".join(lines)
            messages = [
                {
                    "role": "system",
                    "content": "SIBYL tactical AI. You control a unit on a 6x6 grid.",
                },
                {"role": "user", "content": board},
            ]

            print("\n─── Model Output ───")
            response = run_inference(model, tokenizer, messages)
            print(response)
            print()


if __name__ == "__main__":
    main()
