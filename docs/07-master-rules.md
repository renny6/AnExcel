# Master Rules
### Anna University Answer Sheet → Excel Converter

This is the entry-point document. Read this first — it states the non-negotiable principles every other file and every part of the build must follow. The other four documents (architecture, backup & recovery, security, APIs & limits) go into detail; this one states the rules that govern all of them.

---

## 1. The boundary rule

```
Auth (pluggable) → Core pipeline (upload → extract → review → export) → SEMS (pluggable, v2)
```

The **core pipeline is the product.** Authentication and SEMS integration are separate modules attached at the front and back. This is not a suggestion — no code in the core pipeline may depend on which auth implementation is active or whether SEMS integration exists yet. Both are swapped in behind fixed interfaces (see `09-security-master.md` §Auth, and `08-architecture.md` §SEMS).

## 2. Idempotency is mandatory, not optional

Every per-sheet processing job must be safe to retry without side effects. Concretely:
- Jobs are keyed off the image's storage reference and **upsert**, never blind-insert.
- A job that fails after retries is exhausted moves to a `failed` status — it never gets silently dropped, and it never gets silently duplicated on a retry.
- Any counter shown to the user (progress bars, batch totals) is **computed from real state at read time**, never maintained as a separately incremented value that can drift.

## 3. Human review is the safety net — never bypass it

Unreconciled data (a sheet whose totals don't cross-check, or whose fields are low-confidence) never reaches an export. There is no "auto-submit everything" path. The review queue is not an optional UI nicety — it is the control that makes the rest of the automation trustworthy.

## 4. No sheet may permanently block a batch

Every flagged or failed sheet has a manual-entry escape hatch (see `08-architecture.md` §2.1, Review queue). A professor can always finish a batch by hand-entering the stubborn sheet rather than being stuck.

## 5. Images are temporary; Excel exports are permanent

Retention timers apply only to raw scanned images, never to finalized Excel exports. Exports are the durable system of record and are never auto-deleted. Full detail in `10-backup-recovery.md`.

## 6. Single role, ownership-based access

There is no admin or HOD tier. The only access rule in the entire system is: a professor can see and act on their own batches, full stop. Do not build a permission matrix — there isn't one.

## 7. External API calls never happen synchronously in a user-facing request

Anything that calls an external service with rate limits (chiefly the vision LLM API) goes through the job queue. A user action (e.g. clicking "upload") never directly triggers a blocking external call — it enqueues a job. Full detail in `11-apis-and-limits.md`.

## 8. Environment separation is mandatory

Dev, staging, and production are separate databases, storage buckets, and account sets. Test-phase data must never be able to reach anything resembling a production record. New extraction/alignment logic is validated in staging against the golden-sample regression set (`08-architecture.md` §Testing) before production promotion.

## 9. Deliberately out-of-scope — do not build these

These were discussed and explicitly rejected, not overlooked. Do not add them without a fresh conversation about why:
- Onboarding flow
- Admin/HOD role or any permission tier beyond professor-ownership
- Correction-feedback capture for retraining extraction models
- Arrear/backlog student auto-handling (register number outside batch prefix)
- Deep DPDP/data-protection compliance work (tool is private, professor-only, limited scope — revisit only if that scope changes)

## 10. Document index

**Vibe-coding docs (read these first, in order):**
- `00-master-prompt.md` — the prompt to paste into Antigravity to start the build
- `01-PRD.md` — what we're building and for whom
- `02-TRD.md` — tech stack and tools
- `03-App-Flow.md` — every screen and navigation path
- `04-UI-UX-Design-Brief.md` — visual design system
- `05-Backend-Schema.md` — data model, relationships, auth/access rules
- `06-Implementation-Plan.md` — the exact build order, phase by phase

**Rule files (governing detail behind the above):**
- `07-master-rules.md` — this file
- `08-architecture.md` — pipeline stages, data model, tech stack, detailed flow
- `09-security-master.md` — auth, sessions, access model, file constraints
- `10-backup-recovery.md` — retention policy vs. backup/DR, RPO/RTO
- `11-apis-and-limits.md` — every external dependency and how limits are avoided

