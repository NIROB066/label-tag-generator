import Link from "next/link";
import { GuidePrintButton } from "./print-button";

const ink = "#17211f";
const line = "#c9c4b6";
const coral = "#e86f51";
const paper = "#fffdf8";
const muted = "#6e7773";

function Arrow({
  id,
  x1,
  y1,
  x2,
  y2,
}: {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <>
      <defs>
        <marker id={id} markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill={coral} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={coral} strokeWidth="2.5" markerEnd={`url(#${id})`} />
    </>
  );
}

function Callout({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" fill={coral} />
      <text x={x} y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">
        {n}
      </text>
    </g>
  );
}

function FieldRow({
  x,
  y,
  w,
  label,
  value,
  highlight = false,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <g>
      <text x={x} y={y - 5} fontSize="9" fill={muted} letterSpacing="1">
        {label.toUpperCase()}
      </text>
      <rect
        x={x}
        y={y}
        width={w}
        height="26"
        fill={paper}
        stroke={highlight ? coral : line}
        strokeWidth={highlight ? 2 : 1}
      />
      <text x={x + 8} y={y + 17} fontSize="11" fill={highlight ? coral : ink}>
        {value}
      </text>
    </g>
  );
}

export default function GuidePage() {
  return (
    <main className="guide-shell">
      <header className="guide-header">
        <div>
          <p className="eyebrow">Label Tag Studio</p>
          <h1>Business user guide</h1>
          <p className="guide-sub">
            Everything your team needs to create labels, update LOT numbers and best-before dates,
            check labels for errors, and download fixed files.
          </p>
        </div>
        <div className="guide-actions">
          <Link className="back-button" href="/">
            &larr; Back to the app
          </Link>
          <GuidePrintButton />
        </div>
      </header>

      <section className="guide-section">
        <h2>1. Create a new label</h2>
        <ol className="step-list">
          <li>Open the app and choose <strong>Create a label</strong>.</li>
          <li>Fill in the product details. The date field accepts typing (<em>YYYY-MM-DD</em>) or the calendar button.</li>
          <li>Press <strong>Validate</strong>. A green message confirms the barcode is correct. If the GTIN check digit is wrong, the app suggests the correct one — click <em>Use suggested GTIN</em>.</li>
          <li>Press <strong>Generate DOCX</strong> and the label downloads, ready to print.</li>
        </ol>
        <figure className="guide-figure">
          <svg viewBox="0 0 640 330" role="img" aria-label="Create label form with numbered steps">
            <rect x="1" y="1" width="638" height="328" fill={paper} stroke={line} />
            <rect x="20" y="16" width="360" height="298" fill="#fff" stroke={line} />
            <text x="36" y="42" fontSize="14" fill={ink} fontWeight="700">
              Label details
            </text>
            <FieldRow x={36} y={62} w={150} label="Product name" value="Raspberry Cheesecake" />
            <FieldRow x={196} y={62} w={150} label="Item number" value="GP2118" />
            <FieldRow x={36} y={118} w={310} label="GTIN / barcode number" value="10627146285749" />
            <FieldRow x={36} y={174} w={150} label="Lot code" value="72722" />
            <FieldRow x={196} y={174} w={150} label="Best before" value="2025-09-23" />
            <rect x="36" y="230" width="310" height="40" fill="#fff" stroke={line} />
            <text x="44" y="248" fontSize="9" fill={muted} letterSpacing="1">
              INGREDIENTS
            </text>
            <text x="44" y="262" fontSize="10" fill={ink}>
              Cream cheese, sugar, eggs, ...
            </text>
            <rect x="36" y="284" width="70" height="24" fill="#fff" stroke={line} />
            <text x="48" y="300" fontSize="10" fontWeight="700" fill={ink}>
              Validate
            </text>
            <rect x="116" y="284" width="120" height="24" fill={ink} />
            <text x="128" y="300" fontSize="10" fontWeight="700" fill="#fff">
              Generate DOCX
            </text>

            <Callout x={418} y={75} n={1} />
            <Arrow id="ga1" x1={430} y1={75} x2={352} y2={75} />
            <Callout x={418} y={131} n={2} />
            <Arrow id="ga2" x1={430} y1={131} x2={352} y2={131} />
            <Callout x={418} y={187} n={3} />
            <Arrow id="ga3" x1={430} y1={187} x2={352} y2={187} />
            <Callout x={418} y={296} n={4} />
            <Arrow id="ga4" x1={430} y1={296} x2={242} y2={296} />

            <text x="448" y="80" fontSize="11" fill={ink}>
              Product &amp; item details
            </text>
            <text x="448" y="136" fontSize="11" fill={ink}>
              GTIN barcode number
            </text>
            <text x="448" y="192" fontSize="11" fill={ink}>
              Lot code + best before date
            </text>
            <text x="448" y="301" fontSize="11" fill={ink}>
              Validate, then Generate
            </text>
          </svg>
          <figcaption>Fill the form top to bottom, then Validate and Generate DOCX.</figcaption>
        </figure>
      </section>

      <section className="guide-section">
        <h2>2. Changing the LOT number or best-before date later</h2>
        <p>
          In day-to-day use, the product, GTIN, and ingredients stay the same — only the lot and
          best-before date change between production runs. You do <strong>not</strong> need the
          Create form again: edit the barcode number text in Word and let <em>Check &amp; fix</em>{" "}
          update everything else.
        </p>
        <ol className="step-list">
          <li>
            Open the label file (<strong>.docx</strong>) in Microsoft Word.
          </li>
          <li>
            Change only the <strong>barcode number text printed under the barcode</strong>: update
            the date after <strong>(15)</strong> and the lot after <strong>(10)</strong> — for
            example <em>(01)10627146285749(15)260923(10)11722</em>. Save and close the file.
          </li>
          <li>
            Upload it in <strong>Check &amp; fix labels</strong> and review the analysis. The
            number written on the label is always treated as the truth.
          </li>
          <li>
            Press <strong>Fix</strong> (or <strong>Fix and Download ALL</strong>). The app updates
            the <strong>BEST BEFORE</strong> and <strong>LOT CODE</strong> text lines on the label
            and rebuilds the barcode artwork so it encodes exactly the written number.
          </li>
          <li>
            Download the fixed file (prefixed <strong>[FIXED]</strong>) and print it.
          </li>
        </ol>
        <figure className="guide-figure">
          <svg viewBox="0 0 640 250" role="img" aria-label="Edit the barcode number text in Word, then fix in the app">
            <rect x="1" y="1" width="638" height="248" fill={paper} stroke={line} />

            <rect x="20" y="16" width="290" height="218" fill="#fff" stroke={line} />
            <text x="36" y="42" fontSize="13" fill={ink} fontWeight="700">
              1. In Word: edit the number only
            </text>
            {[
              [36, 4], [42, 2], [46, 3], [51, 2], [55, 5], [62, 2], [66, 4],
              [72, 3], [77, 2], [81, 6], [89, 2], [93, 3], [98, 4], [104, 2],
              [108, 5], [115, 3], [120, 2], [124, 4], [130, 3], [135, 5],
              [142, 2], [146, 4], [152, 3], [157, 2], [161, 6], [169, 3],
            ].map(([bx, bw], index) => (
              <rect key={index} x={bx} y={56} width={bw} height={26} fill={ink} />
            ))}
            <text x="36" y="102" fontSize="10.5" fill={ink}>
              (01)10627146285749
              <tspan fill={coral} fontWeight="700">(15)260923(10)11722</tspan>
            </text>
            <text x="36" y="120" fontSize="9" fill={muted}>
              was (15)250923(10)72722 — only these two parts change
            </text>
            <text x="36" y="150" fontSize="9.5" fill={muted}>
              (15) = best-before date (YYMMDD)
            </text>
            <text x="36" y="166" fontSize="9.5" fill={muted}>
              (10) = lot code
            </text>
            <text x="36" y="196" fontSize="9.5" fill={ink}>
              Save and close Word, then upload the file.
            </text>
            <Callout x={272} y={98} n={1} />
            <Arrow id="gb1" x1={260} y1={98} x2={220} y2={98} />

            <rect x="340" y="16" width="280" height="218" fill="#fff" stroke={line} />
            <text x="356" y="42" fontSize="13" fill={ink} fontWeight="700">
              2. In the app: Check &amp; fix
            </text>
            <rect x="356" y="56" width="150" height="22" fill={coral} />
            <text x="366" y="71" fontSize="9.5" fontWeight="700" fill="#fff">
              Upload labels (.docx / .zip)
            </text>
            <rect x="356" y="90" width="248" height="34" fill="#fdf5f0" stroke={line} />
            <rect x="364" y="102" width="110" height="10" fill="#d8d4c6" />
            <rect x="540" y="98" width="56" height="14" fill="#fae5c9" />
            <text x="546" y="109" fontSize="8" fontWeight="700" fill="#a26024">
              MISMATCH
            </text>
            <rect x="356" y="136" width="90" height="24" fill={ink} />
            <text x="384" y="152" fontSize="10" fontWeight="700" fill="#fff">
              Fix
            </text>
            <text x="356" y="184" fontSize="9.5" fill={ink}>
              BEST BEFORE &amp; LOT CODE text updated
            </text>
            <text x="356" y="200" fontSize="9.5" fill={ink}>
              barcode rebuilt to match the number
            </text>
            <text x="356" y="216" fontSize="9.5" fill={ink}>
              download: [FIXED] label.docx
            </text>
            <Callout x={478} y={148} n={2} />
            <Arrow id="gb2" x1={466} y1={148} x2={448} y2={148} />
            <Callout x={596} y={211} n={3} />
            <Arrow id="gb3" x1={584} y1={211} x2={524} y2={211} />
          </svg>
          <figcaption>
            Edit the number under the barcode in Word (1), upload it, then Fix (2) updates the text
            lines, rebuilds the barcode, and downloads the [FIXED] file (3).
          </figcaption>
        </figure>
      </section>

      <section className="guide-section">
        <h2>3. Check labels and download fixed copies</h2>
        <ol className="step-list">
          <li>Choose <strong>Check &amp; fix labels</strong>.</li>
          <li>
            Upload one or more <strong>.docx</strong> labels, or a <strong>.zip</strong> that
            contains several labels.
          </li>
          <li>The chart and queue show how many labels are verified and how many need fixing. Open any label to see the written number versus the scanned barcode.</li>
          <li>
            Press <strong>Fix and Download ALL</strong>. A progress bar shows the work. You get{" "}
            <strong>Labels.zip</strong> containing every file — correct ones unchanged, repaired
            ones prefixed with <strong>[FIXED]</strong>.
          </li>
          <li>If every file is already correct, you can still download them all with the <em>All files are CORRECT, still want to download?</em> button.</li>
        </ol>
        <figure className="guide-figure">
          <svg viewBox="0 0 640 330" role="img" aria-label="Inspect screen with chart, queue, and fix button">
            <rect x="1" y="1" width="638" height="328" fill={paper} stroke={line} />
            <rect x="20" y="16" width="290" height="298" fill="#fff" stroke={line} />
            <rect x="24" y="30" width="150" height="24" fill={coral} />
            <text x="34" y="46" fontSize="10" fontWeight="700" fill="#fff">
              Upload labels (.docx / .zip)
            </text>

            <rect x="40" y="80" width="250" height="44" fill="#f7f5ee" stroke={line} />
            <rect x="48" y="96" width="120" height="10" fill="#d8d4c6" />
            <rect x="236" y="92" width="44" height="14" fill="#dcece1" />
            <text x="242" y="103" fontSize="8" fontWeight="700" fill="#3c785b">
              READY
            </text>

            <rect x="40" y="132" width="250" height="44" fill="#fdf5f0" stroke={line} />
            <rect x="48" y="148" width="120" height="10" fill="#d8d4c6" />
            <rect x="228" y="144" width="52" height="14" fill="#fae5c9" />
            <text x="233" y="155" fontSize="8" fontWeight="700" fill="#a26024">
              MISMATCH
            </text>

            <rect x="40" y="184" width="250" height="44" fill="#f7f5ee" stroke={line} />
            <rect x="48" y="200" width="120" height="10" fill="#d8d4c6" />
            <rect x="236" y="196" width="44" height="14" fill="#dcece1" />
            <text x="242" y="207" fontSize="8" fontWeight="700" fill="#3c785b">
              READY
            </text>

            <circle cx="420" cy="90" r="40" fill="none" stroke="#d8d4c6" strokeWidth="14" />
            <circle
              cx="420"
              cy="90"
              r="40"
              fill="none"
              stroke="#3c785b"
              strokeWidth="14"
              strokeDasharray="126 126"
              transform="rotate(-90 420 90)"
            />
            <circle
              cx="420"
              cy="90"
              r="40"
              fill="none"
              stroke="#a26024"
              strokeWidth="14"
              strokeDasharray="63 189"
              strokeDashoffset="-126"
              transform="rotate(-90 420 90)"
            />
            <text x="420" y="88" textAnchor="middle" fontSize="16" fontWeight="700" fill={ink}>
              3
            </text>
            <text x="420" y="102" textAnchor="middle" fontSize="8" fill={muted}>
              labels
            </text>
            <text x="475" y="72" fontSize="10" fill={ink}>
              2 verified
            </text>
            <text x="475" y="88" fontSize="10" fill={ink}>
              1 needs fixing
            </text>

            <Callout x={392} y={200} n={1} />
            <Arrow id="gc1" x1={404} y1={200} x2={330} y2={200} />
            <Callout x={392} y={252} n={2} />
            <Arrow id="gc2" x1={404} y1={252} x2={336} y2={252} />
            <text x="416" y="205" fontSize="11" fill={ink}>
              Uploaded labels + status
            </text>
            <text x="416" y="257" fontSize="11" fill={ink}>
              Fix every mismatch at once
            </text>

            <rect x="24" y="250" width="306" height="24" fill={coral} />
            <text x="36" y="266" fontSize="10" fontWeight="700" fill="#fff">
              Fix and Download ALL
            </text>
            <rect x="24" y="282" width="306" height="18" fill="#f0ead9" stroke={line} />
            <text x="36" y="295" fontSize="9" fill={muted}>
              Labels.zip → Cheesecake.docx + [FIXED] Lava-Cake.docx
            </text>
          </svg>
          <figcaption>
            Upload labels or a ZIP (1), review the chart and queue (2), then fix and download
            everything as Labels.zip.
          </figcaption>
        </figure>
      </section>

      <section className="guide-section">
        <h2>4. Install the app on your devices</h2>
        <ul className="step-list">
          <li><strong>Computer (Chrome / Edge):</strong> click the <strong>Install</strong> button in the top bar and confirm.</li>
          <li><strong>iPhone / iPad (Safari):</strong> tap <strong>Install</strong>, then Share &rarr; <strong>Add to Home Screen</strong>.</li>
          <li><strong>Android (Chrome):</strong> tap <strong>Install</strong> and the app is added to your home screen.</li>
        </ul>
        <p>
          On phones, switch between Home, Create, and Check with the navigation bar at the bottom of
          the screen, and move between uploaded labels by swiping or using Previous / Next.
        </p>
      </section>

      <section className="guide-section">
        <h2>5. Quick rules to remember</h2>
        <ul className="step-list">
          <li>The <strong>barcode number written on the label is always treated as the truth</strong> — the scanner checks GTIN, best-before date, lot code, and the full number.</li>
          <li>Barcode data never contains parentheses; rendered barcodes have no digits beneath the bars.</li>
          <li>Green means verified. Amber means fixable — one click repairs it.</li>
        </ul>
      </section>
    </main>
  );
}
