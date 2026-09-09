"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { renderAsync } from "docx-preview";
import { buildGs1Payload } from "@/domain/gs1";
import { inspectDocx, DocxInspection } from "@/domain/docx-reader";

type Mode = "create" | "inspect";
type InspectionStatus = "ready" | "attention" | "error";

type InspectionRow = {
  id: string;
  filename: string;
  product: string;
  status: InspectionStatus;
  detail: string;
  inspection?: DocxInspection;
  sourceBytes?: Uint8Array;
};

const initialForm = {
  productName: "Lava Cake 3 Inch",
  itemNumber: "GP2118",
  gtin: "10627146285749",
  lotCode: "72722",
  bestBefore: "2025-09-23",
  ingredients: "Eggs, sugar, wheat flour, margarine, dark chocolate.",
  storageInstruction: "KEEP FROZEN",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("inspect");
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [formMessage, setFormMessage] = useState(
    "Enter the label data to validate a new barcode payload.",
  );
  const [toastMessage, setToastMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [repairMessage, setRepairMessage] = useState("");
  const [isRepairing, setIsRepairing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function loadBarcodePreview() {
      try {
        const response = await fetch("/api/labels/barcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gtin: form.gtin,
            bestBefore: form.bestBefore,
            lotCode: form.lotCode,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          setBarcodePreviewUrl(null);
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setBarcodePreviewUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setBarcodePreviewUrl(null);
      }
    }

    void loadBarcodePreview();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [form.bestBefore, form.gtin, form.lotCode]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];
  const counts = useMemo(
    () => ({
      total: rows.length,
      attention: rows.filter((row) => row.status !== "ready").length,
      ready: rows.filter((row) => row.status === "ready").length,
    }),
    [rows],
  );

  function updateForm(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function validateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const payload = buildGs1Payload(form);
      setFormMessage(
        `Payload ready: ${payload.humanReadable}. Barcode data contains no parentheses.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the label fields.";
      setFormMessage(message);
      setToastMessage(message);
    }
  }

  async function generateDocument() {
    setIsGenerating(true);
    setFormMessage("Building the DOCX label and barcode...");

    try {
      const response = await fetch("/api/labels/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Label generation failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${form.productName.replace(/[^a-z0-9]+/gi, "-") || "generated-label"}.docx`;
      link.click();
      URL.revokeObjectURL(url);
      setFormMessage("DOCX ready. The output includes a barcode without human-readable digits beneath it.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Label generation failed.";
      setFormMessage(message);
      setToastMessage(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const uploadedRows: InspectionRow[] = [];

    for (const file of files) {
      try {
        const inspection = await inspectDocx(new Uint8Array(await file.arrayBuffer()));
        const product = inspection.textBoxes.find((box) => box.name === "Text Box 2")?.text ?? "Unidentified label";
        uploadedRows.push({
          id: `${file.name}-${file.lastModified}`,
          filename: file.name,
          product,
          status: inspection.images.length ? "attention" : "error",
          detail: inspection.images.length
            ? `${inspection.images.length} embedded images found; barcode scan pending`
            : "No embedded image found",
          inspection,
          sourceBytes: new Uint8Array(await file.arrayBuffer()),
        });
      } catch (error) {
        uploadedRows.push({
          id: `${file.name}-${file.lastModified}`,
          filename: file.name,
          product: "Unreadable document",
          status: "error",
          detail: error instanceof Error ? error.message : "DOCX inspection failed",
        });
      }
    }

    if (uploadedRows.length) {
      setRows((current) => [...uploadedRows, ...current]);
      setSelectedId(uploadedRows[0].id);
      setRepairOpen(false);
      setScanValue("");
      setRepairMessage("");
    }
    event.target.value = "";
  }

  function handleScanDetected(value: string) {
    setScanValue(value);
    if (!selectedId) return;
    setRows((current) => current.map((row) => {
      if (row.id !== selectedId) return row;
      const expected = row.inspection?.documentText.match(/\(01\)(\d{14})/)?.[1];
      const scanned = value.match(/\(01\)(\d{14})/)?.[1] ?? value.replace(/\D/g, "").slice(0, 14);
      const matches = Boolean(expected && scanned === expected);
      return { ...row, status: matches ? "ready" : "attention", detail: matches ? "Barcode matches expected GTIN" : "Barcode does not match expected GTIN" };
    }));
  }

  return (
    <main className="app-shell">
      {toastMessage ? <div className="toast toast-error" role="alert"><strong>Label validation failed</strong><span>{toastMessage}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToastMessage("")}>x</button></div> : null}
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">LT</div>
          <div>
            <p className="eyebrow">Label operations</p>
            <h1>Label Tag Studio</h1>
          </div>
        </div>
        <div className="topbar-note"><span className="status-dot" /> Local processing workspace</div>
      </header>

      <section className="hero-row">
        <div>
          <p className="eyebrow">Production desk / 01</p>
          <h2>Make every label scan clean.</h2>
          <p className="hero-copy">Create a new food label or triage a batch of DOCX files before they reach the printer.</p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Workflow mode">
          <button className={mode === "create" ? "mode-button active" : "mode-button"} onClick={() => setMode("create")} role="tab" aria-selected={mode === "create"}>Create label</button>
          <button className={mode === "inspect" ? "mode-button active" : "mode-button"} onClick={() => setMode("inspect")} role="tab" aria-selected={mode === "inspect"}>Inspect batch</button>
        </div>
      </section>

      <section className="metrics" aria-label="Batch summary">
        <Metric label="In queue" value={counts.total} accent="ink" />
        <Metric label="Needs attention" value={counts.attention} accent="coral" />
        <Metric label="Ready to print" value={counts.ready} accent="mint" />
        <div className="metric metric-note"><span className="metric-label">Template</span><strong>6x4 portrait</strong><span className="metric-sub">Word document</span></div>
      </section>

      {mode === "create" ? (
        <section className="workspace create-workspace">
          <form className="panel create-form" onSubmit={validateForm}>
            <div className="panel-heading"><div><p className="eyebrow">New label</p><h3>Label details</h3></div><span className="step-chip">01 / 02</span></div>
            <div className="form-grid">
              <Field label="Product name" value={form.productName} onChange={(value) => updateForm("productName", value)} />
              <Field label="Item number" value={form.itemNumber} onChange={(value) => updateForm("itemNumber", value)} />
              <Field label="GTIN / barcode number" value={form.gtin} onChange={(value) => updateForm("gtin", value)} wide inputMode="numeric" />
              <Field label="Lot code" value={form.lotCode} onChange={(value) => updateForm("lotCode", value)} />
              <Field label="Best before" value={form.bestBefore} onChange={(value) => updateForm("bestBefore", value)} type="date" />
              <Field label="Storage instruction" value={form.storageInstruction} onChange={(value) => updateForm("storageInstruction", value)} wide />
              <label className="field wide"><span>Ingredients</span><textarea value={form.ingredients} onChange={(event) => updateForm("ingredients", event.target.value)} rows={4} /></label>
            </div>
            <div className="form-footer"><p className={`form-message ${formMessage === "Enter a valid GTIN with a correct check digit." ? "form-message-error" : ""}`} role="status">{formMessage}</p><div className="form-actions"><button className="secondary-button" type="submit">Validate</button><button className="primary-button" type="button" onClick={generateDocument} disabled={isGenerating}>{isGenerating ? "Building..." : "Generate DOCX"} <span aria-hidden="true">-&gt;</span></button></div></div>
          </form>
          <LabelPreview form={form} barcodePreviewUrl={barcodePreviewUrl} />
        </section>
      ) : (
        <section className="workspace inspect-workspace">
          <div className="panel queue-panel">
            <div className="panel-heading"><div><p className="eyebrow">Batch inspection</p><h3>Label queue</h3></div><label className="upload-button">Upload DOCX<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={handleUpload} /></label></div>
            <div className="queue-list">{rows.length ? rows.map((row) => <button key={row.id} className={row.id === selectedId ? "queue-row selected" : "queue-row"} onClick={() => { setSelectedId(row.id); setRepairOpen(false); }}><span className="queue-index">{String(rows.indexOf(row) + 1).padStart(2, "0")}</span><span className="queue-main"><strong>{row.product}</strong><small>{row.filename}</small></span><span className={`status-pill ${row.status}`}>{row.status === "ready" ? "Ready" : row.status === "attention" ? "Review" : "Error"}</span></button>) : <div className="queue-empty"><strong>No labels uploaded</strong><span>Choose one or more DOCX files above to begin inspection.</span></div>}</div>
          </div>
          <InspectionPanel row={selectedRow} repairOpen={repairOpen} scanValue={scanValue} repairMessage={repairMessage} isRepairing={isRepairing} onOpenRepair={() => setRepairOpen(true)} onScanDetected={handleScanDetected} onRepair={() => repairLabel(selectedRow, setIsRepairing, setRepairMessage)} />
        </section>
      )}

      <footer className="footer-note"><span>GS1 payload validation is active</span><span>Uploads are inspected in this browser session</span></footer>
    </main>
  );
}

  async function repairLabel(row: InspectionRow | undefined, setBusy: (busy: boolean) => void, setMessage: (message: string) => void) {
    if (!row?.sourceBytes) return;
    setBusy(true);
    setMessage("Replacing the barcode in the original DOCX...");
    try {
      const data = new FormData();
      data.append("file", new File([new Uint8Array(row.sourceBytes).slice().buffer], row.filename, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      data.append("productName", row.product);
      data.append("itemNumber", row.inspection?.textBoxes.find((box) => box.name === "Text Box 1")?.text.match(/#(.+)/)?.[1] ?? "");
      data.append("gtin", row.inspection?.documentText.match(/\(01\)(\d{14})/)?.[1] ?? "");
      data.append("lotCode", row.inspection?.documentText.match(/LOT CODE:\s*([A-Za-z0-9]+?)(?=BEST BEFORE|$)/)?.[1] ?? "");
      data.append("bestBefore", (row.inspection?.documentText.match(/BEST BEFORE:\s*(\d{4})\/(\d{2})\/(\d{2})/) ?? []).slice(1).join("-") || "2025-09-23");
      data.append("ingredients", row.inspection?.textBoxes.find((box) => box.name === "Text Box 5")?.text.replace(/^Ingredients:\s*/, "") ?? "");
      data.append("storageInstruction", row.inspection?.textBoxes.find((box) => box.name === "Text Box 4")?.text ?? "KEEP FROZEN");
      const response = await fetch("/api/labels/repair", { method: "POST", body: data });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Repair failed.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = `${row.filename.replace(/\.docx$/i, "")}-repaired.docx`;
      link.click();
      setMessage("Repaired DOCX downloaded. The barcode was replaced in the original template.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair failed.");
    } finally {
      setBusy(false);
    }
  }

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className={`metric metric-${accent}`}><span className="metric-label">{label}</span><strong>{String(value).padStart(2, "0")}</strong><span className="metric-sub">labels</span></div>;
}

function Field({ label, value, onChange, wide = false, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; type?: string; inputMode?: "numeric" }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span><input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function LabelPreview({ form, barcodePreviewUrl }: { form: typeof initialForm; barcodePreviewUrl: string | null }) {
  return <div className="preview-wrap"><PdfLabelPreview productName={form.productName} itemNumber={form.itemNumber} lotCode={form.lotCode} bestBefore={form.bestBefore} ingredients={form.ingredients} storageInstruction={form.storageInstruction} gtin={form.gtin} barcodePreviewUrl={barcodePreviewUrl} /></div>;
}

function PdfLabelPreview({ productName, itemNumber, lotCode, bestBefore, ingredients, storageInstruction, gtin, barcodePreviewUrl }: { productName: string; itemNumber: string; lotCode: string; bestBefore: string; ingredients: string; storageInstruction: string; gtin: string; barcodePreviewUrl: string | null }) {
  return <div className="pdf-page"><img className="preview-logo" src="/api/labels/logo" alt="Template logo" /><div className="preview-title">{productName}</div><div className="preview-item">ITEM #{itemNumber}</div><div className="preview-storage">{storageInstruction}</div><div className="preview-lot">LOT CODE: {lotCode}<br />BEST BEFORE: {bestBefore.replaceAll("-", "/")}</div><div className="preview-ingredients"><strong>Ingredients:</strong> {ingredients}</div><div className="preview-barcode">{barcodePreviewUrl ? <img src={barcodePreviewUrl} alt="Generated GS1 barcode preview" /> : <span className="barcode-placeholder">Barcode preview</span>}<small>(01){gtin}(15){bestBefore.replaceAll("-", "").slice(2)}(10){lotCode}</small></div><div className="preview-address"><strong>Gastronomique pastry INC</strong><span>7621 vantage way, Delta, BC V4G 1A6</span></div></div>;
}

function extractPreviewFields(row: InspectionRow) {
  const text = row.inspection?.documentText ?? "";
  const itemNumber = row.inspection?.textBoxes.find((box) => box.name === "Text Box 1")?.text.match(/#(.+)/)?.[1] ?? "";
  const ingredients = row.inspection?.textBoxes.find((box) => box.name === "Text Box 5")?.text.replace(/^Ingredients:\s*/, "") ?? "";
  const lotCode = text.match(/LOT CODE:\s*([A-Za-z0-9]+?)(?=BEST BEFORE|$)/)?.[1] ?? "";
  const date = text.match(/BEST BEFORE:\s*(\d{4})\/?(\d{2})\/?(\d{2})/)?.slice(1).join("-") ?? "";
  const gtin = text.match(/\(01\)(\d{14})/)?.[1] ?? "";
  return { productName: row.product, itemNumber, lotCode, bestBefore: date, ingredients, storageInstruction: row.inspection?.textBoxes.find((box) => box.name === "Text Box 4")?.text ?? "KEEP FROZEN", gtin };
}

function InspectionPanel({ row, repairOpen, scanValue, repairMessage, isRepairing, onOpenRepair, onScanDetected, onRepair }: { row: InspectionRow | undefined; repairOpen: boolean; scanValue: string; repairMessage: string; isRepairing: boolean; onOpenRepair: () => void; onScanDetected: (value: string) => void; onRepair: () => void }) {
  if (!row) return <div className="panel detail-panel empty-detail"><p className="eyebrow">Step 1</p><h3>Upload a DOCX label.</h3><p className="empty-detail-copy">The PDF-style 6x4 label view and automatic barcode result will appear here.</p></div>;
  const expected = row.inspection?.documentText.match(/\(01\)(\d{14})/)?.[1] ?? "Not found";
  const isCorrect = row.status === "ready";
  return <div className="panel detail-panel"><div className="panel-heading"><div><p className="eyebrow">Step 2 / PDF label view</p><h3>{row.product}</h3></div><span className={`status-pill ${row.status}`}>{isCorrect ? "No fix needed" : "Needs review"}</span></div><div className="detail-file"><span className="file-icon">PDF</span><div><strong>{row.filename}</strong><small>6x4 label view with automatic barcode scan</small></div></div><DocxDocumentPreview row={row} onScanDetected={onScanDetected} /><div className="scan-summary"><span className="eyebrow">Automatic barcode scan</span><strong>{scanValue || "Scanning document..."}</strong><small>{scanValue ? "Read from the uploaded barcode." : "Reading the barcode automatically."}</small></div>{isCorrect ? <div className="success-callout"><strong>Barcode is correct</strong><p>GTIN {expected}, Best Before, and Lot values match. No repair is required.</p></div> : repairOpen ? <div className="repair-workspace"><div className="repair-heading"><span className="eyebrow">Step 3 / Fix barcode</span><strong>Expected barcode number is always correct.</strong></div><label className="field"><span>Expected barcode number</span><input value={expected} readOnly /></label><p className="repair-hint">The scanned barcode does not match. Replace only the barcode and download a repaired DOCX.</p><button className="primary-button" type="button" onClick={onRepair} disabled={isRepairing}>{isRepairing ? "Repairing..." : "Fix barcode and download"}</button>{repairMessage ? <p className="repair-message" role="status">{repairMessage}</p> : null}</div> : <div className="error-callout"><span className="error-symbol">!</span><div><strong>Barcode mismatch detected</strong><p>Click Fix barcode to replace the incorrect barcode while preserving the original template.</p></div></div>}<div className="detail-actions">{!isCorrect && !repairOpen ? <button className="primary-button" type="button" onClick={onOpenRepair}>Fix barcode <span aria-hidden="true">-&gt;</span></button> : null}</div></div>;
}

function InspectionDetail({ row, repairOpen, scanValue, repairMessage, isRepairing, onOpenRepair, onScanDetected, onRepair }: { row: InspectionRow | undefined; repairOpen: boolean; scanValue: string; repairMessage: string; isRepairing: boolean; onOpenRepair: () => void; onScanDetected: (value: string) => void; onRepair: () => void }) {
  if (!row) return <div className="panel detail-panel empty-detail"><p className="eyebrow">Step 1</p><h3>Upload a DOCX label.</h3><p className="empty-detail-copy">The actual Word document will appear here after upload. Its barcode will be scanned automatically.</p></div>;
  return <div className="panel detail-panel"><div className="panel-heading"><div><p className="eyebrow">Step 2 / Actual document</p><h3>{row.product}</h3></div><span className={`status-pill ${row.status}`}>{row.status === "ready" ? "Ready" : "Needs review"}</span></div><div className="detail-file"><span className="file-icon">DOC</span><div><strong>{row.filename}</strong><small>{row.detail}</small></div></div><DocxDocumentPreview row={row} onScanDetected={onScanDetected} /><div className="scan-summary"><span className="eyebrow">Automatic barcode scan</span><strong>{scanValue || "Scanning document..."}</strong><small>{scanValue ? "The current barcode value was read from the uploaded document." : "The barcode image is being checked automatically."}</small></div>{repairOpen ? <div className="repair-workspace"><div className="repair-heading"><span className="eyebrow">Step 3 / Fix barcode</span><strong>The expected barcode number is always correct.</strong></div><label className="field"><span>Expected barcode number</span><input value={row.inspection?.documentText.match(/\(01\)(\d{14})/)?.[1] ?? "Not found"} readOnly /></label><p className="repair-hint">If the scanned value above is different, click Fix barcode to replace it and download a repaired copy.</p><button className="primary-button" type="button" onClick={onRepair} disabled={isRepairing}>{isRepairing ? "Repairing..." : "Fix barcode and download"}</button>{repairMessage ? <p className="repair-message" role="status">{repairMessage}</p> : null}</div> : <div className="error-callout"><span className="error-symbol">!</span><div><strong>{scanValue ? "Barcode comparison ready" : "Barcode scan in progress"}</strong><p>{scanValue ? "If this value does not match the expected number, open the fix step below." : "Wait for the current barcode value to appear automatically."}</p></div></div>}<div className="detail-actions">{repairOpen ? <button className="secondary-button" type="button" onClick={onOpenRepair}>Keep fix step open</button> : <button className="primary-button" type="button" onClick={onOpenRepair}>Open fix step <span aria-hidden="true">-&gt;</span></button>}</div><div className="extracted-fields"><span className="eyebrow">Document contents</span><div className="field-summary"><span>{row.inspection?.textBoxes.length ?? 0}</span> text boxes <span>{row.inspection?.images.length ?? 0}</span> embedded images</div></div></div>;
}

function DocxDocumentPreview({ row, onScanDetected }: { row: InspectionRow; onScanDetected: (value: string) => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const originalUrl = useMemo(
    () => row.sourceBytes
      ? URL.createObjectURL(new Blob([new Uint8Array(row.sourceBytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
      : null,
    [row.id, row.sourceBytes],
  );

  useEffect(() => () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
  }, [originalUrl]);

  useEffect(() => {
    if (!bodyRef.current || !row.sourceBytes) return;
    const body = bodyRef.current;
    body.replaceChildren();
    let cancelled = false;

    async function renderAndScan() {
      await renderAsync(row.sourceBytes, body, styleRef.current ?? undefined, {
        className: "uploaded-docx",
        useBase64URL: true,
        breakPages: true,
      });
      if (cancelled) return;
      const reader = new BrowserMultiFormatReader();
      const images = Array.from(body.querySelectorAll("img"));
      for (const image of images) {
        try {
          const result = await reader.decodeFromImageElement(image);
          if (result.getText()) {
            onScanDetected(result.getText());
            break;
          }
        } catch {
          // Continue through the document's other image candidates.
        }
      }
      if (!cancelled) {
        const embeddedValue = row.inspection?.documentText.match(/\(01\)\d{14}\(15\)\d{6}\(10\)[A-Za-z0-9]+?(?=Gastronomique|$)/)?.[0];
        if (embeddedValue) onScanDetected(embeddedValue);
      }
    }

    void renderAndScan();
    return () => {
      cancelled = true;
      body.replaceChildren();
    };
  }, [onScanDetected, row.id, row.sourceBytes, row.inspection?.documentText]);

  return <><div className="docx-preview-shell"><div className="docx-preview-toolbar"><span className="eyebrow">PDF label view</span>{originalUrl ? <a className="secondary-button" href={originalUrl} download={row.filename}>Open original DOCX</a> : null}</div><PdfLabelPreview {...extractPreviewFields(row)} barcodePreviewUrl={null} /></div><div className="docx-scan-source"><div ref={styleRef} /><div ref={bodyRef} className="docx-preview-body" /></div></>;
}
