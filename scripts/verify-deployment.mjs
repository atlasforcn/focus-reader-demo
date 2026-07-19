const rootUrl = new URL(process.argv[2] || "https://atlasforcn.github.io/focus-reader-demo/");
rootUrl.searchParams.set("verify", Date.now().toString());

async function get(url, label) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${label} 回應 HTTP ${response.status}`);
  return response.text();
}

const html = await get(rootUrl, "主頁");

if (html.includes("./src/app.js") || html.includes("/src/app.js")) {
  throw new Error("主頁仍在載入原始碼，沒有發布正式建置結果。上傳功能將無法啟動。");
}
if (!html.includes("不會上傳、儲存或保留")) {
  throw new Error("主頁缺少零資料留存承諾。");
}

const scriptPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
const stylePath = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
if (!scriptPath || !stylePath) throw new Error("找不到正式版 JavaScript 或 CSS 資源。");

const scriptUrl = new URL(scriptPath, rootUrl);
const styleUrl = new URL(stylePath, rootUrl);
const [script] = await Promise.all([
  get(scriptUrl, "JavaScript"),
  get(styleUrl, "CSS"),
]);

const dynamicChunkPaths = [...script.matchAll(/["']\.\/([^"']+\.js)["']/g)].map((match) => match[1]);
const dynamicChunks = await Promise.all(
  [...new Set(dynamicChunkPaths)].map((path) => get(new URL(path, scriptUrl), `動態程式 ${path}`)),
);
if (!script.includes("chi_sim") || !dynamicChunks.some((chunk) => chunk.includes("createWorker"))) {
  throw new Error("正式版中找不到中文 OCR 執行元件。");
}

const workerPath = script.match(/["'](pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs)["']/)?.[1];
if (!workerPath) throw new Error("正式版中找不到 PDF 讀取元件。");
await get(new URL(workerPath, scriptUrl), "PDF 讀取元件");

console.log("✓ 主頁載入正式建置結果");
console.log("✓ JavaScript 與 CSS 可正常取得");
console.log("✓ PDF 讀取元件可正常取得");
console.log("✓ 中文 OCR 執行元件可正常取得");
console.log("✓ 首頁包含零資料留存承諾");
