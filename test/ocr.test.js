import test from "node:test";
import assert from "node:assert/strict";
import {
  OCR_PROGRESS_INTERVAL,
  createOcrProgressSnapshot,
  explainOcrError,
  formatDuration,
  ocrPdfFile,
  viewportForOcr,
} from "../src/ocr.js";

test("publishes page progress on a three-second interval", () => {
  assert.equal(OCR_PROGRESS_INTERVAL, 3000);
  const snapshot = createOcrProgressSnapshot({
    startedAt: 0,
    completedPages: 2,
    totalPages: 8,
    currentPage: 3,
    stage: "recognizing",
  }, 120000);
  assert.equal(snapshot.percent, 25);
  assert.equal(snapshot.remainingLabel, "約 6 分鐘");
  assert.equal(formatDuration(60 * 60 * 1000), "約 1 小時");
});

test("explains OCR download and memory failures", () => {
  assert.match(explainOcrError(new Error("failed to fetch traineddata")), /辨識模型/);
  assert.match(explainOcrError(new Error("out of memory")), /記憶體不足/);
});

test("limits OCR render dimensions while preserving page ratio", () => {
  const page = { getViewport: ({ scale }) => ({ width: 1000 * scale, height: 2000 * scale, scale }) };
  const viewport = viewportForOcr(page, 1800);
  assert.equal(viewport.width, 900);
  assert.equal(viewport.height, 1800);
});

test("OCRs pages sequentially, reports completion, and releases resources", async () => {
  const cleanedPages = [];
  const pageTexts = ["第一頁。", "Second page."];
  const pdfDocument = {
    numPages: 2,
    getPage: async (pageNumber) => ({
      getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => cleanedPages.push(pageNumber),
    }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({}),
  };
  let recognizeIndex = 0;
  let terminated = false;
  const workerFactory = async () => ({
    setParameters: async () => {},
    recognize: async () => ({ data: { text: pageTexts[recognizeIndex++] } }),
    terminate: async () => { terminated = true; },
  });
  const progress = [];

  const result = await ocrPdfFile({}, {
    pdfDocument,
    workerFactory,
    canvasFactory: () => canvas,
    onProgress: (state) => progress.push(state),
  });

  assert.equal(result.text, "第一頁。\n\nSecond page.");
  assert.equal(result.totalPages, 2);
  assert.deepEqual(cleanedPages, [1, 2]);
  assert.equal(terminated, true);
  assert.equal(progress.filter((state) => state.stage === "page-complete").length, 2);
  assert.equal(progress.at(-1).stage, "complete");
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
});

test("stops OCR before work starts when already cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    ocrPdfFile({}, { signal: controller.signal, pdfDocument: { numPages: 1 } }),
    (error) => error.name === "AbortError",
  );
});
