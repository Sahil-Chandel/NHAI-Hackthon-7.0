import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.admin import Admin
from app.models.worker import (
    Worker,
    WorkerLoginIn,
    WorkerOut,
    WorkerTokenOut,
    WorkerVerifyIn,
    FaceRegisterIn,
    FaceRegisterOut,
)
from app.auth.jwt import create_role_token, get_current_worker
from app.security.middleware import limiter
from app.utils import data_lake
from app.utils.aadhar import (
    validate_aadhar_format,
    normalize_aadhar,
    verify_aadhar,
    mask_aadhar,
)

router = APIRouter(prefix="/api/v1/worker", tags=["worker-auth"])

# Singleton owner for Datalake-onboarded workers. The existing schema requires
# workers.admin_id (FK, NOT NULL); self-onboarded workers have no human admin,
# so they all hang off this synthetic system admin. Created lazily on first
# onboard via an idempotent upsert.
SYSTEM_ADMIN_ID = "datalake-system-admin"


def _norm_name(s: str) -> str:
    """Trim + collapse internal whitespace + lowercase. Makes 'Ramesh  Kumar '
    match 'ramesh kumar' so a typing slip doesn't lock a worker out."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


@router.post("/login", response_model=WorkerTokenOut)
# 10/min/IP — workers may legitimately retry on typos, but throttle hard
# enough that brute-forcing a 12-digit Aadhar with a known name takes years.
@limiter.limit("10/minute")
async def worker_login(
    payload: WorkerLoginIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Worker logs in with name + Aadhar. DB match required.

    Per-worker salts mean we can't WHERE on aadhar_hash directly. Instead we
    narrow candidates by normalized name (case-insensitive) at the DB layer,
    then verify the per-row hash. For hackathon scale (< 1k workers per admin)
    this stays cheap; for larger deployments add a name index lookup table.
    """
    if not validate_aadhar_format(payload.aadhar):
        # Use the same generic 401 as a wrong match so format-vs-mismatch isn't
        # distinguishable by an attacker doing brute force.
        raise HTTPException(status_code=401, detail="Invalid name or Aadhar number")

    normalized_aadhar = normalize_aadhar(payload.aadhar)
    normalized_name = _norm_name(payload.name)
    if not normalized_name:
        raise HTTPException(status_code=401, detail="Invalid name or Aadhar number")

    # Load active workers and match names in Python via _norm_name. We do NOT
    # pre-filter on func.lower(Worker.name) == normalized_name at the DB layer:
    # _norm_name also collapses internal whitespace ("Ramesh  Kumar" ->
    # "ramesh kumar"), which a plain lower() does not, so a stored multi-space
    # name would be wrongly excluded and the worker locked out. At the stated
    # <1k-worker scale, the in-Python scan below is fine.
    candidates = (
        await db.execute(
            select(Worker).where(Worker.active.is_(True))
        )
    ).scalars().all()

    matched: Worker | None = None
    for w in candidates:
        # Defensive: re-normalize stored name too in case it contains extra spaces.
        if _norm_name(w.name) != normalized_name:
            continue
        # verify_aadhar handles both legacy SHA-256 and new HMAC schemes and
        # uses constant-time compare to avoid timing side-channels.
        if verify_aadhar(normalized_aadhar, w.aadhar_hash, w.aadhar_salt):
            matched = w
            break

    if matched is None:
        raise HTTPException(status_code=401, detail="Invalid name or Aadhar number")

    token, ttl = create_role_token(matched.id, "worker")
    return WorkerTokenOut(
        access_token=token,
        token_type="bearer",
        expires_in=ttl,
        worker=WorkerOut(
            id=matched.id,
            name=matched.name,
            aadhar_masked=mask_aadhar(payload.aadhar),
            admin_id=matched.admin_id,
            active=matched.active,
            created_at=matched.created_at,
        ),
    )


