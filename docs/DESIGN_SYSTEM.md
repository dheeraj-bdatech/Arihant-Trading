# Arihant BOS Design System & Component Library

## 1. Overview & Principles

The Arihant Business Operating System (BOS) follows a strict **Clean Light Executive Theme** engineered for defence and security enterprise workflows. All views must maintain visual consistency across all modules.

### Core Visual Principles
1. **Light, Clean & High-Contrast**: Background is always `#F6F5F1` (warm linen canvas). Cards are pure white `#FFFFFF` with `#DCD8CE` borders.
2. **Strictly No Dark/Black Themes**: Dark mode or black backgrounds (`bg-slate-900`, `bg-gray-900`, `bg-black`, `border-slate-800`) are **strictly prohibited** anywhere in the user interface.
3. **Component-Driven Architecture**: Ad-hoc styles, custom buttons, unstandardized cards, and inconsistent paddings/spacings are prohibited. All views must consume components from `@/components/ui`.
4. **Predictable Spacing & Typography**: Strict spacing scale and font sizing across all modules.

---

## 2. Design Tokens

### Color Palette

| Token | Hex Value | Tailwind Class | Usage |
|---|---|---|---|
| **Canvas Background** | `#F6F5F1` | `bg-[#F6F5F1]` | App container background |
| **Card Surface** | `#FFFFFF` | `bg-white` | Surfaces, modals, cards |
| **Subtle Well** | `#FBFAF7` | `bg-slate-50` / `bg-gray-50/70` | Secondary wells, sub-panels |
| **Border Primary** | `#DCD8CE` | `border-[#DCD8CE]` | All card, table, and container borders |
| **Border Hover** | `#9FC0F5` | `hover:border-[#9FC0F5]` | Interactive card hover states |
| **Brand Primary** | `#0F5E63` | `bg-[#0F5E63]`, `text-[#0F5E63]` | Primary buttons, active tabs, key highlights |
| **Brand Secondary** | `#E3EFEE` | `bg-[#E3EFEE]` | Module pills, subtle accents, badges |
| **Foreground Text** | `#1A1A1A` | `text-[#1A1A1A]` | Primary headings, titles, high-emphasis text |
| **Muted Text** | `#5871A5` | `text-[#5871A5]` | Subtitles, helper text, table header labels |

### Semantic State Colors

| Semantic | Background | Border | Text | Usage |
|---|---|---|---|---|
| **Success** | `bg-emerald-50` | `border-emerald-200` | `text-emerald-700` | Completed, won, healthy, signoffs |
| **Warning** | `bg-amber-50` | `border-amber-200` | `text-amber-700` | Pending, review, awaiting manager |
| **Danger / Urgent** | `bg-red-50` | `border-red-200` | `text-red-700` | Deadlines ≤ 7 days, breakdown, rejected |
| **Info / Focus** | `bg-[#E3EFEE]` | `border-[#0F5E63]/30` | `text-[#0F5E63]` | Information callouts, active indicators |

### Spacing & Layout Standards

- **Page Root Wrapper**: `<PageContainer>` applies `space-y-6 pb-12 animate-in fade-in duration-200`.
- **Card Padding**:
  - Compact: `padding="sm"` (`p-3.5`)
  - Default / Standard: `padding="md"` (`p-5`)
  - Hero / Large: `padding="lg"` (`p-6` to `p-8`)
- **Border Radius**:
  - `rounded-xl` (12px) for cards, modals, stat boxes, and filter bars.
  - `rounded-lg` (8px) for buttons, inputs, dropdowns, and icon containers.
  - `rounded-full` for status badges, tags, and avatars.

---

## 3. Component Catalog (`@/components/ui`)

All components are exported from `@/components/ui`:
```tsx
import {
  // Layout & Spacing
  PageContainer,
  PageHeader,
  SectionHeader,
  Container,
  Stack,
  HStack,
  VStack,
  Grid,
  Spacer,
  Divider,

  // Surfaces & Cards
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Surface,
  Box,

  // Typography
  Heading,
  Text,
  Label,
  Kbd,

  // Buttons & Actions
  Button,
  IconButton,
  ButtonGroup,

  // Inputs
  Input,
  Select,
  Textarea,
  Checkbox,

  // Navigation & Filtering
  Tabs,
  FilterBar,

  // Feedback & Data
  StatGrid,
  StatCard,
  EmptyState,
  InfoCallout,
  Badge,
  Modal,
  Table,
} from '@/components/ui';
```

### 3.1 Layout & Structure

#### `PageContainer`
Unified layout wrapper for every page in the application.
```tsx
<PageContainer maxWidth="default">
  {/* Page content here */}
</PageContainer>
```

#### `PageHeader`
Standard hero page header with module badge pill, icon, title, description, and action buttons.
```tsx
<PageHeader
  badge="Module 3 — Demonstrations"
  title="Field Demonstration Management"
  subtitle="Coordinate trial allocations, depot inventory, and customer signoffs."
  icon={<Shield className="w-5 h-5 text-[#0F5E63]" />}
  actions={
    <Button variant="primary" onClick={handleNewDemo}>
      <Plus className="w-4 h-4 mr-1.5" />
      Request Demonstration
    </Button>
  }
/>
```

