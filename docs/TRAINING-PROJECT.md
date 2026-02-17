# SIBYL Training Project: Teaching Models to Play Tactics

> A practical guide to using SIBYL game data for LLM fine-tuning and RL experiments.
> Written for someone who wants to learn by doing, not by reading papers.

## TL;DR

You have ~15 game transcripts where LLM agents play a 3v3 grid tactics game. Each game has 40+ agent decisions with reasoning, actions, and outcomes — plus a win/loss signal. This is a goldmine for learning about LLM training. The recommended path: **start with SFT on decision data → add DPO with win/loss labels → eventually try online RL.**

---

## What You Have

Each training file contains a full game replay as a sequence of events:

| Event | What it captures | Training value |
|-------|-----------------|----------------|
| `game_config` | Unit compositions, prompts | Context for decision-making |
| `turn_start` | Full board state (unit positions, HP, status effects, traps) | **Input** for the model |
| `agent_decision` | Thinking + two actions (move/ability) | **Output** for the model |
| `damage_dealt`, `unit_killed`, `healing_done` | Action outcomes | **Reward signals** |
| `game_end` | Winner, reason, survivors | **Terminal reward** |

The `agent_decision` event is the heart of it — it has the unit's chain-of-thought reasoning and the actual actions it chose. That's literally a (state, reasoning, action) tuple. Training data doesn't get much better than this.

Current dataset: **~15 games × ~44 decisions/game ≈ 660 training examples.** Small, but enough to learn the process. You'll want 200+ games for real results.

---

## Approach 1: Supervised Fine-Tuning (SFT)

**The idea:** Teach a model to imitate the decisions that won games.

### Data Format

