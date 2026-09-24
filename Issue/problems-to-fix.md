##Task1 - Fix barcode creation issue
    - [x] There is all hardcoded values intead of proper understandable placeholders
      -> Create form now starts empty with example placeholders on every field (page.tsx initialForm/formPlaceholders); template constants centralized in src/domain/label-template.ts and font rules in src/domain/label-typography.ts.
    - [x] If the Title is too large, we have to automatically reduce the font size to accomodate in two lines
      -> pickTitleFontSize() shrinks stepwise until the name fits two wrapped lines (tested in label-typography.test.ts).
    - [x] If the ingredients are too much, also need to reduce the font size to accomodate inside the box.
      -> pickIngredientFontSize() shrinks progressively at 120/280/400/520 characters.

##Task2 - Inspect & fix batch - issue
    - [x] The scanned barcode number should be matched with the number below it without '(' ')'
    - [x] For example, '(01)10627146285749(15)250923(10)72722' shows '10627146285749' as barcode number
    - [x] It's wrong, should be '0110627146285749152509231072722'
      -> gs1.toBarcodeNumber() strips ()/]C1/separators; scan results carry scannedBarcodeNumber/expectedBarcodeNumber and the UI shows the full number everywhere.
    - [x] The scanned value should be the full barcode number, currently only showing the number between (01)-(15).
    - [x] There will be full compare.
    - [x] The inspect will treat the written barcode number as the truth and check the scanned barcode and the LOT Number and Best Before date.
    - [x] For example here, the LOT Number must be '72722' and best before date '2025/09/23'
      -> barcode-scanner.evaluateScanResult compares GTIN, best-before (15), lot (10), and the full paren-stripped number; missing components are errors with stable codes (BEST_BEFORE_MISMATCH, LOT_MISMATCH, BARCODE_VALUE_MISMATCH).
    - [x] All errors must be detected and correctable.
      -> Repair regenerates the full label from the template with the scanned expected values, now preserving ingredients and storage instruction.
    - [x] If there is no error, should not show the correction button.
      -> Correction workspace and Replace Barcode button render only for labels with mismatches.
    - [x] The dashboard and create and inspect button is not user friendly at all. This is for business users. It must be easy for them to use and visually attractive.
      -> Numbered two-step mode switch with descriptive sublabels, plain-language hero/metrics, clearer comparison labels (written vs scanned), and friendlier button copy.
