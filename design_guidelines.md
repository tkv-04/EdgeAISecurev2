# Edge AI IoT Security Center - Design Guidelines

## Design Approach

**Selected System:** Carbon Design System (IBM)
**Rationale:** Carbon is purpose-built for data-intensive enterprise applications with extensive table components, chart integration, and strong information hierarchy - ideal for security monitoring dashboards.

**Core Principles:**
- Clarity over aesthetics - data must be instantly scannable
- Consistent status visualization throughout all views
- Dense information display without overwhelming users
- Functional minimalism with purposeful interactions

---

## Typography System

**Font Family:** IBM Plex Sans (via Google Fonts CDN)
- Headings: IBM Plex Sans, weight 600
- Body text: IBM Plex Sans, weight 400
- Data tables/metrics: IBM Plex Mono, weight 400 (for numerical clarity)

**Type Scale:**
- Page titles: text-2xl (24px)
- Section headers: text-lg (18px)
- Card titles: text-base (16px)
- Body/table text: text-sm (14px)
- Metadata/timestamps: text-xs (12px)

---

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8
- Component padding: p-4 or p-6
- Section margins: mb-6 or mb-8
- Card gaps: gap-4 or gap-6
- Table cell padding: p-2 or p-3

**Dashboard Grid:**
- Main container: max-w-7xl mx-auto with px-4 padding
- Summary cards: 4-column grid on desktop (grid-cols-1 md:grid-cols-2 lg:grid-cols-4)
- Content sections: Single column with full-width tables
- Side-by-side layouts: 2-column grid where needed (grid-cols-1 lg:grid-cols-2)

**Page Structure:**
- Top navigation bar: Fixed height (h-16), full width
- Sidebar navigation: w-64 on desktop, collapsible on mobile
- Main content area: Scrollable with py-6 px-4 spacing
- All tables and charts: Full container width

---

## Component Library

### Navigation
**Top Bar:**
- Full-width header with app title (left), admin profile dropdown (right)
- Height: h-16 with border-b
- Fixed position for consistent access

**Sidebar:**
- Vertical navigation with icon + label format
- Active state: Border accent on left edge
- Icons: Heroicons (outline style for inactive, solid for active)
- Width: w-64 on desktop, slide-over drawer on mobile

### Summary Cards (Dashboard)
- Rounded corners: rounded-lg
- Padding: p-6
- Shadow: shadow-sm with subtle border
- Structure: Large metric number (text-3xl font-semibold), label below (text-sm), small trend indicator icon
- Spacing between metric and label: mb-2

### Data Tables
**Structure:**
- Full-width with horizontal scroll on mobile
- Sticky header row
- Row height: Comfortable (py-3 px-4 per cell)
- Alternating row treatment for scannability
- Hover state: Subtle background change on entire row

**Column Specifications:**
- Status column: Badge component with dot indicator
- Action column: Right-aligned icon buttons (size-5)
- Timestamp columns: Monospace font, muted styling
- IP/MAC addresses: Monospace font

### Status Badges
**Design:**
- Inline-flex with rounded-full
- Dot indicator (w-2 h-2 rounded-full) + text label
- Padding: px-3 py-1
- Font: text-xs font-medium

**Status Types:**
- Normal/Approved: Green scheme
- Monitoring/Suspicious: Yellow scheme  
- Quarantined/High Severity: Red scheme
- New/Pending: Blue scheme
- Blocked: Gray scheme

### Charts
**Library:** Chart.js via CDN
- Line charts: Network traffic over time (dashboard)
- Doughnut charts: Protocol distribution (monitoring page)
- Bar charts: Device activity comparisons
- All charts: 16:9 aspect ratio minimum, responsive container

### Alert Cards
- Border on left edge (w-1) matching severity
- Padding: p-4
- Structure: Timestamp (top-right, text-xs), device name (font-semibold), description, anomaly score (bottom-right as badge)
- Spacing: space-y-2 for internal elements

### Buttons
**Primary Actions:** Solid background, px-4 py-2, rounded-md, font-medium
**Secondary Actions:** Outlined style, same sizing
**Danger Actions:** Red scheme for destructive operations (Block, Reject)
**Icon Buttons:** p-2 with hover state, size-5 icons

### Form Controls
**Inputs:**
- Border: border rounded-md
- Padding: px-3 py-2
- Full width: w-full
- Focus: Ring treatment

**Sliders (Settings):**
- Full width with labeled steps
- Current value display above slider

**Toggle Switches:**
- Modern toggle design (not checkbox style)
- Label on right side

### Modal/Drawer Overlays
**Device Detail Panel:**
- Slide-in from right: w-96 on desktop
- Full height with scrollable content
- Header (device name), content sections, footer with actions
- Close button (top-right): Icon button with X

**Confirmation Dialogs:**
- Centered modal: max-w-md
- Title, description, action buttons (cancel + confirm)

---

## Page-Specific Layouts

### Login Page
- Centered card: max-w-md mx-auto
- Vertical centering: min-h-screen flex items-center justify-center
- Logo/title above form, form fields stacked (space-y-4)

### Dashboard
- 4 summary cards at top (grid with gap-6)
- Chart section below (mb-8)
- Device table at bottom (full width)

### Device Tables Pages
- Page header with title + action button (flex justify-between)
- Filter/search bar (mb-6)
- Full-width table
- Pagination controls (bottom, right-aligned)

### Monitoring Page
- Device selector dropdown (top)
- 2-column grid: Left (metrics cards stacked), Right (protocol chart)
- Event log table below (full width)

### Logs Page
- Filter controls at top (date pickers, dropdowns in flex row)
- Full-width table with sticky header
- Export button (top-right)

---

## Animations

**Minimal Approach:**
- Page transitions: None (instant navigation)
- Data updates: Gentle fade on new rows/alerts (duration-200)
- Modals/drawers: Slide animation (duration-300)
- Button hovers: Background transition (duration-150)
- Chart updates: Built-in Chart.js animations only

---

## Accessibility

- All interactive elements: Minimum 44x44px touch target
- Tables: Proper thead/tbody structure, scope attributes
- Status badges: aria-label with full status description
- Form inputs: Associated labels (not just placeholders)
- Keyboard navigation: Focus visible states on all controls
- Icon buttons: aria-label for screen readers