Convert each decision into a chat-completion pair:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a tactical AI controlling a specter unit named Shade in a 3v3 grid battle..."
    },
    {
      "role": "user", 
      "content": "BOARD STATE:\nRound 1. Grid: 5x7.\nYour units:\n- Shade (specter) at (0,1), HP 4/4, facing N\n- Bastion (sentinel) at (2,1), HP 8/8, facing N\n...\nEnemy units:\n- Lifeline (medic) at (1,5), HP 5/5, facing S\n...\n\nChoose two actions."
    },
    {
      "role": "assistant",
      "content": "THINKING: Round 1: cloak immediately as instructed. Move forward to begin flanking toward enemy medic Lifeline at (1,5).\n\nACTION 1: ability cloak\nACTION 2: move (0,3)"
    }
  ]
}
```

### What you'd filter

- **Only winning-side decisions** (or weight winners higher) — don't train on the losing team's bad plays
- **Skip early games** (v0.5.0) if the game mechanics changed significantly
- Optionally skip decisions that led to immediate bad outcomes (unit died next turn)

### Tools

- **[Unsloth](https://github.com/unslothai/unsloth)** — Best option for Mac. Does QLoRA fine-tuning of Llama/Mistral with dramatically less memory. Supports Apple Silicon via MLX backend.
- **[MLX](https://github.com/ml-explore/mlx-examples/tree/main/lora)** — Apple's own framework. Native M-series support, LoRA fine-tuning built in. Less ecosystem but zero friction on Mac.
- **[Axolotl](https://github.com/OpenAccess-AI-Collective/axolotl)** — Config-driven fine-tuning. Great for learning, slightly heavier.

### Pros/Cons

✅ Simplest approach. You can have something running in hours.  
✅ Great for learning the fine-tuning pipeline end-to-end.  
⚠️ Only learns to imitate — doesn't discover novel strategies.  
⚠️ 660 examples is thin. Model will overfit fast. That's fine for learning.

---

## Approach 2: Preference Learning (DPO)

**The idea:** Show the model pairs of decisions — one good, one bad — and train it to prefer the good one.

### Data Format

DPO needs `(prompt, chosen, rejected)` triples:

```json
{
  "prompt": "BOARD STATE: Round 5. Grid: 5x7...",
  "chosen": "THINKING: Focus fire on wounded oracle...\nACTION 1: ability backstab (2,4)\nACTION 2: move (1,4)",
  "rejected": "THINKING: Move away to safety...\nACTION 1: move (0,2)\nACTION 2: ability cloak"
}
```

### Where pairs come from

You have two natural sources of preference pairs:

1. **Same board state, different outcomes.** If two games reach similar states, the winning side's decision is "chosen" and the losing side's is "rejected." Hard to find with only 15 games.

2. **Winner vs loser decisions within the same game.** At each `turn_start`, both sides make decisions. The winning side's decisions are "chosen" and the losing side's are "rejected." This works *now* — you already have both sides' decisions in every game.

3. **Generate rejected samples.** Take winning decisions as "chosen", then prompt a weaker model (or the base model) to generate alternative decisions for the same board state. Use those as "rejected."

### Tools

- **[TRL (Transformer Reinforcement Learning)](https://github.com/huggingface/trl)** — HuggingFace's library. Has `DPOTrainer` that works great. Can combine with Unsloth for memory efficiency.
- **MLX** doesn't have DPO built-in yet, but it's a small training loop to write yourself — educational!

### Pros/Cons

✅ More principled than SFT — learns *what's better*, not just *what happened*  
✅ Natural fit for game data (winners vs losers)  
⚠️ Needs an SFT base first (DPO on a raw model doesn't work well)  
⚠️ Pair construction takes thought and engineering  

---

## Approach 3: Reinforcement Learning (GRPO / PPO)

**The idea:** Let the model play SIBYL in a loop, score its performance, and update weights toward better play.

### Reward Signals (already in your data)

| Signal | Source | Weight |
|--------|--------|--------|
| Win/loss | `game_end.winner` | High (+1 / -1) |
| Damage dealt | `damage_dealt.amount` | Medium |
| Units killed | `unit_killed` events | Medium |
| Unit survived | `game_end.survivors` | Low-medium |
| Ability success | `ability_used.success` | Low |
| Efficient game (fewer turns) | `game_end.totalTurns` | Low |

You could also penalize: wasted moves (moving to same square), failed abilities, getting breached.

### The Loop

```
1. Model generates decision for board state
2. SIBYL game engine executes it  
3. Game continues until end
4. Compute reward from game outcome
5. Update model weights (GRPO/PPO)
6. Repeat
```

This requires SIBYL to run as a headless environment that the training loop can call. You'd need to wrap the game engine as a gym-like env.

### Frameworks

- **[TRL](https://github.com/huggingface/trl)** — Has `GRPOTrainer` (Group Relative Policy Optimization). GRPO is simpler than PPO and works surprisingly well. This is what DeepSeek used.
- **[OpenRLHF](https://github.com/OpenRLHF/OpenRLHF)** — More scalable, designed for multi-GPU. Overkill for learning but good to know exists.
- **[veRL](https://github.com/volcengine/veRL)** — ByteDance's framework. Clean architecture, good docs. Multi-GPU focused.

### Pros/Cons

✅ This is where the magic happens — model discovers strategies you never taught it  
✅ Extremely educational if you want to understand modern RLHF  
⚠️ Hardest to set up. Need game-as-environment wrapper.  
⚠️ Compute intensive. Even small models need many game rollouts.  
⚠️ Mac mini will struggle with online RL for anything above 1-3B params.  

---

## Recommended Learning Path

### Phase 1: SFT Weekend Sprint (start here) 🎯

**Goal:** Fine-tune a 1-3B model on winning SIBYL decisions using MLX or Unsloth.

1. Write a Python script to convert training JSONs → chat-completion JSONL
   - Filter to winning-side `agent_decision` events only
   - Reconstruct board state from preceding `turn_start`
   - Format as system/user/assistant messages
2. Pick a base model: **Llama 3.2 1B** or **Qwen 2.5 1.5B** (both run on Mac mini)
3. LoRA fine-tune with MLX (`mlx_lm.lora`)
4. Run inference — give it a board state, see if it outputs valid SIBYL actions
5. Plug it back into SIBYL as an agent and watch it play

**This is achievable in a weekend.** You won't get a good player (660 examples isn't enough), but you'll learn the entire pipeline and it *will* produce SIBYL-flavored outputs.

### Phase 2: DPO + More Data

1. Play 100+ more games to build the dataset (can automate: LLM vs LLM)
2. Build winner/loser preference pairs from same-game decisions
3. DPO fine-tune on top of your SFT model
4. Compare SFT-only vs SFT+DPO in actual games

### Phase 3: Online RL (the boss fight)

1. Wrap SIBYL game engine as a Python-callable environment
2. Set up GRPO training loop with TRL
3. Let the model play against itself or against the original LLM agent
4. Watch it develop strategies (this is the fun part)

---

## Hardware: Mac Mini M-Series Reality Check

| Task | 1B model | 3B model | 7B model |
|------|----------|----------|----------|
| Inference | ✅ Fast | ✅ Fine | ✅ Okay |
| SFT (LoRA) | ✅ Fast | ✅ Fine | ⚠️ Slow but works |
| DPO (LoRA) | ✅ Fine | ⚠️ Slow | ❌ Tight on memory |
| Online RL | ⚠️ Possible | ❌ Very slow | ❌ Not practical |

**Recommendation:** Use **1B-3B models** for local experiments. If you catch the bug and want to scale up, rent a GPU on [RunPod](https://runpod.io) or [Lambda](https://lambdalabs.com) ($1-2/hr for an A100).

MLX is the path of least resistance on Mac. The `mlx-lm` package handles quantized LoRA fine-tuning natively and it's fast.

---

## Data Pipeline: What Needs to Change

### Current schema is solid. A few additions would help:

1. **Add a `round` field to `agent_decision`** — Currently decisions don't carry the round number. You have to infer it from surrounding `turn_start` events. Easy fix.

2. **Add outcome annotation per decision** — After a decision, what happened? Did the unit's target die? Did the unit take damage next turn? A post-hoc `decision_outcome` event would make reward computation trivial.

3. **Board state serialization** — The `turn_start` event has full state, but for training you'll want a deterministic text serialization. Write a `boardStateToPrompt(turnStart)` function once and reuse everywhere.

4. **Game-level metadata** — Add to the training file: `winner`, `totalDamageBySize`, `decisionsCount`. Saves re-parsing events for filtering.

### Conversion Script (the core transform)

```python
def game_to_training_pairs(game_data):
    """Convert a SIBYL game to (state, decision) training pairs."""
    pairs = []
    current_state = None
    winner = None
    
    for event in game_data['events']:
        if event['type'] == 'turn_start':
            current_state = serialize_board(event)
        elif event['type'] == 'agent_decision':
            unit_side = get_unit_side(event['unitId'], current_state)
            pairs.append({
                'state': current_state,
                'decision': event,
                'side': unit_side,
            })
        elif event['type'] == 'game_end':
            winner = event.get('winner')
    
    # Label each pair with win/loss
    for pair in pairs:
        pair['won'] = (pair['side'] == winner)
    
    return pairs
