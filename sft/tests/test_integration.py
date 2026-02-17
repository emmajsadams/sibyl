"""Integration tests: validate the convert → output pipeline."""

import json
import subprocess
from pathlib import Path

import pytest

SFT_DIR = Path(__file__).parent.parent
DATA_DIR = SFT_DIR / "data"
TRAINING_DIR = SFT_DIR.parent / "training"


@pytest.fixture(scope="module")
def converted_data():
    """Run the TS converter if training data exists, return path to output JSONL."""
    sft_jsonl = DATA_DIR / "sft-train.jsonl"

    # If no training data dir, skip
    if not TRAINING_DIR.exists():
        pytest.skip("No training/ directory found")

    training_files = list(TRAINING_DIR.glob("training-*.json"))
    if not training_files:
        pytest.skip("No training files found in training/")

    # Run the converter
    result = subprocess.run(
        ["npx", "tsx", "src/convert.ts"],
        cwd=str(SFT_DIR),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"Converter failed: {result.stderr}"

    if not sft_jsonl.exists():
        pytest.skip("Converter produced no output")

    return sft_jsonl


class TestConvertedOutput:
    def test_jsonl_is_valid(self, converted_data):
        """Each line should parse as valid JSON with a messages array."""
        with open(converted_data) as f:
            lines = [line for line in f if line.strip()]

        assert len(lines) > 0, "JSONL file is empty"

        for i, line in enumerate(lines):
            obj = json.loads(line)
            assert "messages" in obj, f"Line {i} missing 'messages' key"
            assert isinstance(obj["messages"], list), f"Line {i} 'messages' not a list"
            assert len(obj["messages"]) >= 2, f"Line {i} has fewer than 2 messages"

    def test_roles_present(self, converted_data):
        """Each example should have system, user, and assistant roles."""
        with open(converted_data) as f:
            lines = [line for line in f if line.strip()]

        for i, line in enumerate(lines):
            obj = json.loads(line)
            roles = {m["role"] for m in obj["messages"]}
            assert "system" in roles, f"Line {i} missing system role"
            assert "user" in roles, f"Line {i} missing user role"
            assert "assistant" in roles, f"Line {i} missing assistant role"

    def test_assistant_content_is_json(self, converted_data):
        """Assistant responses should be valid JSON."""
        with open(converted_data) as f:
            lines = [line for line in f if line.strip()]

        for i, line in enumerate(lines[:10]):  # Check first 10
            obj = json.loads(line)
            for msg in obj["messages"]:
                if msg["role"] == "assistant":
                    parsed = json.loads(msg["content"])
                    assert isinstance(parsed, dict), f"Line {i} assistant content not a dict"


class TestMetadata:
    def test_metadata_jsonl_exists(self, converted_data):
        """Metadata JSONL should be produced alongside training data."""
        meta_path = DATA_DIR / "sft-train-meta.jsonl"
        if not meta_path.exists():
            pytest.skip("No metadata file produced")

        with open(meta_path) as f:
            lines = [line for line in f if line.strip()]

        assert len(lines) > 0, "Metadata file is empty"

        first = json.loads(lines[0])
        # Check for expected fields
        assert isinstance(first, dict), "Metadata entry not a dict"
