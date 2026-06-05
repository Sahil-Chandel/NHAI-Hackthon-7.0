# NHAI Face Authentication System

> **Hackathon 7.0 Submission** | Participant: PramIQ Solutions | Theme: AI-based Face Authentication for Highway Workers

On-device AI face recognition for NHAI highway workforce attendance — offline-first, privacy-preserving, built for Indian demographics. Works on Rs 12,000 phones with <300ms latency.

## 🎥 Demo Videos

**📽️ Pitch Deck** — problem, solution & impact (2:17)

https://github.com/user-attachments/assets/683d9cca-107a-47d5-9b51-bf5f6ba8fa67

**📱 App Demo** — the working app in action: [▶️ Watch the demo (MP4)](https://github.com/Sahil-Chandel/NHAI-Hackthon-7.0/releases/download/demo-assets/demo_web.mp4)

📊 **Slides:** [NHAI Hackathon 7.0 Pitch Deck (PDF)](./NHAI%20Hackathon%207.0%20Pitch%20Deck.pdf)

---

> ⚠️ **PROPRIETARY — Copyright © 2026 PramIQ Solutions. All Rights Reserved.**
>
> This repository is **source-available for NHAI Hackathon 7.0 evaluation only — it is NOT open-source.**
> **Unauthorized cloning, copying, forking, use, modification, or distribution is strictly prohibited** and
> constitutes copyright infringement under the **Indian Copyright Act, 1957 (Sections 63–65 — civil & criminal
> liability)** and international treaties (Berne Convention). Any use requires the author's **prior written
> permission**. The author reserves the right to pursue **legal action** against unauthorized use. See [LICENSE](./LICENSE).

---

## Problem

NHAI manages 1,50,000+ highway workers across India. Current biometric attendance is fraud-prone (buddy punching, ghost workers), costing an estimated Rs 230 Cr annually. Existing systems need constant connectivity, expensive hardware, and fail outdoors.

## Solution

A mobile-first face authentication system that:
- Runs **entirely on-device** — no cloud dependency for recognition
- Works **offline** with automatic sync when connectivity resumes
- Defeats **spoofing** with 2-layer liveness (passive PAD + active challenges)
- Protects **privacy** with ISO/IEC 24745 cancellable BioHashing
- Supports **Hindi + English** with offline voice prompts
- Enables **OTA model updates** without Play Store resubmission

## Architecture

```
Camera Frame
    |
    v
+------------------+     +------------------+     +------------------+
| YuNet Detection  | --> | Face Alignment   | --> | EdgeFace-XS      |
| (100KB INT8)     |     | (Affine Warp)    |     | (512-d Embedding)|
+------------------+     +------------------+     +------------------+
                                                         |
    +----------------------------------------------------+
    |                        |                            |
    v                        v                            v
+------------------+  +------------------+  +------------------+
| MiniFASNet PAD   |  | Active Liveness  |  | BioHash + Match  |
| (Passive Spoof)  |  | (Blink/Turn/Smile)|  | (Cosine Sim)    |
+------------------+  +------------------+  +------------------+
                              |
                              v
                    +------------------+
                    | Attendance Event |
                    | (Offline Queue)  |
                    +------------------+
                              |
                              v
                    +------------------+
                    | FastAPI Backend   |
                    | PostgreSQL + Grafana|
                    +------------------+
```

## Project Structure

```
NhaiHackthon-7/
├── frontend/              # React Native 0.85.3 (Android)
│   ├── src/
│   │   ├── app/           # Screens, navigation, hooks, components
│   │   ├── ml/            # Pipeline, challenges, processors, thresholds
│   │   ├── storage/       # SQLite, vectorMatch, crypto (BioHash, keyManager)
│   │   ├── sync/          # Offline queue, retry, connectivity watcher
│   │   ├── ota/           # Firebase OTA model downloader + Ed25519 verifier
│   │   └── i18n/          # Hindi + English translations
│   ├── assets/models/     # YuNet, EdgeFace-XS, MiniFASNet TFLite models
│   └── tests/             # Jest unit (46 tests) + Detox E2E
├── backend/
│   ├── app/               # FastAPI routes, JWT auth, Play Integrity
│   ├── ml/                # Model conversion, fine-tuning, quantization
│   ├── notebooks/         # Fine-tune + evaluation Jupyter notebooks
│   ├── dashboards/        # Grafana NHAI HQ dashboard JSON
│   └── tests/             # pytest (13 tests)
└── docs/                  # Proposal, architecture, threat model, benchmarks
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native 0.85.3, TypeScript, VisionCamera v4.7.3 |
| ML Inference | react-native-fast-tflite (TFLite INT8, GPU/NNAPI delegate) |
| Detection | YuNet INT8 (~100KB) |
| Recognition | EdgeFace-XS INT8 (~2MB, 512-d embeddings) |
| Anti-Spoof | MiniFASNet V2 + V1SE (passive PAD, dual-model) |
| Liveness | Active challenges: blink, head-turn, smile (random 3-of-4 sequence) |
| Local DB | SQLite + SQLCipher (AES-256 encrypted) |
| Key Storage | react-native-sensitive-info (StrongBox/Keystore hardware-backed) |
| Template Security | Cancellable BioHashing (ISO/IEC 24745) |
| Backend | FastAPI, async SQLAlchemy, asyncpg, PostgreSQL |
| Auth | JWT (HS256, 15-min expiry) + Play Integrity API |
| Sync | Offline queue + exponential backoff (1-16s, jittered) |
| OTA | Firebase Remote Config + Ed25519 signed .tflite delivery |
| Observability | Prometheus + Grafana (4-panel NHAI HQ dashboard) |
| i18n | Hindi + English, offline Pico TTS voice prompts |
| UI | AAA outdoor mode (WCAG AAA 7:1 contrast, 18pt+ fonts) |

## Key Differentiators

1. **Signed OTA Model Updates** — Push improved .tflite models via Firebase without Play Store resubmission. Ed25519 signature verification prevents tampering.
2. **Hardware-Backed Security** — SQLCipher master key stored in StrongBox/Secure Enclave (TEE). Key never leaves hardware.
3. **Play Integrity API** — Reject rooted, emulated, or tampered devices server-side.
4. **Adaptive Threshold** — Per-user verification threshold (mu - 2*sigma after N>=20 samples). Reduces FRR ~30%.
5. **Cancellable BioHashing** — ISO/IEC 24745 compliant. Biometric templates are irrecoverable; can be revoked and re-issued.
6. **NHAI HQ Dashboard** — Real-time Grafana dashboard: compliance %, latency p95, attendance events, device distribution.

## Quick Start

### Prerequisites
- Node.js 20+, Java JDK 17, Android Studio (SDK 34)
- Python 3.11+, PostgreSQL 15+

### Frontend (Android)
```bash
cd frontend
npm install --legacy-peer-deps
npx react-native run-android
```

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # or: pip install fastapi sqlalchemy asyncpg python-jose pydantic-settings alembic
cp .env.example .env              # configure DATABASE_URL, JWT_SECRET
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Docker (Backend + DB + Monitoring)
```bash
cd backend
docker compose up -d
# API: http://localhost:8000
# Grafana: http://localhost:3000 (admin/admin)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/token | Device auth (shared_secret -> JWT) |
| POST | /api/v1/attendance | Batch sync attendance events (idempotent) |
| GET | /api/v1/attendance | Query attendance (filters: user_id, date range) |
| GET | /api/v1/healthz | Health check |
| GET | /metrics | Prometheus metrics |

## Test Results

```
Frontend: 5 suites, 46 tests passed
  - vectorMatch, blink, challengeEngine, retryPolicy, syncWorker
  - Coverage: 81.9% statements, 95.7% functions

Backend: 13 tests passed
  - JWT auth, batch insert, idempotency, Pydantic validation, date queries
```

## Security & Compliance

- **DPDPA 2023** — Biometric data processed on-device; only hashed templates stored; purpose limitation enforced
- **ISO/IEC 24745** — Cancellable BioHashing with per-user random orthonormal projection
- **MeitY FOSS** — All dependencies MIT/Apache-2.0/BSD-3 (zero GPL/commercial)
- **UIDAI** — Template protection aligns with Aadhaar authentication guidelines

## License

**Proprietary — Copyright © 2026 PramIQ Solutions. All Rights Reserved.**

This project is **source-available for NHAI Hackathon 7.0 evaluation only** and is **NOT** released under any
open-source license (MIT/Apache/etc.). No permission is granted to copy, clone, fork, use, modify, or distribute
the source code, models, documentation, slides, or demo video without the author's **prior written consent**.
Unauthorized use constitutes copyright infringement under the **Indian Copyright Act, 1957 (Sections 63–65)** and may
result in **civil and criminal liability**. Full terms: [LICENSE](./LICENSE).

> Third-party dependencies remain under their own open-source licenses (MIT / Apache-2.0 / BSD-3). This proprietary
> notice applies to the original work in this repository.
