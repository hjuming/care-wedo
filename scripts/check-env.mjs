#!/usr/bin/env node
/**
 * Env 啟動前檢查（本機 / CI 兩用）。名單來源：env.schema.json。
 *
 * 模式：
 *   node scripts/check-env.mjs                 # 檢查本機 .dev.vars（wrangler pages dev 用）
 *   node scripts/check-env.mjs --file .env     # 檢查指定 env 檔
 *   node scripts/check-env.mjs --example-sync  # 檢查 .dev.vars.example 是否涵蓋所有 required（CI 文件同步 gate）
 *
 * 只檢查名稱存在與非空，絕不輸出變數值。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(resolve(root, "env.schema.json"), "utf8"));
const REQUIRED = Object.keys(schema.pages_functions.required);
const RECOMMENDED = Object.keys(schema.pages_functions.recommended);
const ALIASES = schema.pages_functions.fallback_aliases ?? {};

function parseEnvFile(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const args = process.argv.slice(2);

if (args.includes("--example-sync")) {
  const example = parseEnvFile(resolve(root, ".dev.vars.example"));
  const missing = REQUIRED.filter((name) => !(name in example));
  if (missing.length) {
    console.error(`check-env: .dev.vars.example 缺少 required 變數（新人照著填會漏）: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`check-env: .dev.vars.example 涵蓋全部 ${REQUIRED.length} 個 required 變數。`);
  process.exit(0);
}

const fileIdx = args.indexOf("--file");
const target = fileIdx >= 0 ? args[fileIdx + 1] : ".dev.vars";
const path = resolve(root, target);
if (!existsSync(path)) {
  console.error(`check-env: 找不到 ${target}。本機開發請從 .dev.vars.example 複製一份。`);
  process.exit(1);
}

const vars = parseEnvFile(path);
const isSet = (name) => typeof vars[name] === "string" && vars[name].trim().length > 0;
const isSatisfied = (name) => isSet(name) || (ALIASES[name] ? isSet(ALIASES[name]) : false);
const missingRequired = REQUIRED.filter((n) => !isSatisfied(n));
const missingRecommended = RECOMMENDED.filter((n) => !isSatisfied(n));

for (const n of missingRequired) console.error(`FAIL required 缺少或為空: ${n} — ${schema.pages_functions.required[n]}`);
for (const n of missingRecommended) console.warn(`warn recommended 未設定: ${n} — ${schema.pages_functions.recommended[n]}`);

if (missingRequired.length) {
  console.error(`\ncheck-env: ${target} 缺 ${missingRequired.length} 個 required 變數，部署/本機啟動會壞。`);
  process.exit(1);
}
console.log(`\ncheck-env: ${target} required 全齊（${REQUIRED.length} 個）；recommended 缺 ${missingRecommended.length} 個。`);
