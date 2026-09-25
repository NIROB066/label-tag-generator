"use client";

export function GuidePrintButton() {
  return (
    <button type="button" className="primary-button print-button" onClick={() => window.print()}>
      Download this guide as PDF
    </button>
  );
}
