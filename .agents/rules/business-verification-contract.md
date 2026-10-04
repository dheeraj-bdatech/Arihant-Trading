# Rule: Mandatory Verification Against Arihant BOS Blueprint & Specification

## 1. Absolute Directive
Whenever the user asks to **"build"**, **"create"**, **"edit"**, **"update"**, or **"fix"** anything in this codebase (backend API, database queries/migrations, frontend pages, components, workflows, or states), you **MUST ALWAYS cross-verify your implementation against**:
1. [ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md](file:///home/dheerajsingh/Desktop/arihant-bos/docs/ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md) (Master Operational Blueprint Specification)
2. [Arihant Trading Corporation BOS Scope Blueprint.pdf](file:///home/dheerajsingh/Desktop/arihant-bos/docs/Arihant%20Trading%20Corporation%20BOS%20Scope%20Blueprint.pdf) (Official 31-page Scope Document)
3. Operational nuances from the founding alignment meeting (B2G workflows, tender-value demo priority, "Also-Meet" directives, GeM/state portals, 2-stage expense approvals, evidence dossiers).

---

## 2. Core Business Tenets to Enforce During Every Task

- **B2G Enterprise Realities**: Arihant sells high-value scanning and security equipment (XBIS X-Ray machines, DFMDs, HHMDs, UVSS) to government agencies, police, paramilitary, and PSUs.
- **"Enter Once, Use Everywhere" (§4)**: No redundant data entry. Field work immediately populates customer timelines, manager review queues, and management dashboards.
- **Strict Scope Exclusions (§3)**:
  - BOS is NOT an accounting ERP; Tally remains the accounting system. BOS exports verified expenses to Excel.
  - BOS does NOT run automated bots on GeM/State portals.
  - BOS does NOT automatically deduct salaries; it creates verifiable Performance Evidence Dossiers for management.
- **Tender-Value Demo Conflict Resolution (§16)**: Limited demo units across Delhi, Patna, and Kolkata depots are prioritized to bids with the highest tender value or strategic urgency.
- **Mobile-First for Road Warriors (§48)**: Field reps and service engineers operate on mobile phones. Interfaces must be responsive, streamlined, pre-filled, and avoid long free-text typing.
- **Light Executive Aesthetic**: Canvas warm linen `#F6F5F1`, cards `#FFFFFF` (subtle `#FBFAF7`), borders `#DCD8CE` (dividers `#ECE9E2`), primary Deep Teal `#0F5E63`, accent Terracotta `#9A3412`, headings `'Source Serif 4'`. Standard components imported strictly from `@/components/ui`. Dark themes are strictly forbidden.

---

## 3. Mandatory 7-Gate Verification Protocol Before Declaring Complete

1. **Gate 1: Business Logic & Scope**: Adheres to Blueprint §1–§56, correct entity relationships (Organisation anchor, Fresh vs Re-approached).
2. **Gate 2: RBAC & Territorial Scoping**: 8-role matrix enforced; non-management queries scoped by `region_id` or `user_id`.
3. **Gate 3: Shared Package & Database**: Schema types in `@arihant/shared`, Kysely query builder used exclusively.
4. **Gate 4: UI Design System**: Pure `#F6F5F1` linen background, `#FFFFFF` cards, `#0F5E63` Deep Teal, `'Source Serif 4'` serif headings, standard primitives from `@/components/ui`.
5. **Gate 5: Mobile Usability**: Verified responsive on mobile viewports (no horizontal overflow, touch-friendly controls).
6. **Gate 6: Audit Trail & Events**: Entity changes logged to audit trail, domain events dispatched.
7. **Gate 7: Clean Typecheck**:
   - `pnpm --filter @arihant/web exec tsc --noEmit` exits with 0 errors.
   - `pnpm --filter @arihant/api exec tsc --noEmit` exits with 0 errors.
