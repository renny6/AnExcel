# Architecture
### Explanation & Rules

See `07-master-rules.md` for the governing principles this architecture must follow.

---

## 1. Layers

Five layers: ingestion, preprocessing/alignment, extraction & validation, human review, export & delivery.

```
Upload & ingestion
      ↓
Preprocessing (deskew, align to fixed template)
      ↓
Extraction & validation (crop, recognize, cross-check)
      ↓
Review queue (only flagged sheets; manual-entry fallback always available)
      ↓
Export & SEMS (Excel always; SEMS push once built)
```

## 2. Pipeline Stages — Detail

1. **Upload & ingestion** — PDF (multi-page) or a batch of images (up to ~100, see `11-apis-and-limits.md` for caps). Each page/image = exactly one student's front page. Expected student count = number of pages/images submitted; no manual count entry.
2. **Preprocessing & alignment** — deskew, then align to the **single, fixed** Anna University template (one template covers every college/year — confirmed, no variant handling needed) using reference points (corners/gridlines/logo position — homography/perspective correction). Low alignment confidence → stop, flag page as unreadable, route to manual entry rather than forcing a bad crop downstream.
3. **Extraction & validation** — crop known field regions (register number boxes, marks grid cells), recognize each crop.
   - **v1 approach**: every crop (digits, ticks, handwritten marks) goes to a vision-capable LLM. Simpler to build first; produces real accuracy/cost data that decides whether dedicated lightweight recognizers (digit classifier, tick detector) are worth building later.
   - **Cross-validation**: recompute Part A total from its questions, each Part B/C question's total from its sub-parts, and the grand total from both parts. Mismatch → flag for review. This is the backstop that catches errors even if a field was misread with false confidence.
   - **Watermark handling**: the diagonal stamp sits in a consistent position relative to the template — treat it as a known zone during alignment, not a dynamic detection problem. Confirm across more real samples whether it ever clips into the marks grid; if so, mark those specific cells for extra scrutiny.
4. **Review queue** — only flagged/failed sheets need attention; everything else auto-approves.
   - **Duplicate detection**: two sheets resolving to the same register number → flagged, professor picks the correct one.
   - **Missing pages**: any page that didn't produce a valid register number is surfaced explicitly.
   - **Manual fallback**: any flagged/failed sheet gets a "switch to manual entry" option — register number, total marks, subject (inherited by default) typed directly. Source image (if any) stays visible alongside. Manually entered sheets still go through duplicate detection and still count toward reconciliation.
5. **Progress & completion notification** — live progress bar computed from actual sheet statuses (never a separately-incremented counter). In-app toast + browser Notification API on completion.
6. **Approve & finalize** — explicit, deliberate confirmation (not implicit from clicking through the queue) locks the batch and triggers export generation.
7. **Export** — direct download, or (v2) SEMS adapter push.
8. **Batch history** — permanently browsable, audit trail intact, even after source images are purged.

## 3. Excel Output Schema

One row per student:

| Column | Notes |
|---|---|
| Register Number | |
| Subject Code | |
| Subject Name | |
| Total Marks | |
| Status | `Auto`, `Reviewed`, or `Manual` |

No per-question breakdown in the export — internal database only.

## 4. Class/Subject Grouping

