import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, text
from sqlalchemy.orm import Mapped, mapped_column
from pydantic import BaseModel, Field

from app.models.attendance import Base


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(128))
    mobile: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    # Width: 80 = `v2$` (3) + 64-hex HMAC-SHA256 + room for future scheme bumps
    # (`v3$...` etc) without another schema migration. See migration 003.
    aadhar_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    aadhar_salt: Mapped[str] = mapped_column(String(64))
    face_template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


# ---------- Pydantic ----------

class AdminSignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    mobile: str = Field(min_length=10, max_length=15)
    aadhar: str = Field(min_length=12, max_length=20)
    face_template_id: str | None = None


class AdminLoginIn(BaseModel):
    mobile: str = Field(min_length=10, max_length=15)
    aadhar: str = Field(min_length=12, max_length=20)
    face_template_id: str | None = None


class AdminOut(BaseModel):
    id: str
    name: str
    mobile: str
    aadhar_masked: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    admin: AdminOut
