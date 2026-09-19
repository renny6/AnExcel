# Backup & Recovery
### Explanation & Rules

See `07-master-rules.md` for the governing principles this must follow.

This file covers **two distinct concerns** that are easy to conflate — keep them separate:

- **Retention policy** (§1) — *intentional*, scheduled deletion of raw images, controlled per-batch by the professor.
- **Backup & disaster recovery** (§2) — protection against *accidental* loss of everything else (database, exports), never something a professor configures.

---

## 1. Retention Policy (Images Only)

- Images are kept only until `images_purge_at`. A daily job auto-deletes past this point.
- Images are compressed on ingestion to reduce storage footprint before this timer even starts mattering.
- **Retention period is chosen by the professor, per batch**, from a fixed list — no "keep forever" option, ever:
  - 1 week / 2 weeks / 1 month / 3 months / 6 months
- **Countdown starts at batch approval**, not upload — images are needed throughout processing/review regardless of the chosen window, so the timer only makes sense once the batch is finalized.
- **Extension**: allowed at any point before expiry (e.g. a dispute comes up). **Shortening**: never allowed once set — no mechanism for it, by design (removes any temptation to quietly reduce a retention window after the fact).
- **Implementation**: prefer native object-storage lifecycle rules (e.g. S3 lifecycle policies) over hand-rolled deletion logic where possible — fewer custom moving parts to get wrong.

**Excel exports are explicitly exempt from all retention rules.** They are kept indefinitely, never auto-deleted, regardless of what retention period was chosen for that batch's images. They are the durable system of record once images are gone, and they are cheap enough (KB-scale) that there is no storage-cost argument for removing them. Do not add a retention setting for exports — this was a deliberate decision, not an oversight.

## 2. Backup & Disaster Recovery (Everything Else)

This protects against accidental loss — a failed deploy, a bad migration, a deleted table, infrastructure failure. It is not configurable by professors and is not affected by the retention settings above.

### 2.1 Database (PostgreSQL)
- **Automated daily snapshots.**
- **Continuous write-ahead-log (WAL) backup**, enabling point-in-time restore — not just restore-to-last-nightly-snapshot. This matters because a bad write (e.g. a buggy migration) discovered hours after it happened shouldn't cost you a full day of data.

### 2.2 Excel Exports (Object Storage)
- **Versioning enabled** on the storage bucket, so an accidental overwrite or delete is recoverable rather than final.

### 2.3 Restore Testing
- Periodically verify a restore actually works end-to-end (not just that backups are being written). An untested backup is not a reliable one — treat "have we test-restored recently" as a real operational checklist item, not a formality.

### 2.4 RPO / RTO Targets
- Define, explicitly, before going live with real student data:
  - **RPO (Recovery Point Objective)** — how much data loss is acceptable if something fails (e.g. "no more than 5 minutes of writes," achievable via WAL backup).
  - **RTO (Recovery Time Objective)** — how fast the system needs to be back up.
- Lean tight on both given this ultimately feeds official academic records — this is not the place to accept a loose target for convenience.

## 3. Monitoring Tie-In

Backup health should appear on the operator dashboard alongside pipeline metrics (see `08-architecture.md` §9 for the rest): confirm snapshot/WAL jobs are actually succeeding, not just scheduled. A silently-failing backup job is worse than no backup job, because it creates false confidence.
