from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
from fastapi import HTTPException


DEFAULT_BASE_URL = "https://api.vieneu.io/api/v1"
DEFAULT_ALLOWED_ORIGINS = "http://localhost:8081,http://127.0.0.1:8081,http://localhost:5173,http://127.0.0.1:5173"
GENDERS = {"Nam", "Nữ", "Không xác định"}


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class VieNeuTtsConfig:
    enabled: bool
    api_key: str
    endpoint_url: str
    model: str
    voice: str
    male_voice: str
    female_voice: str
    allowed_origins: frozenset[str]
    connect_timeout_seconds: float
    read_timeout_seconds: float

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.api_key and self.endpoint_url and self.model and self.voice)

    def public(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "ready": self.ready,
            "endpoint": "/api/tts/vieneu/stream",
            "provider": "vieneu-cloud",
        }


def vieneu_tts_config() -> VieNeuTtsConfig:
    base_url = os.getenv("VIENEU_API_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
    model = os.getenv("VIENEU_MODEL", "vieneu-v4").strip()
    voice = os.getenv("VIENEU_VOICE", os.getenv("MIA_VIENEU_TTS_VOICE", "Quang Định")).strip()
    return VieNeuTtsConfig(
        enabled=_enabled(os.getenv("MIA_VIENEU_TTS_ENABLED")),
        api_key=os.getenv("VIENEU_API_KEY", "").strip(),
        endpoint_url=os.getenv("VIENEU_TTS_URL", f"{base_url}/audio/speech").strip(),
        model=model,
        voice=voice,
        male_voice=os.getenv("VIENEU_VOICE_MALE", voice).strip(),
        female_voice=os.getenv("VIENEU_VOICE_FEMALE", voice).strip(),
        allowed_origins=frozenset(
            item.strip().rstrip("/")
            for item in os.getenv("MIA_VIENEU_TTS_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
            if item.strip()
        ),
        connect_timeout_seconds=float(os.getenv("MIA_VIENEU_TTS_CONNECT_TIMEOUT_SECONDS", "10")),
        read_timeout_seconds=float(os.getenv("MIA_VIENEU_TTS_READ_TIMEOUT_SECONDS", "150")),
    )


def open_vieneu_stream(text: str, origin: str | None, gender: str = "Không xác định") -> tuple[Iterator[bytes], dict[str, str]]:
    config = vieneu_tts_config()
    if not config.enabled:
        raise HTTPException(status_code=404, detail="VIENEU_TTS_DISABLED")
    if not config.ready:
        raise HTTPException(status_code=503, detail="VIENEU_TTS_NOT_CONFIGURED")
    if origin and origin.rstrip("/") not in config.allowed_origins:
        raise HTTPException(status_code=403, detail="VIENEU_TTS_ORIGIN_NOT_ALLOWED")
    if gender not in GENDERS:
        raise HTTPException(status_code=422, detail="VIENEU_TTS_GENDER_INVALID")

    voice = config.male_voice if gender == "Nam" else config.female_voice if gender == "Nữ" else config.voice

    client = httpx.Client(
        timeout=httpx.Timeout(config.read_timeout_seconds, connect=config.connect_timeout_seconds),
    )
    try:
        request = client.build_request(
            "POST",
            config.endpoint_url,
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                "Accept": "audio/wav",
            },
            json={
                "input": text,
                "model": config.model,
                "voice": voice,
                "response_format": "wav",
            },
        )
        response = client.send(request, stream=True)
    except httpx.HTTPError as exc:
        client.close()
        raise HTTPException(status_code=503, detail="VIENEU_TTS_UNAVAILABLE") from exc

    if response.status_code >= 400:
        status = response.status_code
        response.close()
        client.close()
        if status in {401, 403}:
            raise HTTPException(status_code=503, detail="VIENEU_TTS_AUTH_FAILED")
        if status == 429:
            raise HTTPException(status_code=429, detail="VIENEU_TTS_RATE_LIMITED")
        raise HTTPException(status_code=502, detail="VIENEU_TTS_UPSTREAM_ERROR")

    def chunks() -> Iterator[bytes]:
        try:
            yield from response.iter_bytes()
        finally:
            response.close()
            client.close()

    headers = {
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
    }
    if content_type := response.headers.get("Content-Type"):
        headers["X-Upstream-Content-Type"] = content_type
    for name in ("X-Sample-Rate", "X-Output-Format", "X-Stream-Format", "X-Stream-Heartbeat"):
        if value := response.headers.get(name):
            headers[name] = value
    return chunks(), headers
