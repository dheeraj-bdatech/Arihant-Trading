# Arihant BOS — Defence & Security GeM Business Operating System

A mission-critical enterprise operating system for **Arihant Trading Corporation**, engineered to track and execute government tenders on the Government e-Marketplace (GeM), field sales operations, multi-depot demo trials, and financial reimbursements across India.

---

## 🏛️ Architecture & Tech Stack

- **Monorepo:** `pnpm` workspaces (`apps/api`, `apps/web`, `packages/shared`, `db/`)
- **Backend API:** NestJS (TypeScript), PostgreSQL 16, Kysely type-safe query builder, Socket.IO WebSockets (`:4001`), Event-driven architecture with `@nestjs/event-emitter`, cron jobs (`@nestjs/schedule`).
- **Database:** PostgreSQL 16 (Docker container `arihant_bos_db`), 26 relational tables, triggers, indexes, and audit logging.
- **Frontend App:** Next.js 14 (App Router), Tailwind CSS, dark defence-obsidian theme, real-time WebSocket client, 1-click role persona switcher.
- **Data Seed:** 30 live GeM tenders imported from *North Live Tender Sheet FY 2026-27*, 31 users across 8 roles with hierarchical reporting tree.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js $\ge$ 20.0
- Docker & Docker Compose
- `pnpm` $\ge$ 9.0

### 2. Start PostgreSQL Database
```bash
# Start PostgreSQL 16 container on port 5432
pnpm db:up

# Apply schema and local auth migrations
pnpm db:init
```

### 3. Seed Database with 30 Live GeM Tenders & Users
```bash
# Seeds 30 real GeM tenders, 31 users, 10 demo equipment units, 14 organizations
pnpm seed
```

### 4. Run Development Servers
```bash
# Run both API and Web concurrently
pnpm dev

# Or run separately:
pnpm dev:api   # API runs on http://localhost:4000/api, WebSocket on port 4001
pnpm dev:web   # Web app runs on http://localhost:3000
```

### 5. Run Automated Tests
```bash
# Run 14-test end-to-end integration suite against PostgreSQL
pnpm test:e2e
```

---

## 👥 Demo User Credentials (All Roles)

All accounts share the default password: **`password123`**

You can also use the **1-Click Role Persona Switcher** on the login page or top navigation to switch identities instantly.

| Persona | Role | Email | Scope / Depot |
| :--- | :--- | :--- | :--- |
| **Rajesh Arihant** | Top Management | `mgmt@arihant.com` | HQ / All India |
| **Vikram Sharma** | Regional Manager | `regmgr.north@arihant.com` | North Zone |
| **Debanjan Sen** | Regional Manager | `regmgr.ne@arihant.com` | North East Zone |
| **Amit Verma** | Sales Executive | `sales.delhi@arihant.com` | Delhi NCR |
| **Suresh Nair** | Tender Team | `tender@arihant.com` | National GeM Cell |
| **Ramesh Patel** | Demo Team | `demo@arihant.com` | Delhi Depot |
| **Rakesh Meena** | Demo Team | `demo.patna@arihant.com` | Patna Depot |
| **Anil Kumar** | Service Team | `service@arihant.com` | Service HQ |
| **Kavita Rao** | Corporate Accounts | `accounts@arihant.com` | Finance & Audit |
| **System Admin** | Admin | `admin@arihant.com` | Infrastructure |

---

## 📦 Core Functional Modules

The full list of all 16 modules, where each lives in the app, and the build timeline is in [docs/MODULES.md](docs/MODULES.md).

### 1. GeM Tenders Pipeline (`/tenders`)
- 30 live GeM tenders imported from North sheet.
- Red pulsing alert tags for tenders closing $\le$ 7 days (`CLOSING TODAY`, `3 DAYS LEFT`).
- Specification inspect drawer: Bidder/OEM turnover criteria, EMD fee, quantity, MHA QR references.
- Management participation signoff workflow (`/approve`).
- Final commercial outcome recording with win/loss analysis (`/outcome`).

### 2. Command Executive Center (`/dashboard`)
- Top KPI cards: Critical closing tenders, Active Lead Pipeline ($\approx$ ₹ 798 Lakh), Blocked Tasks, Pending Reimbursements.
- Urgent Tenders alert table with countdown timers.
- Operational bottleneck exception queue.

### 3. Field Visits & Travel Planner (`/visits`)
- Tour program itineraries for police headquarters and base workshops.
- Regional Manager **"Also-Meet"** strategic directive callout banners.
- Post-visit update reporting modal with follow-up milestones.

### 4. Demo Fleet & Equipment Matrix (`/demos`)
- Physical equipment inventory tracking across Patna, Delhi, and Kolkata depots.
- Status matrix: Available, In Transit, Deployed, Under Maintenance.
- Equipment reservation request and manager authorization workflow.
- Post-trial failure analysis reporting.

### 5. Two-Stage Expense Reimbursements (`/expenses`)
- Stage 1: Regional Manager verification with self-approval prevention guards.
- Stage 2: Corporate Accounts settlement and payment disbursement voucher.

### 6. Action Tasks & Blocker Management (`/tasks`)
- Deliverables board with priority flags.
- Operational blocker escalation with manager resolution modals.

### 7. Commercial Quotations & Service Desk (`/proposals`, `/service`)
- Proposal generation with validity and follow-up reminders.
- Service tickets with breakdown maintenance and engineer signoff reports.

### 8. System Administration & RBAC (`/admin`)
- Directory of 31 seeded users with active status toggles.
- Product masters with MHA QR specifications.
- Immutable security audit trail with actor, action, and payload details.
