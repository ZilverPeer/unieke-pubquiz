# Prototype: storefront landing page

**Question:** What should the Unieke Pubquiz shop's landing page look like? (The landing page is the product page — configurator, "hoe werkt het", "wat krijg je", FAQ, footer, all on one scroll.)

**Variants** — open `index.html` in a browser, `?variant=A|B|C` (floating pill at the bottom also switches, arrow keys work):

- **A — Configurator first**: configurator is the hero, two-column on desktop (copy left, configurator card right); warm orange accent, geometric heading font (Poppins) + humanist body font (Source Sans 3).
- **B — Story first**: long-scroll narrative — big typographic hero, then "hoe werkt het", then "wat krijg je" as a horizontal scroll spread, then the configurator full-width with the three fields as three big side-by-side steps, then FAQ; deep green accent, high-contrast display font (Archivo, weight 900 headings / Work Sans body).
- **C — Compact card**: one centred card is the whole store (wordmark, pitch, fields, price, Bestellen); info sections collapsed into accordions below; magenta/pink accent, single variable font throughout (Plus Jakarta Sans).

## Verdict

_(Erik fills this in after flipping through the three.)_

Erik, 2026-09-17: **B (Story first)** wins on structure. Accent deep green `#1f5c45`, Archivo headings, Work Sans body, carried into the storefront design spec as fixed decisions. This branch stays as the reference for the child-theme implementers until the spec's tickets are merged, then it is deleted.
