from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


REDACTED = "[REDACTED]"


def _normalise_key(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def redact_payload(value: Any, denied_fields: Sequence[str]) -> Any:
    """Return a deep redacted copy without mutating the source payload."""
    denied = {_normalise_key(field) for field in denied_fields}

    def visit(item: Any) -> Any:
        if isinstance(item, Mapping):
            return {
                str(key): REDACTED if _normalise_key(str(key)) in denied else visit(child)
                for key, child in item.items()
            }
        if isinstance(item, list):
            return [visit(child) for child in item]
        if isinstance(item, tuple):
            return tuple(visit(child) for child in item)
        return item

    return visit(value)

