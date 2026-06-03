"""Datalake 3.0 external worker registry access (SQLite).

This is the pre-existing NHAI worker registry (`data_lake_3.db`) that the app
verifies self-onboarding workers against. It is a *separate* SQLite file from
the backend's own Postgres DB — we never put PII like name/mobile/email into
Postgres; the registry is the source of truth for identity.

Schema (created by the seeder at repo root):
    workers(uuid TEXT PK, first_name, last_name, mobile UNIQUE, email UNIQUE)

On face registration we ADD three columns on first write so the registry row
carries the enrolled face: `face_template_id`, `face_embedding` (JSON of the
512-d vector), `face_registered_at` (ISO-8601).

All functions here are *synchronous* sqlite3 calls. Call them from async route
handlers via `fastapi.concurrency.run_in_threadpool` so the event loop never
blocks on disk I/O.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from app.config import get_settings


def _db_path() -> str:
    """Resolve the registry path: explicit DATA_LAKE_PATH wins, else the
    repo-root `data_lake_3.db` (three parents up from this file:
    utils → app → backend → repo root)."""
    configured = get_settings().DATA_LAKE_PATH
    if configured:
        return configured
    return str(Path(__file__).resolve().parents[3] / "data_lake_3.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    # WAL + a generous busy_timeout so concurrent onboarders (each on its own
    # threadpool thread/connection) don't hit "database is locked" 500s.
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
    except sqlite3.Error:
        pass
    return conn


def _norm(s: str | None) -> str:
    """Trim + collapse internal whitespace + lowercase. Used for case-/space-
    insensitive comparison of names and email."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def find_worker(
    first_name: str, last_name: str, mobile: str, email: str
) -> dict | None:
    """Strict all-4 match against the registry (case-insensitive / trimmed on
    names + email, digits-only on mobile). Returns the row as a dict (with the
    registry `uuid`) or None if no exact match.

    Mobile is UNIQUE in the registry so we narrow on it, then confirm the
    remaining three fields in Python with normalization.
    """
    mob = _digits(mobile)
    if not mob:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT uuid, first_name, last_name, mobile, email FROM workers WHERE mobile = ?",
            (mob,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    if (
        _norm(row["first_name"]) == _norm(first_name)
        and _norm(row["last_name"]) == _norm(last_name)
        and _norm(row["email"]) == _norm(email)
    ):
        return dict(row)
    return None


def get_worker_by_uuid(uuid: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT uuid, first_name, last_name, mobile, email FROM workers WHERE uuid = ?",
            (uuid,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def _ensure_face_columns(conn: sqlite3.Connection) -> None:
    """Add face columns on first use (idempotent + concurrency-safe). SQLite
    has no `ADD COLUMN IF NOT EXISTS`, and the check-then-ALTER is racy under
    concurrent first-time writers (each on its own thread/connection via
    run_in_threadpool): the loser gets a logical "duplicate column name" error
    that no busy_timeout can retry. So we also swallow exactly that error."""
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(workers)")}
    for col in ("face_template_id", "face_embedding", "face_registered_at"):
        if col not in existing:
            try:
                conn.execute(f"ALTER TABLE workers ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise


def save_face(
    uuid: str, embedding_json: str, template_id: str, registered_at_iso: str
) -> str:
    """Idempotent one-time dual-write of the registered face into the worker's
    registry row. The UPDATE is conditional on `face_embedding IS NULL`, so a
    face that was already stored is NEVER overwritten — even if the backend's
    Postgres pointer was lost to a partial-commit failure and a later caller
    re-passes the (Postgres) one-time guard.

    Returns:
      'written' — the embedding was newly stored,
      'exists'  — a face was already registered (left untouched),
      'missing' — the uuid is not in the registry.
    """
    conn = _connect()
    try:
        _ensure_face_columns(conn)
        cur = conn.execute(
            "UPDATE workers SET face_template_id = ?, face_embedding = ?, "
            "face_registered_at = ? WHERE uuid = ? AND face_embedding IS NULL",
            (template_id, embedding_json, registered_at_iso, uuid),
        )
        conn.commit()
        if cur.rowcount > 0:
            return "written"
        exists = conn.execute(
            "SELECT 1 FROM workers WHERE uuid = ?", (uuid,)
        ).fetchone()
        return "exists" if exists else "missing"
    finally:
        conn.close()
