"""Aadhar number hashing + Verhoeff checksum validation.

NEVER stores plain Aadhar numbers. Server keeps only `HMAC-SHA256(pepper,
salt || aadhar)` plus the per-record salt. Pepper is a server-side-only
secret (env var `AADHAR_PEPPER`); without it, a DB leak alone is useless
for brute-force.

A leftover SHA-256-only verifier is kept for backward compatibility with
records that were written before the HMAC upgrade — those records will
upgrade in place on next successful verify (call site can choose to
re-hash with the new scheme).
"""
import hashlib
import hmac
import os
import re

from app.config import get_settings


# Verhoeff algorithm tables
_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


# ---------- Verhoeff / formatting helpers ----------

def validate_aadhar_format(aadhar: str) -> bool:
    """Returns True if 12 digits AND Verhoeff checksum is valid."""
    if not isinstance(aadhar, str):
        return False
    digits = re.sub(r"\D", "", aadhar)
    if len(digits) != 12:
        return False
    if digits[0] in ("0", "1"):
        return False
    c = 0
    for i, d in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(d)]]
    return c == 0


def normalize_aadhar(aadhar: str) -> str:
    """Strip spaces/dashes, return 12 digits or empty string."""
    return re.sub(r"\D", "", aadhar or "")


def mask_aadhar(aadhar: str) -> str:
    """Return XXXX-XXXX-1234 style mask for display."""
    n = normalize_aadhar(aadhar)
    if len(n) != 12:
        return "XXXX-XXXX-XXXX"
    return f"XXXX-XXXX-{n[-4:]}"


# ---------- Hashing ----------

# Format prefix for HMAC scheme. Anything without a known prefix is treated as
# legacy salted-SHA256 for backwards verify.
_HMAC_PREFIX = "v2$"


def _get_pepper() -> bytes:
    """Fetch the Aadhar pepper from the app settings.

    MUST come from get_settings() (pydantic-settings), not os.environ: the app
    is configured via the .env file, which populates the Settings model but
    never touches os.environ. Reading os.environ here returned an EMPTY pepper
    under the documented `uvicorn`-reads-.env run path, silently voiding the
    hash protection and diverging from Docker (which injects a real env var).
    Sourcing from settings makes both deployment modes agree. May be empty in
    dev; production config validation refuses to boot if it is empty."""
    return get_settings().AADHAR_PEPPER.encode("utf-8")


def _hash_hmac(aadhar: str, salt: str, pepper: bytes) -> str:
    """HMAC-SHA256(pepper, salt_bytes || normalized_aadhar) with the v2 prefix."""
    msg = bytes.fromhex(salt) + normalize_aadhar(aadhar).encode("utf-8")
    mac = hmac.new(pepper, msg=msg, digestmod=hashlib.sha256)
    return _HMAC_PREFIX + mac.hexdigest()


def hash_aadhar(aadhar: str, salt: str | None = None) -> tuple[str, str]:
    """Hash an Aadhar with HMAC-SHA256(pepper, salt || normalized_aadhar).

    Returns (hash_with_prefix, salt_hex). If `salt` is supplied (e.g. by a
    verify call against a stored record), uses it as-is.
    """
    if salt is None:
        salt = os.urandom(16).hex()
    return _hash_hmac(aadhar, salt, _get_pepper()), salt


def _hash_legacy_sha256(aadhar: str, salt: str) -> str:
    """The pre-v2 hash: SHA-256(salt_bytes || aadhar). No pepper."""
    h = hashlib.sha256()
    h.update(bytes.fromhex(salt))
    h.update(normalize_aadhar(aadhar).encode("utf-8"))
    return h.hexdigest()


def verify_aadhar(aadhar: str, stored_hash: str, salt: str) -> bool:
    """Compare a candidate Aadhar against a stored hash + salt.

    Auto-detects scheme: anything starting with `v2$` is HMAC, otherwise legacy
    salted SHA-256. Use `hmac.compare_digest` for constant-time compare to
    avoid timing leaks.
    """
    if stored_hash.startswith(_HMAC_PREFIX):
        pepper = _get_pepper()
        if hmac.compare_digest(_hash_hmac(aadhar, salt, pepper), stored_hash):
            return True
        # Pepper-rotation fallback: rows written before the pepper was sourced
        # from settings were HMACed with an EMPTY pepper. Still accept them so
        # the config fix doesn't lock anyone out; they upgrade to the real
        # pepper on the next write (see needs_rehash). Skipped when the pepper
        # is already empty (nothing to fall back to).
        if pepper and hmac.compare_digest(_hash_hmac(aadhar, salt, b""), stored_hash):
            return True
        return False
    candidate = _hash_legacy_sha256(aadhar, salt)
    return hmac.compare_digest(candidate, stored_hash)


def verify_used_legacy_pepper(aadhar: str, stored_hash: str, salt: str) -> bool:
    """True if this v2 hash verifies only under the empty (legacy) pepper —
    i.e. it should be re-hashed to the current pepper. Cheap helper for call
    sites that want to lazily upgrade rows after a successful login."""
    if not stored_hash.startswith(_HMAC_PREFIX):
        return False
    pepper = _get_pepper()
    if not pepper:
        return False
    if hmac.compare_digest(_hash_hmac(aadhar, salt, pepper), stored_hash):
        return False
    return hmac.compare_digest(_hash_hmac(aadhar, salt, b""), stored_hash)


def needs_rehash(stored_hash: str) -> bool:
    """Returns True if a successful verify should be followed by a re-hash to
    the current scheme. Lets call sites lazily upgrade legacy records."""
    return not stored_hash.startswith(_HMAC_PREFIX)
