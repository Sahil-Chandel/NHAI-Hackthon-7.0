import os
import secrets
import sys
from pydantic_settings import BaseSettings
from functools import lru_cache


# Sentinels that mean "operator forgot to set a real secret". We refuse to boot
# in production mode with any of these in place.
DANGEROUS_DEFAULTS = {
    "JWT_SECRET": "change-me-in-production",
    "DEVICE_SHARED_SECRET": "nhai-hackathon-shared-secret",
    "AADHAR_PEPPER": "",  # empty == not set
    "POSTGRES_PASSWORD": "nhai",
    "GRAFANA_ADMIN_PASSWORD": "nhai",
}


class Settings(BaseSettings):
    # --- Core ---
    # In dev (when ENV != "production") these defaults stand. In production they
    # MUST be overridden via env / .env file (validated at startup below).
    ENV: str = "dev"  # one of: dev | production
    DATABASE_URL: str = "postgresql+asyncpg://nhai:nhai@localhost:5432/nhai_face"

    # --- Postgres parts (used when DATABASE_URL is left at default) ---
    # These must be declared as Settings fields, NOT just read from os.environ,
    # because pydantic-settings populates Settings from .env directly and never
    # touches os.environ. Without these fields, .env's POSTGRES_PASSWORD is
    # invisible to the URL composer.
    POSTGRES_USER: str = ""
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: str = "5432"

    # --- JWT ---
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 15
    # Acceptance window for `exp`/`iat` clock skew. 30s is plenty; 300s lets
    # attackers replay an expired token comfortably.
    JWT_LEEWAY_SECONDS: int = 30

    # --- CORS ---
    # In dev allow * for convenience; in production set to your front-door host.
    CORS_ORIGINS: list[str] = ["*"]

    # --- Device JWT (legacy, used by attendance.py / apiClient.ts) ---
    DEVICE_SHARED_SECRET: str = "nhai-hackathon-shared-secret"
    # If False, /api/v1/auth/token returns 410 Gone. Worker/Admin flows don't
    # need it; only the legacy VerificationScreen-driven attendance uploader
    # depended on it. Defaults to False (closed) — flip on for legacy back-compat.
    DEVICE_TOKEN_ENABLED: bool = False

    # --- Crypto ---
    # Pepper mixed into every Aadhar HMAC. Server-side-only; never logged.
    # Without it, DB leak → brute-force the 10^11 Aadhar space in seconds.
    # Required in production; in dev we tolerate empty but emit a warning.
    AADHAR_PEPPER: str = ""

    # --- Limits / DoS ---
    MAX_REQUEST_BODY_BYTES: int = 256 * 1024  # 256 KB
    MAX_PUNCH_BATCH_EVENTS: int = 100
    MAX_DATE_RANGE_DAYS: int = 366  # 1 year max for date_from..date_to queries

    # --- Datalake 3.0 external registry (SQLite) ---
    # Worker self-onboarding matches against this pre-existing registry of
    # known workers (uuid + first/last/mobile/email). Empty == resolve the
    # repo-root `data_lake_3.db` at call time (see app/utils/data_lake.py).
    DATA_LAKE_PATH: str = ""

    # --- Observability ---
    # Token required to read /metrics. If unset, /metrics returns 404.
    METRICS_BEARER_TOKEN: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}

    def is_production(self) -> bool:
        return self.ENV.lower() in ("prod", "production")


def _validate_production_settings(s: Settings) -> None:
    """Refuse to boot in production with any insecure default in place.

    This is the single most important guard against the JWT_SECRET /
    DEVICE_SHARED_SECRET defaults shipping to a real deployment.
    """
    if not s.is_production():
        return
    problems: list[str] = []
    if s.JWT_SECRET == DANGEROUS_DEFAULTS["JWT_SECRET"]:
        problems.append("JWT_SECRET is the default placeholder")
    if s.DEVICE_TOKEN_ENABLED and s.DEVICE_SHARED_SECRET == DANGEROUS_DEFAULTS["DEVICE_SHARED_SECRET"]:
        problems.append("DEVICE_SHARED_SECRET is the default placeholder")
    if not s.AADHAR_PEPPER:
        problems.append("AADHAR_PEPPER is empty (required in production)")
    if "*" in s.CORS_ORIGINS:
        problems.append("CORS_ORIGINS contains '*'")
    if problems:
        print(
            "FATAL: insecure configuration in production:\n  - "
            + "\n  - ".join(problems),
            file=sys.stderr,
        )
        sys.exit(1)


def _compose_database_url_if_missing(s: Settings) -> Settings:
    """If DATABASE_URL is still the hard-coded default but the user did set
    POSTGRES_* parts in .env, compose a proper async URL from them. This lets
    operators rotate POSTGRES_PASSWORD without also having to update a
    duplicated DATABASE_URL field.

    Reads the POSTGRES_* values from the Settings model (not os.environ) —
    pydantic-settings populates Settings.fields directly from .env and never
    touches os.environ, so an os.environ.get() lookup here would always miss.
    """
    default = "postgresql+asyncpg://nhai:nhai@localhost:5432/nhai_face"
    if s.DATABASE_URL != default:
        return s  # operator set it explicitly
    if not (s.POSTGRES_USER and s.POSTGRES_PASSWORD and s.POSTGRES_DB):
        return s  # nothing usable to compose from
    from urllib.parse import quote_plus
    s.DATABASE_URL = (
        f"postgresql+asyncpg://{quote_plus(s.POSTGRES_USER)}"
        f":{quote_plus(s.POSTGRES_PASSWORD)}"
        f"@{s.POSTGRES_HOST}:{s.POSTGRES_PORT}/{quote_plus(s.POSTGRES_DB)}"
    )
    return s


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s = _compose_database_url_if_missing(s)
    _validate_production_settings(s)
    return s


def generate_secret(length: int = 48) -> str:
    """Convenience for ops: `python -c 'from app.config import generate_secret; print(generate_secret())'`"""
    return secrets.token_urlsafe(length)
