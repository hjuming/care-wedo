#!/usr/bin/env node
/**
 * 最小 E2E smoke：build 後核心頁面不白屏（Care WEDO）。
 *
 * 檢查項目（每條路由）：
 *   1. document 回應 200
 *   2. 無 pageerror（瀏覽器 runtime 未捕捉例外）
 *   3. #root 有實質內容（非白屏）
 *   4. /app 額外做軟性關鍵字檢查（預約/用藥/上傳入口有 render）
 *
 * 用法：
 *   npm run smoke:e2e            # 用現有 care-wedo-app/dist
 *   npm run smoke:e2e -- --build # 先跑 vite build
 *
 * 前置（一次性）：
 *   npm i -D playwright && npx playwright install chromium
 *
 * 註：靜態伺服器不掛 /api，因此 API 呼叫會 404——這是刻意的：
 * smoke 驗的是「後端不可用時前端仍能 render」，console error 只警告不擋。
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "care-wedo-app/dist");
const args = process.argv.slice(2);

if (args.includes("--build")) {
  console.log("smoke: 先執行 vite build ...");
  execSync("npm run build", { cwd: resolve(root, "care-wedo-app"), stdio: "inherit" });
}

if (!existsSync(resolve(distDir, "index.html"))) {
  console.error("smoke: 找不到 care-wedo-app/dist/index.html，請先跑 npm run build（或加 --build）。");
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("smoke: 未安裝 playwright。請先執行：\n  npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

// 靜態伺服器 + SPA fallback（等同 Pages 的 404.html 行為）
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let filePath = normalize(join(distDir, urlPath));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
  if (!existsSync(filePath)) filePath = resolve(distDir, "index.html"); // SPA fallback
  res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
  res.end(readFileSync(filePath));
});

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
console.log(`smoke: 靜態伺服器 ${base}（dist）`);

/** @type {Array<{path:string, label:string, keywords?:string[]}>} */
const ROUTES = [
  { path: "/", label: "未登入首頁（landing）" },
  { path: "/login", label: "登入頁", keywords: ["登入"] },
  { path: "/app", label: "受保護主頁（未登入應 render 登入導引或 demo，不得白屏）", keywords: ["登入"] },
  { path: "/features", label: "功能介紹頁" },
  { path: "/privacy", label: "隱私權頁" },
  { path: "/terms", label: "服務條款頁" },
];

const browser = await chromium.launch();
const page = await browser.newPage();

let failed = 0;
for (const route of ROUTES) {
  const pageErrors = [];
  const consoleErrors = [];
  const onPageError = (err) => pageErrors.push(String(err));
  const onConsole = (msg) => msg.type() === "error" && consoleErrors.push(msg.text());
  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  let status = 0;
  let rootLength = 0;
  let text = "";
  try {
    const response = await page.goto(base + route.path, { waitUntil: "networkidle", timeout: 15000 });
    status = response?.status() ?? 0;
    await page.waitForTimeout(300);
    rootLength = await page.evaluate(() => (document.querySelector("#root")?.innerHTML ?? "").trim().length);
    text = await page.evaluate(() => document.body.innerText || "");
  } catch (err) {
    pageErrors.push(`navigation failed: ${err.message}`);
  }
  page.off("pageerror", onPageError);
  page.off("console", onConsole);

  const problems = [];
  if (status !== 200) problems.push(`HTTP ${status}`);
  if (pageErrors.length) problems.push(`pageerror: ${pageErrors[0]}`);
  if (rootLength < 40) problems.push(`#root 內容過少（${rootLength} chars）→ 疑似白屏`);

  const missingKeywords = (route.keywords ?? []).filter((k) => !text.includes(k));

  if (problems.length) {
    failed += 1;
    console.error(`FAIL ${route.path}  ${route.label}\n     ${problems.join("；")}`);
  } else {
    console.log(` ok  ${route.path}  ${route.label}（root ${rootLength} chars）`);
  }
  if (missingKeywords.length) console.warn(`warn ${route.path} 找不到關鍵字：${missingKeywords.join("、")}（軟性檢查，不擋）`);
  if (consoleErrors.length) console.warn(`warn ${route.path} console error ×${consoleErrors.length}（離線模式 API 404 屬預期，不擋）`);
}

// /app 內預約與 OCR 入口的軟性檢查（未登入狀態下能看到多少算多少）
try {
  await page.goto(base + "/app", { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(300);
  const entryText = await page.evaluate(() => document.body.innerText || "");
  const entries = ["行程", "藥", "上傳"].filter((k) => entryText.includes(k));
  console.log(`info /app 入口關鍵字命中：${entries.length ? entries.join("、") : "無（未登入狀態可能未顯示，屬軟性資訊）"}`);
} catch { /* soft */ }

await browser.close();
server.close();

if (failed) {
  console.error(`\nsmoke: ${failed} 條路由未通過。`);
  process.exit(1);
}
console.log(`\nsmoke: 全部 ${ROUTES.length} 條路由通過（不白屏、無未捕捉例外）。`);
