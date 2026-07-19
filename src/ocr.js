import { openPdfDocument } from "./file-parser.js";

export const OCR_LANGUAGES = ["chi_sim", "chi_tra", "eng"];
export const OCR_PROGRESS_INTERVAL = 3000;
export const OCR_MAX_RENDER_DIMENSION = 1800;

function abortError() {
  return new DOMException("OCR 已取消", "AbortError");
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "計算中";
  const totalMinutes = Math.ceil(milliseconds / 60000);
  if (totalMinutes < 60) return `約 ${totalMinutes} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `約 ${hours} 小時 ${minutes} 分` : `約 ${hours} 小時`;
}

export function explainOcrError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/fetch|network|load.*(model|language)|traineddata/i.test(message)) {
    return "無法下載 OCR 辨識模型，請確認網路連線後重新嘗試。PDF 內容沒有被上傳。";
  }
  if (/memory|allocation|out of bounds|table index/i.test(message)) {
    return "瀏覽器記憶體不足，請關閉其他分頁後再試一次，或先將 PDF 拆成較小的檔案。";
  }
  if (/canvas|context/i.test(message)) {
    return "瀏覽器無法建立 OCR 畫布，請改用最新版 Chrome、Edge 或 Safari。";
  }
  return message || "OCR 執行時發生問題，請重新整理頁面後再試一次。";
}

export function createOcrProgressSnapshot(progress, now = Date.now()) {
  const completedPages = progress.completedPages || 0;
  const totalPages = progress.totalPages || 0;
  const elapsed = Math.max(0, now - progress.startedAt);
  const averagePageTime = completedPages > 0 ? elapsed / completedPages : 0;
  const remaining = averagePageTime * Math.max(0, totalPages - completedPages);

  return {
    ...progress,
    percent: totalPages ? Math.round((completedPages / totalPages) * 100) : 0,
    remainingLabel: completedPages ? formatDuration(remaining) : "完成第一頁後估算",
  };
}

export function viewportForOcr(page, maxDimension = OCR_MAX_RENDER_DIMENSION) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxDimension / Math.max(baseViewport.width, baseViewport.height));
  return page.getViewport({ scale });
}

async function defaultWorkerFactory(logger) {
  const { createWorker } = await import("tesseract.js");
  return createWorker(OCR_LANGUAGES, 1, {
    logger,
  });
}

export async function ocrPdfFile(file, {
  signal,
  onProgress = () => {},
  workerFactory = defaultWorkerFactory,
  pdfDocument,
  canvasFactory = () => document.createElement("canvas"),
} = {}) {
  const startedAt = Date.now();
  let worker;
  let pdf = pdfDocument;
  let currentPage = 0;
  let completedPages = 0;
  let terminated = false;

  const report = (stage, extra = {}) => onProgress({
    stage,
    startedAt,
    totalPages: pdf?.numPages || 0,
    currentPage,
    completedPages,
    ...extra,
  });

  const terminateWorker = () => {
    if (worker && !terminated) {
      terminated = true;
      void worker.terminate();
    }
  };
  signal?.addEventListener("abort", terminateWorker, { once: true });

  try {
    assertNotAborted(signal);
    report("loading-pdf");
    if (!pdf) pdf = await openPdfDocument(await file.arrayBuffer());
    assertNotAborted(signal);
    report("loading-model");

    worker = await workerFactory((message) => {
      const stage = currentPage > 0 && /recogniz/i.test(message.status || "") ? "recognizing" : "loading-model";
      report(stage, { engineStatus: message.status, engineProgress: message.progress || 0 });
    });
    assertNotAborted(signal);
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "220",
    });

    const pages = [];
    let pagesWithText = 0;

    for (currentPage = 1; currentPage <= pdf.numPages; currentPage += 1) {
      assertNotAborted(signal);
      report("rendering");
      const page = await pdf.getPage(currentPage);
      const viewport = viewportForOcr(page);
      const canvas = canvasFactory();
      try {
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!context) throw new Error("這個瀏覽器無法建立 OCR 畫布。請改用最新版瀏覽器。");

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        assertNotAborted(signal);
        report("recognizing");
        const result = await worker.recognize(canvas);
        const pageText = result.data.text
          .replace(/\r\n?/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (pageText) {
          pages.push(pageText);
          pagesWithText += 1;
        }

        completedPages = currentPage;
        report("page-complete", { pagesWithText });
      } finally {
        page.cleanup?.();
        canvas.width = 1;
        canvas.height = 1;
      }
    }

    const text = pages.join("\n\n").trim();
    if (!text) throw new Error("OCR 已完成，但沒有辨識到可閱讀的文字。請確認頁面影像是否清楚。");
    report("complete", { pagesWithText });
    return { text, totalPages: pdf.numPages, pagesWithText };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", terminateWorker);
    if (worker && !terminated) {
      terminated = true;
      await worker.terminate();
    }
    if (!pdfDocument) await pdf?.destroy();
  }
}
