"""Shared configuration for phrases that indicate customer frustration."""
import os

from .scenarios import normalized


DEFAULT_EMOTION_PHRASES = (
    "bực mình", "bực quá", "khó chịu", "tức giận", "cáu gắt", "giận dữ",
    "thất vọng", "quá tệ", "lởm", "cùi bắp", "chán quá", "vô lý",
    "mất thời gian", "không hài lòng", "không chấp nhận", "làm ăn",
)


def emotion_phrases() -> list[str]:
    """Return defaults plus semicolon-separated additions from the environment."""
    configured = os.getenv("MIA_EMOTION_PHRASES", "")
    phrases = [*DEFAULT_EMOTION_PHRASES, *configured.split(";")]
    # Preserve order while removing empty and equivalent accent/case variants.
    return list(dict.fromkeys(value for phrase in phrases if (value := normalized(phrase).strip())))


def is_upset(text: str) -> bool:
    value = normalized(text)
    return any(phrase in value for phrase in emotion_phrases())
