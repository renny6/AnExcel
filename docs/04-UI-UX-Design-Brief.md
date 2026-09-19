# 04 — UI/UX Design Brief

**Hard constraint: no purple and no green anywhere in this design — not in the palette, not in status indicators, not in charts or badges.** This applies everywhere, including places a default design system might otherwise reach for green ("success") or purple (a common default accent) — pick a different color for those roles instead (see Status Color Mapping below).

| Document 04 — UI/UX Design Brief | |
|---|---|
| **Aesthetic** | Clean, minimal, institutional. This handles official academic records, so it should read as trustworthy and precise, not playful — closer to Stripe's dashboard or Linear than a consumer app. |
| **Primary Color** | `#2454FF` (blue) |
| **Background Color** | `#FFFFFF` (light mode, primary) / `#12151A` (dark mode, optional) |
| **Text Color** | `#1A1D23` (light) / `#E7E9EC` (dark) |
| **Accent / CTA Color** | `#2454FF` (blue) — primary actions, links, "Auto" status |
| **Font** | Inter for UI text; a monospace font (e.g. JetBrains Mono) for register numbers and marks specifically — numeric data lines up more legibly in mono, and it visually signals "this is data, verify it" |
| **Border Radius** | 6px — modest rounding, not fully sharp or overly soft |
| **Shadows** | Subtle card shadows only for elevation (batch cards, modals); no heavy drop shadows |
| **Dark/Light Mode** | Light mode primary (this is a daytime, desk-based review tool); dark mode optional, not the default |
| **Reference Apps** | Linear (clarity, restraint), Stripe Dashboard (dense data handled cleanly), Notion (calm structure) |
| **Key UI Patterns** | Tables (review queue, batch history) · cards (batch summary, dashboard tiles) · modals (manual-entry fallback, retention extension) · a persistent progress bar during processing · toast notifications · a side-by-side image + editable-field layout for the review screen |
| **Mobile Responsiveness** | Upload screen must work smoothly for camera capture on a phone browser. Review screen is desktop-optimized (it's detail work best done on a bigger screen) but must remain usable on a tablet at minimum. |
| **Accessibility** | Sufficient contrast on all text/background pairs · legible sizing for numeric mark data specifically, since misreading a digit here matters more than in typical UI copy · status indicators (Auto / Reviewed / Manual / Needs Review) must never rely on color alone — pair every color with a label or icon, both for accessibility and because the palette itself is deliberately restricted |

### Status Color Mapping (color + label/icon, never color alone)

| Status | Color | Note |
|---|---|---|
| Auto-approved | Blue (`#2454FF`) | Matches primary/accent — the default, expected path |
| Needs Review | Amber (`#F59E0B`) | Flagged, awaiting professor action |
| Manual | Slate gray (`#64748B`) | Hand-entered, bypassed recognition |
| Failed / Error | Red (`#DC2626`) | Reserved strictly for genuine errors |
