##project-idea
- Build a Next js app to deploy to vercel
- Make a eye catching user friendly layout for my fiverr client (DON'T Use fiverr logo/text)
- It has two purposes:
    - Create a new label tag as like in the folder 'sample'
    - There will be an interface where we can upload 1/multiple .docx label and it needs to identify which barcodes doesn't match with barcode number, Best Before date and LOT number

##description
- The labels will be identical as like 'sample' folder
- Investigate the 'sample' folder to understand the label template
- For label generation, the barcode number must be editable
- Barcode must be scannable and must be CANADA GTIN compliant
- All the info can be put in a user frindly interface
- Clicking 'Generate' will generate the full label in .docx format
- For label fix/bug test, the labels should be easily upload
- The interface should clearly test and scan all the labels for any errors and the top dashboard should clearly display how many and which labels has errors and needs to be fixed.
- To fix, user must be able to navigate one by one and fix
- For each label, user must be able to clearly see which places has errors
- Mostly, the error will be in the barcode number and the scanned value of the barcode.
- Fix will remove the old barcode and insert a new one
- A rectangle box will be displayed and will be resizable inside which the barcode will be placed
- The barcode number should be always treat correct
- The generated barcode should NOT contain barcode number on the bottom
- The barcode number must not include '(')'