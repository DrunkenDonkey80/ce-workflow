# Design session guide

Craft rules adapted from OpenDesign (Apache-2.0); see design-guide.UPSTREAM.md. They apply on top of the frontend-design guidance above. The brief, the user's words and a chosen design system win over both.

## Files

- Build in your design folder only: `index.html` first, one HTML file per screen (`settings.html`, `checkout.html`), a shared `styles.css`, and images under `assets/`. Never write anywhere else, also not through bash.
- Keep `DESIGN.md` in the folder current: color tokens, type scale, spacing, radii, the main components and their states. The implementer builds from it.
- Keep each file under about 1000 lines; split scripts or styles into their own files when it grows.
- The page runs in a sandboxed frame with an opaque origin: `localStorage`, `sessionStorage` and cookies throw. Do not use them, or wrap them in try. Fonts, images and scripts from https URLs load.

## Start

1. Read the brief, every reference in `.pi/designs/references/` it names (`STYLE.md` and the screenshots), and the chosen system's `DESIGN.md` and `tokens.css` in full, once.
2. Before building, state the visual system in three to five lines: background and surface colors, the one accent, the type pairing and scale, the layout pattern. The user can redirect cheaply here.
3. Show a first full pass early, then refine.

## Content

- Real content only. No lorem ipsum, "Feature one / two / three", invented metrics ("10× faster", "99.9% uptime") or filler sections. An empty area is a composition problem, not a reason to invent words. Use the brief's real copy; label a placeholder as one when a fact is unknown.
- Ask before adding sections, pages or copy the user did not ask for.
- Microcopy with a voice: "Start tracking" beats "Get started".
- Borrow style and structure from references, never their logos, brand marks or copy.

## Inspectable elements

Give every element the user is likely to point at a stable `data-id="kebab-case"`: page regions (header, nav, main, section, aside, footer), headings, buttons, links, form controls, calls to action, cards and list items. Ids are unique per file, descriptive (`hero-cta`, `plan-card-pro`, `feature-card-2` when nothing better fits) and do not change between turns. Skip tiny decorative elements. Comments arrive as `(1) index.html @hero-cta <button> "Get started": make it bigger`: find the element by that id or selector in that screen.

## Visual craft

- Avoid the AI tells: default Tailwind indigo or violet accents (`#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`), two-stop purple-blue or blue-cyan hero gradients, emoji as icons, rounded cards with a colored left border, decorative blobs and waves, overused fonts (Inter, Roboto, Arial, Fraunces) and the unvaried Hero, Features, Pricing, FAQ, CTA sequence.
- About 80 percent proven patterns and 20 percent one distinctive choice: a typeface, a single color decision, an unexpected proportion, one memorable micro-interaction.
- Color: neutrals carry 70 to 90 percent of the pixels, one accent 5 to 10 percent, used at most twice per screen; semantic colors only for status. Name tokens by purpose (`--accent`, `--danger`), not by hue. Use CSS custom properties; avoid scattered raw hex values. Dark themes use near-black and near-white, not `#000` and `#fff`.
- Contrast: body text at least 4.5:1, large text and UI parts at least 3:1.
- Type: one multiplicative scale (1.2 or 1.25), six to eight sizes. Body 15 to 18 px with line height 1.5 to 1.6; headings tight (1.0 to 1.2). Measure 45 to 75 characters. Use `text-wrap: balance` on headings and `pretty` on paragraphs.
- Spacing on one 4 or 8 px rhythm; alternate dense and airy sections so the layout has tension.
- Icons: monoline SVG with `currentColor`, about 1.5 to 2 px stroke.
- Modern CSS is welcome: grid, container queries, `color-mix()`, `:has()`, view transitions.

## States and interaction

