# Accessibility statement

LectureFlow aims to be usable by the widest possible audience, including users
with visual, cognitive, motor, and auditory differences. This statement
describes the steps taken, the standards claimed, and the known limitations.

## Conformance claim

LectureFlow has been developed and tested for **substantial conformance with
WCAG 2.1 Level AA**. The claim is "substantial" rather than "full" because
full conformance requires manual assessment against all 50 success criteria
by a qualified auditor, which has not been carried out. What has been done:

- Automated testing with **axe-core 4.10.2** against `/login`, `/student`,
  and `/student/session/...` — 0 violations across `wcag2a`, `wcag2aa`,
  `wcag21a`, and `wcag21aa` rulesets.
- Automated testing with **Google Lighthouse 12.8.2** on `/login` and
  `/register` — 100/100 on the accessibility category.
- Manual keyboard navigation (arrow keys, Tab, Enter, Escape, F for focus
  mode) across all primary flows.
- Colour-vision-deficiency simulation using SVG `feColorMatrix` filters
  (Viénot, Brettel & Mollon, 1999 matrices) for protanopia, deuteranopia,
  tritanopia, and achromatopsia; captured as screenshots in
  `report/figures/accessibility/`.

## Features for specific user groups

### Users who are blind or have low vision

- A visually hidden `aria-live="polite"` region announces real-time events
  to screen readers that sighted users receive through visual changes:
  slide changes, feedback confirmations, question answered, and lecturer
  disconnect/reconnect.
- Interactive regions have semantic HTML (`<main>`, `<header>`, `<h1>`-`<h3>`)
  and ARIA labels on every icon-only control.
- Skip-to-main-content link on every page lets keyboard users bypass the
  navigation header.
- The dyslexia-friendly reading mode (see below) doubles as a comfortable
  reading mode for users with mild visual processing fatigue.
- Limitation: the PDF slide content is rendered on a `<canvas>`. Text inside
  the canvas is not selectable or screen-readable. This is a known
  limitation of `pdfjs-dist`; alt-text of slide content would need to be
  authored by the lecturer at upload time. Listed as future work.

### Users with colour vision deficiencies

- All feedback signals are conveyed redundantly: emoji (😊/😐/😕/😵) + text
  label ("Got it"/"Neutral"/"Confused"/"Lost") + colour. Meaning is never
  carried by hue alone.
- The lecturer's aggregate feedback chart uses the **Okabe-Ito palette** (a
  palette of eight hues that are distinguishable under deuteranopia,
  protanopia, and tritanopia), and renders the percentage as a text label
  inside each slice of the pie.
- Pace and confusion controls also use icons and text alongside colour.

### Users with dyslexia or reading fatigue

- Toggleable dyslexia-friendly reading mode (button labelled "Aa" in the
  page header). Enabling it:
  - Swaps the body font to **Atkinson Hyperlegible** (Braille Institute,
    2020) — a typeface designed for the widest possible legibility,
    including cases of low vision.
  - Loosens `line-height` to 1.55 and `letter-spacing` to 0.02em — matching
    the British Dyslexia Association style guide.
  - Caps long prose passages to 72ch to reduce line-length for saccade
    accuracy.
  - Prevents justified text (the BDA flags uneven inter-word spacing as
    disorienting).
- Setting persists to `localStorage` across sessions.

### Users with motor impairments

- Every interactive element sized to at least 44×44 px (WCAG 2.5.5 Target
  Size, Level AAA). Critical controls on the student session page
  (emoji feedback buttons) are larger.
- All flows are reachable by keyboard — arrow keys navigate slides, Tab
  moves focus, Enter/Space activate buttons, Escape exits focus mode.

### Users sensitive to motion

- All transitions are wrapped in a `@media (prefers-reduced-motion: reduce)`
  guard that reduces animation durations to 0.01ms when the user's OS
  signals motion sensitivity.

### Users with cognitive differences

- Single-purpose screens with one primary action per view.
- Form labels are explicit and associated with inputs (`htmlFor`/`id`).
- Error messages are announced to screen readers and shown as text (not
  colour-only signals).

## Standards and legislation context

- **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA** — the
  technical standard.
- **UK Public Sector Bodies (Websites and Mobile Applications) (No. 2)
  Accessibility Regulations 2018 (PSBAR)** — applies to public-sector
  websites in the UK. The University of Leeds qualifies. Any system
  deployed into the Leeds teaching environment would be expected to meet
  these regulations.
- **Equality Act 2010** — places a duty on service providers to make
  reasonable adjustments for disabled users.
- **BCS Code of Conduct §1(a)(b)** — professional obligation for computer
  scientists to consider the rights of third parties, including users with
  disabilities.

## Known limitations (future work)

1. **No third-party audit.** Commercial WCAG audits by firms such as Deque
   or TPGi were out of scope. Conformance claims are based on automated
   tools plus manual keyboard and colour-blindness testing.
2. **No screen-reader walkthrough** with NVDA (Windows) or VoiceOver
   (macOS/iOS). axe-core and Lighthouse detect technical defects but not
   all reading-order or content-logic issues that manual testing catches.
3. **PDF slide content** is not accessible through the canvas renderer.
   Lecturer-authored alt text per slide would be a substantial extension.
4. **Forced-colors (Windows High Contrast) mode** is not explicitly
   supported yet; relies on Chromium's default fallback behaviour.
5. **Automated contrast checks** cover foreground/background text; gradient
   backgrounds and images with overlaid text have been manually checked but
   not mechanically asserted in CI.

## How to report issues

If you encounter an accessibility barrier, please open an issue in the
project repository with the label `accessibility`.

---

Last reviewed: 2026-04-17.
Tools: axe-core 4.10.2, Lighthouse 12.8.2.
