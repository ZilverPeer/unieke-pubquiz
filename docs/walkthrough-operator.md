# Walkthrough: the operator admin area (spec 4, ticket #97)

For Erik, to judge the admin area the way `docs/walkthrough-customer-journey.md` judges the shop. Every command below is the exact PowerShell form -- run them from a PowerShell prompt in the repo root. Screenshots aren't included; every step names the exact URL, the exact Dutch button/field label to click or fill in (quoted, matching `messages/nl/*.json` verbatim), and the expected result on the next line.

Sample files are never committed (Content never enters git). Make your own before you start:

- A PNG for a Picture Item -- any image editor, or one line of `sharp` if you have Node open: `node -e "require('sharp')('some-photo.jpg').resize(800).toFile('sample.png')"`.
- An MP3 of at least 60 seconds from any song you own, for a Music Item -- the clip cutter needs a song longer than the 45-second maximum clip length to show the trim in action.
- The three CSVs for the bulk-import section are typed by hand from the downloaded templates -- see that section.

## Before you start

```powershell
npm run loop:up
```

Starts (or reuses) the local Supabase stack, the shop and the app with the worker -- see `docs/runbook-local-loop.md`. Prints, at the end, the app URL (`http://localhost:3000`) and the app log path. The admin area lives on the same app, under `/admin`; the customer-journey walkthrough uses port 3000 directly, this walkthrough does too.

Create (or reset) the one operator account, if you haven't already:

```powershell
npm run admin:operator -- operator@example.com Test-Passw0rd-85
```

Prints `operator@example.com created` the first time, `operator@example.com updated` on a later run (idempotent -- safe to re-run). These are the credentials every step below logs in with.

Open `http://localhost:3000/admin` in a browser.

## Log in

1. Navigate to `http://localhost:3000/admin`. **Expected result:** redirected to `http://localhost:3000/admin/login`, heading **"Inloggen"**.
2. Fill in **"E-mailadres"** with `operator@example.com` and **"Wachtwoord"** with `Test-Passw0rd-85`, click **"Inloggen"**. **Expected result:** redirected to `/admin`, showing the nav bar (**"Categorieën"**, **"Items"**, **"Dekking"**, **"Bestellingen"**) and the text **"Welkom in het beheergedeelte."**.
3. Try logging in with a wrong password once, for contrast. **Expected result:** stays on `/admin/login?error=1`, red text **"Ongeldig e-mailadres of wachtwoord."** appears above the form.
4. An email not on the operator allowlist (any address other than `operator@example.com`) is refused the same way -- **"Ongeldig e-mailadres of wachtwoord."** -- the login form never reveals whether the email exists.

## Switch the locale

1. On any admin page, click the locale button in the top-right of the header -- it shows the *other* locale's name, so with the UI in Dutch it reads **"Engels"**. **Expected result:** the whole admin UI (nav, page content, every label from here on) switches to English immediately, same URL, no full reload dialog. The button now reads **"Nederlands"**.
2. Click it again. **Expected result:** back to Dutch. The switch is a cookie (one year), so it survives closing the browser; the rest of this walkthrough assumes Dutch (the default) unless a step says otherwise.

## Categories

URL: `http://localhost:3000/admin/categories`.

The page renders the whole three-level tree (Category -> Subcategory -> Subsubcategory) at once, heading **"Categorieën"**. Every row shows `<Dutch name> / <English name>` (English name in gray), e.g. `Sport / Sports`, followed by two inline rename boxes (one per Locale, prefilled with the current name, button **"Opslaan"** each) and a **"Verwijderen"** button. A Category or Subcategory row's children are listed under it, followed by an "add child" mini-form scoped to that parent. The bottom of the page has a standalone **"Categorie toevoegen"** form for adding a new top-level Category.

There is no confirmation dialog anywhere on this page and no success toast -- every add, rename or delete takes effect by the tree re-rendering with the new state; that re-render **is** the success signal.

