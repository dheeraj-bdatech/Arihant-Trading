# Arihant BOS — Workspace Agent Guidelines & Standards

This document establishes the architecture, code rules, UI design system conventions, and component library standards for the Arihant Business Operating System (BOS). All AI agents operating in this repository must adhere strictly to these directives.

---

## 0. Business Logic Ground Truth & Verification Contract (MANDATORY)

> [!IMPORTANT]
> **MANDATORY VERIFICATION DIRECTIVE:**
> Whenever instructed to **build**, **create**, or **edit** anything in this repository, agents **MUST verify** implementation details, field definitions, lifecycle states, and role permissions against:
> 1. [ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md](file:///home/dheerajsingh/Desktop/arihant-bos/docs/ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md) (Master Operational Blueprint Specification)
> 2. [Arihant Trading Corporation BOS Scope Blueprint.pdf](file:///home/dheerajsingh/Desktop/arihant-bos/docs/Arihant%20Trading%20Corporation%20BOS%20Scope%20Blueprint.pdf) (Official 31-Page Scope Blueprint PDF)
> 3. [.agents/rules/business-verification-contract.md](file:///home/dheerajsingh/Desktop/arihant-bos/.agents/rules/business-verification-contract.md)
>
> Every feature or code change must satisfy the **7 Verification Gates** (Scope compliance, 8-Role RBAC & regional filtering, Kysely & `@arihant/shared` alignment, light `#F6F5F1` design tokens & `@/components/ui` primitives, mobile-first field ergonomics, immutable audit trails, and 0-error TypeScript compilation).

---

## 1. UI Design System & Component Library (Client UI-Kit Aligned)

### Core Aesthetic Principles
- **Client Design System Aesthetic**: Canvas background is warm linen `#F6F5F1`, card surfaces are `#FFFFFF` (subtle `#FBFAF7`), borders are `#DCD8CE` (dividers `#ECE9E2`).
- **Brand & Accent Palette**:
  - Primary: Deep Teal `#0F5E63` (hover `#0B4A4E`, soft `#E3EFEE`, text `#FFFFFF`).
  - Accent / Urgent / Live: Terracotta `#9A3412` (strong `#7C2D12`, soft `#FBEBDD`, bright `#F2B872` on dark panels).
  - Navigation / Hero Dark Panels: Dark Navy `#14213D`, role card `#1F2E52`.
- **Typography Standard**:
  - Display & Page Headings: `'Source Serif 4'`, serif font for titles and card headers.
  - Body & Form Controls: `'IBM Plex Sans'`, sans font for UI controls, inputs, and labels.
  - Codes, Monospace, Currency, Deadlines, Timers: `'IBM Plex Mono'`, monospace font for IDs, currency amounts, timers, and badges.
- **Component-Driven Standard**: Never implement custom buttons, raw unstandardized cards, or ad-hoc div wrappers when a standardized design system component exists. Always import UI primitives from `@/components/ui`.

### Design Tokens & Variables

| Category | Token | Value | Tailwind Class | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas** | Background | `#F6F5F1` | `bg-[#F6F5F1]` | Global page background (warm linen) |
| **Surface** | Card / Panel | `#FFFFFF` | `bg-white` | Primary content card surface |
| **Surface** | Subtle Alt | `#FBFAF7` | `bg-[#FBFAF7]` | Secondary wells, headers, table strips |
| **Border** | Base Line | `#DCD8CE` | `border-[#DCD8CE]` | All cards, outer borders |
| **Border** | Divider Line | `#ECE9E2` | `border-[#ECE9E2]` | Interior dividers, table row lines |
| **Border** | Control Line | `#C9C4B8` | `border-[#C9C4B8]` | Form inputs, select dropdowns |
| **Brand** | Primary Teal | `#0F5E63` | `text-[#0F5E63]`, `bg-[#0F5E63]` | Primary buttons, active tabs, main accents |
| **Brand** | Secondary Teal | `#E3EFEE` | `bg-[#E3EFEE]` | Soft button backgrounds, badge tints |
| **Accent** | Terracotta | `#9A3412` | `text-[#9A3412]`, `bg-[#9A3412]` | Urgent deadlines, live auction chips |
| **Dark Panel** | Dark Navy | `#14213D` | `bg-[#14213D]`, `text-[#14213D]` | Sidebar navigation, `.card--dark` monitor |
| **Text** | Primary Ink | `#14213D` | `text-[#14213D]` | Titles, headings, main content |
| **Text** | Muted / Secondary | `#4A5568` | `text-[#4A5568]` | Subtitles, helper text, labels |
| **Radius** | Standard Card | `14px` | `rounded-[14px]` | Standard for all cards, containers |
| **Radius** | Small Controls | `8px` | `rounded-lg` | Buttons, inputs, chips |
| **Radius** | Badges / Pills | Full | `rounded-full` | Status badges, avatar circles |

---

### Standard Component Catalog (`@/components/ui`)

#### 1. Layout & Structure (`@/components/ui/Layout`, `PageContainer`)
- **`PageContainer`**: Standard page layout wrapper (`space-y-6 pb-12 animate-in fade-in duration-200`). Supports `maxWidth` ('default' | 'narrow' | 'wide' | 'full').
- **`PageHeader`**: Top hero banner with serif title, description, module badge, icon, and action button slots.
- **`SectionHeader`**: Subheading divider for logical page divisions, supporting actions and right-aligned badges.
- **`Container`**: Horizontal centered container with responsive paddings and `maxWidth` options.
- **`Stack` / `VStack` / `HStack`**: Flex layout wrappers with standardized `gap` presets (`none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`), alignment, and direction.
- **`Grid`**: CSS grid container with standardized column presets (`1` through `8`, responsive) and gap controls.
- **`Spacer`**: Semantic spacing block (`size="xs" | "sm" | "md" | "lg" | "xl" | "2xl"`).
- **`Divider`**: Semantic horizontal or vertical separator (`border-[#ECE9E2]`) with optional centered label.

#### 2. Surfaces & Cards (`@/components/ui/Card`, `Surface`)
- **`Card`**: Standard surface with border `#DCD8CE`, rounded corners `rounded-[14px]`, interactive hover states, selection states, and variant tints (`default`, `flat`, `tinted`, `interactive`, `dark` `#14213D`, `danger`, `warning`, `success`).
  - Subcomponents: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`.
- **`Surface`**: Universal container box with standard background (`canvas`, `card`, `subtle`, `primary`, `danger`, etc.), border, and radius tokens.
- **`Box`**: Lightweight polymorphic element with spacing, padding, and layout props.

#### 3. Typography (`@/components/ui/Typography`)
- **`Heading`**: Standard headings `h1` through `h6` in `'Source Serif 4'` (`font-serif`) with strict client ink color (`text-[#14213D]`) and sizing scales.
- **`Text`**: Body text in `'IBM Plex Sans'` supporting sizes (`xs`, `sm`, `base`, `lg`), weights, and colors (`default`, `muted` `#4A5568`, `primary` `#0F5E63`, `success`, `danger`, `warning`).
- **`Label`**: Form field label with optional `required` asterisk indicator.
- **`Kbd`**: Keyboard shortcut pill badge (`border-[#DCD8CE]`, `bg-[#FBFAF7]`, `font-mono`).

#### 4. Buttons & Actions (`@/components/ui/Button`)
- **`Button`**: Primary interactive element.
  - Variants: `primary` (`#0F5E63`), `secondary` (`#FFFFFF` with `#C9C4B8` border), `outline`, `ghost`, `danger`, `success`, `cyber`, `on-dark`.
  - Sizes: `xs`, `sm`, `md`, `lg`, `icon`.
  - Props: `isLoading`, `leftIcon`, `rightIcon`, `fullWidth`, `disabled`.
- **`IconButton`**: Standardized square or circular icon action button with hover effects and tooltip label accessibility.
- **`ButtonGroup`**: Connected button cluster for toolbars, filters, and segmented actions.

#### 5. Form Controls (`@/components/ui/Input`, `Select`, `Textarea`, `Checkbox`)
- **`Input`**: Text input with label, helperText, error state, and brand focus ring (`focus:border-[#223FA7] focus:ring-[#223FA7]/15`).
- **`Select`**: Dropdown select with standardized styling and label/error support.
- **`Textarea`**: Multi-line text input with standardized focus and border styling.
- **`Checkbox`**: Branded checkbox control with label, sub-description, and executive blue focus/check indicators.

#### 6. Navigation & Filtering (`@/components/ui/Tabs`, `FilterBar`)
- **`Tabs`**: Standard tab navigation supporting `pills`, `segmented`, and `underline` visual variants, with item badge counters and icons.
- **`FilterBar`**: Standardized container for search inputs, dropdown filters, quick toggles, and action triggers.

#### 7. Feedback, Metrics & Dialogue (`@/components/ui/StatCard`, `EmptyState`, `InfoCallout`, `Badge`, `Modal`)
- **`StatGrid` & `StatCard`**: Standard executive metric HUDs with trend subtext, progress bars, and semantic color variants (`primary`, `emerald`, `amber`, `rose`).
- **`EmptyState`**: Empty list / search zero-state with icon, title, description, and action button.
- **`InfoCallout`**: Semantic alerts (`info`, `warning`, `danger`, `success`, `neutral`) with optional dismissible `onClose` action.
- **`Badge`**: Status pills with semantic coloring (`default`, `outline`, `success`, `warning`, `danger`, `urgent`, `info`, `cyber`).
- **`Modal`**: Standard accessible dialog modal with header, description, dismiss button, and standardized padding.
- **`Table`**: Standard tabular presentation with `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`.

---

## 2. Fullstack Architecture Standards

### Backend API (NestJS + Kysely)
- **Kysely Queries**: Use Kysely query builder exclusively for PostgreSQL database interactions.
- **RBAC & Territorial Scoping**: Always enforce role boundaries. Unless the user is `management` or `admin`, filter queries by `user.region_id` or `user.id`.
- **Domain Events**: Emit events using `EventEmitter2` on critical entity transitions (e.g. `tender.status_changed`, `demo.assigned`).

### Shared Package (`@arihant/shared`)
- Share all DTO schemas, status enums, permission matrix types, and currency formatters (`formatINR`, `formatLakh`, `formatCrore`) between backend and frontend.

---

## 3. Verification Protocol
Before marking any task as complete:
1. Run `pnpm --filter @arihant/web exec tsc --noEmit` — must exit with 0 errors.
2. Run `pnpm --filter @arihant/api exec tsc --noEmit` — must exit with 0 errors.
3. Test views in browser to ensure all components render properly with `#F7FBFF` background and `#FFFFFF` cards.
