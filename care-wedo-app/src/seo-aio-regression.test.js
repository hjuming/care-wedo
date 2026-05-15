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
  const imagePath = resolve(root, "public/assets/images/og-care-wedo.png");

  assert.equal(existsSync(imagePath), true);
  assert.match(html, /<link rel="canonical" href="https:\/\/care\.wedopr\.com\/" \/>/);
  assert.match(html, /property="og:image" content="https:\/\/care\.wedopr\.com\/assets\/images\/og-care-wedo\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/care\.wedopr\.com\/assets\/images\/og-care-wedo\.png"/);
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
  assert.equal(faq.mainEntity.some((item) => item.name === "免費版和收費版差在哪裡？"), true);
});

test("robots, sitemap, and llms files expose crawl and answer-layer context", () => {
  const robots = readProjectFile("public/robots.txt");
  const sitemap = readProjectFile("public/sitemap.xml");
  const llms = readProjectFile("public/llms.txt");

  assert.match(robots, /Sitemap: https:\/\/care\.wedopr\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/care\.wedopr\.com\/app<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/care\.wedopr\.com\/privacy<\/loc>/);
  assert.match(llms, /AI Quick Answer/);
  assert.match(llms, /Care WEDO 是給長輩與家人的 LINE 醫療照護小管家/);
  assert.match(llms, /正式收費版規劃/);
});