#### `SectionHeader`
Standard subheader for dividing pages into logical functional areas.
```tsx
<SectionHeader
  title="Active Demonstrations in Territory"
  description="Real-time trial units assigned to defence commands."
  icon={<Compass className="w-4 h-4" />}
  badge={<Badge variant="default">12 Active</Badge>}
  actions={<Button variant="outline" size="sm">Export CSV</Button>}
/>
```

#### `HStack`, `VStack`, `Grid`, `Divider`, `Spacer`
Primitive layout building blocks with standardized gap tokens.
```tsx
<VStack gap="md">
  <HStack justify="between" align="center">
    <Heading level={4}>Summary</Heading>
    <Button size="sm" variant="ghost">Refresh</Button>
  </HStack>
  <Divider />
</VStack>
```

---

### 3.2 Cards & Surfaces

#### `Card`
Standardized card surface with built-in border `#DCD8CE`, rounded corners `rounded-xl`, shadow presets, selection states, and variant tints.
```tsx
<Card variant="interactive" padding="md" hover onClick={handleClick}>
  <CardHeader>
    <CardTitle>Security Clearance Roster</CardTitle>
    <CardDescription>Verified officers authorized for GeM procurement.</CardDescription>
  </CardHeader>
  <CardContent>
    <Text size="sm">Active verified credentials: 42</Text>
  </CardContent>
  <CardFooter>
    <Button variant="secondary" size="sm">View All</Button>
  </CardFooter>
</Card>
```

---

### 3.3 Interactive Elements & Forms

#### `Button`, `IconButton`, `ButtonGroup`
Standardized action elements with variants, sizes, loading state with spinner, and icon support.
- **Variants**: `primary` (`#0F5E63`), `secondary` (`#E3EFEE`), `outline` (`border-[#DCD8CE]`), `ghost`, `danger`, `success`, `cyber`.
- **Sizes**: `xs`, `sm`, `md`, `lg`, `icon`.
```tsx
<Button variant="primary" size="md" leftIcon={<Save className="w-4 h-4" />} isLoading={isSubmitting}>
  Save Changes
</Button>

<IconButton
  icon={<Trash2 className="w-4 h-4 text-red-600" />}
  label="Delete record"
  variant="ghost"
  size="sm"
  onClick={handleDelete}
/>
```

#### `Input`, `Select`, `Textarea`, `Checkbox`
Form controls with brand teal focus rings and labels.
```tsx
<Input
  label="Unit Serial Number"
  placeholder="e.g. ARI-FLR-2026-09"
  required
  error={errors.serial}
/>

<Checkbox
  label="Travel Required (Outstation)"
  description="Requires territory manager approval"
  checked={travelRequired}
  onChange={(e) => setTravelRequired(e.target.checked)}
/>
```

---

### 3.4 Navigation & Feedback

#### `Tabs`
Standard navigation tabs with badge counters, icons, and preset styles (`pills`, `segmented`, `underline`).
```tsx
<Tabs
  tabs={[
    { id: 'pipeline', label: 'Demo Pipeline', count: 12 },
    { id: 'fleet', label: 'Fleet Inventory', count: 28 },
    { id: 'history', label: 'Trial Archives' },
  ]}
  activeTab={activeTab}
  onChange={setActiveTab}
  variant="segmented"
/>
```

#### `EmptyState`
Clean visual empty state with icon, title, description, and primary action.
```tsx
<EmptyState
  icon={Calendar}
  title="No field tours scheduled"
  description="No upcoming customer visits or trials assigned for this territory."
  action={<Button variant="primary">Schedule Visit</Button>}
/>
```

#### `InfoCallout`
Semantic alert banner (`info`, `warning`, `danger`, `success`, `neutral`) with optional dismissible `onClose`.
```tsx
<InfoCallout
  variant="warning"
  title="Immediate Action Required"
  description="Security signoff document missing for 2 assigned demonstration kits."
  onClose={() => setAlertVisible(false)}
/>
```

---

## 4. Module Implementation Checklist

When creating or refactoring any module in Arihant BOS:
- [ ] Root is wrapped in `<PageContainer>`.
- [ ] Page top uses `<PageHeader>` with appropriate module badge and icon.
- [ ] Metrics use `<StatGrid>` and `<StatCard>` components.
- [ ] Subsections use `<SectionHeader>`.
- [ ] Filter areas use `<FilterBar>`.
- [ ] Empty data states use `<EmptyState>`.
- [ ] Form inputs use `<Input>`, `<Select>`, `<Textarea>`, and `<Checkbox>`.
- [ ] Buttons use `<Button>` or `<IconButton>` with appropriate variants.
- [ ] Zero dark/black backgrounds used anywhere in the view.
- [ ] Type check passes: `pnpm --filter @arihant/web exec tsc --noEmit`.
