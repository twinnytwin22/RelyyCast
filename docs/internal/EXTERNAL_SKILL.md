# External Front-End Skill: Relyy Radio Console UI

Use this document with LLMs that do not have access to your repository, local machine paths, or project context.

## Purpose

Create UI components that match the Relyy Radio dashboard style: dense, clear, practical, and consistent with a broadcast control console.

## Design Intent

- Build operator-first interfaces, not marketing pages.
- Prefer compact layouts with stable panel structure.
- Favor clarity, scanning speed, and predictable interaction.
- Keep visual hierarchy driven by borders and surface layers.

## Surface System

- App background: soft blue-gray in light mode.
- Primary panel: clean pale surface with visible thin border.
- Inset/nested controls: slightly darker alternate surface with visible border.
- Dark mode:
  - Use `--theme-bg` only for full app background.
  - Use `--theme-surface` for panels.
  - Use `--theme-surface-alt` for nested blocks, controls, and rows.
  - Use `--theme-border`, `--theme-text`, `--theme-muted`, `--theme-primary`, and `--theme-accent` consistently.

Recommended patterns:

```tsx
// Primary panel
rounded border border-[#ccd9e6] bg-[#f8fbff]
dark:border-[var(--theme-border)] dark:bg-[var(--theme-surface)]

// Inset section
rounded border border-slate-300 bg-slate-50
dark:border-[var(--theme-border)] dark:bg-[var(--theme-surface-alt)]
```

Avoid using `dark:bg-[var(--theme-bg)]` inside regular cards.

## Spacing, Shape, and Typography

- Outer panel radius: `rounded`.
- Nested control radius: `rounded`.
- Typical spacing: `gap-2`, `gap-3`, `p-3`, `p-4`.
- Keep sections grouped and compact.
- Use normal system font stack for UI text.
- Use small uppercase eyebrow labels for metadata.
- Use `font-mono` only for operational values (timers, counters, URLs, queue stats).

Eyebrow label pattern:

```tsx
text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b7088]
dark:text-[var(--theme-muted)]
```

## Color Semantics

- Teal/primary: primary actions.
- Sky/cyan: active console emphasis.
- Emerald: success/ready.
- Amber: warning/pending.
- Rose/red: destructive/live/error.
- Do not invent new accent colors without semantic meaning.

## Component Strategy

When possible, base implementations on shared primitives equivalent to:

- `Card`
- `ActionButton`
- `ChoicePill`
- `IconButton`
- `ValueStepper`
- `TextField`
- `ModalShell`

If no primitives exist in the target codebase, mimic their behavior and visual language.

## Interaction Style

- Motion should be subtle and fast.
- Prefer border/color transitions over large transforms.
- Hover should improve clarity, not alter layout.
- Keep the interface responsive and quiet.

## Build Rules For New Components

Use this structure by default:

1. Small eyebrow or concise title
2. Short operator-facing helper copy
3. One or more inset sections for controls/stats/lists
4. Compact action row
5. Monospace only for operational values

Decision tie-breakers:

- Choose lower contrast over louder styling.
- Choose denser console layout over spacious marketing spacing.
- Choose shared primitives over bespoke controls.
- Choose consistent surface tokens over custom dark colors.

## Avoid

- Marketing-style hero headers and oversized typography
- Heavy shadows as the primary separator
- Deeply nested cards with unclear hierarchy
- One-off panel palettes
- Monospace body text
- Bright color fills without semantic meaning

## LLM Output Checklist

Before finalizing a component, verify:

- It visually fits a radio control-room dashboard.
- It uses a clear 3-layer surface hierarchy.
- It keeps borders visible and spacing compact.
- Dark mode uses theme tokens instead of hardcoded dark colors.
- Strong colors correspond to real status/action meaning.
- It can sit next to queue/now-playing/settings panels without looking imported.

## Prompt Snippet For Any LLM

```text
You are implementing a broadcast-console dashboard component.
Prioritize operator speed, compact layout, and clear hierarchy.
Use thin visible borders, rounded outer panels, rounded nested sections, and compact spacing (gap-2/3, p-3/4).
In dark mode use tokenized surfaces: --theme-surface for primary panels and --theme-surface-alt for nested blocks.
Do not use marketing-style typography or oversized headers.
Use monospace only for operational data (timers/counters/URLs/stats).
Use semantic color meanings only: teal primary, cyan active emphasis, emerald success, amber warning, red/rose destructive/error/live.
Reuse shared primitives where available (Card, ActionButton, ChoicePill, IconButton, ValueStepper, TextField, ModalShell).
```
