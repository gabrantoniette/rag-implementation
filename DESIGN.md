---
name: rag-implementation
description: A fact-checker's galley proof for a local GraphRAG chat, where every sentence is checked against its source.
colors:
  desk: 'oklch(0.905 0.009 245)'
  desk-ink: 'oklch(0.37 0.02 250)'
  paper: 'oklch(0.993 0.002 100)'
  paper-2: 'oklch(0.973 0.004 100)'
  ink: 'oklch(0.21 0.012 265)'
  ink-2: 'oklch(0.43 0.014 265)'
  rule: 'oklch(0.885 0.006 265)'
  rule-strong: 'oklch(0.76 0.008 265)'
  blue: 'oklch(0.49 0.17 262)'
  blue-wash: 'oklch(0.94 0.035 255)'
  blue-line: 'oklch(0.62 0.12 255 / 0.42)'
  blue-grid: 'oklch(0.62 0.12 250 / 0.11)'
  red: 'oklch(0.52 0.19 28)'
  red-wash: 'oklch(0.95 0.03 25)'
typography:
  display:
    fontFamily: "'Source Serif 4', Charter, 'Bitstream Charter', Georgia, serif"
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.01em'
  headline:
    fontFamily: "'Source Serif 4', Charter, 'Bitstream Charter', Georgia, serif"
    fontSize: '1.375rem'
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: '-0.005em'
  body:
    fontFamily: "'Source Serif 4', Charter, 'Bitstream Charter', Georgia, serif"
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.65
  excerpt:
    fontFamily: "'Source Serif 4', Charter, 'Bitstream Charter', Georgia, serif"
    fontSize: '0.9rem'
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.9375rem'
    fontWeight: 650
    lineHeight: 1.25
  apparatus:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 600
    lineHeight: 1.35
  margin:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 450
    lineHeight: 1.3
    fontVariation: "'wdth' 82"
    fontFeature: "'tnum'"
  slug:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.3
    fontVariation: "'wdth' 85"
    fontFeature: "'tnum'"
  stamp:
    fontFamily: "'Archivo', 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.875rem'
    fontWeight: 800
    lineHeight: 1
    letterSpacing: '0.12em'
    fontVariation: "'wdth' 75"
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: '0.88em'
rounded:
  hairline: '2px'
  tool: '3px'
  pill: '999px'
  hand-circle: '48% 52% 50% 50% / 52% 48% 52% 48%'
spacing:
  s-1: '0.25rem'
  s-2: '0.5rem'
  s-3: '0.75rem'
  s-4: '1rem'
  s-5: '1.5rem'
  s-6: '2rem'
  s-7: '3rem'
components:
  button-ask:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.tool}'
    padding: '0.6rem 1rem'
  button-ask-hover:
    backgroundColor: '{colors.blue-wash}'
    textColor: '{colors.blue}'
  button-ask-disabled:
    backgroundColor: '{colors.paper-2}'
    textColor: '{colors.ink-2}'
  button-rate:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.pill}'
    padding: '0.3rem 0.6rem 0.3rem 0.4rem'
  button-rate-good-pressed:
    backgroundColor: '{colors.blue-wash}'
    textColor: '{colors.blue}'
  button-rate-bad-pressed:
    backgroundColor: '{colors.red-wash}'
    textColor: '{colors.red}'
  link-button:
    backgroundColor: 'transparent'
    textColor: '{colors.blue}'
    padding: '0.2rem 0'
  mode-segment:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.tool}'
    padding: '0.32rem 0.7rem'
  mode-segment-checked:
    backgroundColor: '{colors.blue-wash}'
    textColor: '{colors.blue}'
  composer-field:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    padding: '0.45rem 0 0.4rem'
  source-slip:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    padding: '1rem 1.1rem 0.85rem'
  source-slip-quiet:
    backgroundColor: '{colors.paper-2}'
  source-number:
    textColor: '{colors.blue}'
    rounded: '{rounded.hand-circle}'
    size: '1.7rem'
  source-number-lit:
    backgroundColor: '{colors.blue}'
    textColor: '{colors.paper}'
  stamp-held:
    textColor: '{colors.blue}'
    typography: '{typography.stamp}'
    rounded: '{rounded.hairline}'
    padding: '0.32rem 0.5rem 0.26rem'
  margin-mark:
    textColor: '{colors.blue}'
    typography: '{typography.margin}'
    rounded: '{rounded.tool}'
    padding: '0.15rem 0.3rem'
  margin-mark-query:
    textColor: '{colors.red}'
  margin-mark-unchecked:
    textColor: '{colors.ink-2}'
  checker-file:
    backgroundColor: '{colors.paper}'
    padding: '1.5rem'
