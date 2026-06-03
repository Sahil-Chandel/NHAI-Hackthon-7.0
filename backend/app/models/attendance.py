import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, Boolean, Text, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from pydantic import BaseModel, Field


class Base(DeclarativeBase):
    pass


class AttendanceRecord(Base):
    __tablename__ = "attendance"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    user_name: Mapped[str] = mapped_column(String(128))
    device_id: Mapped[str] = mapped_column(String(128), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cosine_score: Mapped[float] = mapped_column(Float)
    liveness_passed: Mapped[bool] = mapped_column(Boolean, default=True)
    pad_score: Mapped[float] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=True)
    gps_lat: Mapped[float] = mapped_column(Float, nullable=True)
    gps_lon: Mapped[float] = mapped_column(Float, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class AttendanceEventIn(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    user_name: str
    device_id: str
    timestamp: datetime
    cosine_score: float
    liveness_passed: bool = True
    pad_score: float | None = None
    latency_ms: float | None = None
    gps_lat: float | None = None
    gps_lon: float | None = None
    notes: str | None = None


class AttendanceBatchIn(BaseModel):
    events: list[AttendanceEventIn]


class AttendanceBatchOut(BaseModel):
    accepted: list[str]
    rejected: list[str]
    server_ack: str


class AttendanceOut(BaseModel):
    event_id: str
    user_id: str
    user_name: str
    device_id: str
    timestamp: datetime
    cosine_score: float
    liveness_passed: bool
    pad_score: float | None
    latency_ms: float | None
    gps_lat: float | None
    gps_lon: float | None
    synced_at: datetime
    notes: str | None

    model_config = {"from_attributes": True}
