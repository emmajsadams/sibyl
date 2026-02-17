"""Tests for train.py data conversion functions."""

import json
import os

# Import the function directly from train.py
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from train import convert_jsonl_to_mlx_format


def make_example(role_content_pairs):
    """Create a chat-completion example."""
    return {
        "messages": [{"role": r, "content": c} for r, c in role_content_pairs]
    }


@pytest.fixture
def sample_jsonl(tmp_path):
    """Create a sample JSONL file with 10 examples."""
    path = tmp_path / "train.jsonl"
    examples = []
    for i in range(10):
        ex = make_example([
            ("system", "You are a tactical AI."),
            ("user", f"Board state {i}"),
            ("assistant", json.dumps({"thinking": f"thought {i}", "action": "move"})),
        ])
        examples.append(ex)
    path.write_text("\n".join(json.dumps(e) for e in examples) + "\n")
    return str(path)


class TestConvertJsonlToMlxFormat:
    def test_produces_train_valid_split(self, sample_jsonl, tmp_path):
        output_dir = str(tmp_path / "output")
        train_path, valid_path = convert_jsonl_to_mlx_format(sample_jsonl, output_dir)

        assert os.path.exists(train_path)
        assert os.path.exists(valid_path)

        with open(train_path) as f:
            train = [json.loads(line) for line in f if line.strip()]
        with open(valid_path) as f:
            valid = [json.loads(line) for line in f if line.strip()]

        assert len(train) == 9  # 90% of 10
        assert len(valid) == 1  # 10% of 10
        assert len(train) + len(valid) == 10

    def test_preserves_message_structure(self, sample_jsonl, tmp_path):
        output_dir = str(tmp_path / "output")
        train_path, _ = convert_jsonl_to_mlx_format(sample_jsonl, output_dir)

        with open(train_path) as f:
            example = json.loads(f.readline())

        assert "messages" in example
        roles = [m["role"] for m in example["messages"]]
        assert roles == ["system", "user", "assistant"]

    def test_empty_input_exits(self, tmp_path):
        empty_file = tmp_path / "empty.jsonl"
        empty_file.write_text("")
        output_dir = str(tmp_path / "output")

        with pytest.raises(SystemExit):
            convert_jsonl_to_mlx_format(str(empty_file), output_dir)

    def test_single_example(self, tmp_path):
        """Single example should all go to train, valid empty."""
        path = tmp_path / "single.jsonl"
        ex = make_example([("system", "hi"), ("user", "hello"), ("assistant", "bye")])
        path.write_text(json.dumps(ex) + "\n")
        output_dir = str(tmp_path / "output")

        train_path, valid_path = convert_jsonl_to_mlx_format(str(path), output_dir)

        with open(train_path) as f:
            train = [line for line in f if line.strip()]
        with open(valid_path) as f:
            valid = [line for line in f if line.strip()]

        assert len(train) == 1
        assert len(valid) == 0

    def test_creates_output_dir(self, sample_jsonl, tmp_path):
        output_dir = str(tmp_path / "nested" / "deep" / "output")
        convert_jsonl_to_mlx_format(sample_jsonl, output_dir)
        assert os.path.isdir(output_dir)