---

# Design System: rag-implementation

## Overview

**Creative North Star: "The Fact-Checker's Galley Proof"**

The answer arrives as set type on a white galley sheet lying on a cool grey desk, and a fact-checker has already worked it. Each sentence gets a blue-pencil tick or a red-pencil query in a margin on the same sheet, showing its exact support value. The sources are paper slips clipped to the desk beside the galley. Hovering a sentence lights it and lifts its slip. The trace opens as the checker's file, a sheet ruled with a faint non-repro blue layout grid. Every visual decision comes from that desk: paper, set type, hairline galley rules, two pencils, a rubber stamp and a paper clip.

Density is editorial on the type and tight in the apparatus. The answer is set generously (17px serif, 1.65 leading, about 66 characters to the line). Everything the checker writes is small condensed sans with tabular figures, so numbers stay comparable down the margin and across tables. A refusal ("held") is a correct outcome, so it is stamped and set in the checker's blue, never in error red. The only light is proof paper under desk light. No dark variant exists, and none was built on purpose.

The surface rejects the centered bubble column, the dark terminal, avatars and chat cards. Depth comes only from paper sitting on the desk.

**Key Characteristics:**

- Two type registers: Source Serif 4 for set copy, Archivo (condensed in the margin) for the checker's apparatus.
- Two pencils: non-repro blue for checks, actions and holds; red only for queries and failures.
- A margin column on the same sheet as the text, split from it by a single blue hairline.
- Hand-drawn SVG pencil strokes (tick, query circle, cross, dash, squiggle, paper clip), drawn with pathLength 1 so they can animate.
- Paper objects (galley, slips) carry the only shadows, and slips sit at a slight tilt.
- One signature motion: the check pass, strokes drawing down the margin in sentence order.

## Colors

A near-achromatic paper-and-ink palette with exactly two pencil hues. The values are OKLCH, as authored on `:root`.

### Primary

- **Non-Repro Blue Pencil** (blue): ticks, circled source numbers, citation superscripts, the HELD stamp, the verdict line, links, link-buttons, the focus ring, the caret, the selected mode and the rank bars in the trace. It is the checker's voice and the only action color.
- **Blue Wash** (blue-wash): the highlight under a lit sentence, a lit margin mark, matched excerpt text, the selected mode segment, the hovered Ask button and the "full" column in the mode matrix. It is also the text-selection color.
- **Blue Hairline** (blue-line): the vertical rule between the text and the margin, the sign-off rule and the checker's file border.
- **Layout Grid Blue** (blue-grid): the 1.5rem graph-paper grid behind the checker's file, and nothing else.

### Secondary

- **Red Query Pencil** (red): queried sentences (straight underline), query marks, values below threshold, invalid citations, warnings, error notes and the "Bad" rating. Its job is to flag a problem.
- **Red Wash** (red-wash): the lit background of a queried sentence or query mark, and the pressed "Bad" rating.

### Neutral

- **Proof Paper** (paper): the galley sheet, slips, the checker's file, the sticky slug and the composer backing.
- **Second Sheet** (paper-2): quiet (uncited) slips, the disabled Ask and the hovered mode segment.
- **Cool Desk Grey** (desk): the page background the paper lies on, and the slip tray on medium screens.
- **Desk Pencil** (desk-ink): text written on the desk rather than the paper (slip-column head meta, the "also retrieved" summary) and the paper clip.
- **Set Ink** (ink): set type, questions, table emphasis and the Ask outline.
- **Second Ink** (ink-2): metadata, labels, the unchecked state, placeholders and secondary table text.
- **Galley Rule** (rule): hairlines between takes, table rows and slip footers.
- **Strong Rule** (rule-strong): the slug and composer edges, slug dividers, table heads, the bar baseline, mode segment and rate button borders, quiet-slip borders and the scrollbar thumb.

### Named Rules

**The Two Pencils Rule.** Blue and red are the only hues. Blue means checked, supported, held or actionable. Red means queried, below threshold, invalid or failed. There is no green, no amber and no third accent.

**The Refusal Is Blue Rule.** A held answer, whether the evidence gate refused it or the model did, is set in blue with the HELD stamp. Red never touches a refusal.

