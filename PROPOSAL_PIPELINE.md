# Module 5: Proposal Management — Pipeline & Architecture Specification

**Arihant Business Operating System (BOS)**  
*Location:* `/home/dheerajsingh/Desktop/arihant-bos/PROPOSAL_PIPELINE.md`  
*Companion Doc:* [`docs/MODULE_5_PROPOSAL_MANAGEMENT_PIPELINE.md`](file:///home/dheerajsingh/Desktop/arihant-bos/docs/MODULE_5_PROPOSAL_MANAGEMENT_PIPELINE.md)

---

## 1. System Pipeline Overview

```text
Incoming Proposal Request
         ↓
POST /api/proposals (Validations: Customer, Product, Dates, Territorial Scope)
         ↓
Database Transaction (PostgreSQL + Kysely)
    ├── 1. Generate Proposal No via atomic sequence (PRP-YYYY-NNNNN)
    ├── 2. Insert into `proposals` & `proposal_products`
    ├── 3. Create Version 1 snapshot in `proposal_versions`
    ├── 4. Log initial history in `proposal_status_history`
    └── 5. Write Domain Event to `outbox` table (Status = 'PENDING')
Commit Transaction
         ↓
HTTP 201 Response returned immediately (Sub-50ms latency)
         ↓
Asynchronous Processing Engine (Outbox Worker Sweeper)
    ├── Polls pending outbox records (`FOR UPDATE SKIP LOCKED`)
    ├── Emits to EventEmitter2 Domain Bus
    ├── Dispatches to Consumers:
    │     ├── Audit Log Handler (`audit_logs`)
    │     ├── Timeline Projection (`proposal_timeline`)
    │     ├── Notification Handler (`notifications` + WebSocket `proposal.notification`)
    │     └── Task Reminder Handler (`tasks`)
    └── Marks Outbox record 'PUBLISHED' with timestamp
```

---

## 2. Proposal State Lifecycle Machine

```text
PROPOSAL_REQUESTED
        ↓ (Requires assigned responsible person)
UNDER_PREPARATION
        ↓ (Requires spec sheet / documentation)
READY_FOR_REVIEW
        ↓ (Approved by Manager / RM; self-approval guarded)
APPROVED
        ↓ (Sent date <= today, email reference, follow-up owner, next follow-up date)
SENT_TO_CUSTOMER
        ↓ (Cadence alerts, follow-up logging, postponements)
FOLLOW_UP_REQUIRED
        ├── CONVERTED (Direct win / PO received)
        ├── CLOSED (Inactive closure / cancelled)
        └── LOST (Lost to competitor, structured reason code)
```

---

## 3. Follow-up Tracking & Automation Pipeline

### Cadence & Classification Engine
1. **Follow-ups Due Today**:
   `next_follow_up_date = CURRENT_DATE AND status IN ('SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED')`
2. **Overdue Follow-ups**:
   `next_follow_up_date < CURRENT_DATE AND status IN ('SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED')`
3. **Stale Proposals (No Meaningful Movement)**:
   `status NOT IN ('CONVERTED', 'LOST', 'CLOSED') AND (CURRENT_DATE - last_activity_at::date) >= 7`
4. **Suggest Closure Flag**:
   `status IN ('SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED') AND (CURRENT_DATE - sent_date::date) >= 60`

### Background Worker Schedule
- Periodic cron scheduler (`ProposalsSchedulerService`) sweeps active proposals daily at `09:00 IST`.
- Emits `proposal.followup.due` and `proposal.followup.overdue` domain events.
- Idempotency via `processed_events` table ensures zero duplicate notifications.

---

## 4. Concurrency & Reliability Controls

- **Optimistic Locking**: Every mutation requires matching `row_version` token or `If-Match` header. Mismatch throws `409 Conflict`.
- **Atomic Sequences**: Proposal numbers generated from `proposal_canonical_seq`. Concurrent creations never collide.
- **Idempotency Cache**: `Idempotency-Key` HTTP header cached in-memory with 5-minute TTL.
- **Formulas Escaping**: CSV exports prefix `=`, `+`, `-`, `@` with single quote to prevent spreadsheet injection.

---

## 5. REST Endpoints Summary

```http
POST   /api/proposals                    Create new proposal request
GET    /api/proposals                    Search, filter, paginate, sort proposals
GET    /api/proposals/:id                Detailed proposal profile with relations
PATCH  /api/proposals/:id                Update editable fields with optimistic lock
DELETE /api/proposals/:id                Soft-delete proposal (pre-send only)
POST   /api/proposals/:id/start-preparation   Transition: REQUESTED -> UNDER_PREPARATION
POST   /api/proposals/:id/submit-for-review   Transition: UNDER_PREPARATION -> READY_FOR_REVIEW
POST   /api/proposals/:id/approve             Transition: READY_FOR_REVIEW -> APPROVED
POST   /api/proposals/:id/request-changes     Transition: READY_FOR_REVIEW -> UNDER_PREPARATION
POST   /api/proposals/:id/send                Transition: APPROVED -> SENT_TO_CUSTOMER
POST   /api/proposals/:id/follow-ups          Log client follow-up interaction
PATCH  /api/proposals/:id/follow-up           Update follow-up date and owner
POST   /api/proposals/:id/postpone-follow-up  Postpone follow-up with reason
POST   /api/proposals/:id/versions            Create version snapshot
GET    /api/proposals/:id/versions            List all proposal version snapshots
GET    /api/proposals/:id/activity            List activity history timeline
POST   /api/proposals/:id/mark-converted      Transition -> CONVERTED
POST   /api/proposals/:id/mark-lost           Transition -> LOST
POST   /api/proposals/:id/close               Transition -> CLOSED
POST   /api/proposals/:id/reopen              Transition: TERMINAL -> REQUESTED (Mgmt only)
GET    /api/proposals/dashboard               Real-time executive KPI metrics
GET    /api/proposals/export                  Export CSV
POST   /api/proposals/import                  Import spreadsheet
```

---

## 6. Verification Results

- **Unit & E2E Tests:** 280 / 280 Passed (`pnpm --filter @arihant/api test:e2e`).
  - `proposals-edge-cases.e2e-spec.ts`: 68 / 68 Passed.
  - `proposals-module5.e2e-spec.ts`: 25 / 25 Passed.
- **Typecheck:** Clean 0 errors (`pnpm --filter @arihant/web exec tsc --noEmit` and `pnpm --filter @arihant/api exec tsc --noEmit`).
- **Build:** Clean 0 errors (`next build` 18/18 static pages, `tsc -p tsconfig.build.json`).
- **UI:** Verified in browser subagent adhering to Arihant BOS UI Design System (`#F6F5F1`, `#0F5E63`, `#9A3412`, Source Serif 4).
