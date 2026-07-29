import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the market research desk", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>星辰大海 · 市场研究台<\/title>/);
  assert.match(html, />自选行情<\/button>/);
  assert.doesNotMatch(html, />板块雷达<\/button>/);
  assert.match(html, />资金流向<\/button>/);
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(html, /role="search"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the visual and accessibility safeguards in source", async () => {
  const [page, layout, terminal, css, marketRoute, vercelConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terminal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /title:\s*"星辰大海 · 市场研究台"/);
  assert.match(layout, /<html lang="zh-CN">/);
  assert.match(terminal, /className="skip-link"/);
  assert.match(terminal, /aria-current=/);
  assert.match(terminal, /aria-live="polite"/);
  assert.match(terminal, /autoComplete="off"/);
  assert.match(terminal, /role="img"/);
  assert.match(terminal, /涨停" : "跌停"}封单/);
  assert.match(terminal, /data-stock-key={key}/);
  assert.match(terminal, /keyOf\(detail\.quote\) === activeKey/);
  assert.match(terminal, /分时增量约2秒 · 重点行情约1秒/);
  assert.match(terminal, /QUOTES_CACHE_KEY/);
  assert.match(terminal, /连续报价滚动计算/);
  assert.match(terminal, /isAShareTrading\(\) \? 60_000 : 120_000/);
  assert.match(terminal, /full=\$\{includeKline \? "1" : "0"}/);
  assert.match(marketRoute, /preferredRegion = "hkg1"/);
  assert.match(marketRoute, /batch = await requireComplete\(sinaPromise\)/);
  assert.match(marketRoute, /const eastmoneyPromise = loadEastmoneyQuotes\(\)/);
  assert.deepEqual(JSON.parse(vercelConfig).regions, ["hkg1"]);
  assert.match(css, /--font-data:/);
  assert.match(css, /\.limit-badge\.up/);
  assert.match(css, /\.limit-badge\.down/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(`${terminal}\n${css}`, /#(?:d74652|f05f68|ff0000|ff4d4f|e53935|dc2626)|\bred\b/i);
  assert.doesNotMatch(css, /transition:\s*all/i);
  assert.doesNotMatch(css, /outline:\s*none/i);
});
