import { splitIntoSentences } from "./splitter.js";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  configurePdfWorker,
  extractTextFromFile,
  formatFileSize,
  getFileTypeLabel,
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
  fileName: document.querySelector("#file-name"),
  fileDetail: document.querySelector("#file-detail"),
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

function showFileStatus(file, detail, isError = false) {
  elements.fileStatus.hidden = false;
  elements.fileStatus.classList.toggle("is-error", isError);
  elements.fileStatus.setAttribute("role", isError ? "alert" : "status");
  elements.fileType.textContent = isError ? "!" : getFileTypeLabel(file);
  elements.fileName.textContent = file?.name || "無法匯入檔案";
  elements.fileDetail.textContent = detail;
}

function clearImportedFile({ clearText = true } = {}) {
  elements.fileInput.value = "";
  elements.fileStatus.hidden = true;
  elements.fileStatus.classList.remove("is-error");
  if (clearText) {
    elements.source.value = "";
    elements.source.dispatchEvent(new Event("input"));
  }
}

async function importFile(file) {
  if (!file) return;
  elements.dropZone.classList.add("is-loading");
  elements.fileInput.disabled = true;
  showFileStatus(file, "正在瀏覽器內讀取檔案……");

  try {
    const text = await extractTextFromFile(file);
    elements.source.value = text;
    elements.source.dispatchEvent(new Event("input"));
    showFileStatus(
      file,
      `${formatFileSize(file.size)}・已擷取 ${text.length.toLocaleString("zh-TW")} 個字，可在下方繼續編輯`,
    );
    elements.source.focus();
  } catch (error) {
    clearImportedFile({ clearText: false });
    showFileStatus(file, error instanceof Error ? error.message : "讀取檔案時發生問題。", true);
  } finally {
    elements.dropZone.classList.remove("is-loading");
    elements.fileInput.disabled = false;
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
