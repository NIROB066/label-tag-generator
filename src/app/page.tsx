"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import JSZip from "jszip";
import { buildGs1Payload, normalizeBestBeforeInput, suggestGtinCorrection, toBarcodeNumber } from "@/domain/gs1";
import { pickTitleFontSize } from "@/domain/label-typography";
import { LabelScanResult } from "@/domain/label-schema";

type Mode = "home" | "create" | "inspect";

type InspectionRow = {
  id: string;
  filename: string;
  file: File;
  scanResult: LabelScanResult;
  isRepaired?: boolean;
  repairFailed?: boolean;
  repairError?: string;
};

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

// App metadata served from data.xlsx via /api/app-info.
type AppInfoClient = {
  version: string;
  releaseUpdate: string;
  address: string;
  logoUrl: string;
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The Create form starts empty; every field shows an example placeholder
// instead of pre-filled hardcoded sample data.
const initialForm = {
  productName: "",
  itemNumber: "",
  gtin: "",
  lotCode: "",
  bestBefore: "",
  ingredients: "",
  storageInstruction: "",
};

const formPlaceholders = {
  productName: "e.g. Lava Cake 3 Inch",
  itemNumber: "e.g. GP2118",
  gtin: "e.g. 10627146285749",
  lotCode: "e.g. 72722",
  ingredients: "e.g. Eggs, sugar, wheat flour, margarine, dark chocolate.",
  storageInstruction: "e.g. KEEP FROZEN",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("home");
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  // App metadata from data.xlsx (version badge, release notes, address, logo)
  const [appInfo, setAppInfo] = useState<AppInfoClient | null>(null);

  // Drag & drop upload (Inspect mode)
  const [isDropActive, setIsDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  // Batch download-all state (progress bar)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: "" });

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
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [gtinSuggestion, setGtinSuggestion] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState<string | null>(null);

  // Register the service worker so the app is installable as a PWA.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Load app metadata (version, release update, address, logo) from data.xlsx.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/app-info", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: AppInfoClient | null) => {
        if (data) setAppInfo(data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Load barcode preview for Create mode
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function loadBarcodePreview() {
      // Skip the request until the barcode payload fields have values.
      if (!form.gtin.trim() || !form.bestBefore || !form.lotCode.trim()) {
        setBarcodePreviewUrl(null);
        return;
      }

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
      failed: rows.filter((r) => r.repairFailed).length,
    };
  }, [rows]);

  // Sync box dimensions with the selected row. Adjusting state during render
  // (guarded by the row id) is the React-recommended pattern for deriving
  // state from a changed selection without cascading effects.
  const [lastSyncedRowId, setLastSyncedRowId] = useState("");
  if (selectedRow && selectedRow.id !== lastSyncedRowId) {
    setLastSyncedRowId(selectedRow.id);
    if (selectedRow.scanResult.widthEmu && selectedRow.scanResult.heightEmu) {
      // 1 EMU = 1 / 914400 inch; at 96 DPI: 1px = 9525 EMUs
      const w = Math.round(selectedRow.scanResult.widthEmu / 9525);
      const h = Math.round(selectedRow.scanResult.heightEmu / 9525);
      if (w >= 100 && w <= 400) setBoxWidth(w);
      if (h >= 30 && h <= 200) setBoxHeight(h);
    }
  }

  const mismatchedRows = rows.filter((r) => r.scanResult.status !== "ready" && !r.isRepaired);

  // Handle Multi-file Upload (DOCX files or ZIP archives of DOCX files),
  // shared by the file input and the drag & drop zone.
  async function ingestFiles(files: File[]) {
    if (!files.length || isScanning || isDownloadingAll) return;

    setIsScanning(true);
    setRepairMessage("");

    try {
      const docxFiles: File[] = [];

      for (const file of files) {
        if (file.name.toLowerCase().endsWith(".zip")) {
          try {
            const zip = await JSZip.loadAsync(file);
            const entries = Object.values(zip.files).filter(
              (entry) =>
                !entry.dir &&
                !entry.name.startsWith("__MACOSX") &&
                !(entry.name.split("/").pop() ?? "").startsWith("._") &&
                entry.name.toLowerCase().endsWith(".docx"),
            );
            if (!entries.length) {
              setToastMessage(`${file.name} contains no .docx labels.`);
              continue;
            }
            for (const entry of entries) {
              const bytes = await entry.async("arraybuffer");
              const name = entry.name.split("/").pop() ?? entry.name;
              docxFiles.push(new File([bytes], name, { type: DOCX_MIME }));
            }
          } catch {
            setToastMessage(`${file.name} could not be read as a ZIP archive.`);
          }
        } else {
          docxFiles.push(file);
        }
      }

      if (!docxFiles.length) {
        return;
      }

      const formData = new FormData();
      for (const file of docxFiles) {
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
        const matchingFile = docxFiles.find((f) => f.name === res.filename) ?? docxFiles[index];
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
    }
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    void ingestFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  // Drag & Drop upload (Inspect mode): accept .docx files and .zip archives
  // dropped anywhere over the inspection workspace.
  function dragHasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function handleDragEnter(event: React.DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleDragOver(event: React.DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent) {
    if (!dragHasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDropActive(false);
  }

  function handleDrop(event: React.DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDropActive(false);
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      /\.(docx|zip)$/i.test(file.name),
    );
    if (!files.length) {
      setToastMessage("Only .docx and .zip files can be inspected.");
      return;
    }
    void ingestFiles(files);
  }

  function handleClearAll() {
    setRows([]);
    setSelectedId("");
    setRepairMessage("");
    setToastMessage("");
  }

  // Repair a single label
  async function handleRepair(row: InspectionRow) {
    setIsRepairing(true);
    setRepairMessage("Generating replacement barcode and patching DOCX...");

    try {
      // Honor the resizable barcode box only when the original geometry was
      // detected; the server keeps the detected size/position otherwise.
      const dims =
        selectedRow?.id === row.id && row.scanResult.widthEmu && row.scanResult.heightEmu
          ? { widthEmu: Math.round(boxWidth * 9525), heightEmu: Math.round(boxHeight * 9525) }
          : undefined;
      const blob = await repairRow(row, dims);
      downloadBlob(blob, `${row.filename.replace(/\.docx$/i, "")}-repaired.docx`);

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
                  scannedBarcodeNumber: r.scanResult.expectedBarcodeNumber,
                  scannedRaw: r.scanResult.expectedBarcodeText,
                  mismatches: [],
                  detail: "Repaired: barcode replaced with the authoritative barcode number.",
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

  async function repairRow(
    row: InspectionRow,
    dims?: { widthEmu: number; heightEmu: number },
  ): Promise<Blob> {
    const data = new FormData();
    data.append("file", row.file);
    data.append("gtin", row.scanResult.expectedGtin);
    data.append("lotCode", row.scanResult.expectedLotCode);
    data.append("bestBefore", row.scanResult.expectedBestBefore);
    if (dims) {
      data.append("widthEmu", String(dims.widthEmu));
      data.append("heightEmu", String(dims.heightEmu));
    }

    const response = await fetch("/api/labels/repair", {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      const err = (await response.json()) as { error?: string };
      throw new Error(err.error ?? `Repair failed for ${row.filename}.`);
    }

    return response.blob();
  }

  // Fix and Download ALL: correct labels pass through unchanged, mismatched
  // labels are patched in place (barcode replaced at its original size and
  // position) and prefixed with [FIXED]; everything is bundled into Labels.zip.
  async function handleDownloadAll() {
    const targets = rows;
    if (!targets.length || isDownloadingAll) return;

    setIsDownloadingAll(true);
    setBatchProgress({ done: 0, total: targets.length, current: "" });

    const zip = new JSZip();
    const fixedIds = new Set<string>();
    const failedIds = new Set<string>();
    const failedErrors = new Map<string, string>();
    let okCount = 0;
    let fixedCount = 0;
    let skipped = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const row = targets[index];
        setBatchProgress({ done: index, total: targets.length, current: row.filename });

        const isOk = row.scanResult.status === "ready" || row.isRepaired;
        if (isOk) {
          zip.file(row.filename, row.file);
          okCount += 1;
          continue;
        }

        if (!row.scanResult.expectedGtin) {
          zip.file(row.filename, row.file);
          skipped += 1;
          continue;
        }

        try {
          const blob = await repairRow(row);
          zip.file(`[FIXED] ${row.filename}`, blob);
          fixedIds.add(row.id);
          fixedCount += 1;
        } catch (error) {
          // e.g. an invalid GTIN check digit cannot be fixed automatically;
          // ship the untouched original and flag the row as failed.
          failedIds.add(row.id);
          failedErrors.set(row.id, error instanceof Error ? error.message : "Repair failed.");
          zip.file(row.filename, row.file);
          failedCount += 1;
        }
      }

      setBatchProgress({ done: targets.length, total: targets.length, current: "" });

      // When any label could not be fixed automatically (e.g. a wrong GTIN
      // check digit), nothing is downloaded: fix the flagged labels and run
      // the batch again.
      if (failedCount > 0) {
        setRows((prev) =>
          prev.map((r) =>
            failedIds.has(r.id)
              ? { ...r, repairFailed: true, repairError: failedErrors.get(r.id) }
              : r,
          ),
        );
        setRepairMessage(
          `Nothing was downloaded: ${failedCount} label${failedCount === 1 ? "" : "s"} could not be fixed automatically (wrong GTIN number). Correct the GTIN on the flagged label${failedCount === 1 ? "" : "s"} and run Fix and Download ALL again.`,
        );
        return;
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, "Labels.zip");

      setRows((prev) =>
        prev.map((r) => {
          if (fixedIds.has(r.id)) {
            return {
              ...r,
              isRepaired: true,
              scanResult: {
                ...r.scanResult,
                status: "ready",
                scannedGtin: r.scanResult.expectedGtin,
                scannedBarcodeNumber: r.scanResult.expectedBarcodeNumber,
                scannedRaw: r.scanResult.expectedBarcodeText,
                mismatches: [],
                detail: "Repaired: barcode replaced with the authoritative barcode number.",
              },
            };
          }
          if (failedIds.has(r.id)) {
            return { ...r, repairFailed: true, repairError: failedErrors.get(r.id) };
          }
          return r;
        }),
      );

      const summary = `Labels.zip downloaded: ${okCount} correct, ${fixedCount} fixed`;
      const parts = [summary];
      if (failedCount > 0) parts.push(`${failedCount} failed (wrong GTIN number - fix manually)`);
      if (skipped > 0) parts.push(`${skipped} could not be repaired (no GTIN found)`);
      setRepairMessage(parts.join(", ") + ".");
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : "Batch fix failed.");
    } finally {
      setIsDownloadingAll(false);
      setBatchProgress({ done: 0, total: 0, current: "" });
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
    setFormSuccess(null);
    setGtinSuggestion(null);
  }

  function validateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const payload = buildGs1Payload(form);
      setFormMessage("Payload ready. You can generate the label.");
      setFormSuccess(
        `Barcode payload is valid: ${payload.humanReadable}. Encoded barcode data contains no parentheses.`,
      );
      setGtinSuggestion(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the label fields.";
      const correction = suggestGtinCorrection(form.gtin);
      if (correction) {
        setFormMessage(`The GTIN check digit looks wrong — the correct check digit is ${correction.slice(-1)}.`);
        setGtinSuggestion(correction);
      } else {
        setFormMessage(message);
        setGtinSuggestion(null);
      }
      setFormSuccess(null);
      setToastMessage(correction ? "GTIN check digit error — suggestion available." : message);
    }
  }

  async function generateDocument() {
    if (!form.productName.trim()) {
      setFormMessage("Enter a product name before generating the label.");
      setToastMessage("Enter a product name before generating the label.");
      return;
    }

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
      downloadBlob(blob, `${form.productName.replace(/[^a-z0-9]+/gi, "-") || "generated-label"}.docx`);
      setFormMessage("DOCX ready. Barcode generated without human-readable digits beneath.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Label generation failed.";
      setFormMessage(message);
      setToastMessage(message);
    } finally {
      setIsGenerating(false);
    }
  }

  // Label pager: Previous/Next + swipe navigation between uploaded labels
  function stepLabel(direction: 1 | -1) {
    if (rows.length < 2) return;
    const currentIndex = Math.max(
      0,
      rows.findIndex((r) => r.id === selectedRow?.id),
    );
    const nextIndex = (currentIndex + direction + rows.length) % rows.length;
    setSelectedId(rows[nextIndex].id);
    setRepairMessage("");
  }

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 80) {
      stepLabel(deltaX < 0 ? 1 : -1);
    }
    touchStartRef.current = null;
  }

  const selectedLabelIndex = selectedRow ? rows.findIndex((r) => r.id === selectedRow.id) + 1 : 0;

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
        <button type="button" className="brand-lockup brand-home" onClick={() => setMode("home")}>
          <span className="brand-mark" aria-hidden="true">LT</span>
          <span className="brand-copy">
            <span className="eyebrow">Label operations</span>
            <span className="brand-title">Label Tag Studio</span>
          </span>
        </button>
        <div className="topbar-actions">
          <ThemeToggle />
          <Link className="guide-link" href="/guide">
            User guide
          </Link>
          <InstallButton />
          {appInfo ? (
            <VersionBadge version={appInfo.version} releaseUpdate={appInfo.releaseUpdate} />
          ) : null}
          <span className="topbar-note">
            <span className="status-dot" /> Local barcode verification engine
          </span>
        </div>
      </header>

      {mode === "home" ? (
        <section className="home-choice">
          <div className="home-choice-inner">
            <p className="eyebrow">Welcome</p>
            <h2>What would you like to do?</h2>
            <div className="choice-grid">
              <button type="button" className="choice-card" onClick={() => setMode("create")}>
                <span className="choice-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="4" y="2.5" width="16" height="19" rx="1.5" />
                    <path d="M8 7h8M8 11h8M8 15h4" />
                  </svg>
                </span>
                <strong>Create a label</strong>
                <span className="choice-copy">
                  Fill in the product details and download a print-ready 6x4 DOCX with a verified
                  GS1 barcode.
                </span>
                <span className="choice-cta">Start creating &rarr;</span>
              </button>
              <button type="button" className="choice-card" onClick={() => setMode("inspect")}>
                <span className="choice-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M17 3h2.5A1.5 1.5 0 0 1 21 4.5V7M21 17v2.5a1.5 1.5 0 0 1-1.5 1.5H17M7 21H4.5A1.5 1.5 0 0 1 3 19.5V17" />
                    <path d="M7 8.5v7M10.5 8.5v7M14 8.5v7M17 8.5v7" />
                  </svg>
                </span>
                <strong>Check &amp; fix labels</strong>
                <span className="choice-copy">
                  Upload label files (or a ZIP) — scan every barcode, spot errors, and download
                  fixed copies in one ZIP.
                </span>
                <span className="choice-cta">Start checking &rarr;</span>
              </button>
            </div>
            <p className="home-hint">
              New here? Read the <Link href="/guide">step-by-step guide</Link> with screenshots.
            </p>
          </div>
        </section>
      ) : null}

      {mode === "create" ? (
        <section className="workspace create-workspace">
          <button type="button" className="back-button" onClick={() => setMode("home")}>
            &larr; Back
          </button>
          <div className="workspace-panels">
            <form className="panel create-form" onSubmit={validateForm}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">New label</p>
                  <h3>Label details</h3>
                </div>
                <span className="step-chip">Create</span>
              </div>

              {formSuccess ? (
                <div className="success-banner" role="status">
                  <div>
                    <strong>Validation passed</strong>
                    <span>{formSuccess}</span>
                  </div>
                  <button type="button" aria-label="Dismiss success message" onClick={() => setFormSuccess(null)}>
                    x
                  </button>
                </div>
              ) : null}

              <div className="form-grid">
                <Field label="Product name" value={form.productName} onChange={(v) => updateForm("productName", v)} placeholder={formPlaceholders.productName} />
                <Field label="Item number" value={form.itemNumber} onChange={(v) => updateForm("itemNumber", v)} placeholder={formPlaceholders.itemNumber} />
                <Field label="GTIN / barcode number" value={form.gtin} onChange={(v) => updateForm("gtin", v)} wide inputMode="numeric" placeholder={formPlaceholders.gtin} />
                <Field label="Lot code" value={form.lotCode} onChange={(v) => updateForm("lotCode", v)} placeholder={formPlaceholders.lotCode} />
                <DateField label="Best before" value={form.bestBefore} onChange={(v) => updateForm("bestBefore", v)} placeholder="e.g. 2025-09-23" hint="Type YYYY-MM-DD or use the calendar" />
                <Field label="Storage instruction" value={form.storageInstruction} onChange={(v) => updateForm("storageInstruction", v)} placeholder={formPlaceholders.storageInstruction} />
                <label className="field wide">
                  <span>Ingredients</span>
                  <textarea value={form.ingredients} onChange={(e) => updateForm("ingredients", e.target.value)} rows={4} placeholder={formPlaceholders.ingredients} />
                </label>
              </div>
              <div className="form-footer">
                <div className="form-message-wrap">
                  <p className={`form-message ${formMessage.includes("Error") || formMessage.includes("wrong") || formMessage.includes("Enter a") ? "form-message-error" : ""}`} role="status">
                    {formMessage}
                  </p>
                  {gtinSuggestion ? (
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={() => {
                        updateForm("gtin", gtinSuggestion);
                        setFormMessage(`GTIN updated to the suggested value ${gtinSuggestion}.`);
                      }}
                    >
                      Use suggested GTIN {gtinSuggestion}
                    </button>
                  ) : null}
                </div>
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
                address={appInfo?.address}
                logoUrl={appInfo?.logoUrl}
              />
            </div>
          </div>
        </section>
      ) : null}

      {mode === "inspect" ? (
        <div
          className="inspect-drop-zone"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <section className="metrics" aria-label="Batch summary">
            <Metric label="Labels in queue" value={counts.total} accent="ink" />
            <Metric label="Need fixing" value={counts.attention} accent="coral" />
            <Metric label="Verified &amp; ready" value={counts.ready} accent="mint" />
            <div className="metric metric-chart">
              <StatusDonut
                ready={counts.ready}
                attention={counts.attention}
                error={counts.error}
                failed={counts.failed}
              />
            </div>
          </section>

          <section className="workspace inspect-workspace">
            <button type="button" className="back-button" onClick={() => setMode("home")}>
              &larr; Back
            </button>
            <div className="workspace-panels">
              {/* LEFT: Queue & Batch Actions */}
              <div className="panel queue-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Batch inspection</p>
                    <h3>Label queue</h3>
                  </div>
                  <label className="upload-button">
                    {isScanning ? "Scanning..." : "Upload labels (.docx / .zip)"}
                    <input
                      type="file"
                      accept=".docx,.zip,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      multiple
                      disabled={isScanning || isDownloadingAll}
                      onChange={handleUpload}
                    />
                  </label>
                </div>

                {/* Batch Toolbar */}
                {rows.length > 0 ? (
                  <div className="batch-toolbar">
                    <div className="batch-selection-info">
                      <strong>
                        {rows.length} label{rows.length === 1 ? "" : "s"} in queue
                      </strong>
                      <span>
                        {mismatchedRows.length > 0
                          ? `${mismatchedRows.length} need fixing`
                          : "all verified"}
                      </span>
                    </div>

                    <div className="batch-actions-buttons">
                      <button
                        type="button"
                        className="batch-action-btn ghost"
                        onClick={handleClearAll}
                        disabled={isDownloadingAll}
                      >
                        Clear all
                      </button>
                      {mismatchedRows.length > 0 ? (
                        <button
                          type="button"
                          className="batch-action-btn coral"
                          onClick={handleDownloadAll}
                          disabled={isDownloadingAll}
                        >
                          {isDownloadingAll ? "Fixing..." : "Fix and Download ALL"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="batch-action-btn"
                          onClick={handleDownloadAll}
                          disabled={isDownloadingAll}
                        >
                          {isDownloadingAll ? "Preparing..." : "All files are CORRECT, still want to download?"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Batch progress bar */}
                {isDownloadingAll && batchProgress.total > 0 ? (
                  <div className="progress-wrap">
                    <div
                      className="progress-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={batchProgress.total}
                      aria-valuenow={batchProgress.done}
                    >
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((batchProgress.done / batchProgress.total) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                    <small>
                      Fixing {batchProgress.done + 1} of {batchProgress.total}
                      {batchProgress.current ? `: ${batchProgress.current}` : ""}
                    </small>
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

                      return (
                        <div
                          key={row.id}
                          className={`queue-row-container ${row.id === selectedRow?.id ? "selected" : ""}`}
                        >
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
                                {row.filename} &bull; Expected: {row.scanResult.expectedBarcodeNumber || row.scanResult.expectedGtin || "None"}
                              </small>
                              {row.scanResult.scannedBarcodeNumber && (
                                <span className="scanned-badge">
                                  Scanned: <code>{row.scanResult.scannedBarcodeNumber}</code>
                                </span>
                              )}
                            </span>
                            <span className="queue-row-status">
                              <span
                                className={`status-pill ${
                                  isReady ? "ready" : isAttention ? "attention" : "error"
                                }`}
                              >
                                {isReady ? "Ready" : isAttention ? "Mismatch" : "Unreadable"}
                              </span>
                              {row.repairFailed ? (
                                <span className="fix-failed-note">
                                  {/gtin|check digit/i.test(row.repairError ?? "")
                                    ? "Wrong GTIN number can't be fixed automatically"
                                    : row.repairError ?? "Repair failed"}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="queue-empty">
                      <strong>No labels uploaded</strong>
                      <span>
                        Drag &amp; drop one or more .docx label files (or a .zip containing
                        several) anywhere in this workspace, or use Upload labels, to scan and
                        check barcodes.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT: Inspection & Resizable Barcode Repair Workspace */}
              <div
                className="panel detail-panel"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {rows.length > 1 ? (
                  <div className="label-pager">
                    <button type="button" onClick={() => stepLabel(-1)}>
                      &larr; Previous
                    </button>
                    <span>
                      Label {selectedLabelIndex} of {rows.length}
                    </span>
                    <button type="button" onClick={() => stepLabel(1)}>
                      Next &rarr;
                    </button>
                  </div>
                ) : null}

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
                      Drag &amp; drop .docx labels (or a .zip with several) anywhere in this
                      workspace — or use the Upload labels button — to scan the embedded barcodes
                      and compare them with the expected barcode numbers.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {isDropActive ? (
            <div className="drop-overlay" aria-hidden="true">
              <div className="drop-overlay-card">
                <strong>Drop your labels here</strong>
                <span>.docx files and .zip archives are scanned automatically</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="footer-note">
        <span>
          GS1 Canada GTIN validation active &bull; Barcode scanning with Code 128 / GS1-128 decoder
        </span>
        <span>
          Local DOCX package mutation &bull; Formatting and logo preserved &bull;{" "}
          <Link href="/guide">User guide</Link>
        </span>
      </footer>

      <nav className="mobile-nav" aria-label="Primary">
        <button type="button" className={mode === "home" ? "active" : ""} onClick={() => setMode("home")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" />
          </svg>
          Home
        </button>
        <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create
        </button>
        <button type="button" className={mode === "inspect" ? "active" : ""} onClick={() => setMode("inspect")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M17 3h2.5A1.5 1.5 0 0 1 21 4.5V7M21 17v2.5a1.5 1.5 0 0 1-1.5 1.5H17M7 21H4.5A1.5 1.5 0 0 1 3 19.5V17" />
          </svg>
          Check
        </button>
        <Link href="/guide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
            <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
          </svg>
          Guide
        </Link>
      </nav>
    </main>
  );

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const isIOS =
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="install-wrap">
      <button
        type="button"
        className="install-button"
        onClick={() => {
          if (deferredPrompt) {
            void deferredPrompt.prompt();
          } else {
            setShowHelp((visible) => !visible);
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16" />
        </svg>
        Install
      </button>
      {showHelp ? (
        <div className="install-help" role="dialog" aria-label="Install instructions">
          <strong>Install on your device</strong>
          {isIOS ? (
            <p>
              Tap the <strong>Share</strong> button in Safari, then choose{" "}
              <strong>Add to Home Screen</strong>.
            </p>
          ) : (
            <p>
              Open your browser menu and choose <strong>Install app</strong> or{" "}
              <strong>Add to Home screen</strong>.
            </p>
          )}
          <button type="button" className="text-link-btn" onClick={() => setShowHelp(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

const systemThemeQuery = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(systemThemeQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSystemThemeSnapshot() {
  return window.matchMedia(systemThemeQuery).matches;
}

function ThemeToggle() {
  // null = follow the system preference (default; nothing stored).
  const [storedTheme, setStoredTheme] = useState<"light" | "dark" | null>(null);
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );

  useEffect(() => {
    // Read the stored choice after first paint (the pre-paint script in the
    // layout has already applied it to <html>, so no visual flip happens).
    const frame = requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") setStoredTheme(stored);
      } catch {
        // localStorage can be unavailable (private mode) — stay on system mode.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const isDark = storedTheme ? storedTheme === "dark" : systemDark;

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    setStoredTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // Preference just won't persist across visits.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4.4" />
          <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20.2 14.2A8.2 8.2 0 0 1 9.8 3.8 8.2 8.2 0 1 0 20.2 14.2Z" />
        </svg>
      )}
    </button>
  );
}

function VersionBadge({ version, releaseUpdate }: { version: string; releaseUpdate: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="version-wrap" ref={wrapRef}>
      <button
        type="button"
        className="version-badge"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What's new in this release"
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className="version-dot" aria-hidden="true" />
        v{version}
      </button>
      {open ? (
        <div
          className="version-popover"
          role="dialog"
          aria-label={`Release update for version ${version}`}
        >
          <strong>Release update &mdash; v{version}</strong>
          <p className="version-notes">{releaseUpdate}</p>
          <button type="button" className="text-link-btn" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusDonut({
  ready,
  attention,
  error,
  failed,
}: {
  ready: number;
  attention: number;
  error: number;
  failed: number;
}) {
  const total = ready + attention + error + failed;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { label: "Verified", value: ready, color: "#4e8e70" },
    { label: "Needs fixing", value: attention, color: "#a26024" },
    { label: "Unreadable", value: error, color: "#b74932" },
    { label: "Failed", value: failed, color: "#7f1d1d" },
  ];
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg
        viewBox="0 0 140 140"
        className="donut"
        role="img"
        aria-label={`${ready} verified, ${attention} need fixing, ${error} unreadable, ${failed} failed`}
      >
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#e5e1d6" strokeWidth="18" />
        {total > 0
          ? segments
              .filter((s) => s.value > 0)
              .map((s) => {
                const length = (s.value / total) * circumference;
                const element = (
                  <circle
                    key={s.label}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="18"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 70 70)"
                  />
                );
                offset += length;
                return element;
              })
          : null}
        <text x="70" y="68" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" className="donut-label">
          labels
        </text>
      </svg>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label}: <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
    </div>
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
          <p className="eyebrow">Label inspection &amp; fix</p>
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
          <span className="info-chip">Actual scan vs written number</span>
        </div>

        <div className="comparison-grid">
          {/* Expected Barcode */}
          <div className="comparison-column">
            <span className="col-label">Written on label (source of truth)</span>
            <div className="value-display expected">
              <strong>{scanResult.expectedBarcodeNumber || scanResult.expectedGtin || "Not detected in document"}</strong>
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
            <span className="col-label">Scanned from barcode artwork</span>
            <div className={`value-display scanned ${isMatch ? "match" : "mismatch"}`}>
              <strong>
                {scanResult.scannedBarcodeNumber ||
                  (scanResult.scannedRaw ? toBarcodeNumber(scanResult.scannedRaw) : "Unreadable")}
              </strong>
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
            <strong>Barcode verified - no correction needed</strong>
            <p>
              The scanned barcode number <code>{scanResult.scannedBarcodeNumber}</code> matches the
              written barcode number, lot code, and best-before date exactly. This label is ready to
              print as-is.
            </p>
          </div>
        ) : (
          <div className="error-callout">
            <span className="error-symbol">!</span>
            <div>
              <strong>Barcode mismatch detected</strong>
              <p>
                The scanned barcode number ({scanResult.scannedBarcodeNumber || "unreadable"}) does
                not match the written barcode number ({scanResult.expectedBarcodeNumber || scanResult.expectedGtin}).
                Every difference below will be corrected when you replace the barcode.
              </p>
              {scanResult.mismatches.map((m, idx) => (
                <p
                  key={idx}
                  className={`mismatch-detail-line ${String(m.expected) === String(m.actual) ? "match" : "mismatch"}`}
                >
                  &bull; <strong>{m.field}:</strong> expected <code>{m.expected}</code>, scanned <code>{m.actual}</code>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Correction tools are hidden when the label already verified - nothing to fix */}
      {isMatch ? (
        <div className="repair-box-workspace">
          <div className="verified-tools-note">
            <strong>Correction tools hidden</strong>
            <p>
              This label passed every check (barcode number, lot code, and best-before date), so
              there is nothing to repair, replace, or resize.
            </p>
          </div>
        </div>
      ) : (
        <div className="repair-box-workspace">
          <div className="repair-box-header">
            <div>
              <span className="eyebrow">Replacement barcode placement &amp; sizing</span>
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
      )}
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
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  inputMode?: "numeric";
  placeholder?: string;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  function handlePicked(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value) {
      onChange(event.target.value);
    }
  }

  function normalizeTyped() {
    const normalized = normalizeBestBeforeInput(value);
    if (normalized && normalized !== value) {
      onChange(normalized);
    }
  }

  return (
    <label className="field">
      <span>{label}</span>
      {/* Touch devices (iPhone/iPad/Android) get the native OS date picker
          directly on the main field: tapping it always opens the picker,
          independent of showPicker() support or popup blockers. */}
      <input
        type="date"
        className="date-native-field"
        value={dateValue}
        onChange={handlePicked}
        aria-label={`${label} date`}
      />
      <span className="date-input-row">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={normalizeTyped}
        />
        <span className="calendar-button">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="1.5" y="3" width="13" height="11.5" rx="1" />
            <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" />
          </svg>
          {/* The native input overlays the icon, so the tap/click target IS
              the date input itself and every browser opens its own picker. */}
          <input
            type="date"
            className="calendar-native-input"
            value={dateValue}
            onChange={handlePicked}
            aria-label={`Pick ${label.toLowerCase()} date from calendar`}
            title="Pick from calendar"
          />
        </span>
      </span>
      {hint ? <small className="field-hint">{hint}</small> : null}
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
  address,
  logoUrl,
}: {
  productName: string;
  itemNumber: string;
  lotCode: string;
  bestBefore: string;
  ingredients: string;
  storageInstruction: string;
  gtin: string;
  barcodePreviewUrl: string | null;
  address?: string;
  logoUrl?: string;
}) {
  // Address comes from data.xlsx; the first comma splits the bold company
  // name from the street lines, matching the printed label layout.
  const addressText =
    address || "Gastronomique pastry INC, 7621 vantage way, Delta, BC V4G 1A6";
  const commaIndex = addressText.indexOf(",");
  const company = commaIndex === -1 ? addressText : addressText.slice(0, commaIndex).trim();
  const addressLine = commaIndex === -1 ? "" : addressText.slice(commaIndex + 1).trim();

  return (
    <div className="pdf-page">
      <img className="preview-logo" src={logoUrl || "/api/labels/logo"} alt="Template logo" />
      <div
        className="preview-title"
        style={{ fontSize: `${(pickTitleFontSize(productName) / 2) * 1.25}px` }}
      >
        {productName || "Your product name"}
      </div>
      <div className="preview-item">ITEM #{itemNumber || "—"}</div>
      <div className="preview-storage">{storageInstruction || "STORAGE"}</div>
      <div className="preview-lot">
        LOT CODE: {lotCode || "—"}
        <br />
        BEST BEFORE: {bestBefore ? bestBefore.replaceAll("-", "/") : "—"}
      </div>
      <div className="preview-ingredients">
        <strong>Ingredients:</strong>{" "}
        {ingredients || "Ingredient list appears here as you type"}
      </div>
      <div className="preview-barcode">
        {barcodePreviewUrl ? (
          <img src={barcodePreviewUrl} alt="Generated GS1 barcode preview" />
        ) : (
          <span className="barcode-placeholder">Barcode preview</span>
        )}
        {gtin && bestBefore && lotCode ? (
          <small>
            (01){gtin}(15){bestBefore.replaceAll("-", "").slice(2)}(10){lotCode}
          </small>
        ) : (
          <small>The barcode number appears here once GTIN, date, and lot are filled in</small>
        )}
      </div>
      <div className="preview-address">
        <strong>{company}</strong>
        {addressLine ? <span>{addressLine}</span> : null}
      </div>
    </div>
  );
}