**The Grid Stays In The File Rule.** The blue layout grid belongs only to the checker's file (trace). The galley and the slips stay plain paper.

## Typography

**Display Font:** Source Serif 4 (with Charter, Bitstream Charter, Georgia, serif)
**Body Font:** Source Serif 4 for set copy; Archivo (with Segoe UI, system-ui, sans-serif) for the apparatus and the base body face
**Label/Mono Font:** Archivo condensed through its width axis; ui-monospace / Cascadia Mono / Consolas for inline code

**Character:** A bookish transitional serif for whatever the model or the corpus "says", and a grotesque that compresses for whatever the checker writes about it. Both fonts are self-hosted variable woff2 files (OFL), split into latin and latin-ext subsets, with the latin files preloaded.

### Hierarchy

- **Display** (600, 1.75rem, 1.2, -0.01em): the first-page title on the blank "how to read a proof" take. It appears nowhere else.
- **Headline** (600, 1.375rem, 1.28, -0.005em, balanced wrap; 1.25rem at 760px and below): the question that heads each take.
- **Body / Set** (400, 1.0625rem, 1.65, auto hyphens, pretty wrap): the answer, inside a column clamped to 27rem to 35rem (about 66ch). The composer textarea uses the same face at 1.0625rem / 1.5, and the suggestion rows use it at 1rem / 1.4.
- **Excerpt** (400, 0.9rem, 1.55): source text on a slip, clamped to 7 lines until opened. The slip-column head uses serif 600 at 1rem.
- **Title** (Archivo 650, 0.9375rem, 1.25): slip titles. Trace section heads use Archivo 700 at 0.9375rem.
- **Apparatus** (Archivo 400, 0.9375rem, 1.5): the verdict, the held explanation, error notes and the legend.
- **Label** (Archivo 600, 0.8125rem): "Key points", "Try", mode segments, rate buttons and table heads.
- **Margin** (Archivo 450 / 650 for the value, 0.8125rem, 1.3, width 82%, tabular): margin marks and margin notes.
- **Slug** (Archivo 500, 0.8125rem, width 85%, tabular; the name in ink 700): the running head of the galley.
- **Stamp** (Archivo 800, 0.875rem, width 75%, 0.12em tracking, uppercase, rotated -2.5deg): the HELD stamp only.

### Named Rules

**The Two Registers Rule.** Serif is for set copy: the question, the answer, key points, excerpts, the composer input and suggestions. Archivo is for everything the checker or the machine reports. Never set apparatus in the serif, and never set an answer in the sans.

**The Condensed Margin Rule.** The narrower the space, the narrower the face: the margin is set at 82% width, the slug at 85%, slip sections at 88% and the stamp at 75%. Stay on Archivo's width axis instead of shrinking the size below 0.75rem.

**The Tabular Figures Rule.** Every number (scores, timings, quotas, ranks, citation numbers) uses tabular figures. Support values print to four decimals and are never rounded away.

## Layout

**Desktop (1200px and wider):** a centered two-column desk. The galley sheet sits on the left, with width = 3rem left pad + text column `clamp(27rem, 100vw - 50rem, 35rem)` + 2rem gap + 13rem margin + 2rem right pad. The 22rem slip column sits to its right, 2rem apart, with 1.5rem desk padding. Each take is a two-column row (text | margin) on the same sheet, and a 1px blue hairline runs down the gap's midline. The slug sticks to the top of the galley and the composer sticks to its foot. Both run full-bleed across the sheet. The slip column sticks at 1.5rem and scrolls on its own.

**Medium (1199px and narrower):** the slip column disappears from the desk. Each take gets a "sources" disclosure that opens a desk-grey tray of slips, filling a grid with columns of at least 16rem. The text column becomes `clamp(22rem, 100vw - 27rem, 37rem)` and the margin becomes 11rem.

**Narrow (760px and narrower):** the galley fills the screen with 1rem side padding and no shadow. The margin column and the blue hairline go away. Each verdict folds into the line as an inline mark (a 1rem icon plus a 0.75rem condensed value) after its sentence. The slug wraps. Ask sits beside the field, the mode segments scroll sideways, and tables show edge-fade scroll shadows plus a scroll hint.

**Rhythm:** a 7-step scale from 0.25rem to 3rem (s-1 to s-7). Takes are padded 3rem above and 2rem below (2rem above on phones) and separated by a hairline rule. A forgotten take gets a dashed rule. Blocks inside a take step by 1.5rem (s-5). Paragraphs step by 0.75rem and list items by 0.5rem. The last take reserves `100dvh - 15rem` so it can scroll up under the slug.

