import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FILE_SIZE,
  cleanTextFileContents,
  createFileReadError,
  explainFileReadError,
  extractPdfText,
  formatFileSize,
  getFileExtension,
  inspectFile,
  joinPdfTextItems,
  validateFile,
} from "../src/file-parser.js";

test("recognizes supported text files and rejects unsafe inputs", () => {
  assert.equal(validateFile({ name: "notes.md", type: "text/markdown", size: 120 }), "");
  assert.equal(validateFile({ name: "data.yaml", type: "", size: 120 }), "");
  assert.match(validateFile({ name: "photo.png", type: "image/png", size: 120 }), /無法讀取/);
  assert.match(validateFile({ name: "huge.txt", type: "text/plain", size: MAX_FILE_SIZE + 1 }), /40 MB/);
});

test("reports independent format and size checks", () => {
  const inspection = inspectFile({ name: "book.pdf", type: "application/pdf", size: 2048 });
  assert.deepEqual(inspection.format, { passed: true, label: "PDF" });
  assert.deepEqual(inspection.size, { passed: true, label: "2.0 KB" });
});

test("turns common PDF failures into actionable messages", () => {
  const file = { name: "locked.pdf", type: "application/pdf", size: 2048 };
  const error = new Error("Password required");
  error.name = "PasswordException";
  assert.match(explainFileReadError(error, file), /密碼保護/);
});

test("labels image-only PDFs so the interface can start OCR", () => {
  const error = createFileReadError("PDF_NO_TEXT", "沒有文字");
  assert.equal(error.code, "PDF_NO_TEXT");
});

test("normalizes text, JSON, and subtitle files", () => {
  assert.equal(cleanTextFileContents("\uFEFF第一行\r\n第二行", "txt"), "第一行\n第二行");
  assert.equal(cleanTextFileContents('{"title":"逐句"}', "json"), '{\n  "title": "逐句"\n}');
  assert.equal(
    cleanTextFileContents("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c.green>慢慢閱讀。</c>", "vtt"),
    "慢慢閱讀。",
  );
});

test("joins PDF items without inserting spaces between Chinese characters", () => {
  assert.equal(
    joinPdfTextItems([{ str: "逐", hasEOL: false }, { str: "句", hasEOL: true }, { str: "Focus", hasEOL: false }, { str: "Reader", hasEOL: false }]),
    "逐句\nFocus Reader",
  );
});

test("extracts and separates text from multiple PDF pages", async () => {
  const pages = [
    [{ str: "第一頁。", hasEOL: false }],
    [{ str: "第二頁。", hasEOL: false }],
  ];
  let destroyed = false;
  const mockGetDocument = () => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (pageNumber) => ({
        getTextContent: async () => ({ items: pages[pageNumber - 1] }),
        cleanup: () => {},
      }),
      destroy: async () => { destroyed = true; },
    }),
  });

  assert.equal(await extractPdfText(new ArrayBuffer(4), mockGetDocument), "第一頁。\n第二頁。");
  assert.equal(destroyed, true);
});

test("extracts text through the real PDF engine", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const content = "BT /F1 18 Tf 72 720 Td (Hello PDF.) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(source));
    source += object;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += "xref\n0 6\n0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = Uint8Array.from(Buffer.from(source));
  assert.equal(await extractPdfText(bytes.buffer, getDocument), "Hello PDF.");
});

test("formats file metadata for the interface", () => {
  assert.equal(getFileExtension("BOOK.PDF"), "pdf");
  assert.equal(formatFileSize(1536), "1.5 KB");
});
