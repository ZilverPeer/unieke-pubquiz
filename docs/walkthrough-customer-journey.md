# Walkthrough: the customer journey in the local shop (ticket #59)

For Erik, to judge the shop as a customer would experience it. Every command below is the exact PowerShell form -- run them from a PowerShell prompt in the repo root. `curl.exe` (not the `curl` alias for `Invoke-WebRequest`) is used for every scripted HTTP step, so the browser steps have a scriptable equivalent when a browser isn't available.

## The one command

```powershell
npm run loop:up
```

Starts the local Supabase stack (unless already running -- never resets it), the shop (wp-env, Mailpit, the cron ticker), and the app with the pg-boss worker. Safe to run again while everything is already up (see `docs/runbook-local-loop.md`). It prints, at the end:

- **Shop:** http://localhost:45330
- **Mailpit:** http://127.0.0.1:45332
- **App:** http://localhost:3000 (the download route; you never navigate here directly except via a download link)
- the app log path (`.local/next-dev.log`), if anything looks stuck

When you're done: `npm run loop:down` (see the end of this document).

## The product page

Open http://localhost:45330/product/pubquiz/ in a browser. It's Dutch: "Pubquiz – digitale download", &euro;14,95, with three always-visible fields above the price (ticket #72):

- **Taal** -- Nederlands (preselected) / Engels
- **Moeilijkheid** -- Makkelijk / Gemiddeld / Moeilijk / Gemengd (preselected)
- **Categorieën** -- a group of checkboxes, one per seeded Category's Dutch name (currently Sport, Geschiedenis, Muziek, Aardrijkskunde, Wetenschap, Film en TV, Literatuur, Algemene Kennis -- whatever the local Supabase stack's seed has), none preselected, capped at 8 -- checking a 9th shows "Kies maximaal 8 categorieën." and the item is not added. Below it: "Zonder keuze krijgt elke ronde een willekeurige categorie. Kies categorieën als je ze in je quiz wilt." -- picking nothing is a valid, explained choice (the sampler then gives every round a random, distinct Category, per CONTEXT.md "Quiz"); picking *k* Categories cycles those *k* picks evenly over the 8 rounds, in the order you checked them.

Check zero to eight boxes, then click **Toevoegen aan winkelwagen**.