```

---

## Open Questions & Tradeoffs

**How much does prompt engineering matter vs fine-tuning?**  
The current SIBYL agents use careful prompts. Fine-tuning a small model might just learn to follow those prompts, not develop independent tactical sense. Compare: fine-tuned 3B vs prompted GPT-4o mini. If prompting is 90% as good, maybe the real value is in RL (Phase 3).

**Should the model see the full board or just its unit's perspective?**  
Full board = easier to learn, but unrealistic if you want fog-of-war later. Unit-perspective = harder, more interesting, more like real gameplay.

**What about multi-turn context?**  
Currently each decision is independent. But strategy unfolds over turns. Should the model see its last 2-3 decisions? Probably yes — but it increases context length and training complexity.

**When is the dataset big enough?**  
For SFT: 1000+ examples to see real learning. For DPO: 500+ preference pairs. For RL: dataset size matters less (it generates its own), but you need a fast game environment.

**Is a 1B model even capable of tactical reasoning?**  
Honestly? Probably not great. But it'll learn the output format and basic patterns. That's enough for Phase 1. Real tactical play likely needs 7B+ with RL.

---

## Quick Reference: Tools to Install

```bash
# MLX (Apple Silicon native)
pip install mlx mlx-lm

# For data processing
pip install datasets transformers

# For Phase 2+
pip install trl peft accelerate

# Optional: Unsloth (faster LoRA)
pip install unsloth
```

---

## The Pitch

This project is a playground for understanding how modern LLM training works — SFT, DPO, RLHF, GRPO — applied to something you built and understand deeply. Games are the best domain for this because reward signals are clear, rollouts are fast, and you can *watch* the model play. 

Start with the SFT weekend sprint. If the fine-tuned model outputs even one valid SIBYL move, you'll be hooked.
