import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, Boolean, Integer, ForeignKey, text
from sqlalchemy.orm import Mapped, mapped_column
from pydantic import BaseModel, Field

from app.models.attendance import Base


class PunchEvent(Base):
    __tablename__ = "punch_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    worker_id: Mapped[str] = mapped_column(String(64), ForeignKey("workers.id"), index=True)
    type: Mapped[str] = mapped_column(String(8))  # 'in' or 'out'
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    gps_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    face_match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    liveness_passed: Mapped[bool] = mapped_column(Boolean, default=True)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sync_attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


# ---------- Pydantic ----------

class PunchEventIn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str = Field(pattern="^(in|out)$")
    timestamp: datetime
    gps_lat: float | None = None
    gps_lon: float | None = None
    gps_accuracy: float | None = None
    face_match_score: float | None = None
    liveness_passed: bool = True
    device_id: str | None = None


class PunchEventBatchIn(BaseModel):
    events: list[PunchEventIn]


class PunchEventBatchOut(BaseModel):
    accepted: list[str]
    rejected: list[str]


class PunchEventOut(BaseModel):
    id: str
    worker_id: str
    type: str
    timestamp: datetime
    gps_lat: float | None
    gps_lon: float | None
    face_match_score: float | None
    liveness_passed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AttendanceSummary(BaseModel):
    """Per-day rollup for calendar view."""
    date: str  # YYYY-MM-DD
    punch_in: datetime | None
    punch_out: datetime | None
    duration_minutes: int | None
    status: str  # 'full' | 'partial' | 'absent'