1. At the bottom of the page, fill the **"Categorie toevoegen"** form: **"Naam (NL)"** = `Walkthrough 97`, **"Naam (EN)"** = `Walkthrough 97`, click **"Categorie toevoegen"**. **Expected result:** a new top-level row `Walkthrough 97 / Walkthrough 97` appears in the tree.
2. Under that new Category, use its own "add subcategory" form (same two name fields, button **"Subcategorie toevoegen"**): NL/EN both `Walkthrough 97 sub`. **Expected result:** a `Walkthrough 97 sub / Walkthrough 97 sub` row nests under the Category.
3. Under that Subcategory, use its "add subsubcategory" form (button **"Subsubcategorie toevoegen"**): NL/EN both `Walkthrough 97 subsub`. **Expected result:** a `Walkthrough 97 subsub / Walkthrough 97 subsub` row nests under the Subcategory -- this is the Subsubcategory the Item sections below file their Items under.
4. Try to delete the `Walkthrough 97` Category now (click its **"Verwijderen"**), while it still has the Subcategory under it. **Expected result:** the Category is **not** deleted; a red line appears under its Delete button: **"Kan niet verwijderd worden: er verwijzen nog 1 onderliggende categorieën naar."** (the count is the live number of children).
5. Rename the Subsubcategory: in its NL rename box, change the text to `Walkthrough 97 subsub renamed`, click the box's own **"Opslaan"**. **Expected result:** the row's Dutch half updates to `Walkthrough 97 subsub renamed / Walkthrough 97 subsub` immediately; leave the EN half alone.
6. Rename it back to `Walkthrough 97 subsub` before moving on (the Item sections below refer to it by that name).
7. Try to submit an add-Category form with **"Naam (NL)"** left empty. **Expected result:** inline red text under that field, **"Vul een naam in."**, nothing is added.
8. Leave the three `Walkthrough 97*` rows in place for now -- the Item sections below file their Items under the Subsubcategory. "Archive and delete" at the end of this document deletes them in reverse order (Subsubcategory, then Subcategory, then Category), once no Item references the Subsubcategory any more.

## Text Items

URL for the list: `http://localhost:3000/admin/items`. Create: `http://localhost:3000/admin/items/new` (Text is the default kind; the same URL with `?kind=text` and the on-page **"Tekst-Item"** link both land here too).

1. Open `/admin/items`, heading **"Items"**. **Expected result:** a filter bar (search **"Zoeken"**, then selects **"Soort"**, **"Categorie"**, **"Subcategorie"**, **"Subsubcategorie"**, **"Moeilijkheidsgraad"**, **"Ontbrekende vertaling"**, a checkbox **"Toon gearchiveerde Items"**, submit **"Filteren"**), a table of existing Items (columns **"Vraag"**, **"Antwoord"**, **"Categorie"**, **"Moeilijkheidsgraad"**, **"Vertalingen"**, **"Acties"**), and a **"Nieuw Item"** link.
2. Click **"Nieuw Item"**. **Expected result:** `/admin/items/new`, heading **"Nieuw tekst-Item"**, with three kind links at the top -- **"Tekst-Item"** (current), **"Afbeelding-Item"**, **"Muziek-Item"**.
3. Set **"Subsubcategorie"** to the `Category / Subcategory / Subsubcategory`-style option for `Walkthrough 97 / Walkthrough 97 sub / Walkthrough 97 subsub` (the dropdown lists every real Subsubcategory this way). Set **"Moeilijkheidsgraad"** to **"Makkelijk"**.
4. Under **"Nederlands"**: **"Vraag"** = `Hoeveel is 2 + 2?`, **"Antwoord"** = `4`, leave **"Weetje (optioneel)"** empty.
5. Leave the whole **"Engels"** fieldset empty and click **"Item aanmaken"**. **Expected result:** the Item is created with only a Dutch Translation (a one-Locale Item is valid -- CONTEXT.md "Item": "an Item is only sampleable for a Locale if a translation exists for it"), redirected to `/admin/items`, the new row's **"Vertalingen"** column shows `en (ontbreekt)`.
6. Open it again (**"Bewerken"** on that row) and fill **"Vraag"** under **"Engels"** with `How much is 2 + 2?` but leave **"Antwoord"** empty, click **"Wijzigingen opslaan"**. **Expected result:** the save is refused, inline red text **"Vul zowel vraag als antwoord in, of laat deze taal volledig leeg."** appears under the English **"Antwoord"** field -- a Locale is either fully filled or fully empty, never partial.
7. Fill the English **"Antwoord"** with `4` too and save again. **Expected result:** succeeds, redirected to the list, **"Vertalingen"** now shows both Locales with no `(ontbreekt)` mark.
8. Edit it once more and change **"Moeilijkheidsgraad"** to **"Gemiddeld"**; the kind links are gone on this page (kind is fixed after creation) and the heading reads **"Item bewerken"** instead of **"Nieuw tekst-Item"**. Save. **Expected result:** the list's **"Moeilijkheidsgraad"** column now reads **"Gemiddeld"** for this row.
9. Leave this Item in place -- "Archive and delete" below uses it.

