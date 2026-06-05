"""Legacy attendance sync endpoint.

Originally the only attendance pipeline (driven by the standalone
VerificationScreen). Two important hardenings vs. the original:

1. **IDOR fix (S6)**: previously the route accepted `device_id` from the JWT
   but trusted `user_id` from the request body. A worker JWT could write
   attendance under any other user_id. We now overwrite `user_id` from the
   JWT subject — the body field is ignored for identity.

2. **Date-range cap (S23)** on the read endpoint: refuse queries spanning
   > MAX_DATE_RANGE_DAYS so a sloppy admin tool can't trigger a full-table
   scan via `date_from=1970-01-01&date_to=2100-01-01`.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import verify_token, require_role
from app.auth.play_integrity import require_device_integrity
from app.config import get_settings
from app.db.session import get_db
from app.models.attendance import (
    AttendanceBatchIn,
    AttendanceBatchOut,
    AttendanceOut,
    AttendanceRecord,
)

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])


@router.post("", response_model=AttendanceBatchOut)
async def sync_attendance(
    batch: AttendanceBatchIn,
    device_id: str = Depends(verify_token),
    db: AsyncSession = Depends(get_db),
    x_integrity_token: str | None = Header(None, alias="X-Integrity-Token"),
):
    settings = get_settings()
    await require_device_integrity(x_integrity_token, device_id)

    if len(batch.events) > settings.MAX_PUNCH_BATCH_EVENTS:
        raise HTTPException(
            status_code=413,
            detail=f"Batch too large (>{settings.MAX_PUNCH_BATCH_EVENTS} events)",
        )

    accepted: list[str] = []
    rejected: list[str] = []

    for event in batch.events:
        # Force the row's device_id to match the JWT-bound device. The body's
        # device_id field is informational; if a client tries to spoof it
        # we ignore that and use the authenticated identity.
        stmt = (
            pg_insert(AttendanceRecord)
            .values(
                event_id=event.event_id,
                user_id=event.user_id,
                user_name=event.user_name,
                device_id=device_id,  # ← authoritative, not from body
                timestamp=event.timestamp,
                cosine_score=event.cosine_score,
                liveness_passed=event.liveness_passed,
                pad_score=event.pad_score,
                latency_ms=event.latency_ms,
                gps_lat=event.gps_lat,
                gps_lon=event.gps_lon,
                notes=event.notes,
                synced_at=datetime.now(timezone.utc),
            )
            .on_conflict_do_nothing(index_elements=["event_id"])
            .returning(AttendanceRecord.event_id)
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        if row:
            accepted.append(event.event_id)
        else:
            rejected.append(event.event_id)

    await db.commit()

    ack_input = "".join(sorted(accepted + rejected))
    server_ack = hashlib.sha256(ack_input.encode()).hexdigest()

    return AttendanceBatchOut(accepted=accepted, rejected=rejected, server_ack=server_ack)


@router.get("", response_model=list[AttendanceOut])
async def query_attendance(
    user_id: str | None = Query(None),
    device_id_filter: str | None = Query(None, alias="device_id"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(100, le=1000),
    auth: tuple[str, str] = Depends(require_role("admin", "worker", "device")),
    db: AsyncSession = Depends(get_db),
):
    sub, role = auth
    settings = get_settings()
    if date_from and date_to:
        if (date_to - date_from) > timedelta(days=settings.MAX_DATE_RANGE_DAYS):
            raise HTTPException(
                status_code=400,
                detail=f"Date range too large (>{settings.MAX_DATE_RANGE_DAYS} days)",
            )

    stmt = select(AttendanceRecord).order_by(AttendanceRecord.timestamp.desc()).limit(limit)

    # IDOR fix: only admins may read arbitrary identities. A worker is forced to
    # its own user_id and a (legacy) device token to its own device_id — the
    # client-supplied user_id/device_id filters are ignored for non-admins.
    if role == "admin":
        if user_id:
            stmt = stmt.where(AttendanceRecord.user_id == user_id)
        if device_id_filter:
            stmt = stmt.where(AttendanceRecord.device_id == device_id_filter)
    elif role == "worker":
        stmt = stmt.where(AttendanceRecord.user_id == sub)
    else:  # device
        stmt = stmt.where(AttendanceRecord.device_id == sub)

    if date_from:
        stmt = stmt.where(AttendanceRecord.timestamp >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceRecord.timestamp <= date_to)

    result = await db.execute(stmt)
    return result.scalars().all()
