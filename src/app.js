import { splitIntoSentences } from "./splitter.js";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  configurePdfWorker,
  explainFileReadError,
  extractTextFromFile,
  formatFileSize,
  getFileTypeLabel,
  inspectFile,
} from "./file-parser.js";

configurePdfWorker(pdfWorkerUrl);

const SAMPLE_TEXT = "閱讀並不是一場速度比賽。當文字一次出現太多，我們的眼睛和注意力可能會感到疲累。把文章切成一句一句，就像在頁面上放了一把溫柔的閱讀尺。準備好了嗎？讓我們按照自己的節奏，慢慢往下讀。";

const elements = {
  form: document.querySelector("#text-form"),
  source: document.querySelector("#source-text"),
  count: document.querySelector("#character-count"),
  sample: document.querySelector("#sample-button"),
  fileInput: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  fileStatus: document.querySelector("#file-status"),
  fileType: document.querySelector("#file-type"),
  fileStateTitle: document.querySelector("#file-state-title"),
  fileName: document.querySelector("#file-name"),
  fileDetail: document.querySelector("#file-detail"),
  formatCheck: document.querySelector("#format-check"),
  sizeCheck: document.querySelector("#size-check"),
  contentCheck: document.querySelector("#content-check"),
  removeFile: document.querySelector("#remove-file"),
  stage: document.querySelector("#reading-stage"),
  list: document.querySelector("#sentence-list"),
  empty: document.querySelector("#empty-state"),
  progressText: document.querySelector("#progress-text"),
  progressBar: document.querySelector("#progress-bar"),
  blur: document.querySelector("#blur-toggle"),
  fontSize: document.querySelector("#font-size"),
  fontSizeOutput: document.querySelector("#font-size-output"),
  previous: document.querySelector("#previous-button"),
  next: document.querySelector("#next-button"),
  status: document.querySelector("#reader-status"),
};

let sentences = splitIntoSentences(SAMPLE_TEXT);
let activeIndex = 0;
let importSequence = 0;

function renderSentences() {
  elements.list.replaceChildren();
  elements.empty.hidden = sentences.length > 0;

  sentences.forEach((sentence, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sentence";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `第 ${index + 1} 句：${sentence}`);
    const text = document.createElement("span");
    text.textContent = sentence;
    button.append(text);
    item.append(button);
    elements.list.append(item);
  });

  setActiveSentence(0, false);
}

