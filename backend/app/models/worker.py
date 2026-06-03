import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, ForeignKey, text
from sqlalchemy.orm import Mapped, mapped_column
from pydantic import BaseModel, Field

from app.models.attendance import Base


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128), index=True)
    # Width: 80 = `v2$` (3) + 64-hex HMAC-SHA256 + room for future scheme bumps
    # (`v3$...` etc) without another schema migration. See migration 003.
    aadhar_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    aadhar_salt: Mapped[str] = mapped_column(String(64))
    face_template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    admin_id: Mapped[str] = mapped_column(String(64), ForeignKey("admins.id"), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


# ---------- Pydantic ----------

class WorkerCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    aadhar: str = Field(min_length=12, max_length=20)
    face_template_id: str | None = None


class WorkerLoginIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    aadhar: str = Field(min_length=12, max_length=20)


class WorkerOut(BaseModel):
    id: str
    name: str
    aadhar_masked: str
    admin_id: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkerTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    worker: WorkerOut


# ---------- Datalake 3.0 self-onboarding ----------

class WorkerVerifyIn(BaseModel):
    """Self-onboarding worker identity, matched against the Datalake 3.0
    registry (data_lake_3.db). All four fields must match a registry row."""
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)
    mobile: str = Field(min_length=6, max_length=20)
    email: str = Field(min_length=3, max_length=128)


class FaceRegisterIn(BaseModel):
    """One-time face registration payload sent after the 3-angle enrollment.
    `embedding` is the averaged 512-d face vector; it is dual-written into the
    worker's Datalake registry row."""
    face_template_id: str = Field(min_length=1, max_length=64)
    embedding: list[float] = Field(min_length=1, max_length=1024)


class FaceRegisterOut(BaseModel):
    ok: bool
    worker_id: str
    face_template_id: str
    data_lake_updated: bool
