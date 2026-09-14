##Task1 - Fix barcode crfeation issue
    - Close look at 'Lava-Cake-3-Inch.docx'
    - The Best Before should be '2025/09/23' but it's showing '72722/72722/72722'

##Task2 - Inspect & fix batch - issue
    - The scanned barcode number should be matched with the number below it without '(' ')'
    - For example, '(01)10627146285749(15)250923(10)72722' shows '10627146285749' as barcode number
    - It's wrong, should be '0110627146285749152509231072722'
    - Another issue is, if I press regenerate button, the layout corrupted
    - My idea is, let's generate the full label with new barcode as we does in 'Create Label'
