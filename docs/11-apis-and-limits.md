# APIs & Tools Used
### Limits & How to Avoid Hitting Them

See `07-master-rules.md` for the governing principles this must follow — chiefly Rule 7: external API calls never happen synchronously in a user-facing request.

---

## 1. Full Dependency List

| API/Tool | Used for | Limit that matters | Mitigation |
|---|---|---|---|
| **Vision LLM API** — Google Gemini API, Flash model, free tier | Reading each cropped field (register numbers, ticks, marks) | The one dependency where limits are a real day-one concern. Free tier is roughly 15 RPM / ~1,500 RPD as of setup (verify current numbers in Google AI Studio — Google adjusts these over time and they're tied to your specific project). No cost, but the tightest constraint in the whole stack. | See §2 below — this is the dependency the whole queue architecture exists to protect. Bundling a sheet's field crops into one request (see §2.7) keeps request count per batch low relative to this limit. |
| **Object storage (S3/MinIO)** | Images, Excel exports | Generous per-prefix request limits — not realistically hit at this scale (dozens of batches, not millions of objects). | None needed |
| **Managed Postgres** (if using a managed provider) | Main database | Concurrent connection cap based on plan tier — can matter with many workers + web requests connecting at once. | Connection pooling (e.g. PgBouncer) as a default from day one — cheap now, prevents a real problem later |
| **Redis** | Job queue | Capacity-bound (server resources), not an external quota | None needed |
| **CI provider** (e.g. GitHub Actions) | Tests, deploys | Free-tier monthly minutes cap on private repos | Only relevant at scale; trivial tier upgrade if ever hit |
| **Browser Notification API** | Completion pop-ups | No usage limit — permission-gated, not quota-gated | N/A |
| **Email/Slack webhook** | Operator alerting | Generous limits for this volume | None needed |
| **SEMS** (v2, unbuilt) | Marks submission | **Unknown** — rate limits, session behavior, per-account caps all unconfirmed | Cannot design around this until the real interface is seen. Flagged, not solved. |
| **Anna University auth/SSO** (v2, unbuilt) | Real login | **Unknown**, same reason | Same — open unknown until real access is granted |

## 2. Rules for the Vision LLM API Specifically

This is the dependency that actually needs engineering discipline. Rules:

1. **Never call it synchronously from a user-facing request.** A professor clicking "upload" enqueues jobs; it never directly triggers a blocking API call in the request/response cycle.
2. **Worker concurrency is the throttle.** Celery worker pool size is tuned to stay under whatever the account tier's rate limit actually is — this is the primary lever, not something to hardcode once and forget as usage grows.
3. **Treat rate-limit responses (e.g. HTTP 429) as a normal retry case, not a failure.** The job requeues with backoff; it does not mark the sheet as `failed` on a rate-limit response specifically — only after retries are genuinely exhausted for a non-rate-limit reason.
4. **Exponential backoff on retry**, not fixed-interval — avoids a thundering-herd retry pattern against an already-strained API.
5. **Circuit breaker on sustained failure**: if the vision API's error rate spikes (outage, not just rate-limiting), stop pulling new jobs from the queue rather than burning through retries pointlessly, and alert the operator (ties into `10-backup-recovery.md` §3 monitoring). Resume automatically once the API recovers.
6. **Monitor quota usage itself**, not just error rates — the operator dashboard should show how close current usage is to the account tier's limit, so tier upgrades happen proactively rather than reactively after a batch stalls.
7. **Bundle a sheet's field crops into a single API call** rather than one call per field (register number boxes, Part A grid, Part B/C grid all in one request). This is what keeps an 80-sheet batch to roughly 80 requests instead of several hundred, and is the main thing that makes the free tier's RPM/RPD caps workable rather than a bottleneck.

## 3. Open Items

- **Exact current Gemini free-tier numbers**: confirm in Google AI Studio for your specific project once the API key exists — Google adjusts these over time and they can vary by project, so treat the ~15 RPM / ~1,500 RPD figures here as a starting assumption to verify, not a guarantee. Tune worker concurrency (§2.2) to whatever the real number turns out to be.
- **SEMS and Anna University auth limits**: entirely unknown until real access is granted (see `07-master-rules.md` and `09-security-master.md` §1 for how these plug in once known).
