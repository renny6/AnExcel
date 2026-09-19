You are building AnExcel (if there are any metion of markflow, just know that the name has been changed to AnExcel) — a tool for Anna University professors to convert scanned/photographed answer-sheet front pages into a clean Excel mark sheet, with a future SEMS submission integration.

Before writing any code, read every document in this repo, in this order, and treat them as the complete and authoritative source of truth for this build:

1. 01-PRD.md — what we're building and for whom
2. 02-TRD.md — tech stack and tools
3. 03-App-Flow.md — every screen and navigation path
4. 04-UI-UX-Design-Brief.md — visual design system (hard constraint: no purple, no green, anywhere)
5. 05-Backend-Schema.md — data model, relationships, auth/access rules
6. 06-Implementation-Plan.md — the exact build order, phase by phase
7. 07-master-rules.md, 08-architecture.md, 09-security-master.md, 10-backup-recovery.md, 11-apis-and-limits.md — the governing engineering rules and detailed rationale behind everything above

Ground rules — do not deviate from these without asking me first:

- Follow the Implementation Plan's phase order exactly. Do not start a later phase before the current one is genuinely done.
- The entire application must run containerized via Docker Compose (Postgres, Redis, object storage, frontend, backend services) from the very first commit — nothing should require a locally-installed database or queue.
- Initialize this as a git repository with a sensible .gitignore before writing any application code, and make a commit at the end of each completed phase.
- Every per-sheet processing job must be idempotent — safe to retry without duplicating data. See 07-master-rules.md §2.
- Vision API calls happen only from queued background jobs, never synchronously inside a user-facing request. See 11-apis-and-limits.md §2.
- Use only the test-account login system defined in 05-Backend-Schema.md — no real Anna University credentials exist yet, and no code should assume a specific real auth mechanism.
- Single role only: professor. No admin/HOD tier, no permission matrix.
- Do not build anything listed as Out of Scope in 01-PRD.md or §9 of 07-master-rules.md.
- No purple, no green, anywhere in the UI — including status colors. Use the palette in 04-UI-UX-Design-Brief.md exactly.
- If anything here is ambiguous, underspecified, or you'd have to guess to proceed, stop and ask me rather than making an assumption.

Start with Phase 1 of 06-Implementation-Plan.md: git init, Docker Compose setup, folder structure, and .env.example.