function setActiveSentence(index, shouldScroll = true) {
  if (!sentences.length) return;
  activeIndex = Math.max(0, Math.min(index, sentences.length - 1));

  const sentenceButtons = [...elements.list.querySelectorAll(".sentence")];
  sentenceButtons.forEach((button, buttonIndex) => {
    if (buttonIndex === activeIndex) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });

  const current = activeIndex + 1;
  elements.progressText.textContent = `${current} / ${sentences.length}`;
  elements.progressBar.style.width = `${(current / sentences.length) * 100}%`;
  elements.previous.disabled = activeIndex === 0;
  elements.next.disabled = activeIndex === sentences.length - 1;
  elements.status.textContent = `目前是第 ${current} 句，共 ${sentences.length} 句。`;

  if (shouldScroll) {
    sentenceButtons[activeIndex].scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function move(direction) {
  setActiveSentence(activeIndex + direction);
}

function setFileCheck(element, state, label) {
  element.className = state ? `is-${state}` : "";
  element.querySelector("b").textContent = label;
}

function showFileStatus(file, { state, title, detail, text = "" }) {
  const inspection = inspectFile(file);
  elements.fileStatus.hidden = false;
  elements.fileStatus.className = `file-status is-${state}`;
  elements.fileStatus.setAttribute("role", state === "error" ? "alert" : "status");
  elements.fileType.textContent = state === "error" ? "!" : getFileTypeLabel(file);
  elements.fileStateTitle.textContent = title;
  elements.fileName.textContent = file?.name || "無法匯入檔案";
  elements.fileDetail.textContent = detail;

  setFileCheck(elements.formatCheck, inspection.format.passed ? "pass" : "fail", inspection.format.passed ? `支援・${inspection.format.label}` : `不支援・${inspection.format.label}`);
  setFileCheck(elements.sizeCheck, inspection.size.passed ? "pass" : "fail", inspection.size.passed ? `通過・${inspection.size.label}` : `未通過・${inspection.size.label}`);

  if (state === "loading" && inspection.format.passed && inspection.size.passed) {
    setFileCheck(elements.contentCheck, "checking", "正在擷取文字");
  } else if (state === "success") {
    const sentenceCount = splitIntoSentences(text).length;
    setFileCheck(elements.contentCheck, "pass", `${text.length.toLocaleString("zh-TW")} 字・${sentenceCount.toLocaleString("zh-TW")} 句`);
  } else {
    const didRun = inspection.format.passed && inspection.size.passed;
    setFileCheck(elements.contentCheck, didRun ? "fail" : "skip", didRun ? "沒有取得文字" : "未執行");
  }
}

function clearImportedFile({ clearText = true } = {}) {
  importSequence += 1;
  elements.fileInput.value = "";
  elements.fileStatus.hidden = true;
  elements.fileStatus.className = "file-status";
  if (clearText) {
    elements.source.value = "";
    elements.source.dispatchEvent(new Event("input"));
  }
}

async function importFile(file) {
  if (!file) return;
  const runId = ++importSequence;
  elements.dropZone.classList.add("is-loading");
  elements.fileInput.disabled = true;
  showFileStatus(file, {
    state: "loading",
    title: "正在檢查檔案……",
    detail: "格式與大小通過後，會在瀏覽器內擷取文字。",
  });

  try {
    const text = await extractTextFromFile(file);
    if (runId !== importSequence) return;
    elements.source.value = text;
    elements.source.dispatchEvent(new Event("input"));
    showFileStatus(file, {
      state: "success",
      title: "檔案讀取成功",
      detail: `${formatFileSize(file.size)}・內容已放入下方文字區，可編輯後開始閱讀。`,
      text,
    });
    elements.source.focus();
  } catch (error) {
    if (runId !== importSequence) return;
    elements.fileInput.value = "";
    showFileStatus(file, {
      state: "error",
      title: "檔案讀取失敗",
      detail: explainFileReadError(error, file),
    });
  } finally {
    if (runId === importSequence) {
      activeOcrController = null;
      elements.dropZone.classList.remove("is-loading");
      elements.fileInput.disabled = false;
    }
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sentences = splitIntoSentences(elements.source.value);
  activeIndex = 0;
  renderSentences();
  elements.stage.focus({ preventScroll: true });
  document.querySelector("#reader").scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.source.addEventListener("input", () => {
  elements.count.textContent = `${elements.source.value.length.toLocaleString("zh-TW")} 個字`;
});

elements.sample.addEventListener("click", () => {
  clearImportedFile({ clearText: false });
  elements.source.value = SAMPLE_TEXT;
  elements.source.dispatchEvent(new Event("input"));
  elements.source.focus();
});

elements.fileInput.addEventListener("change", () => importFile(elements.fileInput.files[0]));
elements.removeFile.addEventListener("click", () => {
  clearImportedFile();
  elements.fileInput.focus();
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => importFile(event.dataTransfer.files[0]));

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest(".sentence");
  if (button) {
    setActiveSentence(Number(button.dataset.index), false);
    elements.stage.focus({ preventScroll: true });
  }
});

document.addEventListener("keydown", (event) => {
  const isUsingControl = event.target.closest("textarea, input, button, a, select");
  if (isUsingControl || !sentences.length) return;
  if (event.key === " " || event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  }
});

elements.previous.addEventListener("click", () => move(-1));
elements.next.addEventListener("click", () => move(1));

document.querySelectorAll("input[name='marker']").forEach((control) => {
  control.addEventListener("change", () => {
    elements.stage.className = elements.stage.className.replace(/marker-\w+/, `marker-${control.value}`);
  });
});

elements.blur.addEventListener("change", () => {
  elements.stage.classList.toggle("blur-inactive", elements.blur.checked);
});

elements.fontSize.addEventListener("input", () => {
  elements.stage.style.setProperty("--reader-font-size", `${elements.fontSize.value}px`);
  elements.fontSizeOutput.value = elements.fontSize.value;
});

elements.source.value = SAMPLE_TEXT;
elements.source.dispatchEvent(new Event("input"));
renderSentences();