## Elevation & Depth

Depth is physical. Paper lies on the desk and gets a soft two-part drop shadow. Nothing printed on the paper gets one. The galley sheet and each slip carry the shadow. Inside the galley everything is flat and separated only by hairline rules, tonal washes and a bordered grid sheet. Slips also tilt slightly (-0.35deg, 0.25deg, -0.12deg in turn), and the paper clip overlaps the slip's top edge.

### Shadow Vocabulary

- **Paper on desk** (`box-shadow: 0 1px 1px oklch(0.25 0.03 250 / 0.08), 0 10px 26px -12px oklch(0.25 0.03 250 / 0.3)`): the galley at rest and every slip at rest.
- **Lifted slip** (`box-shadow: 0 2px 3px oklch(0.25 0.03 250 / 0.1), 0 20px 36px -14px oklch(0.25 0.03 250 / 0.42)`, together with `translate: 0 -3px`): the slip whose sentence or citation is lit.
- **Composer edge** (`box-shadow: 0 -12px 20px -16px oklch(0.25 0.03 250 / 0.3)`): an upward fall-off where the sticky composer covers text that scrolls under it.
- **Scroll edges** (scroll-attached 0.8rem gradients at `oklch(0.25 0.03 250 / 0.18)` with paper-coloured local covers): table overflow cues at 760px and below only.

### Named Rules

**The Paper Only Rule.** Only a sheet of paper on the desk casts a shadow. Panels, tables, buttons and the checker's file inside the galley stay flat.

**The Lift Means Linked Rule.** A slip lifts only when its source is lit from the text. Nothing lifts just to decorate a hover.

## Shapes

The geometry is square. Paper sheets have sharp corners. Small tools get barely-there radii: 2px on sentence highlights, the stamp, the focus ring and excerpt marks, and 3px on margin marks, the Ask button and the outer ends of the mode segmented control. The only fully round shape is the rate pill (999px). Source numbers and rank numbers are hand-drawn circles: a 1.5px blue ring with a slightly uneven radius (`48% 52% 50% 50% / 52% 48% 52% 48%`) so it reads as a pencil loop, not a badge. The composer field is a single 1.5px underline with no box. Pipeline stages are 3px blue top rules: dashed for a skipped stage, double (5px) for the gate that held. Icons are 2px round-capped strokes on a 24-unit grid, never filled.

## Components

### Buttons

Restrained and inked. The primary action stays in the apparatus register.

- **Shape:** gently squared (3px).
- **Primary (Ask):** a 1.5px ink outline on a transparent ground with ink text, Archivo 650 at 1rem, padded 0.6rem 1rem. It fills the margin column on desktop and sizes to its label on phones.
- **Hover / Focus:** the border and text turn blue over the blue wash (160ms ease-out). Focus shows a 2px blue outline offset 2px.
- **Disabled:** second-sheet ground, second-ink text, an inset strong-rule hairline and a not-allowed cursor.
- **Link-button (trace, compare, show passage, forget):** blue Archivo 600 at 0.875rem with no box, underlined on hover. A chevron rotates 180deg when expanded (220ms).

### Chips (rate)

- **Style:** pill (999px), paper ground, strong-rule border, ink Archivo 600 at 0.8125rem, with a 1rem tick or cross icon.
- **State:** "Good" turns blue on blue wash when hovered or pressed, and "Bad" turns red on red wash. `aria-pressed` carries the state.

### Segmented control (modes)

- **Style:** joined segments with 1px strong-rule borders, 3px corners on the outer ends only, and second-ink Archivo 600 at 0.8125rem.
- **State:** a hovered segment turns ink on the second sheet. The checked segment turns blue on blue wash with a blue border. A focused segment gets the 2px blue ring, and a disabled one drops to 0.55 opacity.

### Inputs / Fields (composer)

- **Style:** an underline only (1.5px ink), with a transparent ground, serif 1.0625rem text and a blue caret. It auto-grows from 2.6rem to 11rem.
- **Focus:** the underline turns blue and thickens to 3px (border plus a 1.5px shadow). There is no outline box.
- **Disabled:** the underline turns to strong rule.
- **Toggle (Retrieval only):** a native checkbox with a blue accent next to an ink-2 label.

### Navigation (slug)

