export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "html", "htm",
  "xml", "yaml", "yml", "srt", "vtt", "log",
]);

let pdfWorkerUrl = "";

export function configurePdfWorker(url) {
  pdfWorkerUrl = url;
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

export function validateFile(file) {
  if (!file) return "請先選擇一個檔案。";
  if (file.size === 0) return "這個檔案沒有內容。";
  if (file.size > MAX_FILE_SIZE) return "檔案超過 20 MB，請選擇較小的檔案。";

  const extension = getFileExtension(file.name);
  const isPdf = extension === "pdf" || file.type === "application/pdf";
  const isText = SUPPORTED_EXTENSIONS.has(extension) || file.type.startsWith("text/");
  if (!isPdf && !isText) return "目前無法讀取這種格式，請改用 PDF 或純文字檔案。";
  return "";
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

export async function extractPdfText(arrayBuffer, getDocumentOverride) {
  let getDocument = getDocumentOverride;

  if (!getDocument) {
    const pdfjs = await import("pdfjs-dist");
    if (pdfWorkerUrl) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    getDocument = pdfjs.getDocument;
  }

  const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = joinPdfTextItems(textContent.items);
    if (pageText) pages.push(pageText);
  }

  return pages.join("\n").trim();
}

export async function extractTextFromFile(file) {
  const validationError = validateFile(file);
  if (validationError) throw new Error(validationError);

  const extension = getFileExtension(file.name);
  const isPdf = extension === "pdf" || file.type === "application/pdf";
  const text = isPdf
    ? await extractPdfText(await file.arrayBuffer())
    : cleanTextFileContents(await file.text(), extension);

  if (!text) {
    const message = isPdf
      ? "沒有在 PDF 中找到可讀取的文字。若這是掃描文件，目前尚未支援 OCR。"
      : "沒有在檔案中找到可閱讀的文字。";
    throw new Error(message);
  }

  return text;
}