**Curl equivalent** (a fresh cookie jar per attempt keeps the cart session; the Pubquiz product id varies per instance, so it's read from `.local/shop-setup.json`, the same file `loop:up`'s "Product: #N" line reads; `wapf[field_categories][]` repeats, once per pick, in pick order -- three picks below, so the sampler's cycle rule gives 3/3/2 rounds per pick, per CONTEXT.md "Quiz"):

```powershell
$productId = (Get-Content .local/shop-setup.json | ConvertFrom-Json).productId
curl.exe -s -c cookies.txt -b cookies.txt `
  -d "quantity=1" -d "add-to-cart=$productId" -d "wapf_field_groups=$productId" `
  -d "wapf[field_locale]=nl" -d "wapf[field_difficulty]=easy" `
  -d "wapf[field_categories][]=1" -d "wapf[field_categories][]=2" -d "wapf[field_categories][]=3" `
  "http://localhost:45330/product/pubquiz/"
```

## Checkout with the test gateway

Click through to **Winkelwagen** then **Naar de kassa** (or go straight to http://localhost:45330/afrekenen/). The checkout form asks only for **Voornaam**, **Achternaam** and **E-mailadres** -- no address fields. Below that, a checkbox: **Een account aanmaken?** -- tick it once (see "My Account downloads" below) to see that path too.

**Use a fresh e-mail address every time.** The no-repeat rule means Compositions never reuse the same Item pool for the same billing email across orders -- reusing an address doesn't break anything, it's just less interesting to look at.

The only payment method is **Test payment (local only)** (`pubquiz_test_gateway`), selected by default -- it always succeeds. Click **Plaats bestelling**.

**Curl equivalent**, continuing the same cookie jar (scrape the checkout nonce first, then submit):

```powershell
curl.exe -s -c cookies.txt -b cookies.txt "http://localhost:45330/afrekenen/" -o checkout.html
$nonce = (Select-String -Path checkout.html -Pattern 'woocommerce-process-checkout-nonce" value="([a-f0-9]+)"').Matches[0].Groups[1].Value
$email = "you-$(Get-Date -UFormat %s)@example.com"

curl.exe -s -c cookies.txt -b cookies.txt `
  -d "billing_first_name=Erik" -d "billing_last_name=Test" `
  -d "billing_email=$email" -d "billing_country=NL" `
  -d "payment_method=pubquiz_test_gateway" `
  -d "woocommerce-process-checkout-nonce=$nonce" -d "_wp_http_referer=/afrekenen/" `
  "http://localhost:45330/?wc-ajax=checkout"
```

The JSON response carries `"result":"success"` and a `redirect` URL -- the order-received page below. Add `-d "createaccount=1"` to also create an account (see "My Account downloads").

## The order-received page

Redirects to `http://localhost:45330/afrekenen/order-received/<order id>/?key=...`. It reads, in Dutch:

> Bedankt. Je bestelling is ontvangen.
>
> Je quiz wordt gemaakt. Je ontvangt binnen enkele minuten een e-mail met de downloadlink.

followed by the order summary (product, your picks, the total).

## The processing mail

Open Mailpit (http://127.0.0.1:45332) -- or, scripted:

```powershell
curl.exe -s http://127.0.0.1:45332/api/v1/messages
```

to list messages and get an `ID`, then:

```powershell
curl.exe -s "http://127.0.0.1:45332/api/v1/message/<message id>"
```

for one message's full text. Within a couple of seconds you'll see **"Je bestelling bij `<site name>` is ontvangen!"**, addressed to your billing email, with the same "Je quiz wordt gemaakt..." notice repeated and your order summary (Taal/Moeilijkheid/Categorieën, in Dutch, matching what you picked). `<site name>` is WordPress's own site title, which `wp-env` sets to the checkout directory's name (this worktree's folder -- locally, whatever `../Pubquiz-wt-*` or similar you're running from), so it varies by checkout; every mail subject below carries the same value.

If you ticked **Een account aanmaken?**, a second mail arrives: **"Je account bij `<site name>` is aangemaakt!"**, naming your username and a password-reset link (WooCommerce never mails a plaintext password) -- you don't need it for this walkthrough, since checkout already logs the new account in for the rest of your browser session.

A third mail, **"[`<site name>`]: Je hebt een nieuwe bestelling: #<n>"**, goes to the shop admin (also routed to Mailpit locally) -- not customer-facing, safe to ignore.

## Waiting for generation

Do nothing else. `npm run shop:up`'s cron ticker keeps WordPress's cron ticking every 5 seconds, so the `order.updated` webhook reaches the app worker on its own, and generation typically finishes within well under a minute. If nothing has happened after a minute or two, see `docs/runbook-local-loop.md` "Troubleshooting".

## The completed mail

A fourth mail arrives once every Quiz in the order is delivered: **"Je bestelling van `<site name>` is onderweg!"** (WooCommerce's own Dutch completed-order subject). It repeats the order summary and adds one row per Quiz (ticket #73): a plain link (no `target`) named after that Quiz's zip, with the picked Category names underneath as "Categorieën: ...":

- `pubquiz-<order number>-1-nl.zip` -- Categorieën: ...
- `pubquiz-<order number>-2-nl.zip` -- Categorieën: ... (only on a multi-Quiz order)

Each link is `http://localhost:3000/download/<token>/quiz.zip`, one distinct token per Quiz; the zip filename in the link text and in the download's `Content-Disposition` always matches (`quizZipFilename`, `src/domain/orders.ts`).

## Downloading the files

Click each link in your browser, or:

```powershell
curl.exe -o quiz-1.zip "http://localhost:3000/download/<token 1>/quiz.zip"
curl.exe -o quiz-2.zip "http://localhost:3000/download/<token 2>/quiz.zip"
```

Each zip unpacks to the four Deliverables (`quizmaster.pdf`, `picture-handout.pdf`, `answer-sheet.pdf`, `music-round.mp3`; a script and answer-sheet PDF around 15-30 KB, a picture hand-out PDF a few hundred KB depending on the images sampled, an MP3 under a megabyte).

## My Account downloads (an account created at checkout)

If you ticked **Een account aanmaken?**, the same download links also show up under **Mijn account -> Downloads** (http://localhost:45330/mijn-account/downloads/) for as long as your browser session (or cookie jar) stays logged in from checkout -- no separate login step needed right after placing the order. The page lists, per product: **Product / Resterende downloads / Vervalt / Download** -- one row per Quiz zip, each with **&infin;** (unlimited) and **Nooit** (never expires).

**Curl equivalent**, same cookie jar as the checkout call that had `-d "createaccount=1"`:

```powershell
curl.exe -s -c cookies.txt -b cookies.txt "http://localhost:45330/mijn-account/downloads/" -o downloads.html
```

## Placing a failing order on purpose

Two ways to make generation fail on purpose (both documented in `shop/README.md`/`docs/runbook-local-loop.md` "A failing order"): a single pick (which cycles onto all 8 slots) whose Category has too few Items for the requested difficulty/amount, or -- simplest to reproduce on demand -- an unknown Category id, via the order script (bypasses the product page's Categorieën checkboxes, which only ever offer real Category ids):

```powershell
npx tsx scripts/shop/place-order.ts --email failing-order@example.com --locale nl --difficulty easy --pick 999999
```

This places a paid order directly (skipping checkout). Watch Mailpit: instead of a completed-order mail, an operator alert arrives, **"[Pubquiz] Order #<n> needs attention"**, with the private note's text, e.g.:

> A private order note starting with "[pubquiz]" was added to order #<n>:
>
> [pubquiz] line item <id>: unknown Category id "999999" at pick 1

The order itself stays `processing` forever (WooCommerce never sees a reason to move it) -- no completed mail, no download links. Check the status directly if you like:

```powershell
npx wp-env run cli -- wp wc shop_order get <order id> --field=status --user=admin
```

## Stopping everything

```powershell
npm run loop:down
```

Stops the app (and its worker), the shop (wp-env, Mailpit, the cron ticker), and the Supabase stack -- tolerant of anything already stopped, always exits successfully. Data is preserved; `npm run loop:up` picks up where you left off.
