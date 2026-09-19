# Security Master File

See `07-master-rules.md` for the governing principles this must follow.

---

## 1. Authentication — pluggable by design

Every part of the app downstream of login depends only on a **stable identity object** (ID, name, college/department) — never on how that identity was verified. This is the rule that makes swapping auth implementations safe.

- **`POST /api/auth/login`** is the single endpoint through which identity is established. Its internal logic can change completely without anything else in the app changing.
- **v1**: test login provider, several distinct test accounts spanning different colleges/departments (needed to properly exercise register-number-prefix grouping). Behaves exactly like a real login — real sessions, real expiry. Visibly labeled as a test environment in the UI.
- **v2**: real Anna University credential verification behind the same endpoint. If it turns out to be a simple credentials-in/identity-out flow, only the endpoint's internals change. If it turns out to be an SSO-redirect flow, the login *page* also needs a small frontend change to support the redirect — but everything past "we now have an identity" (sessions, batch ownership, the rest of the app) stays untouched either way.
- Test-phase account IDs will not match real Anna University IDs. Treat test-phase batch data as throwaway at swap time — do not build migration/linking logic for it.

## 2. Session Handling

- **Idle timeout**: auto-logout after ~30–60 minutes of inactivity.
- **Max session lifetime**: forced re-login periodically (e.g. every 24 hours) regardless of activity — sessions are never unbounded.
- **Brute-force protection**: rate-limit/lock out repeated failed login attempts per account. Build this now — it carries forward unchanged into v2's real auth.
- **Session storage**: secure, httpOnly cookies. Never localStorage/sessionStorage for session tokens.

## 3. Access Model

- **Single role: professor.** No admin, no HOD, no permission tiers.
- **The only access rule in the system**: `batch.professor_id == current_user.id`. Apply this check everywhere a batch or its contents are read or written. There is nothing more complex to design here — do not add a permission matrix.

## 4. File Constraints (abuse-prevention + reliability)

- **Max image size**: capped (~15–20MB), clear rejection message if exceeded.
- **HEIC handling**: auto-convert HEIC → JPEG server-side on upload.
- **PDF page cap**: sane upper bound (~100 pages) — safety limit and wrong-file-upload catch.
- **Batch size cap**: explicit max images per bulk upload (~100).

## 5. Audit Trail

- Every manual correction in the review queue is logged: who, when, old value, new value, which sheet.
- The audit log must be **tamper-evident** — not just a database table anyone with DB access could quietly edit. (Concretely: append-only, no update/delete permissions granted to the application layer on this table — corrections create new rows, never overwrite old ones.)

## 6. Data Protection

- Register numbers and marks are personal academic data; treat as sensitive regardless of formal compliance obligations.
- **DPDP Act / formal data-protection compliance**: deliberately deferred (see `07-master-rules.md` §9). Tool is private, professor-only, limited scope. Revisit if scope ever expands to a broader institutional rollout — that is the trigger condition for this item, not a fixed date.
- Encrypt data at rest and in transit as a baseline practice regardless of the compliance deferral (standard managed Postgres/S3 encryption is sufficient — no custom encryption layer needed for this scope).

## 7. What This File Deliberately Does Not Cover

Per explicit scope decisions in `07-master-rules.md` §9: no admin/HOD access design, no onboarding-related security considerations, no DPDP compliance checklist. If any of these get reconsidered, this file needs a fresh pass — it currently assumes they stay out of scope.
