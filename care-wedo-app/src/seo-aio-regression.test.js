import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("site has complete social sharing metadata with the shared Care WEDO image", () => {
  const html = readProjectFile("index.html");
  const imagePath = resolve(root, "public/assets/images/og-care-wedo.jpg");

  assert.equal(existsSync(imagePath), true);
  assert.match(html, /<link rel="canonical" href="https:\/\/care\.wedopr\.com\/" \/>/);
  assert.match(html, /property="og:image" content="https:\/\/care\.wedopr\.com\/assets\/images\/og-care-wedo\.jpg"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:title" content="Care WEDO｜陪你照顧最重要的人"/);
  assert.match(html, /property="og:description" content="從「一個人」升級到「一家人」。長輩用 LINE 傳照片，系統整理看診、用藥與提醒，家人同步掌握。"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:title" content="Care WEDO｜陪你照顧最重要的人"/);
  assert.match(html, /name="twitter:description" content="從「一個人」升級到「一家人」。長輩用 LINE 傳照片，系統整理看診、用藥與提醒，家人同步掌握。"/);
  assert.match(html, /name="twitter:image" content="https:\/\/care\.wedopr\.com\/assets\/images\/og-care-wedo\.jpg"/);
  assert.match(html, /name="description" content="Care WEDO 陪你照顧最重要的人。從「一個人」升級到「一家人」/);
  assert.match(html, /max-image-preview:large/);
});

test("structured data is valid and exposes AI-friendly FAQ answers", () => {
  const html = readProjectFile("index.html");
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match);

  const jsonLd = JSON.parse(match[1]);
  const graph = jsonLd["@graph"];
  const faq = graph.find((item) => item["@type"] === "FAQPage");
  const app = graph.find((item) => item["@type"] === "SoftwareApplication");

  assert.ok(app);
  assert.equal(app.applicationCategory, "HealthApplication");
  assert.ok(faq);
  assert.equal(faq.mainEntity.length >= 8, true);
  assert.equal(faq.mainEntity.some((item) => item.name === "Care WEDO 是什麼？"), true);
  assert.equal(faq.mainEntity.some((item) => item.name === "Free 和照護圈升級差在哪裡？"), true);
});

test("robots, sitemap, and llms files expose crawl and answer-layer context", () => {
  const robots = readProjectFile("public/robots.txt");
  const sitemap = readProjectFile("public/sitemap.xml");
  const llms = readProjectFile("public/llms.txt");
  const headers = readProjectFile("public/_headers");

  assert.match(robots, /User-agent: facebookexternalhit\nAllow: \//);
  assert.match(robots, /User-agent: Facebot\nAllow: \//);
  assert.match(robots, /User-agent: meta-externalagent\nAllow: \//);
  assert.match(robots, /User-agent: Twitterbot\nAllow: \//);
  assert.match(robots, /User-agent: LinkedInBot\nAllow: \//);
  assert.match(robots, /Sitemap: https:\/\/care\.wedopr\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/care\.wedopr\.com\/app<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/care\.wedopr\.com\/privacy<\/loc>/);
  assert.match(llms, /AI Quick Answer/);
  assert.match(llms, /Care WEDO 是給長輩與家人的 LINE 醫療照護小管家/);
  assert.match(llms, /照護圈升級/);
  assert.match(headers, /\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/assets\/images\/og-care-wedo\.jpg\n\s+Cache-Control: public, max-age=31536000, immutable\n\s+X-Robots-Tag: all/);
  assert.match(headers, /\/robots\.txt\n\s+Cache-Control: public, max-age=300, must-revalidate/);
  assert.match(headers, /\/features\n\s+Cache-Control: no-store/);
  assert.doesNotMatch(headers, /\/\*\n\s+Cache-Control: no-store/);
});

test("static AIO pages are readable without JavaScript", () => {
  const sitemap = readProjectFile("public/sitemap.xml");
  const llms = readProjectFile("public/llms.txt");

  for (const page of ["faq", "guide", "pricing"]) {
    const html = readProjectFile(`public/${page}/index.html`);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<main/);
    assert.match(html, /Care WEDO/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /Care WEDO 需要 JavaScript/);
    assert.match(sitemap, new RegExp(`<loc>https://care\\.wedopr\\.com/${page}</loc>`));
    assert.match(llms, new RegExp(`https://care\\.wedopr\\.com/${page}`));
  }

  const faq = readProjectFile("public/faq/index.html");
  const guide = readProjectFile("public/guide/index.html");
  const pricing = readProjectFile("public/pricing/index.html");

  assert.match(faq, /Care WEDO 是什麼/);
  assert.match(faq, /不是醫療診斷工具/);
  assert.match(guide, /第一次使用/);
  assert.match(guide, /加入 LINE 照護小管家/);
  assert.match(guide, /先選家人、再拍單子/);
  assert.match(pricing, /每個家庭群組/);
  assert.match(pricing, /\$30-250\/月/);
  assert.match(pricing, /主帳號[\s\S]*不計入協作者費用/);
});
