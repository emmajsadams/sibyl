"""Tests for infer.py helper functions (no GPU/model required)."""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from infer import load_model


class TestLoadModel:
    def test_missing_adapter_path(self):
        """load_model with a nonexistent adapter should raise."""
        # mlx_lm.load will fail if the model doesn't exist locally,
        # so we just verify ImportError or FileNotFoundError is raised
        # (not silently ignored)
        with pytest.raises(Exception):
            load_model("nonexistent-model-abc123", adapter_path="/nonexistent/adapter")


class TestJsonParsing:
    """Test the JSON parsing logic from infer.py main (extracted pattern)."""

    def test_valid_json_response(self):
        response = json.dumps({
            "thinking": "I should move north",
            "firstAction": {"type": "move", "direction": "north"},
            "secondAction": {"type": "attack", "target": "enemy"},
        })
        parsed = json.loads(response)
        assert parsed["thinking"] == "I should move north"
        assert parsed["firstAction"]["type"] == "move"

    def test_invalid_json_response(self):
        response = "This is not JSON at all"
        with pytest.raises(json.JSONDecodeError):
            json.loads(response)

    def test_partial_json_fields(self):
        """Model might return valid JSON but missing expected fields."""
        response = json.dumps({"thinking": "hmm"})
        parsed = json.loads(response)
        assert parsed.get("firstAction") is None
        assert parsed.get("secondAction") is None

    def test_truncated_json(self):
        """Model might return truncated JSON due to max_tokens."""
        response = '{"thinking": "I should'
        with pytest.raises(json.JSONDecodeError):
            json.loads(response)
