# 2026-09-17 Storefront design spec: grilling

Erik's answers (asked in two batches, recommendation first):

- Brand name **Unieke Pubquiz**, wordmark only; no logo, colours or fonts exist yet.
- Audience: friends and family at home. Vibe: **clean modern** (white, one accent, sans-serif), not the warm-pub look I recommended.
- Home page is the landing page with the configurator on it (hero, configurator, how it works, what you get, FAQ; no testimonials until real ones exist).
- Buy flow: **Bestellen** goes straight to checkout, no cart stop; the cart stays reachable from the header for "add another quiz".
- Erik asked whether `/prototype` is useful here: yes, the UI branch, adapted to static HTML (three structurally different variants, `?variant=` switcher) because a child-theme prototype costs a wp-env round trip per tweak.

Fixed by me (95% rule), to go into the spec as decisions:

- Keep **Storefront as the parent theme**, whole look in a **child theme** (`shop/themes/unieke-pubquiz/`, bind-mounted like mu-plugins). What Erik sees today is Storefront's default CSS; a ready-made free theme would give someone else's look and still need the product-fields, cart and checkout restyled. Erik's "100% in for a better free theme" read as "better look", stated openly so he can push back.
- Fonts self-hosted (no Google Fonts requests in production), no stock photos, inline SVG only, mobile-first, WCAG contrast 4.5:1.
- Checkout, order-received, My Account and the cart page are restyled by the child theme in the winning variant's style, no bespoke layouts.
- WooCommerce customer mails get the wordmark and accent through WooCommerce's own email settings (free, built in), no custom templates.
- "What you get" shows placeholder page thumbnails until the PDF design spec lands; footer carries Privacy / Voorwaarden / Contact slots with placeholder pages (content belongs to the deployment spec).
- No analytics, no cookie banner in this spec.

Prototype dispatched to a Sonnet agent on branch `prototype-storefront` (`shop/prototype/index.html`, variants A "Configurator first", B "Story first", C "Compact card"); Erik picks, then `to-spec`.

## Prototype verdict and competitor research

- Prototype (branch `prototype-storefront`, ba49012): **B "Story first"** wins on structure; accent deep green `#1f5c45`, Archivo headings, Work Sans body (fixed by me, Erik can swap the accent).
- Erik brought a competitor analysis (`docs/research/2026-09-competitor-analysis.md`, from a claude.ai deep-research chat). Outcomes for the storefront spec: withdrawal-right waiver checkbox at checkout confirmed in the order mail; footer legal block (company, KvK, BTW-ID, address, email; links Voorwaarden, Privacy, Herroeping, Cookies, texts in the deployment spec); "Bekijk een voorbeeld" slot in "Wat krijg je"; copy leads with unique-per-order, category/difficulty/language choice, no repeats; Dutch/Nederland only, Belgium later; prices incl. BTW; working price **€19,95** (mid tier, Erik's call).
- Roadmap outcomes: next spec is **deliverables design** = PDF styling + a questions-only PowerPoint in every zip (picture images, music cue slides, no answers) + host score sheet as the last page of the quizmaster PDF. Then a **free sample** spec: one fixed Composition re-rendered with the layout via the recompose script, delivered as a €0 WooCommerce product so the email gate and the no-repeat rule come for free. Mollie later (no recurring fee). Theme quizzes are Categories with content, no code.

## Spec published

- #142 "Spec 6: storefront design" (ready-for-agent). Seams: rendered HTML over HTTP from wp-env, curl checkout POST, Mailpit, the bootstrap's unit test, screenshots at 375/1280 for Erik's visual acceptance. Follow-up issues filed from the discussion: #140 refund revokes downloads, #141 self-service re-render of an expired download (needs grilling). Next: `to-tickets` on #142.