## Picture Items

Create: `http://localhost:3000/admin/items/new?kind=picture`, or click **"Afbeelding-Item"** from the New page's kind links.

1. Open the URL above. **Expected result:** heading **"Nieuw afbeelding-Item"**. Compared with the Text form: no **"Vraag"** field, only **"Antwoord"** and **"Weetje (optioneel)"** per Locale, plus a picture-only field labelled **"Afbeelding"** (a file input, PNG/JPEG only).
2. Set **"Subsubcategorie"** to the `Walkthrough 97` chain again, **"Moeilijkheidsgraad"** to **"Makkelijk"**. Under **"Nederlands"**: **"Antwoord"** = `Een testfoto`. Choose your sample PNG in **"Afbeelding"**. Click **"Item aanmaken"**.
   **Expected result:** redirected to `/admin/items`; the server resizes the upload to at most 1600 px on the long edge (never upscaled) and re-encodes it as JPEG before storing it in the `pictures` bucket -- there is no client-side preview or resize note on the form itself, only the file picker.
3. Edit the new Item. **Expected result:** the current image shows as a plain `<img>` under the label **"Huidige afbeelding"** (a 10-minute signed URL); the file field's label has switched from **"Afbeelding"** to **"Afbeelding vervangen"**.
4. Leave the file field empty and click **"Wijzigingen opslaan"** (only change something else, e.g. leave everything as-is). **Expected result:** the stored image is untouched -- an empty file field on edit never clears or re-resizes the existing image.
5. Edit again, this time choosing a *different* PNG in **"Afbeelding vervangen"**, save. **Expected result:** the preview after reopening the edit page shows the new image; the Item id and its row in the list are unchanged (replacement overwrites the same Storage object, past Compositions are unaffected).
6. Try creating a new Picture Item with no file chosen. **Expected result:** inline red text under the file field, **"Kies een afbeelding."**.
7. Try uploading a non-image file (rename any `.txt` to `.jpg` if you want to see the "not an image" path specifically, distinct from the MIME check). **Expected result:** either **"Alleen PNG- of JPEG-bestanden zijn toegestaan."** (wrong declared type) or **"Dit bestand is geen geldige afbeelding."** (right declared type, bytes aren't really an image) -- either way nothing is saved.
8. Leave this Item in place for "Archive and delete" below.

## Music Items

Create: `http://localhost:3000/admin/items/new?kind=music`, or **"Muziek-Item"** from the kind links.

1. Open the URL above. **Expected result:** heading **"Nieuw muziek-Item"**. No **"Vraag"** or **"Antwoord"** fields at all -- Music Items carry **"Artiest"** and **"Titel"** instead (both plain text, not per-Locale), plus a per-Locale checkbox labelled **"Beschikbaar in deze taal"** (this is how a Music Item's Locale presence is set, since there's no per-Locale text to leave empty) and the shared optional **"Weetje (optioneel)"** per Locale.
2. Set **"Subsubcategorie"** to the `Walkthrough 97` chain, **"Moeilijkheidsgraad"** to **"Makkelijk"**. **"Artiest"** = `Walkthrough Band`, **"Titel"** = `Walkthrough Track`. Tick **"Beschikbaar in deze taal"** under **"Nederlands"** only.
3. Choose your sample MP3 (60+ seconds) in **"Volledig nummer (upload)"**. **Expected result:** an audio player appears labelled **"Beluister voor het knippen"** -- play it to find a start point.
4. Set **"Startpunt (seconden)"** to `5` and **"Eindpunt (seconden)"** to `20` (a 15-second clip, inside the 10-45 second allowed range) -- or click **"Gebruik huidige afspeeltijd"** next to each field while the preview player is paused at the point you want, which copies the player's current time into that field. Click **"Item aanmaken"**.
   **Expected result:** the server cuts `[5s, 20s)` out of the upload with ffmpeg, stores only that clip in the `music-clips` bucket, and discards the full upload -- redirected to `/admin/items`.
5. Edit the new Item. **Expected result:** an audio player labelled **"Huidige clip"** plays back exactly the cut 15-second clip -- this is the "check the cut before it reaches customers" step from #80's user stories.
6. Try an end point before the start point (e.g. start `20`, end `5`). **Expected result:** inline red text under the End field, **"Vul een startpunt en eindpunt in, met het eindpunt na het startpunt."**.
7. Try a range shorter than 10 seconds or longer than 45 (e.g. start `0`, end `5`, or start `0`, end `50`). **Expected result:** same field, **"De geknipte clip moet tussen de 10 en 45 seconden lang zijn."**.
8. Re-cut: edit the Item again, upload a (possibly different) song in **"Volledig nummer (upload)"** with new start/end values, save. **Expected result:** the stored clip is replaced at the same Storage path -- the Item id is unchanged, confirmed by the list still showing one `Walkthrough Band - Walkthrough Track` row, not two.
9. Leave this Item in place for "Archive and delete" below.

## Archive and delete

Every Item's edit page and the Items list row both offer up to three lifecycle buttons: **"Archiveren"**, **"Herstellen"**, **"Verwijderen"** -- none of them ask for confirmation.

1. Open the Text Item you created above and click **"Archiveren"**. **Expected result:** the page stays put (no redirect), the button is now **"Herstellen"** and text **"Gearchiveerd op `<date>`"** appears; on the list, this row shows the extra label **"Gearchiveerd"** next to its actions and its **"Verwijderen"** button is gone (archiving hides delete -- an archived Item can only be restored or left alone, per the no-repeat rule needing its history).
2. Still on that page, click **"Herstellen"**. **Expected result:** back to live -- **"Archiveren"** returns, the archived-at text disappears, and the Delete button reappears since the Item was never actually used in a Composition.
3. On the Items list, tick **"Toon gearchiveerde Items"** and click **"Filteren"** once, then untick it again. **Expected result:** ticked, archived rows are mixed into the results alongside live ones (each still marked **"Gearchiveerd"**); unticked (the default), archived rows never appear.
4. Delete the Text Item, Picture Item and Music Item created above (their edit pages' **"Verwijderen"**, or the list row's own). **Expected result:** each is removed, cascading its Translations and (for Picture/Music) its detail row and Storage object; redirected to `/admin/items`, the row is gone.
5. Deleting an Item that a Composition references is refused instead -- there's no way to reach this locally without placing a real order (never place orders, per this walkthrough's own rules), so take it from the code: the Delete button is only rendered when the Item's usage count is zero, and if the delete were forced anyway the foreign key from `composition_items` refuses it, surfaced as **"Dit Item wordt gebruikt in een Compositie en kan niet verwijderd worden."** -- **verified by reading**, not exercised live.
6. Back on `/admin/categories`, delete `Walkthrough 97 subsub` (now that no Item references it), then `Walkthrough 97 sub`, then `Walkthrough 97`, each with that row's own **"Verwijderen"**. **Expected result:** each disappears from the tree in turn; deleting a parent before its child still refers to it is refused the same way "Categories" step 4 showed.

