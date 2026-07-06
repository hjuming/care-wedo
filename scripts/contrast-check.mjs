#!/usr/bin/env node
/**
 * WCAG 對比度 CI gate（Phase A-1）
 *
 * 驗證 care-wedo-app/src/index.css 的 :root 色彩 token 中，
 * 「會當文字/文字底色使用」的組合不得低於 WCAG AA (4.5:1)。
 * 任一組合低於門檻即 exit 1，阻擋 deploy。
 *
 * 已知豁免：LINE 品牌綠按鈕（#06c755）為品牌規範色，不列入檢查。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, "../care-wedo-app/src/index.css");
const css = readFileSync(cssPath, "utf8");

const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
if (!rootMatch) {
  console.error("contrast-check: 找不到 :root 區塊");
  process.exit(1);
}

const tokens = {};
for (const m of rootMatch[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  tokens[m[1]] = m[2];
}

function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = "#FFFFFF";
const AA = 4.5;

// [說明, 前景, 背景]
const pairs = [
  ["text-primary on bg", tokens["text-primary"], tokens["bg-color"]],
  ["text-primary on surface", tokens["text-primary"], tokens["surface"]],
  ["text-secondary on bg", tokens["text-secondary"], tokens["bg-color"]],
  ["text-secondary on surface", tokens["text-secondary"], tokens["surface"]],
  ["text-muted on bg", tokens["text-muted"], tokens["bg-color"]],
  ["text-muted on surface", tokens["text-muted"], tokens["surface"]],
  ["white on action-bg（主要按鈕）", WHITE, tokens["action-bg"]],
  ["white on action-bg-hover", WHITE, tokens["action-bg-hover"]],
  ["white on primary-dark", WHITE, tokens["primary-dark"]],
  ["white on accent-dark（今日標記）", WHITE, tokens["accent-dark"]],
  ["danger on surface", tokens["danger"], tokens["surface"]],
];

let failed = false;
for (const [label, fg, bg] of pairs) {
  if (!fg || !bg) {
    console.error(`FAIL ${label}: token 不存在（fg=${fg}, bg=${bg}）`);
    failed = true;
    continue;
  }
  const r = ratio(fg, bg);
  const ok = r >= AA;
  console.log(`${ok ? " ok " : "FAIL"} ${r.toFixed(2)}:1  ${label}  (${fg} / ${bg})`);
  if (!ok) failed = true;
}

if (failed) {
  console.error(`\ncontrast-check: 有組合低於 WCAG AA ${AA}:1，長輩會看不清楚。`);
  process.exit(1);
}
console.log("\ncontrast-check: 全部通過 WCAG AA。");
