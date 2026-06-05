from datetime import datetime, timedelta, timezone
from collections import defaultdict

# India Standard Time — attendance days/months must be bucketed in IST, not UTC,
# or punches in the first ~5.5h of an IST day fall into the previous UTC day.
IST = timezone(timedelta(hours=5, minutes=30))
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.models.punch_event import (
    PunchEvent,
    PunchEventBatchIn,
    PunchEventBatchOut,
    PunchEventOut,
    AttendanceSummary,
)
from app.models.worker import Worker
from app.auth.jwt import (
    get_current_worker,
    get_current_admin,
    bearer_scheme,
    _decode,
)
from app.security.middleware import limiter

router = APIRouter(prefix="/api/v1/punch", tags=["punch"])


def _enforce_date_range(date_from: datetime | None, date_to: datetime | None) -> None:
    """Reject queries whose date span exceeds `MAX_DATE_RANGE_DAYS` to prevent
    accidental (or hostile) full-table scans."""
    if date_from and date_to:
        cap = get_settings().MAX_DATE_RANGE_DAYS
        if (date_to - date_from) > timedelta(days=cap):
            raise HTTPException(
                status_code=400,
                detail=f"Date range too large (>{cap} days)",
            )


@router.post("/sync", response_model=PunchEventBatchOut)
@limiter.limit("60/minute")
async def sync_punch_events(
    payload: PunchEventBatchIn,
    request: Request,
    worker_id: str = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    """Worker uploads pending punch events from local SQLite. Idempotent on event id."""
    accepted: list[str] = []
    rejected: list[str] = []

    if not payload.events:
        return PunchEventBatchOut(accepted=[], rejected=[])

    if len(payload.events) > get_settings().MAX_PUNCH_BATCH_EVENTS:
        raise HTTPException(
            status_code=413,
            detail=f"Batch too large (>{get_settings().MAX_PUNCH_BATCH_EVENTS} events)",
        )

    for ev in payload.events:
        if ev.type not in ("in", "out"):
            rejected.append(ev.id)
            continue
        stmt = (
            pg_insert(PunchEvent)
            .values(
                id=ev.id,
                worker_id=worker_id,  # override with JWT worker_id for security
                type=ev.type,
                timestamp=ev.timestamp,
                gps_lat=ev.gps_lat,
                gps_lon=ev.gps_lon,
                gps_accuracy=ev.gps_accuracy,
                face_match_score=ev.face_match_score,
                liveness_passed=ev.liveness_passed,
                device_id=ev.device_id,
            )
            .on_conflict_do_nothing(index_elements=["id"])
            .returning(PunchEvent.id)
        )
        result = await db.execute(stmt)
        inserted = result.scalar_one_or_none()
        if inserted is None:
            rejected.append(ev.id)
        else:
            accepted.append(ev.id)

    await db.commit()
    return PunchEventBatchOut(accepted=accepted, rejected=rejected)


@router.get("/me", response_model=list[PunchEventOut])
async def my_punches(
    worker_id: str = Depends(get_current_worker),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(500, le=2000),
    db: AsyncSession = Depends(get_db),
):
    _enforce_date_range(date_from, date_to)
    stmt = select(PunchEvent).where(PunchEvent.worker_id == worker_id)
    if date_from is not None:
        stmt = stmt.where(PunchEvent.timestamp >= date_from)
    if date_to is not None:
        stmt = stmt.where(PunchEvent.timestamp <= date_to)
    stmt = stmt.order_by(PunchEvent.timestamp.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [PunchEventOut.model_validate(r) for r in rows]


@router.get("/worker/{worker_id}", response_model=list[PunchEventOut])
async def admin_view_worker_punches(
    worker_id: str,
    admin_id: str = Depends(get_current_admin),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(500, le=2000),
    db: AsyncSession = Depends(get_db),
):
    _enforce_date_range(date_from, date_to)
    # Verify worker belongs to this admin
    worker = (
        await db.execute(
            select(Worker).where(Worker.id == worker_id, Worker.admin_id == admin_id)
        )
    ).scalar_one_or_none()
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found under your admin scope")

    stmt = select(PunchEvent).where(PunchEvent.worker_id == worker_id)
    if date_from is not None:
        stmt = stmt.where(PunchEvent.timestamp >= date_from)
    if date_to is not None:
        stmt = stmt.where(PunchEvent.timestamp <= date_to)
    stmt = stmt.order_by(PunchEvent.timestamp.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [PunchEventOut.model_validate(r) for r in rows]


@router.get("/summary/{worker_id}", response_model=list[AttendanceSummary])
async def attendance_summary(
    worker_id: str,
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Per-day rollup for a worker for the given YYYY-MM.

    Authorised callers:
      - The worker themselves (token sub == worker_id, role == 'worker').
      - The admin who owns this worker (token role == 'admin' AND
        worker.admin_id == admin_id).
    Anyone else → 403.
    """
    payload = _decode(credentials)
    sub = payload.get("sub")
    role = payload.get("role")
    if not sub or not role:
        raise HTTPException(status_code=401, detail="Invalid token")

    if role == "worker":
        if sub != worker_id:
            raise HTTPException(status_code=403, detail="Cannot view another worker's attendance")
    elif role == "admin":
        worker = (
            await db.execute(
                select(Worker).where(Worker.id == worker_id, Worker.admin_id == sub)
            )
        ).scalar_one_or_none()
        if worker is None:
            raise HTTPException(status_code=403, detail="Worker not under your admin scope")
    else:
        raise HTTPException(status_code=403, detail="Role not allowed")

    year, mo = map(int, month.split("-"))
    start = datetime(year, mo, 1, tzinfo=IST)
    if mo == 12:
        end = datetime(year + 1, 1, 1, tzinfo=IST)
    else:
        end = datetime(year, mo + 1, 1, tzinfo=IST)

    rows = (
        await db.execute(
            select(PunchEvent)
            .where(
                PunchEvent.worker_id == worker_id,
                PunchEvent.timestamp >= start,
                PunchEvent.timestamp < end,
            )
            .order_by(PunchEvent.timestamp.asc())
        )
    ).scalars().all()

    per_day: dict[str, list[PunchEvent]] = defaultdict(list)
    for r in rows:
        # Bucket by the IST calendar date (timestamps are stored UTC/aware).
        ts = r.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        date_key = ts.astimezone(IST).date().isoformat()
        per_day[date_key].append(r)

    out: list[AttendanceSummary] = []
    for date_key, events in sorted(per_day.items()):
        punch_in = next((e.timestamp for e in events if e.type == "in"), None)
        punch_out = next((e.timestamp for e in reversed(events) if e.type == "out"), None)
        duration: int | None = None
        if punch_in is not None and punch_out is not None and punch_out > punch_in:
            duration = int((punch_out - punch_in).total_seconds() / 60)
        if punch_in and punch_out:
            status_str = "full"
        elif punch_in:
            status_str = "partial"
        else:
            status_str = "absent"
        out.append(
            AttendanceSummary(
                date=date_key,
                punch_in=punch_in,
                punch_out=punch_out,
                duration_minutes=duration,
                status=status_str,
            )
        )
    return out