Rows created and removed by this section: 3 Categories (one per level) and 3 Items (one per kind) -- nothing left over.

## Bulk import

Reachable from the Items list's **"Importeren vanuit CSV"** link, which lands on the Text import page; a sub-nav on all three import pages switches kind: **"Tekst-Items importeren"** / **"Afbeelding-Items importeren"** / **"Muziek-Items importeren"**, at `/admin/items/import`, `/admin/items/import/pictures`, `/admin/items/import/music`. Every import validates every row exactly like the single-Item form and writes nothing at all if any row fails -- there is no partial import.

### Text

1. Open `/admin/items/import`, click **"Download CSV-sjabloon"**. **Expected result:** downloads `text-items-template.csv` with header
   `subsubcategoryId,difficulty,question_nl,answer_nl,fact_nl,question_en,answer_en,fact_en`
   and one example row (`0,medium,...`).
2. Recreate the `Walkthrough 97` Category tree from "Categories" above (three levels), note its Subsubcategory's numeric id (visible in the page URL when editing, or look it up via the Subsubcategorie dropdown on the New Item page -- hover/inspect, or just try `1` upward until a row imports; the template's example row uses `0` as a placeholder that never resolves). Replace the template's example row with two rows of your own under that Subsubcategory id, one with a deliberate mistake -- e.g. row 1 valid, row 2 with `difficulty` misspelled as `medum`.
3. On the import page, choose that CSV in **"CSV-bestand"**, click **"Importeren"**. **Expected result:** nothing is imported (row 2 fails validation); a table titled **"Fouten in het bestand"** appears with columns **"Rij"**, **"Veld"**, **"Reden"**, naming row 2's `difficulty` field and the reason.
4. Fix row 2, re-upload, click **"Importeren"** again. **Expected result:** green text **"2 Items geïmporteerd."**; both appear on `/admin/items` filtered to that Subsubcategory.
5. Limits (from the code, not exercised live -- 500 rows is impractical to hand-type for this walkthrough): a Text CSV over **500 rows** is refused whole with **"Het bestand bevat te veel rijen (maximaal 500)."**; the CSV file itself is capped at 1 MB.
6. Delete the two imported Items via the list (same lifecycle buttons as "Archive and delete").

