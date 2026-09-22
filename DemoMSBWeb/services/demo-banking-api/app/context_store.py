from __future__ import annotations

from threading import RLock

from .models import AppErrorRecord, ScreenContext


class ContextNotFoundError(KeyError):
    pass


class InMemoryContextStore:
    """Stage-one store; replace behind this interface in later phases."""

    def __init__(self) -> None:
        self._items: dict[str, ScreenContext] = {}
        self._errors: dict[str, AppErrorRecord] = {}
        self._lock = RLock()

    def put(self, context: ScreenContext) -> None:
        with self._lock:
            self._items[context.session_id] = context.model_copy(deep=True)

    def get(self, session_id: str) -> ScreenContext:
        with self._lock:
            context = self._items.get(session_id)
            if context is None:
                raise ContextNotFoundError(session_id)
            return context.model_copy(deep=True)

    def put_error(self, error: AppErrorRecord) -> None:
        with self._lock:
            self._errors[error.session_id] = error.model_copy(deep=True)

    def clear_error(self, session_id: str) -> None:
        with self._lock:
            self._errors.pop(session_id, None)

    def get_error(self, session_id: str) -> AppErrorRecord:
        with self._lock:
            error = self._errors.get(session_id)
            if error is None:
                raise ContextNotFoundError(session_id)
            return error.model_copy(deep=True)

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._items.pop(session_id, None)
            self._errors.pop(session_id, None)