- Auto-group by the first 8 digits of register number (college + branch + batch code).
- Professor declares subject/course/batch name before upload; cross-checked against extracted subject code, mismatches flagged.
- Arrear/backlog students (prefix doesn't match) — out of scope for v1 (see `07-master-rules.md` §9).

## 5. Data Model

- **Professor** — account, identity from auth module. Single role. Every batch scoped to its owning professor.
- **Batch** — professor ref, declared subject/course/batch name, retention_period, images_purge_at, status.
- **AnswerSheet** — register number, batch ref, image ref, status (`processing` → `needs_review`/`auto_approved`/`manual`/`failed` → `reviewed` → `exported`). Keyed off image storage reference (upsert, not insert) for idempotency.
- **QuestionMark** — per-question/sub-part: question no., marks, tick state, confidence score, source. Internal only.
- **AuditLogEntry** — who changed what, when, on which sheet. Tamper-evident, not a plain editable table.

`Batch.status` is an explicit state machine. Export only ever pulls from `reviewed`/`auto_approved`/`manual` sheets, never `processing`.

## 6. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React (Next.js) | Web app + PWA for camera capture; API routes for light backend needs |
| Core processing service | Python (FastAPI) | OpenCV ecosystem for alignment/cropping far ahead of JS's |
| Job queue | Redis + Celery | Async, parallel batch processing; built-in retry w/ backoff |
| Database | PostgreSQL | Relational fits batch/student/marks/audit model cleanly |
| Object storage | S3-compatible (AWS S3 or self-hosted MinIO) | Lifecycle rules implement retention/auto-purge directly |
| Extraction | Vision-capable LLM API + OpenCV | v1 simplicity; revisit with dedicated models once real data exists |
| Excel generation | openpyxl | Same language as processing service |
| Auth | Custom session provider, pluggable | See `09-security-master.md` |
| Hosting | Single modest cloud instance + managed Postgres + S3 | Sufficient for v1 |
| CI/CD | GitHub Actions (or equivalent) | Unit tests + golden-sample regression on every change; staging auto-deploy, manual production promotion |

**Platform**: responsive web app (PWA), not native. Standard browser file/camera APIs cover the actual interaction needs.

**Environments**: dev / staging / production — separate databases, buckets, accounts. See `07-master-rules.md` §8.

## 7. Testing

- **Golden-sample regression set** — permanent collection of real, manually-verified-correct sample sheets. Every extraction/alignment/prompt change is rerun against this set before shipping. Grows as real misreads surface in production.
- **Unit tests** for deterministic logic — cross-validation math, duplicate detection, status transitions.
- **One end-to-end test** simulating a full batch (upload → process → review → export).

## 8. SEMS Integration (v2, currently unbuilt)

Mechanism unknown (bulk upload vs. manual-entry-only form vs. API — depends on actual access granted). Whatever it is, it consumes a finalized Excel export and pushes totals into SEMS — never touches capture, alignment, extraction, or review. Until built, the professor submits manually; the product is fully functional without it.

## 9. Detailed Flow — Stage → Tools

| Stage | What happens | Tools/tech involved |
|---|---|---|
| Login | Professor authenticates | Next.js login page → auth service → session stored |
| Start/resume batch | Name batch, declare subject/course, pick retention period | Next.js form → API route → Postgres (`Batch`) |
| Upload | Client-side quality check per file; HEIC auto-converted; direct upload | Browser JS check → presigned upload → S3/MinIO; `AnswerSheet` row logged |
| Processing kickoff | Job queued per sheet | FastAPI trigger → Redis queue → Celery workers (idempotent, retry w/ backoff) |
| Alignment & cropping | Deskew, align, crop fields | Python worker + OpenCV |
| Extraction | Each crop recognized | Python worker → vision LLM API → `QuestionMark` rows |
| Cross-validation | Totals recomputed, compared | Worker logic → sets sheet status |
| Progress updates | Live counter | Backend computed from statuses → frontend live connection → progress bar |
| Completion signal | Batch done | In-app toast + browser Notification API |
| Review queue | Corrections or manual entry | Next.js UI (S3 image + editable fields) → API → Postgres + `AuditLogEntry` |
| Approve & finalize | Explicit lock | API sets `Batch.status = approved` → triggers export |
| Excel generation | Workbook built | Python worker + openpyxl → S3 |
| Export/download | File delivered | Presigned S3 URL; (v2) SEMS adapter |
| Batch history | Always browsable | Postgres query → Excel permanently on S3 |
| Retention purge (bg) | Old images deleted | Celery beat job / S3 lifecycle rule |
| Backups (bg) | Continuous protection | See `10-backup-recovery.md` |
| Monitoring (bg) | Operator visibility | See `10-backup-recovery.md` §Monitoring |
| CI/CD (bg) | Change validation | Tests → staging → manual production promotion |

## 10. MVP Scope (v1) vs. Later

**Build now:** auth + session security, PDF/image upload with constraints, alignment/extraction/cross-validation, review queue with manual fallback, Excel export, retention + purge job, batch history, testing + CI/CD, backups + monitoring.

**Defer:** SEMS adapter, real Anna University auth swap-in, dedicated lightweight recognizers (only if data justifies it), arrear-student handling, correction-feedback capture.