### Pictures

1. Open `/admin/items/import/pictures`, click **"Download CSV-sjabloon"**. **Expected result:** `picture-items-template.csv`, header
   `file,subsubcategoryId,difficulty,answer_nl,fact_nl,answer_en,fact_en`
   example row `example.jpg,0,medium,Amsterdam,,Amsterdam,`.
2. Make a small zip containing two PNGs/JPEGs (your sample image, copied twice under different names, e.g. `pic1.jpg`, `pic2.jpg`). Write a two-row CSV under your `Walkthrough 97` Subsubcategory id, `file` column matching the zip entries by exact base file name -- one row correct, one row naming a file that isn't in the zip (e.g. `pic3.jpg`).
3. Choose the CSV in **"CSV-bestand"** and the zip in **"Zip-bestand met afbeeldingen"**, click **"Importeren"**. **Expected result:** refused, row-error table shows the bad row's `file` field with **"Geen bestand in de zip met deze naam."**; nothing is written (not even the good row).
4. Fix the CSV to name real zip entries for both rows and re-submit. **Expected result:** **"2 Items geïmporteerd."**, both resized/re-encoded the same way the single form does.
5. Limits (from the code): over **200 rows** refused with **"Het bestand bevat te veel rijen (maximaal 200)."**; the zip itself capped at **20 MB** with **"Het zip-bestand is te groot (maximaal 20 MB)."**.
6. Delete the two imported Items.

### Music

1. Open `/admin/items/import/music`, click **"Download CSV-sjabloon"**. **Expected result:** `music-items-template.csv`, header
   `file,subsubcategoryId,difficulty,artist,title,startSeconds,endSeconds,locales`
   example row `example.mp3,0,medium,Example Artist,Example Title,30,55,nl;en`.
2. Zip your sample MP3 under one name (e.g. `song1.mp3`). Write a two-row CSV: row 1 real (`song1.mp3`, a valid 10-45s range, `locales` = `nl`), row 2 naming a `locales` value that's neither `nl`, `en` nor `nl;en` (e.g. `de`).
3. Upload both, click **"Importeren"**. **Expected result:** refused, row 2's `locales` field shows **"De kolom \"locales\" moet \"nl\", \"en\" of \"nl;en\" zijn."**; nothing written, no clip cut.
4. Fix row 2's `locales` and re-submit. **Expected result:** **"2 Items geïmporteerd."** -- but only if both rows' `file` values match real zip entries; a two-row CSV needs a second zip entry too (copy the MP3 under a second name for row 2).
5. Limits (from the code): over **50 rows** refused with **"Het bestand bevat te veel rijen (maximaal 50)."**; zip capped at **20 MB** with the same message text as Pictures.
6. Delete the two imported Items, then delete the `Walkthrough 97` Category tree from "Bulk import" step 2 the same way "Archive and delete" did.

## Coverage

URL: `http://localhost:3000/admin/coverage`.