async def _upsert_datalake_worker(
    db: AsyncSession, uuid: str, full_name: str
) -> Worker:
    """Make sure a Postgres `workers` row exists for a Datalake-onboarded
    worker so punch_events FK + JWT identity line up. The worker's id IS the
    registry uuid. Idempotent: re-onboarding the same uuid is a no-op insert.

    aadhar_hash is NOT NULL + UNIQUE in the schema; onboarded workers have no
    Aadhar, so we store a unique non-Aadhar sentinel (`dl$<uuid>`) that the
    `v2$`/legacy verifiers will never accept — it can't be used to log in via
    the Aadhar path, only via this Datalake flow.
    """
    # Idempotent system-admin owner (FK target) — safe under concurrent first
    # onboards thanks to ON CONFLICT DO NOTHING.
    await db.execute(
        pg_insert(Admin)
        .values(
            id=SYSTEM_ADMIN_ID,
            name="Datalake 3.0 System",
            mobile="0000000000",
            aadhar_hash="system$datalake-admin",
            aadhar_salt="",
            face_template_id=None,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(
        pg_insert(Worker)
        .values(
            id=uuid,
            name=full_name,
            aadhar_hash=f"dl${uuid}",
            aadhar_salt="",
            face_template_id=None,
            admin_id=SYSTEM_ADMIN_ID,
            active=True,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.commit()
    worker = (
        await db.execute(select(Worker).where(Worker.id == uuid))
    ).scalar_one()
    return worker


@router.post("/verify", response_model=WorkerTokenOut)
# Strict 4-field lookup against the registry. Throttle to blunt enumeration of
# the registry by guessing mobile/email combinations.
@limiter.limit("20/minute")
async def worker_verify(
    payload: WorkerVerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Datalake 3.0 self-onboarding step 1.

    Match First Name + Last Name + mobile + email against the registry. On an
    exact match: ensure a backend worker row (keyed by the registry uuid),
    issue a worker JWT, and return the profile. The mobile app then proceeds to
    one-time face registration.
    """
    row = await run_in_threadpool(
        data_lake.find_worker,
        payload.first_name,
        payload.last_name,
        payload.mobile,
        payload.email,
    )
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="No matching worker found in the registry. Check your details.",
        )

    uuid = row["uuid"]
    full_name = f"{row['first_name']} {row['last_name']}".strip()
    worker = await _upsert_datalake_worker(db, uuid, full_name)

    token, ttl = create_role_token(worker.id, "worker")
    return WorkerTokenOut(
        access_token=token,
        token_type="bearer",
        expires_in=ttl,
        worker=WorkerOut(
            id=worker.id,
            name=worker.name,
            aadhar_masked="—",
            admin_id=worker.admin_id,
            active=worker.active,
            created_at=worker.created_at,
        ),
    )


@router.post("/register-face", response_model=FaceRegisterOut)
@limiter.limit("30/minute")
async def worker_register_face(
    payload: FaceRegisterIn,
    request: Request,
    worker_id: str = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    """Datalake 3.0 self-onboarding step 2 (one-time).

    Persist the freshly enrolled face: set the backend worker's
    `face_template_id`, and dual-write the embedding into the worker's row in
    the Datalake registry (same row, new columns). The device keeps its own
    copy for on-device punch matching.
    """
    worker = (
        await db.execute(select(Worker).where(Worker.id == worker_id))
    ).scalar_one_or_none()
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    # One-time: never overwrite an already-registered face. The registry's
    # stored embedding is the source of truth and is written exactly once. A
    # legitimate re-registration (e.g. a new device) is handled client-side —
    # it enrolls a fresh on-device template and treats this 409 as "already on
    # file" — but the central registry copy can't be silently replaced by a
    # later caller who happens to know the same 4 PII fields.
    if worker.face_template_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Face already registered for this worker.",
        )

    # Dual-write ORDER matters: write the registry (source of truth) first,
    # then the Postgres pointer — so we never commit Postgres claiming a face
    # the registry doesn't actually hold.
    embedding_json = json.dumps(payload.embedding)
    registered_at = datetime.now(timezone.utc).isoformat()
    status = await run_in_threadpool(
        data_lake.save_face,
        worker_id,
        embedding_json,
        payload.face_template_id,
        registered_at,
    )
    if status == "missing":
        # uuid vanished from the registry between /verify and here — surface it
        # instead of leaving the stores inconsistent.
        raise HTTPException(status_code=404, detail="Worker not found in registry.")

    # 'written' = newly stored; 'exists' = registry already held a face (e.g. a
    # prior attempt whose Postgres commit failed) — in both cases reconcile the
    # Postgres pointer; the registry embedding is never overwritten.
    await db.execute(
        update(Worker)
        .where(Worker.id == worker_id)
        .values(face_template_id=payload.face_template_id)
    )
    await db.commit()

    return FaceRegisterOut(
        ok=True,
        worker_id=worker_id,
        face_template_id=payload.face_template_id,
        data_lake_updated=(status == "written"),
    )
