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
