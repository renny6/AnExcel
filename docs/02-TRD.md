# 02 — TRD (Technical Requirements Document)

| Document 02 — TRD | |
|---|---|
| **Frontend** | Next.js (React) with TypeScript, Tailwind CSS |
| **Backend** | Two services: Next.js API routes for lightweight CRUD (batches, auth, history) + a Python/FastAPI core processing service for the extraction pipeline (alignment, cropping, recognition, cross-validation) |
| **Database** | PostgreSQL, run as a container in Docker Compose |
| **Job Queue** | Redis + Celery — async, parallel per-sheet processing; built-in retry with backoff |
| **Object Storage** | S3-compatible: MinIO container for local dev, real S3-compatible bucket (AWS S3 or equivalent) for production. Lifecycle rules implement image retention/auto-purge directly. |
| **Auth** | Custom session-based provider, built behind a single pluggable interface. v1 uses a test-account login (several accounts spanning different colleges/departments); v2 swaps in real Anna University credentials without touching anything downstream. |
| **Hosting** | Fully containerized via Docker Compose for local dev; a single modest cloud instance + managed Postgres + S3-compatible storage for production, sufficient at this scale. |
| **Third-party APIs** | Google Gemini API (Flash model), **free tier** — used for reading cropped fields (register number digits, tick marks, handwritten marks). No credit card required. Free-tier limits are roughly 15 RPM / ~1,500 RPD on Flash as of project setup, but verify current numbers in Google AI Studio for your own project, since these are adjusted by Google over time. |
| **Key Libraries** | OpenCV (template alignment, deskew, cropping) · openpyxl (Excel generation) · PgBouncer (Postgres connection pooling) · a HEIC→JPEG conversion library (for iPhone photo uploads) |
| **Folder Structure & Naming** | `/frontend` (Next.js app) · `/backend-api` (Next.js API routes or a thin service layer) · `/processing-service` (FastAPI + Celery workers) · `/infra` (Docker Compose files, migrations) · snake_case for DB columns/tables, camelCase for TS, snake_case for Python |
| **Environment Variables Needed** | `DATABASE_URL` · `REDIS_URL` · `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` · `VISION_API_KEY` · `SESSION_SECRET` · `NODE_ENV` / `ENVIRONMENT` (dev/staging/production) |
| **Hard Constraints** | Must run fully containerized via Docker Compose from the first commit · must work end-to-end using only test-account auth (no real Anna University access yet) · single-role access model only — no admin/HOD permission tier · every per-sheet processing job must be idempotent (safe to retry without duplicating data) · vision API calls only happen from queued background jobs, never synchronously in a user request |
