"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
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
};

const demoRows: InspectionRow[] = [
  {
    id: "lava-cake",
    filename: "Lava Cake Label 6''x4''.docx",
    product: "Lava Cake 3 Inch",
    status: "attention",
    detail: "Barcode image needs verification",
  },
  {
    id: "raspberry-cheesecake",
    filename: "Raspberry cheesecake Label (6''x4'').docx",
    product: "Raspberry Cheesecake Cups",
    status: "ready",
    detail: "All required fields found",
  },
];

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
  const [rows, setRows] = useState<InspectionRow[]>(demoRows);
  const [selectedId, setSelectedId] = useState(demoRows[0].id);
  const [form, setForm] = useState(initialForm);
  const [formMessage, setFormMessage] = useState(
    "Enter the label data to validate a new barcode payload.",
  );
  const [isGenerating, setIsGenerating] = useState(false);

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
      setFormMessage(error instanceof Error ? error.message : "Check the label fields.");
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
      setFormMessage(error instanceof Error ? error.message : "Label generation failed.");
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
    }
    event.target.value = "";
  }

  return (
    <main className="app-shell">
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
            <div className="form-footer"><p className="form-message" role="status">{formMessage}</p><div className="form-actions"><button className="secondary-button" type="submit">Validate</button><button className="primary-button" type="button" onClick={generateDocument} disabled={isGenerating}>{isGenerating ? "Building..." : "Generate DOCX"} <span aria-hidden="true">-&gt;</span></button></div></div>
          </form>
          <LabelPreview form={form} />
        </section>
      ) : (
        <section className="workspace inspect-workspace">
          <div className="panel queue-panel">
            <div className="panel-heading"><div><p className="eyebrow">Batch inspection</p><h3>Label queue</h3></div><label className="upload-button">Upload DOCX<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={handleUpload} /></label></div>
            <div className="queue-list">{rows.map((row) => <button key={row.id} className={row.id === selectedId ? "queue-row selected" : "queue-row"} onClick={() => setSelectedId(row.id)}><span className="queue-index">{String(rows.indexOf(row) + 1).padStart(2, "0")}</span><span className="queue-main"><strong>{row.product}</strong><small>{row.filename}</small></span><span className={`status-pill ${row.status}`}>{row.status === "ready" ? "Ready" : row.status === "attention" ? "Review" : "Error"}</span></button>)}</div>
          </div>
          <InspectionDetail row={selectedRow} />
        </section>
      )}

      <footer className="footer-note"><span>GS1 payload validation is active</span><span>Uploads are inspected in this browser session</span></footer>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className={`metric metric-${accent}`}><span className="metric-label">{label}</span><strong>{String(value).padStart(2, "0")}</strong><span className="metric-sub">labels</span></div>;
}

function Field({ label, value, onChange, wide = false, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; type?: string; inputMode?: "numeric" }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span><input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function LabelPreview({ form }: { form: typeof initialForm }) {
  return <div className="preview-wrap"><div className="preview-label"><div className="preview-brand">GASTRONOMIQUE <small>PASTRY INC</small></div><div className="preview-title">{form.productName}</div><div className="preview-item">ITEM #{form.itemNumber}</div><div className="preview-storage">{form.storageInstruction}</div><div className="preview-ingredients"><strong>Ingredients:</strong> {form.ingredients}</div><div className="preview-barcode"><div className="barcode-bars" /> <small>(01){form.gtin}(15){form.bestBefore.replaceAll("-", "").slice(2)}(10){form.lotCode}</small></div></div><p className="preview-caption">Live label preview / 6x4 portrait</p></div>;
}

function InspectionDetail({ row }: { row: InspectionRow | undefined }) {
  if (!row) return <div className="panel detail-panel empty-detail"><p className="eyebrow">No selection</p><h3>Upload a label to begin.</h3></div>;
  const textBoxes = row.inspection?.textBoxes ?? [];
  return <div className="panel detail-panel"><div className="panel-heading"><div><p className="eyebrow">Selected label</p><h3>{row.product}</h3></div><span className={`status-pill ${row.status}`}>{row.status === "ready" ? "Ready" : "Needs review"}</span></div><div className="detail-file"><span className="file-icon">DOC</span><div><strong>{row.filename}</strong><small>{row.detail}</small></div></div><div className="detail-canvas"><div className="canvas-label"><span className="canvas-title">{row.product}</span><span className="canvas-lot">LOT CODE: 26815<br />BEST BEFORE: 2027/02/15</span><span className="canvas-box">BARCODE REGION</span></div></div><div className="error-callout"><span className="error-symbol">!</span><div><strong>Barcode scan pending</strong><p>The expected barcode number remains authoritative. Replace the barcode inside the bounded region, then verify the output.</p></div></div><div className="detail-actions"><button className="secondary-button" disabled>Open repair view</button><button className="primary-button" disabled>Verify label <span aria-hidden="true">-&gt;</span></button></div><div className="extracted-fields"><span className="eyebrow">Extracted structure</span><div className="field-summary"><span>{textBoxes.length}</span> text boxes <span>{row.inspection?.images.length ?? 0}</span> embedded images</div></div></div>;
}