1. Open the page. **Expected result:** heading **"Dekking"**, intro text **"Aantal beschikbare Items per Categorie, Itemtype en Moeilijkheidsgraad, voor de datalocale hieronder. Dit is los van de taal van dit scherm."**, then one table per Category. Each table's rows are Itemtype (**"Tekst"** / **"Foto"** / **"Muziek"**), columns are Difficulty (**"Makkelijk"** / **"Gemiddeld"** / **"Moeilijk"** / **"Gemengd"**), and each cell is the count of eligible Items for that combination, in the chosen data locale.
2. A cell that can't fill a full Round of 10 is red and bold, with `(onvoldoende)` appended after the number, e.g. `3 (onvoldoende)` -- this is the same rule the sampler itself applies (eligible = a Translation exists for that Locale, not archived, no two Items sharing a Subsubcategory).
3. Above the tables, **"Datalocale"** offers **"Nederlands"** / **"Engels"** links -- this switches which Locale's counts the tables show, independent of the admin UI's own language switch from "Switch the locale" above (`?locale=nl` vs `?locale=en` on this page's own URL). Click **"Engels"**: the numbers may differ from the Dutch table, since Item pools can differ per Locale.
4. There is no separate "dry run" button or form on this page -- the always-on table above is the whole feature; the pre-payment checkout feasibility check (spec 5, `docs/walkthrough-customer-journey.md` "A refused checkout") shares the same underlying coverage function but runs at checkout time in the shop, not here.

## Orders

URL: `http://localhost:3000/admin/orders`.

A fresh `loop:up` has no Orders, so steps 2, 3 and 6 need at least one: place one first by following `docs/walkthrough-customer-journey.md` up to and including its checkout (it takes a minute and ends with an order number and the billing email you typed), then use that order number and email below. The retry step is described from the code and the customer-journey walkthrough's failing-order section (**verified by reading**); the search and detail views were verified live against existing orders.

1. Open `/admin/orders`, heading **"Bestellingen"**, one field labelled **"WooCommerce-bestelnummer of e-mailadres"** (placeholder **"Bijvoorbeeld 12345 of klant@voorbeeld.nl"**), button **"Zoeken"**.
2. Search a real order number (digits only). **Expected result:** a results table (**"Bestelnummer"**, **"E-mailadres"**, **"Bekijken"**) with at most one row, since an order number is unique.
3. Search a real billing email (must contain `@`). **Expected result:** a row per Order for that email, newest first.
4. Search something that's neither digits nor contains `@` (e.g. `abc`). **Expected result:** no search runs, red text **"Voer een bestelnummer (cijfers) of een e-mailadres in."**.
5. Search a real but nonexistent order number. **Expected result:** **"Geen bestelling gevonden."**.
6. Click **"Bekijken"** on a real result. **Expected result:** `/admin/orders/<id>`, heading **"Bestelling `<order number>`"**, the billing email, one **"Quiz `<n>`"** section per Quiz on the order with its status (**"In wachtrij"** / **"Wordt gegenereerd"** / **"Afgeleverd"** / **"Mislukt"**), a failure reason line if failed, a delivered-on date if delivered, and either **"Downloadlink beschikbaar"** or **"Nog geen downloadlink"**. Below that, a **"Samenstelling"** section: either **"Nog geen samenstelling voor deze quiz."**, or one line per Round slot (**"Tekstronde"** / **"Fotoronde"** / **"Muziekronde"**) naming the Category and the sampled Items' display text.
7. If `WOOCOMMERCE_URL` is configured (it is, once `shop:up` has run), a link **"Openen in WooCommerce"** opens that order's WooCommerce admin edit screen in a new tab, built as `<shop URL>/wp-admin/admin.php?page=wc-orders&action=edit&id=<woo order id>`.
8. **Retry (verified by reading only):** a **"Opnieuw proberen"** button appears only under a Quiz whose status is **"Mislukt"**. Clicking it asks `window.confirm` with **"Deze quiz opnieuw in de wachtrij zetten?"**; on confirmation it calls the same `failed -> pending` transition and re-enqueue the CLI's `--retry-quiz` flag uses, then shows green **"Quiz staat weer in de wachtrij."** and the page refreshes to show the new status. If the Quiz isn't actually `failed` any more by the time the click lands, it shows red **"Deze quiz kan niet opnieuw geprobeerd worden."** instead. This walkthrough does not manufacture a failed order to click the button live -- see `docs/walkthrough-customer-journey.md` "Placing a failing order on purpose" for how one gets created, and this walkthrough's own rules for why it isn't run here.

## Stopping

```powershell
npm run loop:down
```
