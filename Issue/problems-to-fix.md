##Task1 - Fix barcode creation issue
  - [x] There is a button called 'Validate'. When I click, if the GTIN is correct, I can see the message but it's not really eye catching. I want a green disposable info showing like in case of error.
    -> Green dismissible success banner shown on validation success (src/app/page.tsx success-banner).
  - [x] If the validation is failed due to wrong checksum digit, please suggest the correct checksum digit.
    -> gs1.suggestGtinCorrection() + gtinCheckDigit(); the form shows the correct check digit and a one-click "Use suggested GTIN" button. Unit-tested in gs1.test.ts.

##Task2 - Inspect & fix batch - issue
  - [x] Along with multiple docx, add an option to upload a .zip containing multiple .docx also
    -> Upload accepts .docx and .zip; ZIPs are extracted in the browser (JSZip) and each contained .docx is scanned.
  - [x] When Multiple docx is uploaded, if any of them has issues, display a button saying 'Fix and Download ALL'. Clicking that will download the correct ones and the fixed ones. The difference will be the fixed ones name will be prefixed '[FIXED]'. All the files will be compressed in a .zip and 'Labels.zip' will be downloaded.
    -> handleDownloadAll() repairs mismatched labels via /api/labels/repair, keeps correct originals unchanged, and bundles everything as [FIXED] <name> / <name> into Labels.zip.
  - [x] If all the uploaded files are okay, show 'All files are CORRECT, Still want to download?'. If clicked, then download
    -> The toolbar swaps to that exact button when no mismatches exist; it downloads all originals as Labels.zip.
  - [x] While fixing, a progressbar will be visible
    -> Progress bar with per-file count ("Fixing 3 of 12: <file>") while the batch runs.

##Task3 - Web Layout Fix
  - [x] The current layout is too messy for a business user / In the first page, with the header, the user should see only two big buttons on the middle of the screen and choose if he/she wants to create/inspect
    -> New home screen: header + two large choice cards centered; each mode has a Back button.
  - [x] Inspect layout should be more rich with at least one pie/bar chart reflecting how many files has errors and how many is okay.
    -> SVG donut chart (verified / needs fixing / unreadable) with legend in the batch summary row.
  - [x] There must be a 'CLEAR ALL' button to remove all uploaded files
    -> "Clear all" in the batch toolbar empties the queue.
  - [x] On the top, there must be an 'Install' button and icon that will work for web - in stall as a webpage, for iPhone - Add to home page, Android - Install as a pwd app.
    -> Install button with beforeinstallprompt support, iOS Add to Home Screen instructions, web app manifest + generated icons + minimal service worker (PWA installable).
  - [x] Up to you - Any other layout adjustment you think might be helpful for the business users
    -> Simplified queue (no checkboxes), user guide link in the header, clearer copy throughout.

##Task4 - Mobile Layout redesign
  - [x] The layout must be mobile compitable in all browsers / The text boxes should be one under another
    -> Viewport metadata added; all form fields and comparison columns stack under 700px.
  - [x] There will be navigations in the bottom
    -> Fixed bottom navigation (Home / Create / Check / Guide) shown only on mobile.
  - [x] Swapping and clicking Next, Previous will work
    -> Previous / Next pager cycles through uploaded labels; swipe left/right on the detail panel switches labels.
  - [x] The mobile layout will be minimal and independent of web layout
    -> Dedicated mobile media-query block with its own navigation, spacing, and stacked comparison card.

##Task5 - Business friendly documentation in a pdf
  - [x] Add necessary screenshots with arrows and steps
    -> /guide page with annotated diagram screenshots (numbered callouts + arrows) for Create, LOT/BB updates, and Check & fix.
  - [x] After creation, the business mainly changes LOT and BB later
    -> Guide section 2 covers the per-production-run workflow: edit the (15)/(10) parts of the number under the barcode in Word, upload in Check & fix, review, Fix — the BB/LOT text and the barcode artwork are updated to match the written number.
  - [x] Instruct, after the change how they will upload the files in inspect and how to fix and download
    -> Guide section 3 covers upload (.docx/.zip), reviewing the chart/queue, and Fix and Download ALL -> Labels.zip with [FIXED] prefix.
  - [x] Add proper easy instructions
    -> Plain-language numbered steps; "Download this guide as PDF" button prints to PDF with print-optimized styles.

##Task6 - Repair must not rebuild the label from the template
  - [x] The [FIXED] file broke the title into a third line ("Raspberry Cheese c ake C up s") and leaked the template's own title ("Lava Cake 3 Inch")
    -> Repair no longer regenerates from the template. The uploaded DOCX is patched in place, so the title runs, layout, and fonts stay byte-identical.
  - [x] Ingredients showed "Ingredients: Ingredients:"
    -> Ingredients text box is never rewritten during repair, so the prefix can no longer be duplicated.
  - [x] Font was lower than the original even though the text fit
    -> Auto-fit typography is a Create-only step; repair never re-picks font sizes.
  - [x] Repair should detect the barcode's size/position and replace only the barcode; correct wrong LOT / Best Before text
    -> /api/labels/repair scans the upload, regenerates the barcode PNG from the written truth, swaps the media at its detected extent (DrawingML + VML fallback), syncs the (01)... number, and patches LOT CODE / BEST BEFORE runs in place only when they differ. Verified end-to-end on the Raspberry sample: rescan status "ready", 0 mismatches.
