export const MAX_FILE_SIZE = 40 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "html", "htm",
  "xml", "yaml", "yml", "srt", "vtt", "log",
]);

let pdfWorkerUrl = "";

export function configurePdfWorker(url) {
  pdfWorkerUrl = url;
}

export function createFileReadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getFileExtension(fileName = "") {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getFileTypeLabel(file) {
  const extension = getFileExtension(file.name);
  if (extension) return extension.slice(0, 4).toUpperCase();
  return file.type === "application/pdf" ? "PDF" : "TEXT";
}

export function inspectFile(file) {
  if (!file) return null;
  const extension = getFileExtension(file.name);
  const isPdf = extension === "pdf" || file.type === "application/pdf";
  const isText = SUPPORTED_EXTENSIONS.has(extension) || (file.type || "").startsWith("text/");

  return {
    isPdf,
    format: {
      passed: isPdf || isText,
      label: isPdf ? "PDF" : (extension || file.type || "未知格式").toUpperCase(),
    },
    size: {
      passed: file.size > 0 && file.size <= MAX_FILE_SIZE,
      label: formatFileSize(file.size),
    },
  };
}

export function validateFile(file) {
  if (!file) return "請先選擇一個檔案。";
  const inspection = inspectFile(file);
  if (file.size === 0) return "這個檔案沒有內容。";
  if (!inspection.size.passed) return "檔案超過 40 MB，請選擇較小的檔案。";
  if (!inspection.format.passed) return "目前無法讀取這種格式，請改用 PDF 或純文字檔案。";
  return "";
}

export function explainFileReadError(error, file) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const inspection = file ? inspectFile(file) : null;

  if (/password/i.test(name) || /password/i.test(message)) {
    return "這份 PDF 有密碼保護，請先解除密碼後再試一次。";
  }
  if (/invalidpdf|missingpdf|unexpectedresponse/i.test(name) || /invalid pdf|corrupt/i.test(message)) {
    return "PDF 可能已損毀或不是有效的 PDF，請重新匯出檔案後再試一次。";
  }
  if (inspection?.isPdf && /worker|module|fetch/i.test(message)) {
    return "PDF 讀取元件載入失敗，請重新整理頁面後再試一次。";
  }
  return message || "讀取檔案時發生問題，請重新選擇檔案。";
}

export function cleanTextFileContents(rawText, extension) {
  const text = rawText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  if (["html", "htm", "xml"].includes(extension) && typeof DOMParser !== "undefined") {
    const type = extension === "xml" ? "application/xml" : "text/html";
    const document = new DOMParser().parseFromString(text, type);
    document.querySelectorAll("script, style, template, noscript").forEach((node) => node.remove());
    return (document.body?.textContent ?? document.documentElement.textContent ?? "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (["srt", "vtt"].includes(extension)) {
    return text
      .replace(/^WEBVTT[^\n]*\n/i, "")
      .split("\n")
      .filter((line) => !/^\s*\d+\s*$/.test(line) && !/-->/.test(line))
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (extension === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text.trim();
    }
  }

  return text.trim();
}

export function joinPdfTextItems(items) {
  let result = "";

  items.forEach((item) => {
    if (typeof item.str !== "string") return;
    const previous = result.at(-1) ?? "";
    const needsLatinSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(item.str);
    if (needsLatinSpace) result += " ";
    result += item.str;
    if (item.hasEOL) result += "\n";
  });

  return result.replace(/[ \t]+\n/g, "\n").trim();
}

export async function openPdfDocument(arrayBuffer, getDocumentOverride) {
  let getDocument = getDocumentOverride;

  if (!getDocument) {
    const pdfjs = await import("pdfjs-dist");
    if (pdfWorkerUrl) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    getDocument = pdfjs.getDocument;
  }

  const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
  return loadingTask.promise;
}

export async function extractPdfText(arrayBuffer, getDocumentOverride) {
  const pdf = await openPdfDocument(arrayBuffer, getDocumentOverride);
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = joinPdfTextItems(textContent.items);
      if (pageText) pages.push(pageText);
      page.cleanup?.();
    }

    return pages.join("\n").trim();
  } finally {
    await pdf.destroy?.();
  }
}

export async function extractTextFromFile(file) {
  const validationError = validateFile(file);
  if (validationError) throw new Error(validationError);

  const extension = getFileExtension(file.name);
  const isPdf = extension === "pdf" || file.type === "application/pdf";
  const text = isPdf
    ? await extractPdfText(await file.arrayBuffer())
    : cleanTextFileContents(await file.text(), extension);

  const replacementCharacters = (text.match(/\uFFFD/g) || []).length;
  if (!isPdf && replacementCharacters > Math.max(3, text.length * 0.02)) {
    throw new Error("檔案的文字編碼無法正確辨識，請將檔案另存為 UTF-8 後再試一次。");
  }

  if (!text) {
    const message = isPdf
      ? "這是掃描圖片型 PDF，沒有可讀取的文字層；目前不支援 OCR，請改用含可選取文字的 PDF。"
      : "沒有在檔案中找到可閱讀的文字。";
    throw createFileReadError(isPdf ? "PDF_NO_TEXT" : "TEXT_NO_CONTENT", message);
  }

  return text;
}
