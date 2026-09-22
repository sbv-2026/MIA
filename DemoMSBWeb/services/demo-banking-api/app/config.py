from __future__ import annotations

from pathlib import Path
from threading import RLock

import yaml
from pydantic import ValidationError

from .models import ContextReaderConfig


class ConfigLoadError(RuntimeError):
    """Raised when a context reader configuration cannot be activated."""


def load_context_reader_config(path: Path) -> ContextReaderConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise ConfigLoadError(f"Unable to read context config: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigLoadError("Context config root must be an object")

    try:
        return ContextReaderConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigLoadError(f"Invalid context config: {exc}") from exc


class ContextReaderConfigManager:
    """Thread-safe configuration holder with last-known-good reload semantics."""

    def __init__(self, path: Path):
        self._path = path
        self._lock = RLock()
        self._active = load_context_reader_config(path)
        self._last_reload_error: str | None = None

    @property
    def active(self) -> ContextReaderConfig:
        with self._lock:
            return self._active.model_copy(deep=True)

    @property
    def last_reload_error(self) -> str | None:
        with self._lock:
            return self._last_reload_error

    def reload(self) -> bool:
        try:
            candidate = load_context_reader_config(self._path)
        except ConfigLoadError as exc:
            with self._lock:
                self._last_reload_error = str(exc)
            return False

        with self._lock:
            self._active = candidate
            self._last_reload_error = None
        return True

