---
name: frontend
description: SparkStock frontend and UI standards — design tokens, component patterns, auto-save, dialogs, buttons, phase colors. Load before building or modifying any UI component.
---

# SparkStock Frontend & UI Standards

Use this skill when building or modifying any UI component in SparkStock.

## Color & Tokens

- Never use hardcoded color utilities (`bg-white`, `text-slate-900`, `border-slate-200`, `amber-500`, etc.). Always use semantic design tokens (`bg-background`, `text-foreground`, `border-border`, `bg-muted`, `bg-popover`, etc.) to ensure theming and dark mode compatibility.
- When extracting Tailwind class strings into `lib/utils/` files, they are covered — `./lib/**/*.{js,ts,jsx,tsx}` is in `tailwind.config.ts` content. If you add a new top-level directory with class strings, add it to the content array.
- Prefer semantic tokens (`primary`, `destructive`, `success`, `ring`, `muted`, etc.) over raw color utilities.
- **OKLCH CSS variables:** When referencing design tokens outside Tailwind (e.g. inline `style`, arbitrary `[border-bottom-color:]` values), always use `oklch(var(--token))` — NOT `hsl(var(--token))`. Tokens are defined in OKLCH space; wrapping them in `hsl()` produces wrong colors (often solid black).

## Typography & Casing

- ALWAYS use Sentence case for UI text, buttons, and headers (e.g. "Nieuw project", not "Nieuw Project").

## Dates

- Day-of-week abbreviations are always 2 letters (`Ma`, `Di`, `Wo`, `Do`, `Vr`, `Za`, `Zo`). Use the `EEEEEE` token and capitalize the leading letter (date-fns nl returns lowercase): `format(d, "EEEEEE d MMM yyyy", { locale: nl }).replace(/^\w/, (c) => c.toUpperCase())`.

## Inputs

- No placeholders — inputs clean and empty by default.
- Globally hide number-input spinners.
- Focus ring: `focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2`.
- **Suppressing browser autofill/history in dialogs:** Wrap dialog form fields in `<form autoComplete="off" onSubmit={(e) => e.preventDefault()}>` AND add `autoComplete="off"` to each `<Input>` explicitly (the form-level attribute alone is not enough — per-element attribute takes precedence). Note: Chrome always shows saved email addresses for `type="email"` inputs regardless of `autoComplete` — this cannot be suppressed without removing the semantic type.

## Buttons & Icons

- Icons inside buttons sit on the left: `<Icon className="mr-2" /> Text`.
- Primary actions (e.g. Opslaan): `bg-primary text-primary-foreground hover:bg-primary-hover`. Never use raw opacity modifiers (e.g. `/90`) for primary hover — always use `bg-primary-hover` or `bg-primary-subtle`.
- Success states (e.g. Afronding phase): Button or Badge `variant="success"` (`bg-success text-success-foreground hover:bg-success-hover`). Never use raw opacity for success hover; use `bg-success-hover`.
- Destructive actions (e.g. Verwijderen): ALWAYS use `variant="destructive-outline"`. Neutral navy/bordered at rest, red on hover.

## Feedback & Dialogs

- Toasts: Solid white background, subtle border, dark text.
- Dialogs: Sentence case title, "X" close top-right, footer actions right-aligned.
- **Dialog layout — sticky footer, scrolling body (required):** The base `DialogContent`/`SheetContent` is a `flex flex-col overflow-hidden` column. Compose every dialog as three sections so action buttons stay visible on short viewports while only the middle scrolls:
  ```tsx
  <DialogContent>
    <DialogHeader>…title/description…</DialogHeader>
    <DialogBody>…all form fields / scrollable content…</DialogBody>
    <DialogFooter>…action buttons…</DialogFooter>
  </DialogContent>
  ```
  - `DialogHeader` and `DialogFooter` are `shrink-0` and carry their own padding — they never scroll. `DialogBody` (`flex-1 overflow-y-auto min-h-0`) is the **only** scroll region.
  - Put action buttons in `DialogFooter`, never inside `DialogBody`, or they get pushed off-screen.
  - Don't re-add container padding or `overflow-y-auto`/`max-h-*` scroll hacks on `DialogContent` — `DialogBody` owns scrolling and padding (`px-6 py-4`). Pass `className="p-0"` on `DialogBody` only for flush layouts (e.g. the two-column ArtikelCreate image+form dialog), then pad/scroll the inner column yourself.
  - Sheets use the identical pattern with `SheetHeader` / `SheetBody` / `SheetFooter`.
- **Touch / iPad:** Use `shouldSuppressInitialFieldFocus()` from `lib/device/pointer-environment.ts`. `DialogContent` skips auto-focus on open when this returns true (coarse pointer / no-hover). Full-page forms (e.g. login) use the same helper. Override `onOpenAutoFocus` only when you need custom focus behavior.

## Search Bars

- Must span full width of their container.
- Place a Lucide `Search` icon inside the input on the left.

## Interactive & Selected States

- Selectable items in Dropdowns/Popovers/Selects: hover `hover:bg-primary-subtle`, selected `bg-primary text-primary-foreground` (navy/dark — never white).
- Never use checkmarks for selected state; use `data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground`.
- Never use raw opacity modifiers (e.g. `/90`, `/20`) for hover/selected states.

## Section & Card Headers

- Do NOT use custom `.section-header` or `.section-title` classes. Use Tailwind utilities only:
  - Container: `flex items-center justify-between px-6 py-4 bg-muted/50 border-b border-border`
  - Title: `text-lg font-semibold text-foreground`

## Phase Colors

- Phase colours are centralised in `lib/utils/phase.ts`.
- Use `phaseChipClass` (with hover) for month-view chips.
- Use `phaseBlockClass` (with `border-l-2`, no hover) for week-view time-grid chips.

## Auto-Save Pattern

- Forms editing existing records must persist each field on focus-out. No fixed-footer "Opslaan" button.
- Use `<SavingDot show={...} />` (`components/veld/saving-dot.tsx`) next to each label while the request is in flight.
- Track saves in a `Set<string>` of field keys (`project:{field}`, `appt:{id}:{field}`, `row:{rowId}`, etc.).
- Selects, checkboxes, calendar popovers, and combobox `onSelect` change-and-save in the same event handler — pass the new value explicitly to the save call (closure is stale within the same event).
- Text inputs are safe to read state at `onBlur` — intermediate renders have already committed the latest value.
- Phase transitions call `flushPendingSaves()`, which blurs `document.activeElement` and waits up to 3s for the saving set to drain before running the transition.
