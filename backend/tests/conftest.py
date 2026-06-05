import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///test.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["DEVICE_SHARED_SECRET"] = "test-device-secret"
# The legacy device-token endpoint is disabled (410) by default for security;
# enable it under test so the /auth/token logic is still exercised.
os.environ["DEVICE_TOKEN_ENABLED"] = "true"

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models.attendance import Base
from app.db.session import get_db
from app.main import app

engine_test = create_async_engine("sqlite+aiosqlite:///test.db", echo=False)
TestSession = async_sessionmaker(engine_test, expire_on_commit=False)


async def override_get_db():
    async with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def auth_headers(client):
    from app.auth.jwt import create_access_token
    token = create_access_token("test-device-001")
    return {"Authorization": f"Bearer {token}"}