- Every interactive element has hover, `:focus-visible`, active and disabled styles.
- Every list, table, form or panel that shows data covers loading, empty (headline, one sentence, one action), error (what happened, why, what to do, input kept) and populated, and survives long text and missing optional fields. Show them in the screen (a state switcher marked `data-design-chrome`) or as their own screens.
- Forms: visible labels, validation on blur, errors next to the field.
- Touch targets at least 44 by 44 px on phone layouts; no hover-only actions there.
- Motion: 150 to 300 ms, ease-out, transform and opacity only, and honor `prefers-reduced-motion`.

## Accessibility

Semantic HTML first (`button`, `a`, `nav`, `main`, `label`), one `h1` per screen, headings in order, alt text on meaningful images and empty alt on decorative ones, a visible focus ring, no information by color alone, and `lang` on `html`.

## Responsive

Every screen works from 360 px phones to 1440 px desktops without horizontal scrolling. App designs are designed phone first; web pages check both ends.

The live device picker changes size only; input remains the viewer's browser capability. Headless `design look` defaults to mouse at every size; set `input: "touch"` and/or `reducedMotion: true` explicitly when checking those behaviors. Its report records the observed capability, not a real-device or Safari certification.

For async startup, assign a promise to `window.designReady` and resolve it after the page commits. Rendering waits for it, fonts, images, finite animations and stable layout within one five-second readiness budget; rejected or timed-out readiness returns an error instead of a settled picture. Explicitly infinite decorations do not block capture.

## Images

Use real visuals. Call `generate_image` for photos and illustrations and save them under `assets/` (reference them by relative path). Never hotlink placeholder services (unsplash, placehold.co, picsum). A neutral labelled placeholder box beats a wrong picture.

## Tweaks panel (prototypes)

When variations are worth trying live, add a small floating Tweaks panel with a few knobs (accent, type scale, density, dark mode). Mark its root `data-design-chrome` so it is not taken as product UI, apply values through CSS custom properties, and on every change call `window.dispatchEvent(new CustomEvent("design:tweaks", { detail: { accent: "#c2410c", scale: 1.125 } }))` so the user can keep them (the hub's preview passes them on).

## Decks (kind deck)

Copy this framework as is and only write slides and their styles (in `styles.css` or a second style block). Slides are 1920×1080; text is never below 24 px. Give each slide `data-screen-label` and a `data-id`. The slide position lives in `location.hash` (`#3` is slide 3).

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Deck title</title>
<style>/* deck framework: keep these rules */
html, body { margin: 0; height: 100%; overflow: hidden; background: #111; }
.deck-stage { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; overflow: hidden; background: var(--bg, #fff); }
.slide { position: absolute; inset: 0; overflow: hidden; }
.slide:not(.active) { display: none !important; }
</style>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="deck-stage">
  <section class="slide" data-screen-label="01 Title" data-id="slide-title"><!-- slide content --></section>
  <section class="slide" data-screen-label="02 Problem" data-id="slide-problem"><!-- slide content --></section>
</main>
<script>/* deck framework: keep this script */
(() => {
  const stage = document.querySelector(".deck-stage"), slides = [...stage.querySelectorAll(".slide")];
  const fit = () => { const s = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`; };
  const current = () => Math.min(slides.length, Math.max(1, parseInt(location.hash.slice(1), 10) || 1));
  const show = () => slides.forEach((slide, i) => slide.classList.toggle("active", i + 1 === current()));
  const go = n => { location.hash = String(Math.min(slides.length, Math.max(1, n))); };
  addEventListener("resize", fit);
  addEventListener("hashchange", show);
  addEventListener("keydown", e => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) go(current() + 1);
    else if (["ArrowLeft", "PageUp"].includes(e.key)) go(current() - 1);
    else if (e.key === "Home") go(1);
    else if (e.key === "End") go(slides.length);
  });
  fit(); show();
})();
</script>
</body>
</html>
```

## Check once, then stop

Build the whole change first. Then reread what you wrote for broken markup, and call `design look` once (Phone and Desktop, or Slide for decks) and fix what its report shows: overflow, page errors, failed files. Do not loop on renders. Reply in a line or two with what changed; never describe the design at length, the user sees it.
