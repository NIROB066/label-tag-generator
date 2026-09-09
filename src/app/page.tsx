"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildGs1Payload } from "@/domain/gs1";
import { LabelScanResult } from "@/domain/label-schema";

type Mode = "create" | "inspect";

type InspectionRow = {
  id: string;
  filename: string;
  file: File;
  scanResult: LabelScanResult;
  isRepaired?: boolean;
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
  const [selectedCheckedIds, setSelectedCheckedIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isBatchRepairing, setIsBatchRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");

  // Resizable Barcode Box state (in pixels; 96 DPI: 3.4" x 0.70" = 326px x 67px)
  const [boxWidth, setBoxWidth] = useState(326);
  const [boxHeight, setBoxHeight] = useState(67);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; startW: number; startH: number }>({
    startX: 0,
    startY: 0,
    startW: 326,
    startH: 67,
  });

  // Create Mode Form State
  const [form, setForm] = useState(initialForm);
  const [formMessage, setFormMessage] = useState(
    "Enter the label data to validate a new barcode payload.",
  );
  const [toastMessage, setToastMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState<string | null>(null);

  // Load barcode preview for Create mode
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

  // Batch metrics
  const counts = useMemo(() => {
    return {
      total: rows.length,
      attention: rows.filter((r) => r.scanResult.status === "attention" && !r.isRepaired).length,
      ready: rows.filter((r) => r.scanResult.status === "ready" || r.isRepaired).length,
      error: rows.filter((r) => r.scanResult.status === "error" && !r.isRepaired).length,
    };
  }, [rows]);

  // Sync box dimensions with selected row if available
  useEffect(() => {
    if (selectedRow?.scanResult.widthEmu && selectedRow?.scanResult.heightEmu) {
      // 1 EMU = 1 / 914400 inch; at 96 DPI: 1px = 9525 EMUs
      const w = Math.round(selectedRow.scanResult.widthEmu / 9525);
      const h = Math.round(selectedRow.scanResult.heightEmu / 9525);
      if (w >= 100 && w <= 400) setBoxWidth(w);
      if (h >= 30 && h <= 200) setBoxHeight(h);
    }
  }, [selectedRow?.id, selectedRow?.scanResult.widthEmu, selectedRow?.scanResult.heightEmu]);

  // Handle Multi-file Upload and Real Scanning
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setIsScanning(true);
    setRepairMessage("");

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const response = await fetch("/api/labels/scan", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? "Scanning failed.");
      }

      const { results } = (await response.json()) as { results: LabelScanResult[] };

      const newRows: InspectionRow[] = results.map((res, index) => {
        const matchingFile = files.find((f) => f.name === res.filename) ?? files[index];
        return {
          id: `${res.filename}-${matchingFile.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          filename: res.filename,
          file: matchingFile,
          scanResult: res,
          isRepaired: false,
        };
      });

      setRows((prev) => [...newRows, ...prev]);
      if (newRows.length > 0) {
        setSelectedId(newRows[0].id);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Scanning failed.";
      setToastMessage(msg);
    } finally {
      setIsScanning(false);
      event.target.value = "";
    }
  }

  // Toggle selection checkbox for a row
  function toggleCheck(id: string) {
    setSelectedCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedCheckedIds.size === rows.length) {
      setSelectedCheckedIds(new Set());
    } else {
      setSelectedCheckedIds(new Set(rows.map((r) => r.id)));
    }
  }

  function selectAllMismatched() {
    const mismatched = rows.filter((r) => r.scanResult.status !== "ready" && !r.isRepaired);
    setSelectedCheckedIds(new Set(mismatched.map((r) => r.id)));
  }

  // Repair a single label
  async function handleRepair(row: InspectionRow) {
    setIsRepairing(true);
    setRepairMessage("Generating replacement barcode and patching DOCX...");

    try {
      const data = new FormData();
      data.append("file", row.file);
      data.append("productName", row.scanResult.productName);
      data.append("itemNumber", row.scanResult.itemNumber);
      data.append("gtin", row.scanResult.expectedGtin);
      data.append("lotCode", row.scanResult.expectedLotCode);
      data.append("bestBefore", row.scanResult.expectedBestBefore);
      if (row.scanResult.barcodeMediaFile) {
        data.append("barcodeMediaFile", row.scanResult.barcodeMediaFile);
      }
      // Pass resizable box dimensions converted to EMUs (1px = 9525 EMUs)
      data.append("widthEmu", String(Math.round(boxWidth * 9525)));
      data.append("heightEmu", String(Math.round(boxHeight * 9525)));

      const response = await fetch("/api/labels/repair", {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? "Label repair failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${row.filename.replace(/\.docx$/i, "")}-repaired.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                isRepaired: true,
                scanResult: {
                  ...r.scanResult,
                  status: "ready",
                  scannedGtin: r.scanResult.expectedGtin,
                  scannedRaw: r.scanResult.expectedBarcodeText,
                  mismatches: [],
                  detail: "Repaired: barcode replaced with authoritative GTIN.",
                },
              }
            : r,
        ),
      );

      setRepairMessage("Repaired DOCX downloaded! Barcode was successfully replaced.");
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "Repair failed.");
    } finally {
      setIsRepairing(false);
    }
  }

  // Batch repair all selected or all mismatched labels
  async function handleBatchRepair(targetRows: InspectionRow[]) {
    if (!targetRows.length) return;
    setIsBatchRepairing(true);

    try {
      const data = new FormData();
      for (const row of targetRows) {
        data.append("files", row.file);
      }

      const response = await fetch("/api/labels/batch-repair", {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? "Batch repair failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "repaired-labels.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      // Mark all repaired
      const targetIds = new Set(targetRows.map((r) => r.id));
      setRows((prev) =>
        prev.map((r) =>
          targetIds.has(r.id)
            ? {
                ...r,
                isRepaired: true,
                scanResult: {
                  ...r.scanResult,
                  status: "ready",
                  mismatches: [],
                  detail: "Batch repaired: replacement barcode generated.",
                },
              }
            : r,
        ),
      );
      setRepairMessage(`Successfully repaired and downloaded ${targetRows.length} labels in ZIP.`);
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : "Batch repair failed.");
    } finally {
      setIsBatchRepairing(false);
    }
  }

  // Handle Box Resize Drag
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: boxWidth,
      startH: boxHeight,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const deltaX = moveEvent.clientX - dragStartRef.current.startX;
      const deltaY = moveEvent.clientY - dragStartRef.current.startY;
      const newW = Math.max(120, Math.min(330, dragStartRef.current.startW + deltaX));
      const newH = Math.max(35, Math.min(140, dragStartRef.current.startH + deltaY));
      setBoxWidth(newW);
      setBoxHeight(newH);
    }

    function onMouseUp() {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // Create Mode Actions
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
      setFormMessage("DOCX ready. Barcode generated without human-readable digits beneath.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Label generation failed.";
      setFormMessage(message);
      setToastMessage(message);
    } finally {
      setIsGenerating(false);
    }
  }

  const checkedRows = rows.filter((r) => selectedCheckedIds.has(r.id));
  const mismatchedRows = rows.filter((r) => r.scanResult.status !== "ready" && !r.isRepaired);

  return (
    <main className="app-shell">
      {toastMessage ? (
        <div className="toast toast-error" role="alert">
          <strong>Notice</strong>
          <span>{toastMessage}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToastMessage("")}>
            x
          </button>
        </div>
      ) : null}

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">LT</div>
          <div>
            <p className="eyebrow">Label operations</p>
            <h1>Label Tag Studio</h1>
          </div>
        </div>
        <div className="topbar-note">
          <span className="status-dot" /> Local barcode verification engine
        </div>
      </header>

      <section className="hero-row">
        <div>
          <p className="eyebrow">Production desk / 01</p>
          <h2>Scan, verify & fix label barcodes.</h2>
          <p className="hero-copy">
            Upload multiple DOCX labels. The engine automatically scans the actual barcode artwork, matches it against the expected barcode number, and replaces any mismatches cleanly.
          </p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Workflow mode">
          <button
            className={mode === "create" ? "mode-button active" : "mode-button"}
            onClick={() => setMode("create")}
            role="tab"
            aria-selected={mode === "create"}
          >
            Create label
          </button>
          <button
            className={mode === "inspect" ? "mode-button active" : "mode-button"}
            onClick={() => setMode("inspect")}
            role="tab"
            aria-selected={mode === "inspect"}
          >
            Inspect & fix batch
          </button>
        </div>
      </section>

      <section className="metrics" aria-label="Batch summary">
        <Metric label="In queue" value={counts.total} accent="ink" />
        <Metric label="Needs attention / Mismatched" value={counts.attention} accent="coral" />
        <Metric label="Ready to print" value={counts.ready} accent="mint" />
        <div className="metric metric-note">
          <span className="metric-label">Engine</span>
          <strong>Barcode 1D Scanner</strong>
          <span className="metric-sub">GS1 / Code 128 verify</span>
        </div>
      </section>

      {mode === "create" ? (
        <section className="workspace create-workspace">
          <form className="panel create-form" onSubmit={validateForm}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New label</p>
                <h3>Label details</h3>
              </div>
              <span className="step-chip">01 / 02</span>
            </div>
            <div className="form-grid">
              <Field label="Product name" value={form.productName} onChange={(v) => updateForm("productName", v)} />
              <Field label="Item number" value={form.itemNumber} onChange={(v) => updateForm("itemNumber", v)} />
              <Field label="GTIN / barcode number" value={form.gtin} onChange={(v) => updateForm("gtin", v)} wide inputMode="numeric" />
              <Field label="Lot code" value={form.lotCode} onChange={(v) => updateForm("lotCode", v)} />
              <Field label="Best before" value={form.bestBefore} onChange={(v) => updateForm("bestBefore", v)} type="date" />
              <Field label="Storage instruction" value={form.storageInstruction} onChange={(v) => updateForm("storageInstruction", v)} wide />
              <label className="field wide">
                <span>Ingredients</span>
                <textarea value={form.ingredients} onChange={(e) => updateForm("ingredients", e.target.value)} rows={4} />
              </label>
            </div>
            <div className="form-footer">
              <p className={`form-message ${formMessage.includes("Error") ? "form-message-error" : ""}`} role="status">
                {formMessage}
              </p>
              <div className="form-actions">
                <button className="secondary-button" type="submit">Validate</button>
                <button className="primary-button" type="button" onClick={generateDocument} disabled={isGenerating}>
                  {isGenerating ? "Building..." : "Generate DOCX"} <span aria-hidden="true">-&gt;</span>
                </button>
              </div>
            </div>
          </form>
          <div className="preview-wrap">
            <PdfLabelPreview
              productName={form.productName}
              itemNumber={form.itemNumber}
              lotCode={form.lotCode}
              bestBefore={form.bestBefore}
              ingredients={form.ingredients}
              storageInstruction={form.storageInstruction}
              gtin={form.gtin}
              barcodePreviewUrl={barcodePreviewUrl}
            />
          </div>
        </section>
      ) : (
        <section className="workspace inspect-workspace">
          {/* LEFT: Queue & Batch Actions */}
          <div className="panel queue-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Batch inspection</p>
                <h3>Label queue</h3>
              </div>
              <label className="upload-button">
                {isScanning ? "Scanning..." : "Upload DOCX labels"}
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple
                  disabled={isScanning}
                  onChange={handleUpload}
                />
              </label>
            </div>

            {/* Batch Toolbar */}
            {rows.length > 0 ? (
              <div className="batch-toolbar">
                <div className="batch-selection-info">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedCheckedIds.size === rows.length}
                      onChange={toggleSelectAll}
                    />
                    <span>Select all ({rows.length})</span>
                  </label>
                  {mismatchedRows.length > 0 ? (
                    <button type="button" className="text-link-btn" onClick={selectAllMismatched}>
                      Select mismatched ({mismatchedRows.length})
                    </button>
                  ) : null}
                </div>

                <div className="batch-actions-buttons">
                  {checkedRows.length > 0 ? (
                    <button
                      type="button"
                      className="batch-action-btn"
                      onClick={() => handleBatchRepair(checkedRows)}
                      disabled={isBatchRepairing}
                    >
                      {isBatchRepairing ? "Fixing..." : `Fix selected (${checkedRows.length})`}
                    </button>
                  ) : mismatchedRows.length > 0 ? (
                    <button
                      type="button"
                      className="batch-action-btn coral"
                      onClick={() => handleBatchRepair(mismatchedRows)}
                      disabled={isBatchRepairing}
                    >
                      {isBatchRepairing ? "Fixing..." : `Fix all mismatched (${mismatchedRows.length})`}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Queue Items */}
            <div className="queue-list">
              {isScanning ? (
                <div className="scanning-indicator">
                  <span className="spinner" />
                  <div>
                    <strong>Scanning uploaded labels...</strong>
                    <p>Extracting embedded artwork and decoding 1D barcodes</p>
                  </div>
                </div>
              ) : rows.length ? (
                rows.map((row) => {
                  const isReady = row.scanResult.status === "ready" || row.isRepaired;
                  const isAttention = row.scanResult.status === "attention" && !row.isRepaired;
                  const isError = row.scanResult.status === "error" && !row.isRepaired;

                  return (
                    <div
                      key={row.id}
                      className={`queue-row-container ${row.id === selectedId ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        checked={selectedCheckedIds.has(row.id)}
                        onChange={() => toggleCheck(row.id)}
                        aria-label={`Select ${row.filename}`}
                      />
                      <button
                        type="button"
                        className="queue-row-btn"
                        onClick={() => {
                          setSelectedId(row.id);
                          setRepairMessage("");
                        }}
                      >
                        <span className="queue-main">
                          <strong>{row.scanResult.productName || row.filename}</strong>
                          <small>
                            {row.filename} &bull; Expected GTIN: {row.scanResult.expectedGtin || "None"}
                          </small>
                          {row.scanResult.scannedGtin && (
                            <span className="scanned-badge">
                              Scanned: <code>{row.scanResult.scannedGtin}</code>
                            </span>
                          )}
                        </span>
                        <span
                          className={`status-pill ${
                            isReady ? "ready" : isAttention ? "attention" : "error"
                          }`}
                        >
                          {isReady ? "Ready" : isAttention ? "Mismatch" : "Unreadable"}
                        </span>
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="queue-empty">
                  <strong>No labels uploaded</strong>
                  <span>Upload one or more .docx label files above to scan and check barcodes.</span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Inspection & Resizable Barcode Repair Workspace */}
          <div className="panel detail-panel">
            {selectedRow ? (
              <InspectionDetail
                row={selectedRow}
                boxWidth={boxWidth}
                boxHeight={boxHeight}
                setBoxWidth={setBoxWidth}
                setBoxHeight={setBoxHeight}
                onStartResize={startResize}
                isDragging={isDragging}
                isRepairing={isRepairing}
                repairMessage={repairMessage}
                onRepair={() => handleRepair(selectedRow)}
              />
            ) : (
              <div className="empty-detail">
                <p className="eyebrow">Step 1</p>
                <h3>Upload label files</h3>
                <p className="empty-detail-copy">
                  Select and upload .docx labels to scan the embedded barcodes and compare with the expected barcode numbers.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="footer-note">
        <span>GS1 Canada GTIN validation active &bull; Barcode scanning with Code 128 / GS1-128 decoder</span>
        <span>Local DOCX package mutation &bull; Formatting and logo preserved</span>
      </footer>
    </main>
  );
}

function InspectionDetail({
  row,
  boxWidth,
  boxHeight,
  setBoxWidth,
  setBoxHeight,
  onStartResize,
  isDragging,
  isRepairing,
  repairMessage,
  onRepair,
}: {
  row: InspectionRow;
  boxWidth: number;
  boxHeight: number;
  setBoxWidth: (w: number) => void;
  setBoxHeight: (h: number) => void;
  onStartResize: (e: React.MouseEvent) => void;
  isDragging: boolean;
  isRepairing: boolean;
  repairMessage: string;
  onRepair: () => void;
}) {
  const { scanResult, isRepaired } = row;
  const isMatch = (scanResult.status === "ready" || isRepaired) && scanResult.mismatches.length === 0;

  // Replacement barcode preview url for authoritative expected number
  const [replacementUrl, setReplacementUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    const controller = new AbortController();

    async function loadReplacement() {
      if (!scanResult.expectedGtin) return;
      try {
        const res = await fetch("/api/labels/barcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gtin: scanResult.expectedGtin,
            bestBefore: scanResult.expectedBestBefore || "2026-12-31",
            lotCode: scanResult.expectedLotCode || "00000",
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          url = URL.createObjectURL(await res.blob());
          setReplacementUrl(url);
        }
      } catch {
        // ignore
      }
    }

    void loadReplacement();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [scanResult.expectedGtin, scanResult.expectedBestBefore, scanResult.expectedLotCode]);

  return (
    <>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Label inspection & fix</p>
          <h3>{scanResult.productName || row.filename}</h3>
        </div>
        <span className={`status-pill ${isMatch ? "ready" : "attention"}`}>
          {isMatch ? "Verified correct" : "Needs barcode replacement"}
        </span>
      </div>

      <div className="detail-file">
        <span className="file-icon">DOCX</span>
        <div>
          <strong>{row.filename}</strong>
          <small>{scanResult.detail}</small>
        </div>
      </div>

      {/* Barcode Comparison Card */}
      <div className="comparison-card">
        <div className="comparison-heading">
          <span className="eyebrow">Barcode verification analysis</span>
          <span className="info-chip">Actual scan vs Expected number</span>
        </div>

        <div className="comparison-grid">
          {/* Expected Barcode */}
          <div className="comparison-column">
            <span className="col-label">Authoritative Expected Number</span>
            <div className="value-display expected">
              <strong>{scanResult.expectedGtin || "Not detected in document"}</strong>
              <small>{scanResult.expectedBarcodeText || "Standard GS1 format"}</small>
            </div>
            <div className="meta-sub">
              <span>Lot: <strong>{scanResult.expectedLotCode || "N/A"}</strong></span>
              <span>Best Before: <strong>{scanResult.expectedBestBefore || "N/A"}</strong></span>
            </div>
          </div>

          {/* Divider Symbol */}
          <div className="comparison-divider">
            {isMatch ? (
              <span className="match-icon match">&#10003;</span>
            ) : (
              <span className="match-icon mismatch">&#8800;</span>
            )}
          </div>

          {/* Scanned Barcode */}
          <div className="comparison-column">
            <span className="col-label">Actual Scanned Barcode Artwork</span>
            <div className={`value-display scanned ${isMatch ? "match" : "mismatch"}`}>
              <strong>{scanResult.scannedGtin || scanResult.scannedRaw || "Unreadable"}</strong>
              <small>{scanResult.scannedRaw || "Barcode scanner result"}</small>
            </div>
            {scanResult.barcodeImageBase64 ? (
              <div className="scanned-thumbnail-wrap">
                <img
                  src={scanResult.barcodeImageBase64}
                  alt="Embedded barcode from document"
                  className="scanned-thumbnail"
                />
                <span className="thumb-caption">Scanned from embedded artwork</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Mismatch Alert / Success Callout */}
        {isMatch ? (
          <div className="success-callout">
            <strong>Barcode Matches Correctly</strong>
            <p>
              The embedded barcode scans to GTIN {scanResult.expectedGtin}. No replacement is required.
            </p>
          </div>
        ) : (
          <div className="error-callout">
            <span className="error-symbol">!</span>
            <div>
              <strong>Barcode Mismatch Detected</strong>
              <p>
                The scanned barcode artwork ({scanResult.scannedGtin || "unreadable"}) does not match the expected barcode number ({scanResult.expectedGtin}).
              </p>
              {scanResult.mismatches.map((m, idx) => (
                <p key={idx} className="mismatch-detail-line">
                  &bull; <strong>{m.field}:</strong> expected <code>{m.expected}</code>, scanned <code>{m.actual}</code>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resizable Barcode Box Editor & Fix Workspace */}
      <div className="repair-box-workspace">
        <div className="repair-box-header">
          <div>
            <span className="eyebrow">Replacement barcode placement & sizing</span>
            <strong>Resizable Barcode Box</strong>
          </div>
          <div className="dimension-controls">
            <label className="dim-label">
              <span>W (px):</span>
              <input
                type="number"
                min="120"
                max="340"
                value={boxWidth}
                onChange={(e) => setBoxWidth(Number(e.target.value))}
              />
            </label>
            <label className="dim-label">
              <span>H (px):</span>
              <input
                type="number"
                min="35"
                max="140"
                value={boxHeight}
                onChange={(e) => setBoxHeight(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="preset-btn"
              onClick={() => {
                setBoxWidth(280);
                setBoxHeight(65);
              }}
            >
              Reset 6x4
            </button>
          </div>
        </div>

        <p className="repair-hint">
          Drag the bottom-right corner of the rectangle box below to adjust the replacement barcode size in the DOCX label:
        </p>

        {/* Resizable Box Canvas */}
        <div className="resizable-canvas-container">
          <div
            className={`resizable-barcode-box ${isDragging ? "resizing" : ""}`}
            style={{ width: `${boxWidth}px`, height: `${boxHeight}px` }}
          >
            {replacementUrl ? (
              <img src={replacementUrl} alt="Replacement barcode" className="replacement-barcode-img" />
            ) : (
              <div className="barcode-placeholder">Generating correct barcode...</div>
            )}
            <span className="dimension-pill">
              {boxWidth} &times; {boxHeight} px
            </span>
            {/* Drag Handle */}
            <div
              className="resize-handle"
              onMouseDown={onStartResize}
              title="Drag to resize barcode box"
            />
          </div>
          <small className="canvas-footnote">
            Generated according to Canada GTIN rules with no digits underneath the bars
          </small>
        </div>

        <div className="repair-actions">
          <button
            className="primary-button"
            type="button"
            onClick={onRepair}
            disabled={isRepairing}
          >
            {isRepairing ? "Repairing..." : "Replace Barcode & Download DOCX"} <span aria-hidden="true">-&gt;</span>
          </button>
          {repairMessage ? <p className="repair-message">{repairMessage}</p> : null}
        </div>
      </div>
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className={`metric metric-${accent}`}>
      <span className="metric-label">{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
      <span className="metric-sub">labels</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  wide = false,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  type?: string;
  inputMode?: "numeric";
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PdfLabelPreview({
  productName,
  itemNumber,
  lotCode,
  bestBefore,
  ingredients,
  storageInstruction,
  gtin,
  barcodePreviewUrl,
}: {
  productName: string;
  itemNumber: string;
  lotCode: string;
  bestBefore: string;
  ingredients: string;
  storageInstruction: string;
  gtin: string;
  barcodePreviewUrl: string | null;
}) {
  return (
    <div className="pdf-page">
      <img className="preview-logo" src="/api/labels/logo" alt="Template logo" />
      <div className="preview-title">{productName}</div>
      <div className="preview-item">ITEM #{itemNumber}</div>
      <div className="preview-storage">{storageInstruction}</div>
      <div className="preview-lot">
        LOT CODE: {lotCode}
        <br />
        BEST BEFORE: {bestBefore.replaceAll("-", "/")}
      </div>
      <div className="preview-ingredients">
        <strong>Ingredients:</strong> {ingredients}
      </div>
      <div className="preview-barcode">
        {barcodePreviewUrl ? (
          <img src={barcodePreviewUrl} alt="Generated GS1 barcode preview" />
        ) : (
          <span className="barcode-placeholder">Barcode preview</span>
        )}
        <small>
          (01){gtin}(15){bestBefore.replaceAll("-", "").slice(2)}(10){lotCode}
        </small>
      </div>
      <div className="preview-address">
        <strong>Gastronomique pastry INC</strong>
        <span>7621 vantage way, Delta, BC V4G 1A6</span>
      </div>
    </div>
  );
}