The galley's running head: a sticky, full-bleed paper strip with a strong-rule bottom edge. Its items (project name in ink 700, domain and collection, model, quota, key) are divided by 1px strong-rule bars. The model name truncates first, with an ellipsis, and its full name stays in the tooltip. A `:free` suffix is its own element that never shrinks, so it is never cut off. Warnings and errors switch to red 600, and inline actions are underlined blue buttons.

### Margin mark (signature)

A grid of a 1.375rem icon and its text, pinned to the vertical offset of its sentence. A supported sentence gets a blue tick, a queried one a red circled query, and an unchecked one an ink-2 dash. The support value is set at 650 weight, with a 450 "why" line under it ("best of 1 and 2", "below 0.5998, source 1"). On hover, or when linked, the mark takes its pencil's wash. Unchecked marks are not interactive.

### Sentence states (signature)

Supported sentences carry no decoration at rest. A queried sentence gets a straight, solid red underline (1.5px, offset 0.28em, skip-ink off), never a wavy one. A lit sentence takes the blue wash, or the red wash when queried. Citation superscripts are blue Archivo 650 at 0.68em, and an invalid citation turns red.

### Source slip (signature)

A paper slip on the desk with a slight tilt, a paper-clip SVG overlapping its top edge, and the paper shadow. It holds a hand-circled number, an Archivo title with a condensed section line, a serif excerpt with matched spans in blue wash, a "show the whole passage" toggle, and a 0.75rem tabular footer of scores split off by a rule. When lit, the slip lifts and its number fills blue. A quiet slip (retrieved but not cited) lies flat and untilted on the second sheet with a strong-rule border.

### HELD stamp and sign-off (signature)

The stamp is a rubber-stamp block: a 2px blue border, condensed 800 uppercase type tracked 0.12em, rotated -2.5deg. It lands with a 420ms scale-in from 1.3 during the check pass. The sign-off sits under a blue hairline. It holds the blue verdict line (with any below-threshold share in red) and the rate chips in the margin.

### Checker's file (trace)

A flat paper sheet with a blue hairline border and a 1.5rem blue layout grid, padded 1.5rem (1rem on phones). Inside are pipeline stages as top-ruled strips, ledger tables (strong-rule head, rule rows, right-aligned tabular figures), score bars (a blue fill on a hairline track, with an ink tick at the threshold), graph paths, hit lists, and the mode matrix with hand-circled ranks and the full-mode column in blue wash.

### Motion

The check pass, in sentence order. Each sentence washes for 900ms on a 130ms stagger. Each margin stroke draws over 560ms (dash offset from 1 to 0, 90ms after its sentence). Slips slide in 18px from the right over 480ms on a 70ms stagger. All motion uses `cubic-bezier(0.16, 1, 0.3, 1)`. While the answer is being worked on, the working squiggle loops (1.4s linear). Hover washes take 160ms, and slip lifts and chevrons take 220ms. With reduced motion, every animation and transition collapses to 1ms.

## Do's and Don'ts

### Do:

- **Do** set the question, the answer, excerpts and the composer input in Source Serif 4, and everything the checker reports in Archivo.
- **Do** keep blue for checked, held and actionable things, and red only for queries, below-threshold values, invalid citations and failures.
- **Do** stamp a refusal HELD in blue and explain the gate or model reason in blue apparatus type.
- **Do** print support values to four decimals with tabular figures, right beside the mark they justify.
- **Do** draw icons as 2px round-capped SVG strokes with `pathLength="1"` so the check pass can draw them.
- **Do** give shadows only to paper lying on the desk (the galley and slips), using the paper-on-desk and lifted-slip values.
- **Do** narrow the face on Archivo's width axis (75% to 88%) when space is tight, rather than dropping below 0.75rem.

### Don't:

- **Don't** build a centered bubble column, chat avatars or a dark terminal look.
- **Don't** style a refusal as an error: no red, no warning icon on a held answer.
- **Don't** hide, fade or round away a queried sentence or its value. It stays underlined in red.
- **Don't** use a wavy spell-check underline for a query. The red pencil rule is straight and solid.
- **Don't** put a shadowed or rounded card inside the galley. Separate things with hairline rules, washes and the grid sheet.
- **Don't** add a third accent hue (green for success, amber for warning).
- **Don't** reuse the stamp's tracked uppercase for section labels. Labels stay in sentence case, Archivo 600 at 0.8125rem.
- **Don't** use icon fonts, emoji or text glyphs as icons.
