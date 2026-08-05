"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WatchlistImportDialog, type ImportedStock } from "./watchlist-import";

type PageKey = "watch" | "capital" | "rankings";
type ChartMode = "time" | "day";
type MarketMeta = { mode: "live" | "cache" | "stale" | "offline"; updatedAt: number; source: string };
type FeedKey = "quotes" | "detail" | "speeds" | "turnover" | "sectors" | "sector-detail" | "capital" | "rankings";
type FeedSnapshot = MarketMeta & { label: string };
type WatchSort = "manual" | "change" | "speed" | "amount";
type WatchGroupKey = "main" | "etf";
type Stock = { code: string; market: number; name: string };
type Quote = Stock & {
  price: number | null; changePercent: number | null; speed: number | null; high?: number | null;
  low?: number | null; open?: number | null; prevClose?: number | null; volume?: number | null;
  amount?: number | null; marketCap?: number | null; turnover?: number | null; amplitude?: number | null; netInflow?: number | null;
  limitState?: "up" | "down" | null; sealedAmount?: number | null; sector?: string | null;
};
type Trend = { time: string; price: number | null; average: number | null; volume: number | null; amount: number | null };
type Kline = { date: string; open: number | null; close: number | null; high: number | null; low: number | null; volume: number | null; amount: number | null; changePercent: number | null };
type Detail = { quote: Quote; trends: Trend[]; klines: Kline[]; preClose: number | null; meta: MarketMeta };
type Speed4 = { code: string; market: number; speed4m: number; pointTime: string };
type MarketTurnover = {
  currentAmount: number; previousAmount: number; delta: number; deltaPercent: number;
  currentDate: string; previousDate: string; pointTime: string; meta: MarketMeta;
};
type Sector = { code: string; name: string; change: number | null; speed: number | null; inflow: number | null };
type SectorStock = Stock & { price: number | null; change: number | null; speed: number | null; inflow: number | null };
type CapitalData = {
  quote: Quote;
  flow: Array<{ time: string; main: number | null; small: number | null; medium: number | null; large: number | null }>;
  inflow: Array<{ code: string; name: string; amount: number | null }>;
  outflow: Array<{ code: string; name: string; amount: number | null }>;
  meta: MarketMeta;
};
type RankingData = { gainers: Quote[]; losers: Quote[]; meta: MarketMeta };

const DEFAULT_STOCKS: Stock[] = [
  { code: "CNOW", market: 101, name: "富时A50期指" },
  { code: "883421", market: 102, name: "同花顺全A(沪深京)" },
  { code: "883418", market: 102, name: "微盘股" },
  { code: "000001", market: 1, name: "上证指数" },
  { code: "883958", market: 102, name: "昨日连板" },
  { code: "399001", market: 0, name: "深证成指" },
  { code: "KS11", market: 100, name: "韩国综合" },
  { code: "000815", market: 0, name: "美利云" },
  { code: "603259", market: 1, name: "药明康德" },
  { code: "001232", market: 0, name: "N嘉立创" },
  { code: "000533", market: 0, name: "顺钠股份" },
  { code: "002131", market: 0, name: "利欧股份" },
  { code: "603629", market: 1, name: "利通电子" },
  { code: "601611", market: 1, name: "中国核建" },
  { code: "002827", market: 0, name: "高争民爆" },
  { code: "000595", market: 0, name: "新能股份" },
  { code: "002354", market: 0, name: "天娱数科" },
  { code: "600396", market: 1, name: "华电辽能" },
  { code: "600468", market: 1, name: "百利电气" },
  { code: "002879", market: 0, name: "长缆科技" },
  { code: "001208", market: 0, name: "华菱线缆" },
  { code: "002366", market: 0, name: "融发核电" },
  { code: "603011", market: 1, name: "合锻智能" },
  { code: "002896", market: 0, name: "中大力德" },
  { code: "003001", market: 0, name: "中岩大地" },
  { code: "600664", market: 1, name: "哈药股份" },
  { code: "605179", market: 1, name: "一鸣食品" },
  { code: "003032", market: 0, name: "传智教育" },
  { code: "001258", market: 0, name: "立新能源" },
  { code: "002882", market: 0, name: "金龙羽" },
  { code: "603221", market: 1, name: "爱丽家居" },
  { code: "588200", market: 1, name: "科创芯片ETF" },
  { code: "688825", market: 1, name: "长鑫科技" },
  { code: "000636", market: 0, name: "风华高科" },
  { code: "002384", market: 0, name: "东山精密" },
  { code: "600667", market: 1, name: "太极实业" },
  { code: "603986", market: 1, name: "兆易创新" },
  { code: "002156", market: 0, name: "通富微电" },
  { code: "001309", market: 0, name: "德明利" },
];

const ETF_STOCKS: Stock[] = [
  { code: "603986", market: 1, name: "兆易创新" },
  { code: "002156", market: 0, name: "通富微电" },
  { code: "001309", market: 0, name: "德明利" },
  { code: "002384", market: 0, name: "东山精密" },
  { code: "000636", market: 0, name: "风华高科" },
  { code: "000938", market: 0, name: "紫光股份" },
  { code: "588060", market: 1, name: "科创50ETF" },
  { code: "600584", market: 1, name: "长电科技" },
  { code: "002837", market: 0, name: "英维克" },
  { code: "600176", market: 1, name: "中国巨石" },
  { code: "601869", market: 1, name: "长飞光纤" },
  { code: "000725", market: 0, name: "京东方A" },
  { code: "603256", market: 1, name: "宏和科技" },
  { code: "600183", market: 1, name: "生益科技" },
  { code: "301308", market: 0, name: "江波龙" },
  { code: "002475", market: 0, name: "立讯精密" },
  { code: "002409", market: 0, name: "雅克科技" },
  { code: "600206", market: 1, name: "有研新材" },
  { code: "000977", market: 0, name: "浪潮信息" },
  { code: "600703", market: 1, name: "三安光电" },
  { code: "600487", market: 1, name: "亨通光电" },
  { code: "000657", market: 0, name: "中钨高新" },
  { code: "002859", market: 0, name: "洁美科技" },
  { code: "002281", market: 0, name: "光迅科技" },
  { code: "600460", market: 1, name: "士兰微" },
  { code: "603259", market: 1, name: "药明康德" },
  { code: "600869", market: 1, name: "远东股份" },
  { code: "002600", market: 0, name: "领益智造" },
  { code: "002008", market: 0, name: "大族激光" },
  { code: "002428", market: 0, name: "云南锗业" },
  { code: "601991", market: 1, name: "大唐发电" },
  { code: "002916", market: 0, name: "深南电路" },
  { code: "601179", market: 1, name: "中国西电" },
];
const DEFAULT_WATCH_GROUPS: Record<WatchGroupKey, Stock[]> = { main: DEFAULT_STOCKS, etf: ETF_STOCKS };
const DEFAULT_PINNED = ["101.CNOW", "102.883421", "102.883418", "1.000001", "102.883958", "0.399001", "100.KS11"];
const WATCHLIST_GROUPS_KEY = "xinghai_watchlist_groups_v3";
const ACTIVE_WATCH_GROUP_KEY = "xinghai_watch_group_v3";
const PINNED_KEY = "xinghai_pinned_v3";
const QUOTES_CACHE_KEY = "xinghai_quotes_cache_v1";
const FEED_LABELS: Record<FeedKey, string> = {
  quotes: "自选摘要", detail: "个股详情", speeds: "4分涨速", turnover: "市场成交额",
  sectors: "板块列表", "sector-detail": "板块成分", capital: "资金流向", rankings: "涨跌排行",
};

const keyOf = (stock: Pick<Stock, "market" | "code">) => `${stock.market}.${stock.code}`;
const marketDescription = (market: number) => market === 100 ? "韩国交易所" : market === 101 ? "富时中国A50期货" : market === 102 ? "同花顺特色指数" : "人民币普通股";
const signed = (value: number | null | undefined, suffix = "%") => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const relativePercent = (value: number | null | undefined, base: number | null | undefined) =>
  value === null || value === undefined || base === null || base === undefined || !Number.isFinite(value) || !Number.isFinite(base) || base === 0
    ? "—"
    : signed(((value - base) / base) * 100);
const tone = (value: number | null | undefined) => value === null || value === undefined || value === 0 ? "flat" : value > 0 ? "up" : "down";
const number = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const amount = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return value.toFixed(0);
};
const marketAmount = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(value / 1e8).toFixed(abs >= 1e11 ? 0 : 1)}亿`;
  return amount(value);
};
const shortTime = (stamp?: number) => stamp ? new Date(stamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
const feedModeLabel = (mode?: MarketMeta["mode"]) => mode === "live" ? "实时" : mode === "cache" ? "有效缓存" : mode === "stale" ? "过期缓存" : mode === "offline" ? "不可用" : "等待";
const feedAge = (updatedAt?: number, now = Date.now()) => {
  if (!updatedAt) return "无有效行情时间";
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1_000));
  if (seconds < 60) return `延迟约 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `数据年龄 ${minutes} 分钟` : `数据年龄 ${Math.floor(minutes / 60)} 小时`;
};
const isTextEntry = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || (target instanceof HTMLElement && target.isContentEditable);
const isAShareTrading = (date = new Date()) => {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return (minutes >= 9 * 60 + 15 && minutes <= 11 * 60 + 32) || (minutes >= 12 * 60 + 58 && minutes <= 15 * 60 + 2);
};

function DataStamp({ meta, label, compact = false }: { meta: MarketMeta | null | undefined; label: string; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const source = meta?.source || "尚未连接";
  return <div className={`data-stamp ${meta?.mode || "offline"} ${compact ? "compact" : ""}`} title={`${label}｜${source}｜${feedAge(meta?.updatedAt, now)}`}>
    <i aria-hidden="true" />
    <span>{label}</span>
    <b>{source}</b>
    <time>{shortTime(meta?.updatedAt)}</time>
    <em>{meta ? `${feedModeLabel(meta.mode)} · ${feedAge(meta.updatedAt, now)}` : "等待数据"}</em>
  </div>;
}

async function fetchJson<T>(url: string, timeout = 12_000, retries = 0): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "数据服务暂不可用");
      return body as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 450));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("数据服务暂不可用");
}

const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function fetchDirectRankings(): Promise<RankingData> {
  const universe = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
  const fields = "f2,f3,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18,f20,f100";
  const loadSide = async (order: 0 | 1) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const url = `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=${order}&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(universe)}&fields=${fields}`;
      const response = await fetch(url, { signal: controller.signal, cache: "no-store", mode: "cors" });
      if (!response.ok) throw new Error("排行直连暂不可用");
      const payload = await response.json() as { data?: { diff?: Array<Record<string, unknown>> } };
      return (payload.data?.diff || []).map((item): Quote => ({
        code: String(item.f12 ?? ""),
        market: finiteNumber(item.f13) === 1 ? 1 : 0,
        name: String(item.f14 ?? ""),
        price: finiteNumber(item.f2),
        changePercent: finiteNumber(item.f3),
        speed: null,
        high: finiteNumber(item.f15),
        low: finiteNumber(item.f16),
        open: finiteNumber(item.f17),
        prevClose: finiteNumber(item.f18),
        volume: finiteNumber(item.f5),
        amount: finiteNumber(item.f6),
        marketCap: finiteNumber(item.f20),
        turnover: finiteNumber(item.f8),
        sector: String(item.f100 || "板块待更新"),
      })).filter((item) => item.code && item.name && item.price !== null).slice(0, 100);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const [gainers, losers] = await Promise.all([loadSide(1), loadSide(0)]);
  if (gainers.length < 100 || losers.length < 100) throw new Error("排行直连数据不完整");
  return {
    gainers,
    losers,
    meta: { mode: "live", updatedAt: Date.now(), source: "东方财富 · 浏览器直连" },
  };
}

function directSpecialQuote(stock: Stock, data: Record<string, unknown>): Quote {
  const price = Number(data.price);
  const prevClose = Number(data.prevClose);
  const high = Number(data.high);
  const low = Number(data.low);
  return {
    ...stock,
    price: Number.isFinite(price) ? price : null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    open: Number.isFinite(Number(data.open)) ? Number(data.open) : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    volume: Number.isFinite(Number(data.volume)) ? Number(data.volume) : null,
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
    changePercent: Number.isFinite(Number(data.changePercent))
      ? Number(data.changePercent)
      : Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : null,
    amplitude: Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(prevClose) && prevClose !== 0
      ? ((high - low) / prevClose) * 100
      : null,
    speed: null,
    turnover: null,
    netInflow: null,
    limitState: null,
    sealedAmount: null,
  };
}

function loadDirectSinaSpecial(stocks: Stock[], timeoutMs = 2_500): Promise<Quote[]> {
  const globals = window as unknown as Record<string, unknown>;
  const symbols = stocks.map((stock) => stock.market === 100 ? "b_KOSPI" : "hf_CHA50CFD");
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.charset = "gbk";
    let done = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      symbols.forEach((symbol) => { try { delete globals[`hq_str_${symbol}`]; } catch { /* no-op */ } });
    };
    const finish = (action: () => void) => {
      if (done) return;
      done = true;
      action();
      cleanup();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("海外指数直连超时"))), timeoutMs);
    script.onerror = () => finish(() => reject(new Error("海外指数直连失败")));
    script.onload = () => finish(() => {
      const items = stocks.map((stock, index) => {
        const parts = String(globals[`hq_str_${symbols[index]}`] ?? "").split(",");
        if (!parts[0]) return null;
        return stock.market === 101
          ? directSpecialQuote(stock, { price: parts[0], prevClose: parts[7], high: parts[4], low: parts[5], open: parts[8], volume: parts[9] })
          : directSpecialQuote(stock, { price: parts[1], changePercent: parts[3], open: parts[8], prevClose: parts[9], high: parts[10], low: parts[11], volume: parts[12] });
      }).filter((item): item is Quote => Boolean(item));
      if (!items.length) throw new Error("海外指数直连为空");
      resolve(items);
    });
    script.src = `https://hq.sinajs.cn/list=${symbols.join(",")}`;
    document.head.appendChild(script);
  });
}

function loadDirectThsSpecial(stock: Stock, timeoutMs = 2_500): Promise<Quote> {
  const globals = window as unknown as Record<string, unknown>;
  const callback = `quotebridge_v2_realhead_48_${stock.code}_last`;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      try { delete globals[callback]; } catch { /* no-op */ }
    };
    const finish = (action: () => void) => {
      if (done) return;
      done = true;
      action();
      cleanup();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("同花顺指数直连超时"))), timeoutMs);
    script.onerror = () => finish(() => reject(new Error("同花顺指数直连失败")));
    globals[callback] = (payload: { items?: Record<string, unknown> }) => finish(() => {
      const row = payload?.items ?? {};
      resolve(directSpecialQuote(stock, {
        price: row["10"], prevClose: row["6"], open: row["7"], high: row["8"], low: row["9"],
        volume: row["13"], amount: row["19"],
      }));
    });
    script.src = `https://d.10jqka.com.cn/v2/realhead/48_${stock.code}/last.js`;
    document.head.appendChild(script);
  });
}

async function fetchDirectSpecialQuotes(stocks: Stock[]) {
  const legacy = stocks.filter((stock) => stock.market === 100 || stock.market === 101);
  const tasks: Array<Promise<Quote[]>> = [];
  if (legacy.length) tasks.push(loadDirectSinaSpecial(legacy));
  stocks.filter((stock) => stock.market === 102).forEach((stock) => tasks.push(loadDirectThsSpecial(stock).then((item) => [item])));
  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  if (!items.length) throw new Error("特殊指数直连失败");
  return {
    items,
    meta: { mode: items.length === stocks.length ? "live" : "stale", updatedAt: Date.now(), source: "浏览器直连行情" } as MarketMeta,
  };
}

async function fetchSpecialQuotes(stocks: Stock[]) {
  const direct = await fetchDirectSpecialQuotes(stocks).catch(() => ({
    items: [] as Quote[],
    meta: { mode: "offline", updatedAt: 0, source: "浏览器直连失败" } as MarketMeta,
  }));
  if (direct.items.length === stocks.length) return direct;
  try {
    const secids = stocks.map(keyOf).join(",");
    const remote = await fetchJson<{ items: Quote[]; meta: MarketMeta }>(
      `https://xinghai-special-feed.vercel.app/api/special?secids=${encodeURIComponent(secids)}`,
      6_000,
    );
    const merged = new Map(remote.items.map((item) => [keyOf(item), item]));
    direct.items.forEach((item) => merged.set(keyOf(item), item));
    return {
      items: stocks.map((stock) => merged.get(keyOf(stock))).filter((item): item is Quote => Boolean(item)),
      meta: {
        mode: merged.size >= stocks.length ? "live" : "stale",
        updatedAt: Math.max(direct.meta.updatedAt, remote.meta.updatedAt),
        source: direct.items.length ? "浏览器直连 + 备用指数源" : remote.meta.source,
      } as MarketMeta,
    };
  } catch (error) {
    if (direct.items.length) return direct;
    throw error;
  }
}

function useCanvas(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, dependencies: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      draw(ctx, rect.width, rect.height);
    };
    render();
    let frame = 0;
    const requestRender = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(render);
    };
    const observer = new ResizeObserver(requestRender);
    observer.observe(canvas.parentElement || canvas);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
    // draw is intentionally refreshed by the supplied dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return ref;
}

function grid(ctx: CanvasRenderingContext2D, width: number, height: number, pad: { l: number; r: number; t: number; b: number }) {
  ctx.strokeStyle = "rgba(24,48,72,.09)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + ((height - pad.t - pad.b) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
  }
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.l + ((width - pad.l - pad.r) * i) / 4;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, height - pad.b); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function aShareSessionProgress(time: string, fallbackIndex: number) {
  const match = time.match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return Math.min(Math.max(fallbackIndex, 0), 240) / 240;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  const tradingMinute = minute <= 11 * 60 + 30
    ? minute - (9 * 60 + 30)
    : minute >= 13 * 60
      ? 120 + minute - 13 * 60
      : 120;
  return Math.min(Math.max(tradingMinute, 0), 240) / 240;
}

type ChartHover = { x: number; y: number; label: string; price: number | null; average?: number | null; volume?: number | null; amount?: number | null };
const MARKET_CHART_LEFT = 88;
const MARKET_CHART_RIGHT = 18;

function MarketChart({ detail, mode }: { detail: Detail | null; mode: ChartMode }) {
  const [hover, setHover] = useState<ChartHover | null>(null);
  const ref = useCanvas((ctx, width, height) => {
    const pad = { l: MARKET_CHART_LEFT, r: MARKET_CHART_RIGHT, t: 24, b: 36 };
    grid(ctx, width, height, pad);
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    ctx.font = '500 12px "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif';
    ctx.fillStyle = "#6f7f91";
    if (!detail || (mode === "time" ? !detail.trends.length : !detail.klines.length)) {
      ctx.textAlign = "center";
      ctx.fillText("等待行情数据…", width / 2, height / 2);
      return;
    }

    if (mode === "time") {
      const rows = detail.trends.filter((row) => row.price !== null);
      const prices = rows.map((row) => row.price as number);
      const base = detail.preClose || detail.quote.prevClose || prices[0];
      const span = Math.max(...prices.map((p) => Math.abs(p - base)), base * 0.006, 0.01);
      const min = base - span * 1.18;
      const max = base + span * 1.18;
      const x = (row: Trend, index: number) => pad.l + aShareSessionProgress(row.time, index) * plotW;
      const y = (value: number) => pad.t + ((max - value) / (max - min)) * plotH;
      const lastRow = rows.at(-1) as Trend;
      const lastX = x(lastRow, rows.length - 1);

      const maxVolume = Math.max(...rows.map((row) => row.volume || 0), 1);
      ctx.fillStyle = "rgba(33, 118, 169, .13)";
      rows.forEach((row, index) => {
        const volumeH = ((row.volume || 0) / maxVolume) * plotH * .17;
        ctx.fillRect(x(row, index) - 1.2, height - pad.b - volumeH, 2.4, volumeH);
      });

      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(154, 107, 37, .55)";
      ctx.beginPath(); ctx.moveTo(pad.l, y(base)); ctx.lineTo(width - pad.r, y(base)); ctx.stroke();
      ctx.restore();

      const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
      gradient.addColorStop(0, "rgba(77,181,255,.24)");
      gradient.addColorStop(1, "rgba(77,181,255,0)");
      ctx.beginPath();
      rows.forEach((row, index) => index ? ctx.lineTo(x(row, index), y(row.price as number)) : ctx.moveTo(x(row, index), y(row.price as number)));
      ctx.lineTo(lastX, height - pad.b); ctx.lineTo(pad.l, height - pad.b); ctx.closePath();
      ctx.fillStyle = gradient; ctx.fill();

      ctx.beginPath();
      rows.forEach((row, index) => index ? ctx.lineTo(x(row, index), y(row.price as number)) : ctx.moveTo(x(row, index), y(row.price as number)));
      ctx.strokeStyle = "#55b9ff"; ctx.lineWidth = 1.8; ctx.stroke();

      const averages = rows.filter((row) => row.average !== null);
      ctx.beginPath();
      averages.forEach((row, index) => index ? ctx.lineTo(x(row, index), y(row.average as number)) : ctx.moveTo(x(row, index), y(row.average as number)));
      ctx.strokeStyle = "#d7ae66"; ctx.lineWidth = 1.15; ctx.stroke();

      ctx.beginPath();
      ctx.arc(lastX, y(lastRow.price as number), 2.8, 0, Math.PI * 2);
      ctx.fillStyle = "#55b9ff";
      ctx.fill();

      const axisLabel = (value: number) => `${value.toFixed(2)}  ${signed(((value - base) / base) * 100)}`;
      const drawAxisLabel = (value: number, position: number) => {
        const change = ((value - base) / base) * 100;
        ctx.fillStyle = change > 0.005 ? "#9a5f00" : change < -0.005 ? "#087f60" : "#66798a";
        ctx.fillText(axisLabel(value), pad.l - 8, position);
      };
      ctx.textAlign = "right";
      drawAxisLabel(max, pad.t + 4);
      drawAxisLabel(base, y(base) + 4);
      drawAxisLabel(min, height - pad.b);
      ctx.textAlign = "left"; ctx.fillStyle = "#9a6b25"; ctx.fillText("昨收", pad.l + 5, y(base) - 6);
      ctx.textAlign = "center";
      ["09:30", "10:30", "11:30 / 13:00", "14:00", "15:00"].forEach((label, i) => ctx.fillText(label, pad.l + (plotW * i) / 4, height - 12));
    } else {
      const rows = detail.klines.filter((row) => row.close !== null && row.high !== null && row.low !== null);
      const max = Math.max(...rows.map((row) => row.high as number));
      const min = Math.min(...rows.map((row) => row.low as number));
      const range = Math.max(max - min, max * 0.01);
      const candleArea = plotH * 0.76;
      const xStep = plotW / Math.max(rows.length, 1);
      const y = (value: number) => pad.t + ((max + range * 0.05 - value) / (range * 1.1)) * candleArea;
      const maxVolume = Math.max(...rows.map((row) => row.volume || 0), 1);
      rows.forEach((row, index) => {
        const x = pad.l + xStep * index + xStep / 2;
        const up = (row.close as number) >= (row.open as number);
        const color = up ? "#bd7815" : "#16806b";
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y(row.high as number)); ctx.lineTo(x, y(row.low as number)); ctx.stroke();
        const bodyY = Math.min(y(row.open as number), y(row.close as number));
        const bodyH = Math.max(1.5, Math.abs(y(row.open as number) - y(row.close as number)));
        ctx.fillRect(x - Math.max(1.8, xStep * 0.28), bodyY, Math.max(3.6, xStep * 0.56), bodyH);
        const volumeH = ((row.volume || 0) / maxVolume) * plotH * 0.16;
        ctx.globalAlpha = 0.55; ctx.fillRect(x - Math.max(1.5, xStep * 0.24), height - pad.b - volumeH, Math.max(3, xStep * 0.48), volumeH); ctx.globalAlpha = 1;
      });
      ctx.textAlign = "right"; ctx.fillStyle = "#7f8fa1";
      ctx.fillText(max.toFixed(2), pad.l - 8, pad.t + 4); ctx.fillText(min.toFixed(2), pad.l - 8, pad.t + candleArea);
      ctx.textAlign = "center";
      [0, Math.floor(rows.length / 2), rows.length - 1].forEach((index) => {
        if (rows[index]) ctx.fillText(rows[index].date.slice(5), pad.l + xStep * index + xStep / 2, height - 12);
      });
    }
  }, [detail, mode]);

  const inspectPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - MARKET_CHART_LEFT - MARKET_CHART_RIGHT);
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - MARKET_CHART_LEFT) / plotWidth));
    const y = Math.min(rect.height - 36, Math.max(24, event.clientY - rect.top));
    if (mode === "time") {
      const rows = (detail?.trends || []).filter((row) => row.price !== null);
      if (!rows.length) return;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      rows.forEach((row, index) => {
        const distance = Math.abs(aShareSessionProgress(row.time, index) - ratio);
        if (distance < nearestDistance) { nearestIndex = index; nearestDistance = distance; }
      });
      const row = rows[nearestIndex];
      const x = MARKET_CHART_LEFT + aShareSessionProgress(row.time, nearestIndex) * plotWidth;
      setHover({ x, y, label: row.time.split(" ").at(-1) || row.time, price: row.price, average: row.average, volume: row.volume, amount: row.amount });
      return;
    }
    const rows = (detail?.klines || []).filter((row) => row.close !== null);
    if (!rows.length) return;
    const index = Math.min(rows.length - 1, Math.max(0, Math.round(ratio * (rows.length - 1))));
    const row = rows[index];
    setHover({ x: MARKET_CHART_LEFT + ((index + .5) / rows.length) * plotWidth, y, label: row.date, price: row.close, volume: row.volume, amount: row.amount });
  };

  return <div className="market-chart-wrap" onPointerMove={inspectPoint} onPointerLeave={() => setHover(null)}>
    <canvas className="market-canvas" ref={ref} role="img" aria-label={mode === "time" ? "可悬停查看时间、价格、均价和成交量的分时走势" : "可悬停查看日期、收盘价和成交量的日K走势"} />
    {hover && <>
      <span className="crosshair vertical" style={{ left: hover.x }} aria-hidden="true" />
      <span className="crosshair horizontal" style={{ top: hover.y }} aria-hidden="true" />
      <div className="chart-tooltip" style={{ left: hover.x, top: hover.y }}>
        <strong>{hover.label}</strong><span>价格 {number(hover.price)}</span>
        {hover.average !== undefined && <span>均价 {number(hover.average)}</span>}
        <span>成交量 {amount(hover.volume)}</span>
        {hover.amount !== undefined && <span>成交额 {amount(hover.amount)}</span>}
      </div>
    </>}
    {mode === "time" && <span className="volume-caption">成交量</span>}
  </div>;
}

function Sparkline({ values, value }: { values: number[]; value: number | null | undefined }) {
  const ref = useCanvas((ctx, width, height) => {
    if (values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, 0.01);
    const color = (value || 0) >= 0 ? "#bd7815" : "#16806b";
    ctx.beginPath();
    values.forEach((item, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = 4 + ((max - item) / span) * (height - 8);
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }, [values, value]);
  return <canvas ref={ref} className="sparkline" aria-hidden="true" />;
}

function FlowChart({ rows }: { rows: CapitalData["flow"] }) {
  const ref = useCanvas((ctx, width, height) => {
    const pad = { l: 58, r: 18, t: 18, b: 32 };
    grid(ctx, width, height, pad);
    const values = rows.map((row) => row.main).filter((value): value is number => value !== null);
    if (!values.length) { ctx.fillStyle = "#6f7f91"; ctx.textAlign = "center"; ctx.fillText("等待资金流数据…", width / 2, height / 2); return; }
    const maxAbs = Math.max(...values.map(Math.abs), 1);
    const x = (index: number) => pad.l + (index / Math.max(values.length - 1, 1)) * (width - pad.l - pad.r);
    const y = (value: number) => pad.t + ((maxAbs - value) / (maxAbs * 2)) * (height - pad.t - pad.b);
    const last = values.at(-1) || 0;
    const color = last >= 0 ? "#bd7815" : "#16806b";
    const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
    gradient.addColorStop(0, `${color}44`); gradient.addColorStop(1, `${color}00`);
    ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
    ctx.lineTo(x(values.length - 1), height - pad.b); ctx.lineTo(pad.l, height - pad.b); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#657789"; ctx.font = '500 12px "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'; ctx.textAlign = "right";
    ctx.fillText(`${(maxAbs / 1e8).toFixed(0)}亿`, pad.l - 8, pad.t + 4); ctx.fillText("0", pad.l - 8, y(0) + 4); ctx.fillText(`${(-maxAbs / 1e8).toFixed(0)}亿`, pad.l - 8, height - pad.b);
    ctx.textAlign = "center";
    [0, Math.floor(rows.length / 2), rows.length - 1].forEach((index) => rows[index] && ctx.fillText(rows[index].time.slice(11, 16), x(index), height - 10));
  }, [rows]);
  return <canvas ref={ref} className="flow-canvas" role="img" aria-label="沪深300主力资金净流入曲线" />;
}

function LoadingRows({ count = 7 }: { count?: number }) {
  return <div className="loading-rows" role="status" aria-live="polite"><span className="sr-only">加载中…</span>{Array.from({ length: count }, (_, index) => <div className="loading-row" aria-hidden="true" key={index} />)}</div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state" role="status" aria-live="polite"><div className="empty-orbit" aria-hidden="true">◎</div><strong>{title}</strong><span>{detail}</span></div>;
}

export function StockTerminal() {
  const [page, setPage] = useState<PageKey>("watch");
  const [watchGroup, setWatchGroup] = useState<WatchGroupKey>("main");
  const [watchGroups, setWatchGroups] = useState<Record<WatchGroupKey, Stock[]>>(DEFAULT_WATCH_GROUPS);
  const [pinned, setPinned] = useState<Set<string>>(new Set(DEFAULT_PINNED));
  const [hydrated, setHydrated] = useState(false);
  const [activeKey, setActiveKey] = useState("1.000001");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [speeds4m, setSpeeds4m] = useState<Record<string, number>>({});
  const [marketTurnover, setMarketTurnover] = useState<MarketTurnover | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chartDetail, setChartDetail] = useState<Detail | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("time");
  const [feedStates, setFeedStates] = useState<Partial<Record<FeedKey, FeedSnapshot>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [compactList, setCompactList] = useState(true);
  const [screenshotImportOpen, setScreenshotImportOpen] = useState(false);
  const [watchSort, setWatchSort] = useState<WatchSort>("manual");
  const [railOpen, setRailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Stock[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const dragged = useRef<string | null>(null);
  const quoteRequest = useRef<Record<"all" | "priority" | "overseas", number>>({ all: 0, priority: 0, overseas: 0 });
  const detailRequest = useRef(0);
  const quoteBusy = useRef<Record<"all" | "priority" | "overseas", boolean>>({ all: false, priority: false, overseas: false });
  const detailBusy = useRef<string | null>(null);
  const speedBusy = useRef(false);
  const turnoverBusy = useRef(false);
  const priceHistory = useRef<Record<string, Array<{ at: number; price: number }>>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<Detail | null>(null);
  const chartSignature = useRef("");
  const quotesRef = useRef<Record<string, Quote>>({});
  const speedsRef = useRef<Record<string, number>>({});
  const turnoverRef = useRef<MarketTurnover | null>(null);
  const watchlist = watchGroups[watchGroup];
  const quoteUniverse = useMemo(() => {
    const unique = new Map<string, Stock>();
    [...DEFAULT_STOCKS.slice(0, 7), ...watchlist].forEach((stock) => unique.set(keyOf(stock), stock));
    return Array.from(unique.values());
  }, [watchlist]);

  const updateWatchlist = useCallback((update: Stock[] | ((current: Stock[]) => Stock[])) => {
    setWatchGroups((current) => {
      const currentRows = current[watchGroup];
      const nextRows = typeof update === "function" ? update(currentRows) : update;
      return nextRows === currentRows ? current : { ...current, [watchGroup]: nextRows };
    });
  }, [watchGroup]);

  const switchWatchGroup = useCallback((nextGroup: WatchGroupKey) => {
    setWatchGroup(nextGroup);
    setActiveKey((current) => watchGroups[nextGroup].some((stock) => keyOf(stock) === current) ? current : (watchGroups[nextGroup][0] ? keyOf(watchGroups[nextGroup][0]) : ""));
    setMenu(null);
  }, [watchGroups]);

  useEffect(() => {
    try {
      const storedGroups = JSON.parse(localStorage.getItem(WATCHLIST_GROUPS_KEY) || "null");
      const storedGroup = localStorage.getItem(ACTIVE_WATCH_GROUP_KEY);
      const storedPinned = JSON.parse(localStorage.getItem(PINNED_KEY) || "null");
      const storedQuotes = JSON.parse(localStorage.getItem(QUOTES_CACHE_KEY) || "null");
      const nextGroups = storedGroups && Array.isArray(storedGroups.main) && Array.isArray(storedGroups.etf)
        ? { main: storedGroups.main, etf: storedGroups.etf } : DEFAULT_WATCH_GROUPS;
      const nextGroup: WatchGroupKey = storedGroup === "etf" ? "etf" : "main";
      setWatchGroups(nextGroups);
      setWatchGroup(nextGroup);
      const rows = nextGroups[nextGroup];
      setActiveKey(rows.some((stock: Stock) => keyOf(stock) === "1.000001") ? "1.000001" : (rows[0] ? keyOf(rows[0]) : ""));
      if (Array.isArray(storedPinned)) setPinned(new Set(storedPinned));
      if (storedQuotes?.items && typeof storedQuotes.items === "object" && Date.now() - Number(storedQuotes.updatedAt || 0) < 12 * 60 * 60 * 1_000) {
        setQuotes(storedQuotes.items);
      }
    } catch { /* Ignore invalid browser storage. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(WATCHLIST_GROUPS_KEY, JSON.stringify(watchGroups));
    localStorage.setItem(ACTIVE_WATCH_GROUP_KEY, watchGroup);
    localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(pinned)));
  }, [hydrated, pinned, watchGroup, watchGroups]);

  useEffect(() => {
    if (!hydrated || !Object.keys(quotes).length) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), items: quotes })); }
      catch { /* Storage pressure must not interrupt live quotes. */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, quotes]);

  const displayedStocks = useMemo(() => {
    const order = (rows: Stock[]) => watchSort === "manual" ? rows : [...rows].sort((a, b) => {
      const aKey = keyOf(a), bKey = keyOf(b);
      const value = (key: string) => watchSort === "change" ? quotes[key]?.changePercent : watchSort === "speed" ? speeds4m[key] : quotes[key]?.amount;
      return (value(bKey) ?? Number.NEGATIVE_INFINITY) - (value(aKey) ?? Number.NEGATIVE_INFINITY);
    });
    return [
      ...order(watchlist.filter((stock) => pinned.has(keyOf(stock)))),
      ...order(watchlist.filter((stock) => !pinned.has(keyOf(stock)))),
    ];
  }, [pinned, quotes, speeds4m, watchSort, watchlist]);

  const activeStock = quoteUniverse.find((stock) => keyOf(stock) === activeKey) || watchlist[0] || null;
  const activeDetail = detail && keyOf(detail.quote) === activeKey ? detail : null;
  const activeQuote = activeDetail?.quote || (activeStock ? quotes[keyOf(activeStock)] : null);

  useEffect(() => {
    chartSignature.current = "";
    setChartDetail(null);
  }, [activeKey, chartMode]);

  useEffect(() => {
    if (!activeDetail) return;
    const rows = chartMode === "time" ? activeDetail.trends : activeDetail.klines;
    if (!rows.length) return;
    const lastPoint = rows[rows.length - 1];
    const pointKey = chartMode === "time" ? (lastPoint as Trend).time : (lastPoint as Kline).date;
    const signature = `${activeKey}|${chartMode}|${rows.length}|${pointKey}`;
    if (chartSignature.current === signature) return;
    chartSignature.current = signature;
    setChartDetail(activeDetail);
  }, [activeDetail, activeKey, chartMode]);

  const selectStock = useCallback((key: string) => {
    if (!key) return;
    setPage("watch");
    if (key === activeKey) return;
    // Invalidate the previous stock immediately so a slow response can never
    // paint over the newly selected row.
    detailRequest.current += 1;
    detailBusy.current = null;
    detailRef.current = null;
    setDetail(null);
    setActiveKey(key);
  }, [activeKey]);

  const updateConnection = useCallback((nextMeta: MarketMeta, feed: FeedKey = "quotes") => {
    setFeedStates((current) => ({ ...current, [feed]: { ...nextMeta, label: FEED_LABELS[feed] } }));
  }, []);

  const markFeedFailure = useCallback((feed: FeedKey, hasData: boolean) => {
    setFeedStates((current) => {
      const previous = current[feed];
      return {
        ...current,
        [feed]: {
          mode: hasData ? "stale" : "offline",
          updatedAt: previous?.updatedAt || 0,
          source: previous?.source || "上游暂不可用",
          label: FEED_LABELS[feed],
        },
      };
    });
  }, []);

  const connection = useMemo<"loading" | "online" | "stale" | "offline">(() => {
    const rows = Object.values(feedStates);
    if (!rows.length) return "loading";
    if (rows.some((item) => item?.mode === "offline")) return "offline";
    if (rows.some((item) => item?.mode === "stale")) return "stale";
    return "online";
  }, [feedStates]);
  const meta = useMemo<MarketMeta | null>(() => {
    const rank = { offline: 3, stale: 2, cache: 1, live: 0 };
    const rows = Object.values(feedStates).filter((item): item is FeedSnapshot => Boolean(item));
    return rows.sort((a, b) => rank[b.mode] - rank[a.mode] || (a.updatedAt || 0) - (b.updatedAt || 0))[0] || null;
  }, [feedStates]);

  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => { quotesRef.current = quotes; }, [quotes]);
  useEffect(() => { speedsRef.current = speeds4m; }, [speeds4m]);
  useEffect(() => { turnoverRef.current = marketTurnover; }, [marketTurnover]);

  const updateRollingSpeeds = useCallback((items: Quote[]) => {
    const now = Date.now();
    const cutoff = now - 5 * 60_000;
    const target = now - 4 * 60_000;
    const updates: Record<string, number> = {};
    items.forEach((item) => {
      if (item.price === null || !Number.isFinite(item.price) || item.price <= 0) return;
      const key = keyOf(item);
      const rows = (priceHistory.current[key] || []).filter((point) => point.at >= cutoff);
      const last = rows.at(-1);
      if (!last || last.price !== item.price || now - last.at >= 1_000) rows.push({ at: now, price: item.price });
      priceHistory.current[key] = rows;
      let reference: { at: number; price: number } | undefined;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].at <= target) { reference = rows[index]; break; }
      }
      const age = reference ? now - reference.at : 0;
      if (reference && age >= 210_000 && age <= 300_000 && reference.price > 0) {
        updates[key] = ((item.price - reference.price) / reference.price) * 100;
      }
    });
    if (Object.keys(updates).length) {
      setSpeeds4m((current) => ({ ...current, ...updates }));
      updateConnection({ mode: "live", updatedAt: now, source: "连续报价滚动计算" }, "speeds");
    }
  }, [updateConnection]);

  const refreshQuotes = useCallback(async (silent = false, scope: "all" | "priority" | "overseas" = "all") => {
    if (!quoteUniverse.length) return;
    if (silent && quoteBusy.current[scope]) return;
    const requestId = ++quoteRequest.current[scope];
    quoteBusy.current[scope] = true;
    if (!silent) setRefreshing(true);
    try {
      const priorityKeys = new Set([activeKey, "1.000001", "0.399001", ...Array.from(pinned)]);
      const requestedStocks = scope === "all"
        ? quoteUniverse.filter((stock) => stock.market === 0 || stock.market === 1)
        : scope === "overseas"
          ? quoteUniverse.filter((stock) => stock.market === 100 || stock.market === 101)
          : quoteUniverse.filter((stock) => priorityKeys.has(keyOf(stock))).slice(0, 14);
      if (scope === "overseas") requestedStocks.push(...quoteUniverse.filter((stock) => stock.market === 102));
      if (!requestedStocks.length) return;
      const secids = requestedStocks.map(keyOf).join(",");
      const data = scope === "overseas"
        ? await fetchSpecialQuotes(requestedStocks)
        : await fetchJson<{ items: Quote[]; meta: MarketMeta }>(`/api/market?action=quotes&secids=${encodeURIComponent(secids)}`);
      if (requestId !== quoteRequest.current[scope]) return;
      updateRollingSpeeds(data.items);
      setQuotes((current) => {
        const next = { ...current };
        data.items.forEach((item) => {
          const local = quoteUniverse.find((stock) => keyOf(stock) === keyOf(item));
          next[keyOf(item)] = { ...item, name: item.name || local?.name || item.code };
        });
        return next;
      });
      updateConnection(data.meta, "quotes");
    } catch (error) {
      if (requestId === quoteRequest.current[scope]) {
        if (scope !== "overseas") markFeedFailure("quotes", Object.keys(quotesRef.current).length > 0);
        if (!silent && scope !== "overseas") setNotice(error instanceof Error ? error.message : "刷新失败");
      }
    } finally {
      if (requestId === quoteRequest.current[scope]) quoteBusy.current[scope] = false;
      if (!silent) setRefreshing(false);
    }
  }, [activeKey, markFeedFailure, pinned, quoteUniverse, updateConnection, updateRollingSpeeds]);

  useEffect(() => {
    refreshQuotes(false, "all");
    refreshQuotes(true, "overseas");
  }, [watchGroup, watchlist.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let timer = 0;
    const poll = async () => {
      const trading = isAShareTrading();
      if (!pollingPaused && document.visibilityState === "visible") await refreshQuotes(true, trading ? "priority" : "all");
      timer = window.setTimeout(poll, trading ? 1_000 : 5_000);
    };
    timer = window.setTimeout(poll, isAShareTrading() ? 1_000 : 5_000);
    return () => window.clearTimeout(timer);
  }, [pollingPaused, refreshQuotes]);

  useEffect(() => {
    let timer = 0;
    const pollSpecial = async () => {
      if (!pollingPaused && document.visibilityState === "visible") await refreshQuotes(true, "overseas");
      timer = window.setTimeout(pollSpecial, isAShareTrading() ? 10_000 : 5_000);
    };
    timer = window.setTimeout(pollSpecial, 2_000);
    return () => window.clearTimeout(timer);
  }, [pollingPaused, refreshQuotes]);

  useEffect(() => {
    let timer = 0;
    const pollAll = async () => {
      if (!pollingPaused && document.visibilityState === "visible") await refreshQuotes(true, "all");
      timer = window.setTimeout(pollAll, isAShareTrading() ? 3_000 : 20_000);
    };
    timer = window.setTimeout(pollAll, isAShareTrading() ? 3_000 : 20_000);
    return () => window.clearTimeout(timer);
  }, [pollingPaused, refreshQuotes]);

  const refreshSpeeds = useCallback(async () => {
    if (!quoteUniverse.length || speedBusy.current) return;
    speedBusy.current = true;
    try {
      const secids = quoteUniverse.map(keyOf).join(",");
      const data = await fetchJson<{ items: Speed4[]; meta: MarketMeta }>(`/api/market?action=speeds&secids=${encodeURIComponent(secids)}`, 20_000);
      setSpeeds4m((current) => {
        const next = { ...current };
        data.items.forEach((item) => { next[`${item.market}.${item.code}`] = item.speed4m; });
        return next;
      });
      updateConnection(data.meta, "speeds");
    } catch { markFeedFailure("speeds", Object.keys(speedsRef.current).length > 0); }
    finally { speedBusy.current = false; }
  }, [markFeedFailure, quoteUniverse, updateConnection]);

  useEffect(() => {
    const initial = window.setTimeout(refreshSpeeds, 1_500);
    const timer = window.setInterval(() => {
      if (!pollingPaused && document.visibilityState === "visible") refreshSpeeds();
    }, isAShareTrading() ? 60_000 : 120_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [pollingPaused, refreshSpeeds]);

  const refreshMarketTurnover = useCallback(async () => {
    if (turnoverBusy.current) return;
    turnoverBusy.current = true;
    try {
      const next = await fetchJson<MarketTurnover>("/api/market?action=market-turnover", 15_000);
      setMarketTurnover(next);
      updateConnection(next.meta, "turnover");
    } catch { markFeedFailure("turnover", Boolean(turnoverRef.current)); }
    finally { turnoverBusy.current = false; }
  }, [markFeedFailure, updateConnection]);

  useEffect(() => {
    refreshMarketTurnover();
    const timer = window.setInterval(() => {
      if (!pollingPaused && document.visibilityState === "visible") refreshMarketTurnover();
    }, isAShareTrading() ? 5_000 : 20_000);
    return () => window.clearInterval(timer);
  }, [pollingPaused, refreshMarketTurnover]);

  const refreshDetail = useCallback(async (silent = false) => {
    const stock = quoteUniverse.find((item) => keyOf(item) === activeKey) || watchlist[0];
    if (!stock) { setDetail(null); return; }
    const stockKey = keyOf(stock);
    if (detailBusy.current === stockKey) return;
    const requestId = ++detailRequest.current;
    detailBusy.current = stockKey;
    try {
      const previous = detailRef.current;
      const sameStock = Boolean(previous && keyOf(previous.quote) === stockKey);
      const includeKline = chartMode === "day" && (!sameStock || !previous?.klines.length);
      const canDelta = Boolean(silent && sameStock && !includeKline);
      const since = canDelta ? previous?.trends.at(-1)?.time || "" : "";
      const data = await fetchJson<Detail>(`/api/market?action=detail&secid=${encodeURIComponent(stockKey)}&full=${includeKline ? "1" : "0"}&since=${encodeURIComponent(since)}`);
      if (requestId !== detailRequest.current) return;
      setDetail((current) => {
        if (!canDelta || !current || keyOf(current.quote) !== stockKey) return data;
        const trends = new Map(current.trends.map((row) => [row.time, row]));
        data.trends.forEach((row) => trends.set(row.time, row));
        return { ...data, trends: Array.from(trends.values()).sort((a, b) => a.time.localeCompare(b.time)), klines: data.klines.length ? data.klines : current.klines, preClose: data.preClose ?? current.preClose };
      });
      updateConnection(data.meta, "detail");
    } catch (error) {
      if (requestId === detailRequest.current && !silent) {
        setNotice(error instanceof Error ? error.message : "个股数据加载失败");
      }
      if (requestId === detailRequest.current) markFeedFailure("detail", Boolean(detailRef.current));
    } finally {
      if (requestId === detailRequest.current) detailBusy.current = null;
    }
  }, [activeKey, chartMode, markFeedFailure, quoteUniverse, updateConnection, watchlist]);

  useEffect(() => {
    detailRequest.current += 1;
    detailBusy.current = null;
    detailRef.current = null;
    setDetail(null);
    refreshDetail(false);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeKlineCount = activeDetail?.klines.length || 0;
  useEffect(() => {
    if (chartMode === "day" && activeKlineCount === 0) refreshDetail(false);
  }, [activeKey, activeKlineCount, chartMode, refreshDetail]);

  useEffect(() => {
    let timer = 0;
    const poll = async () => {
      const active = watchlist.find((item) => keyOf(item) === activeKey);
      const delay = active && (active.market === 0 || active.market === 1 || active.market === 102) && !isAShareTrading() ? 20_000 : 2_000;
      if (!pollingPaused && page === "watch" && document.visibilityState === "visible") await refreshDetail(true);
      timer = window.setTimeout(poll, delay);
    };
    timer = window.setTimeout(poll, 2_000);
    return () => window.clearTimeout(timer);
  }, [activeKey, page, pollingPaused, refreshDetail, watchlist]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshQuotes(true, "all"), refreshDetail(true), refreshSpeeds(), refreshMarketTurnover()]);
    setRefreshing(false);
  }, [refreshDetail, refreshMarketTurnover, refreshQuotes, refreshSpeeds]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); setSearching(false); setSearchMessage(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchMessage("");
      try {
        const response = await fetch(`/api/market?action=search&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "搜索暂不可用");
        const items = data.items || [];
        setSuggestions(items);
        setSearchMessage(items.length ? "" : "没有找到匹配的沪深股票");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
          setSearchMessage("搜索暂不可用，请稍后重试");
        }
      }
      finally { setSearching(false); }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const addStock = useCallback((stock: Stock) => {
    const key = keyOf(stock);
    updateWatchlist((current) => current.some((item) => keyOf(item) === key) ? current : [...current, stock]);
    selectStock(key);
    setQuery(""); setSuggestions([]); setSearchMessage("");
    setNotice(watchlist.some((item) => keyOf(item) === key) ? "已在自选列表中" : `已添加 ${stock.name}`);
  }, [selectStock, updateWatchlist, watchlist]);

  const importStocks = useCallback((stocks: ImportedStock[]) => {
    const existing = new Set(watchlist.map(keyOf));
    const additions = stocks.filter((stock) => !existing.has(keyOf(stock)));
    updateWatchlist((current) => {
      const keys = new Set(current.map(keyOf));
      return [...current, ...stocks.filter((stock) => !keys.has(keyOf(stock)))];
    });
    if (additions[0]) selectStock(keyOf(additions[0]));
    setScreenshotImportOpen(false);
    setNotice(additions.length ? `已从截图添加 ${additions.length} 只股票` : "识别到的股票已在当前分组中");
  }, [selectStock, updateWatchlist, watchlist]);

  const closeScreenshotImport = useCallback(() => setScreenshotImportOpen(false), []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (suggestions[suggestionIndex]) { addStock(suggestions[suggestionIndex]); return; }
    if (/^\d{6}$/.test(value)) {
      const market = /^(6|5|9)/.test(value) ? 1 : 0;
      addStock({ code: value, market, name: value });
    } else if (value) setNotice("请输入六位代码，或从搜索结果中选择");
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault(); setSuggestionIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault(); setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Escape") {
      setQuery(""); setSuggestions([]); setSearchMessage(""); searchRef.current?.blur();
    }
  };

  const removeStock = (key: string) => {
    updateWatchlist((current) => {
      const next = current.filter((stock) => keyOf(stock) !== key);
      if (activeKey === key) setActiveKey(next[0] ? keyOf(next[0]) : "");
      return next;
    });
    setPinned((current) => { const next = new Set(current); next.delete(key); return next; });
    setMenu(null);
  };

  const moveStock = (key: string, target: "top" | "bottom") => {
    updateWatchlist((current) => {
      const item = current.find((stock) => keyOf(stock) === key);
      if (!item) return current;
      const rest = current.filter((stock) => keyOf(stock) !== key);
      return target === "top" ? [item, ...rest] : [...rest, item];
    });
    setMenu(null);
  };

  const togglePin = (key: string) => {
    setPinned((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
    setMenu(null);
  };

  const dropOn = (targetKey: string) => {
    const sourceKey = dragged.current;
    if (!sourceKey || sourceKey === targetKey) return;
    updateWatchlist((current) => {
      const next = [...current];
      const from = next.findIndex((stock) => keyOf(stock) === sourceKey);
      const to = next.findIndex((stock) => keyOf(stock) === targetKey);
      if (from < 0 || to < 0) return current;
      const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
    });
    dragged.current = null;
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "/") {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
      }
      if (isTextEntry(event.target) || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        setPage(event.key === "1" ? "watch" : event.key === "2" ? "capital" : "rankings"); return;
      }
      if (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") {
        if (!displayedStocks.length) return;
        event.preventDefault();
        const current = displayedStocks.findIndex((stock) => keyOf(stock) === activeKey);
        const delta = event.key.toLowerCase() === "j" ? 1 : -1;
        const next = (Math.max(current, 0) + delta + displayedStocks.length) % displayedStocks.length;
        selectStock(keyOf(displayedStocks[next])); return;
      }
      if (event.code === "Space") {
        event.preventDefault(); setPollingPaused((current) => !current);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeKey, displayedStocks, selectStock]);

  const indexStocks = [quotes["1.000001"], quotes["0.399001"], quotes["100.KS11"]].filter(Boolean);
  const visibleChartDetail = chartDetail && keyOf(chartDetail.quote) === activeKey ? chartDetail : null;
  const chartLastPoint = chartMode === "time"
    ? visibleChartDetail?.trends.at(-1)?.time?.split(" ").at(-1)?.slice(0, 8)
    : visibleChartDetail?.klines.at(-1)?.date;
  const alerts = useMemo(() => {
    const rows: Array<{ key: string; label: string; stockKey?: string; tone: "warning" | "info" }> = [];
    if (connection === "offline") rows.push({ key: "offline", label: "部分数据源不可用，页面保留最近成功数据", tone: "warning" });
    else if (connection === "stale") rows.push({ key: "stale", label: "存在过期缓存，请留意各模块数据年龄", tone: "warning" });
    displayedStocks.forEach((stock) => {
      const key = keyOf(stock); const quote = quotes[key]; const speed = speeds4m[key];
      if (quote?.limitState) rows.push({ key: `limit-${key}`, stockKey: key, label: `${quote.name || stock.name} ${quote.limitState === "up" ? "涨停" : "跌停"}${quote.sealedAmount ? ` · 封单 ${amount(quote.sealedAmount)}` : ""}`, tone: "info" });
      else if (Number.isFinite(speed) && Math.abs(speed) >= 3) rows.push({ key: `speed-${key}`, stockKey: key, label: `${quote?.name || stock.name} 4分钟涨速 ${signed(speed)}`, tone: "warning" });
    });
    if (marketTurnover && Math.abs(marketTurnover.deltaPercent) >= 20) rows.push({ key: "turnover", label: `两市成交额较上日同期${marketTurnover.delta >= 0 ? "放量" : "缩量"} ${Math.abs(marketTurnover.deltaPercent).toFixed(1)}%`, tone: "warning" });
    return rows.slice(0, 6);
  }, [connection, displayedStocks, marketTurnover, quotes, speeds4m]);

  return (
    <div className="terminal-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span />〈</div>
          <div><strong>星辰大海</strong><small>行情研究台</small></div>
        </div>
        <nav className="main-tabs" aria-label="主要页面">
          {([ ["watch", "自选行情"], ["capital", "资金流向"], ["rankings", "涨跌排行"] ] as Array<[PageKey, string]>).map(([key, label]) => (
            <button type="button" key={key} className={page === key ? "active" : ""} aria-current={page === key ? "page" : undefined} onClick={() => setPage(key)}>{label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <div className={`network-pill ${connection}`} role="status" aria-live="polite" title="页面保留最近一次成功数据，失败时不会伪造更新时间">
            <i aria-hidden="true" />
            <span>{pollingPaused ? "自动刷新已暂停" : connection === "loading" ? "连接中" : connection === "online" ? "各模块正常" : connection === "stale" ? "存在过期缓存" : "部分数据中断"}</span>
            <time>{shortTime(meta?.updatedAt)}</time>
          </div>
          <form className="search" role="search" onSubmit={submitSearch}>
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input ref={searchRef} name="stock-search" autoComplete="off" spellCheck={false} value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionIndex(0); setSearchMessage(""); }} onKeyDown={handleSearchKeyDown} placeholder="股票名称 / 代码…" aria-label="搜索股票，控制键加斜杠快速聚焦" aria-activedescendant={suggestions[suggestionIndex] ? `suggest-${keyOf(suggestions[suggestionIndex])}` : undefined} />
            {query && <button type="button" className="search-clear" aria-label="清空股票搜索" onClick={() => { setQuery(""); setSuggestions([]); setSearchMessage(""); }}>×</button>}
            {(searching || suggestions.length > 0 || searchMessage) && <div className="suggestions" aria-live="polite">
              {searching && <div className="suggest-status">正在检索市场…</div>}
              {!searching && searchMessage && <div className="suggest-status">{searchMessage}</div>}
              {!searching && suggestions.map((stock, index) => <button type="button" id={`suggest-${keyOf(stock)}`} className={suggestionIndex === index ? "active" : ""} key={keyOf(stock)} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => addStock(stock)}><span><strong>{stock.name}</strong><small>{stock.code}</small></span><em>{stock.market === 1 ? "沪市" : "深市"}</em></button>)}
              {!searching && <div className="search-shortcuts"><span>↑↓ 选择</span><span>回车添加</span><span>退出键关闭</span></div>}
            </div>}
          </form>
          <button type="button" className={`pause-button ${pollingPaused ? "active" : ""}`} onClick={() => setPollingPaused((current) => !current)} aria-pressed={pollingPaused} title="空格键暂停或恢复自动刷新">{pollingPaused ? "继续" : "暂停"}</button>
          <button type="button" className="refresh-button" onClick={refreshAll} disabled={refreshing} aria-label="立即刷新行情与分时图"><span className={refreshing ? "spin" : ""} aria-hidden="true">↻</span><b>刷新</b></button>
        </div>
      </header>

      <section className="market-strip" aria-label="市场脉搏">
        <div className="strip-label"><i aria-hidden="true" /> 市场脉搏</div>
        {indexStocks.length ? indexStocks.map((quote) => (
          <button type="button" key={keyOf(quote)} className="ticker" onClick={() => selectStock(keyOf(quote))}>
            <span>{quote.name}</span><strong>{number(quote.price)}</strong><em className={tone(quote.changePercent)}>{signed(quote.changePercent)}</em>
          </button>
        )) : <span className="strip-loading">正在连接行情源…</span>}
        <div className="turnover-summary" title={marketTurnover ? `当前 ${marketTurnover.currentDate} ${marketTurnover.pointTime}，对比 ${marketTurnover.previousDate} 同期` : "正在汇总沪深两市成交额"}>
          <span>两市成交额</span><strong>{marketTurnover ? marketAmount(marketTurnover.currentAmount) : "同步中…"}</strong>
          {marketTurnover && <em className={tone(marketTurnover.delta)}>{marketTurnover.delta >= 0 ? "较上日同期放量" : "较上日同期缩量"} {marketAmount(Math.abs(marketTurnover.delta))}（{signed(marketTurnover.deltaPercent)}）</em>}
        </div>
        <div className="source-note">全局取最差状态 · {feedModeLabel(meta?.mode)} · {feedAge(meta?.updatedAt)}</div>
      </section>

      {alerts.length > 0 && <section className="alert-tape" aria-label="行情异常提醒">
        <strong>提醒</strong>
        <div>{alerts.map((item) => <button type="button" key={item.key} className={item.tone} onClick={() => { if (item.stockKey) selectStock(item.stockKey); }}><i aria-hidden="true" />{item.label}</button>)}</div>
      </section>}

      {page === "watch" && <div className="watch-layout" id="main-content">
        <aside className={`watch-sidebar panel ${compactList ? "compact-list" : ""}`} title="拖动右下角可调整宽高">
          <div className="panel-title"><div><span>自选列表</span><strong>我的自选</strong></div><div className="panel-actions"><button type="button" className="screenshot-import-button" onClick={() => setScreenshotImportOpen(true)}>上传截图</button><button type="button" onClick={() => setCompactList((current) => !current)} aria-pressed={compactList}>{compactList ? "紧凑" : "舒展"}</button><em>{watchlist.length}</em></div></div>
          <div className="watch-groups" role="tablist" aria-label="自选股分组">
            <button type="button" role="tab" aria-selected={watchGroup === "main"} className={watchGroup === "main" ? "active" : ""} onClick={() => switchWatchGroup("main")}><span>自选股</span><em>{watchGroups.main.length}</em></button>
            <button type="button" role="tab" aria-selected={watchGroup === "etf"} className={watchGroup === "etf" ? "active" : ""} onClick={() => switchWatchGroup("etf")}><span>ETF组</span><em>{watchGroups.etf.length}</em></button>
          </div>
          <div className="watch-columns"><span>名称 / 代码</span><span>最新 / 涨幅</span><span>4分涨速</span></div>
          <div className="watch-sortbar" aria-label="自选股临时排序">
            {([ ["manual", "手动"], ["change", "涨幅"], ["speed", "4分"], ["amount", "成交额"] ] as Array<[WatchSort, string]>).map(([key, label]) => <button type="button" key={key} className={watchSort === key ? "active" : ""} aria-pressed={watchSort === key} onClick={() => setWatchSort(key)}>{label}</button>)}
          </div>
          <div className="watch-list">
            {displayedStocks.map((stock) => {
              const key = keyOf(stock); const quote = quotes[key];
              return <div key={key} draggable={watchSort === "manual"} onDragStart={() => { if (watchSort === "manual") dragged.current = key; }} onDragOver={(event) => { if (watchSort === "manual") event.preventDefault(); }} onDrop={() => { if (watchSort === "manual") dropOn(key); }}
                className={`watch-row ${activeKey === key ? "active" : ""}`} onContextMenu={(event) => { event.preventDefault(); setMenu({ key, x: event.clientX, y: event.clientY }); }}>
                <button type="button" className="watch-select" data-stock-key={key} aria-pressed={activeKey === key} onClick={() => selectStock(key)}>
                  <span className="stock-identity"><span><span>{pinned.has(key) ? "◆" : "◇"}</span><strong>{quote?.name || stock.name}</strong></span><small><span>{stock.code}</span>{quote?.limitState && quote.sealedAmount ? <b className={`limit-badge ${quote.limitState}`}>{quote.limitState === "up" ? "涨停" : "跌停"}封单 {amount(quote.sealedAmount)}</b> : null}</small></span>
                  <span className="stock-quote"><strong>{number(quote?.price)}</strong><span className={tone(quote?.changePercent)}>{signed(quote?.changePercent)}</span></span>
                  <span className={`stock-speed ${tone(speeds4m[key])}`}>{signed(speeds4m[key])}</span>
                </button>
                <button type="button" className="row-menu" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ key, x: rect.right - 150, y: rect.bottom + 6 }); }} aria-label={`${stock.name} 操作`}>•••</button>
              </div>;
            })}
            {!watchlist.length && <EmptyState title="自选列表为空" detail="在顶部搜索并添加股票" />}
          </div>
          <div className="sidebar-hint"><span>{watchSort === "manual" ? "拖动排序 · 右键管理" : "临时排序 · 手动顺序已保留"}</span><span>右下角可缩放</span></div>
        </aside>

        <main className="research-main">
          <section className="quote-hero panel" title="拖动右下角可调整宽高">
            {activeQuote ? <>
              <div className="quote-heading"><div className="quote-symbol"><div><h1>{activeQuote.name || activeStock?.name}</h1><p>{activeQuote.code} · {marketDescription(activeQuote.market)}</p></div></div><DataStamp meta={activeDetail?.meta || feedStates.detail} label="个股详情" compact /></div>
              <div className="price-cluster"><strong className={tone(activeQuote.changePercent)}>{number(activeQuote.price)}</strong><div className={tone(activeQuote.changePercent)}><span>{signed(activeQuote.changePercent)}</span><small>较前收 {number(activeQuote.prevClose)}</small></div></div>
              <div className="metric-grid">
                {[ ["今开", number(activeQuote.open)], ["最高涨幅", relativePercent(activeQuote.high, activeQuote.prevClose)], ["最低跌幅", relativePercent(activeQuote.low, activeQuote.prevClose)], ["涨速", signed(activeQuote.speed)], ["成交额", amount(activeQuote.amount)], ["换手率", signed(activeQuote.turnover)], ["总市值", marketAmount(activeQuote.marketCap)] ].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            </> : <div className="hero-loading" role="status" aria-label="正在加载个股行情"><div /><div /><div /></div>}
          </section>

          <section className="chart-panel panel" title="拖动右下角可调整宽高">
            <div className="section-head"><div><span>行情走势</span><strong>{chartMode === "time" ? "盘中走势" : "日线结构"}</strong></div><div className="chart-head-actions"><button type="button" className="rail-toggle" onClick={() => setRailOpen((current) => !current)} aria-pressed={railOpen}>辅助栏</button><div className="chart-switch"><button type="button" aria-pressed={chartMode === "time"} className={chartMode === "time" ? "active" : ""} onClick={() => setChartMode("time")}>分时</button><button type="button" aria-pressed={chartMode === "day"} className={chartMode === "day" ? "active" : ""} onClick={() => setChartMode("day")}>日K</button></div></div></div>
            <div className="chart-legend"><span><i className="price-line" />最新价</span>{chartMode === "time" && <><span><i className="avg-line" />均价</span><span><i className="close-line" />昨收</span><span><i className="volume-line" />成交量</span></>}<em>{chartMode === "time" ? "新增分时节点时更新 · 重点行情约1秒" : "日K按需加载"} · 最近点 {chartLastPoint || "—"}</em></div>
            <MarketChart key={`${activeKey}-${chartMode}`} detail={visibleChartDetail} mode={chartMode} />
          </section>
        </main>

        <aside className={`insight-rail ${railOpen ? "open" : ""}`}>
          <section className="panel pulse-card" title="拖动右下角可调整宽高"><div className="section-head compact"><div><span>市场快照</span><strong>指数快照</strong></div></div>{indexStocks.map((quote) => <button key={keyOf(quote)} onClick={() => selectStock(keyOf(quote))}><div><span>{quote.name}</span><strong>{number(quote.price)}</strong></div><Sparkline values={[0, quote.speed || 0, (quote.changePercent || 0) * .6, quote.changePercent || 0]} value={quote.changePercent} /><em className={tone(quote.changePercent)}>{signed(quote.changePercent)}</em></button>)}</section>
          <section className="panel reliability-card" title="拖动右下角可调整宽高"><div className="section-head compact"><div><span>数据状态</span><strong>刷新环境</strong></div></div><div className="health-score"><strong>{connection === "online" ? "优" : connection === "stale" ? "缓" : connection === "offline" ? "断" : "—"}</strong><div><span>{connection === "online" ? "各模块正常" : connection === "stale" ? "存在过期缓存" : connection === "offline" ? "部分数据不可用" : "等待连接"}</span><p>全局按最差模块状态显示</p></div></div><div className="feed-ledger">{Object.entries(feedStates).map(([key, value]) => <DataStamp key={key} meta={value} label={value?.label || FEED_LABELS[key as FeedKey]} compact />)}</div></section>
          <section className="panel note-card" title="拖动右下角可调整宽高"><span>使用说明</span><p>暖色表示上涨，青色表示下跌。数据仅供研究，不构成投资建议；上游中断时会标记来源、时间与数据年龄。</p><kbd>控制键加斜杠搜索 · 数字键 1/2/3 切换页面 · 空格键暂停</kbd></section>
        </aside>
      </div>}

      {page === "capital" && <CapitalPage updateConnection={updateConnection} />}
      {page === "rankings" && <RankingsPage onPick={addStock} updateConnection={updateConnection} />}

      {menu && <div className="context-menu" role="menu" aria-label="自选股操作" style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}>
        <button type="button" role="menuitem" onClick={() => togglePin(menu.key)}><span aria-hidden="true">◆</span>{pinned.has(menu.key) ? "取消固定" : "固定置顶"}</button>
        <button type="button" role="menuitem" onClick={() => moveStock(menu.key, "top")}><span aria-hidden="true">↑</span>移至顶部</button>
        <button type="button" role="menuitem" onClick={() => moveStock(menu.key, "bottom")}><span aria-hidden="true">↓</span>移至底部</button>
        <button type="button" role="menuitem" className="danger" onClick={() => removeStock(menu.key)}><span aria-hidden="true">×</span>删除自选</button>
      </div>}
      <WatchlistImportDialog open={screenshotImportOpen} groupLabel={watchGroup === "main" ? "自选股" : "ETF组"} onClose={closeScreenshotImport} onImport={importStocks} />
      {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
    </div>
  );
}

function SectorPage({ onPick, updateConnection }: { onPick: (stock: Stock) => void; updateConnection: (meta: MarketMeta, feed?: FeedKey) => void }) {
  const [type, setType] = useState<"concept" | "industry">("concept");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [active, setActive] = useState<Sector | null>(null);
  const [stocks, setStocks] = useState<SectorStock[]>([]);
  const [sort, setSort] = useState<"change" | "speed" | "inflow">("change");
  const [stockSort, setStockSort] = useState<"change" | "speed" | "inflow">("change");
  const [descending, setDescending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailNonce, setDetailNonce] = useState(0);
  const [error, setError] = useState("");
  const [sectorMeta, setSectorMeta] = useState<MarketMeta | null>(null);
  const [detailMeta, setDetailMeta] = useState<MarketMeta | null>(null);
  const sectorStockCache = useRef(new Map<string, { items: SectorStock[]; sector?: { change: number | null; inflow: number | null } }>());
  const detailMetaRef = useRef<MarketMeta | null>(null);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    fetchJson<{ items: Sector[]; meta: MarketMeta }>(`/api/market?action=sectors&type=${type}`)
      .then((data) => { if (!cancelled) { setSectors(data.items); setActive(data.items[0] || null); setSectorMeta(data.meta); updateConnection(data.meta, "sectors"); } })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : "板块数据加载失败"); const failed = { mode: "offline" as const, updatedAt: 0, source: "板块行情暂不可用" }; setSectorMeta(failed); updateConnection(failed, "sectors"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, updateConnection]);

  useEffect(() => {
    if (!active) { setStocks([]); return; }
    let cancelled = false;
    const activeCode = active.code;
    const cached = sectorStockCache.current.get(activeCode);
    setStocks(cached?.items ?? []);
    setDetailError("");
    setDetailLoading(true);
    const load = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const data = await fetchJson<{ items: SectorStock[]; sector?: { change: number | null; inflow: number | null }; meta: MarketMeta }>(`/api/market?action=sector-stocks&code=${activeCode}`, 6_000);
          if (!data.items.length) throw new Error("成分股暂未返回");
          if (cancelled) return;
          sectorStockCache.current.set(activeCode, { items: data.items, sector: data.sector });
          setStocks(data.items);
          setDetailMeta(data.meta); detailMetaRef.current = data.meta;
          if (data.sector) {
            setSectors((current) => current.map((sector) => sector.code === activeCode ? { ...sector, ...data.sector } : sector));
            setActive((current) => current?.code === activeCode ? { ...current, ...data.sector } : current);
          }
          setDetailError("");
          updateConnection(data.meta, "sector-detail");
          return;
        } catch (nextError) {
          lastError = nextError;
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 450));
        }
      }
      if (cancelled) return;
      if (cached?.items.length) { setDetailError("网络波动，正在显示本次访问中最近成功的数据"); const stale = { mode: "stale" as const, updatedAt: detailMetaRef.current?.updatedAt || 0, source: detailMetaRef.current?.source || "板块成分缓存" }; setDetailMeta(stale); updateConnection(stale, "sector-detail"); }
      else {
        setStocks([]);
        setDetailError(lastError instanceof Error ? lastError.message : "成分股连接失败");
        const failed = { mode: "offline" as const, updatedAt: 0, source: "板块成分暂不可用" }; setDetailMeta(failed); updateConnection(failed, "sector-detail");
      }
    };
    load().finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [active?.code, detailNonce, updateConnection]);

  const metricAvailable = useMemo(() => ({
    change: sectors.some((sector) => Number.isFinite(sector.change)),
    speed: sectors.some((sector) => Number.isFinite(sector.speed)),
    inflow: sectors.some((sector) => Number.isFinite(sector.inflow)),
  }), [sectors]);
  const validMetricCount = sectors.filter((sector) => Number.isFinite(sector.change) || Number.isFinite(sector.speed) || Number.isFinite(sector.inflow)).length;
  const sortedSectors = useMemo(() => metricAvailable[sort] ? [...sectors].sort((a, b) => ((b[sort] ?? Number.NEGATIVE_INFINITY) - (a[sort] ?? Number.NEGATIVE_INFINITY)) * (descending ? 1 : -1)) : sectors, [descending, metricAvailable, sectors, sort]);
  const sortedStocks = useMemo(() => [...stocks].sort((a, b) => ((b[stockSort] || 0) - (a[stockSort] || 0))), [stockSort, stocks]);
  const changeSort = (next: typeof sort) => { if (sort === next) setDescending((value) => !value); else { setSort(next); setDescending(true); } };

  return <div className="sector-layout" id="main-content">
    <aside className="sector-sidebar panel">
      <div className="panel-title"><div><span>板块列表</span><strong>板块强弱</strong></div><em>{sectors.length}</em></div>
      <div className="segmented"><button type="button" aria-pressed={type === "concept"} className={type === "concept" ? "active" : ""} onClick={() => setType("concept")}>概念板块</button><button type="button" aria-pressed={type === "industry"} className={type === "industry" ? "active" : ""} onClick={() => setType("industry")}>行业板块</button></div>
      <DataStamp meta={sectorMeta} label="板块列表" compact />
      <div className={`sector-data-state ${validMetricCount ? "available" : "classification-only"}`}><strong>{validMetricCount ? `${validMetricCount}/${sectors.length} 个板块有实时指标` : "板块行情暂不可用"}</strong><span>{validMetricCount ? "排序只基于有效行情" : "当前仅显示行业分类缓存，排序已停用"}</span></div>
      <div className="sector-sort"><span>排序</span><button disabled={!metricAvailable.change} className={sort === "change" ? "active" : ""} onClick={() => changeSort("change")}>涨幅 {sort === "change" && metricAvailable.change ? descending ? "↓" : "↑" : ""}</button><button disabled={!metricAvailable.speed} className={sort === "speed" ? "active" : ""} onClick={() => changeSort("speed")}>涨速</button><button disabled={!metricAvailable.inflow} className={sort === "inflow" ? "active" : ""} onClick={() => changeSort("inflow")}>净流入</button></div>
      <div className="sector-list" aria-label="板块列表">{loading ? <LoadingRows count={10} /> : error ? <EmptyState title="板块连接失败" detail={error} /> : !sortedSectors.length ? <EmptyState title="暂无可用板块" detail="实时分类数据正在恢复" /> : sortedSectors.map((sector, index) => <button type="button" key={sector.code} aria-pressed={active?.code === sector.code} className={active?.code === sector.code ? "active" : ""} onClick={() => setActive(sector)}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{sector.name}</strong><small>{Number.isFinite(sector.inflow) ? amount(sector.inflow) : "仅分类"}</small></span><b className={tone(sector.change)}>{signed(sector.change)}</b></button>)}</div>
    </aside>
    <main className="sector-main panel">
      <div className="sector-hero"><div><span>{type === "concept" ? "概念板块" : "行业板块"} · {active?.code || "—"}</span><h1>{active?.name || "选择一个板块"}</h1><p>{type === "industry" ? "参考同花顺行业分类 · 已合并重复层级" : "参考同花顺概念分类 · 已排除涨停、新高等行情标签"}</p></div>{active && <div className="sector-stat"><span>板块涨幅</span><strong className={tone(active.change)}>{Number.isFinite(active.change) ? signed(active.change) : "行情待恢复"}</strong><em>净流入 {amount(active.inflow)}</em></div>}</div>
      <div className="table-toolbar"><div><strong>成分股</strong><span>{detailLoading && !stocks.length ? "连接中…" : `${stocks.length} 支`}</span></div><DataStamp meta={detailMeta} label="板块成分" compact /><div className="table-sorts"><button className={stockSort === "change" ? "active" : ""} onClick={() => setStockSort("change")}>涨幅</button><button className={stockSort === "speed" ? "active" : ""} onClick={() => setStockSort("speed")}>涨速</button><button className={stockSort === "inflow" ? "active" : ""} onClick={() => setStockSort("inflow")}>资金</button></div></div>
      <div className="stock-table"><div className="table-head"><span>排名</span><span>股票</span><span>最新价</span><span>涨跌幅</span><span>涨速</span><span>主力净流入</span><span /></div>{detailLoading && !stocks.length ? <LoadingRows count={6} /> : detailError && !stocks.length ? <div className="sector-detail-error"><strong>成分股暂时没有返回</strong><span>{detailError}</span><button onClick={() => setDetailNonce((value) => value + 1)}>立即重试</button></div> : <>{detailError && <div className="sector-cache-note"><span>{detailError}</span><button onClick={() => setDetailNonce((value) => value + 1)}>重新连接</button></div>}{sortedStocks.map((stock, index) => <button className="table-row" key={`${stock.market}.${stock.code}`} onClick={() => onPick(stock)}><span>{String(index + 1).padStart(2, "0")}</span><span><strong>{stock.name}</strong><small>{stock.code}</small></span><span>{number(stock.price)}</span><span className={tone(stock.change)}>{signed(stock.change)}</span><span className={tone(stock.speed)}>{signed(stock.speed)}</span><span className={tone(stock.inflow)}>{amount(stock.inflow)}</span><span>＋自选</span></button>)}</>}</div>
    </main>
  </div>;
}

function RankingsPage({ onPick, updateConnection }: { onPick: (stock: Stock) => void; updateConnection: (meta: MarketMeta, feed?: FeedKey) => void }) {
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dataRef = useRef<RankingData | null>(null);
  const load = useCallback(async () => {
    if (!dataRef.current) setLoading(true);
    try {
      let next: RankingData;
      try {
        next = await fetchDirectRankings();
      } catch {
        next = await fetchJson<RankingData>("/api/market?action=rankings", 12_000, 0);
      }
      dataRef.current = next;
      setData(next);
      setError("");
      updateConnection(next.meta, "rankings");
    } catch (err) {
      const previous = dataRef.current;
      setError(err instanceof Error ? err.message : "涨跌排行加载失败");
      updateConnection({ mode: previous ? "stale" : "offline", updatedAt: previous?.meta.updatedAt || 0, source: previous?.meta.source || "涨跌排行暂不可用" }, "rankings");
    } finally {
      setLoading(false);
    }
  }, [updateConnection]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await load();
      if (!cancelled) timer = window.setTimeout(tick, isAShareTrading() ? 5_000 : 15_000);
    };
    tick();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [load]);

  const board = (title: string, description: string, items: Quote[], direction: "up" | "down") => <section className="ranking-board panel">
    <div className="ranking-board-head">
      <div><span>{description}</span><strong>{title}</strong></div>
      <em className={direction}>{items.length} 只</em>
    </div>
    <div className="ranking-columns" aria-hidden="true"><span>排名</span><span>股票 / 所属板块</span><span>最新价</span><span>涨跌幅</span><span>成交额</span><span>总市值</span></div>
    <div className="ranking-list" aria-label={title}>
      {loading && !items.length ? <LoadingRows count={12} /> : items.map((stock, index) => <button type="button" className="ranking-row" key={keyOf(stock)} onClick={() => onPick(stock)} title={`查看 ${stock.name} 详情`}>
        <span>{String(index + 1).padStart(3, "0")}</span>
        <span className="ranking-stock"><span className="ranking-name-line"><strong>{stock.name}</strong><em title={stock.sector || "板块待更新"}>{stock.sector || "板块待更新"}</em></span><small>{stock.code}</small></span>
        <span>{number(stock.price)}</span>
        <span className={tone(stock.changePercent)}>{signed(stock.changePercent)}</span>
        <span>{amount(stock.amount)}</span>
        <span>{marketAmount(stock.marketCap)}</span>
      </button>)}
      {!loading && !items.length && <EmptyState title={`${title}暂无数据`} detail="行情源正在恢复，请稍后重试" />}
    </div>
  </section>;

  return <main className="rankings-page" id="main-content">
    <header className="rankings-header panel">
      <div><span>沪深A股实时排序</span><h1>涨跌排行</h1><p>按当前涨跌幅排序，点击任意股票可进入个股详情。</p></div>
      <div className="rankings-status"><DataStamp meta={data?.meta} label="涨跌排行" compact /><button type="button" onClick={load} disabled={loading}>{loading ? "同步中…" : "立即刷新"}</button></div>
    </header>
    {error && <div className="ranking-warning" role="status"><strong>{data ? "榜单刷新暂时中断" : "榜单连接失败"}</strong><span>{error}{data ? "，当前保留最近一次有效结果。" : ""}</span></div>}
    <div className="rankings-grid">
      {board("涨幅前100", "上涨领先", data?.gainers || [], "up")}
      {board("跌幅前100", "下跌领先", data?.losers || [], "down")}
    </div>
  </main>;
}

function CapitalPage({ updateConnection }: { updateConnection: (meta: MarketMeta, feed?: FeedKey) => void }) {
  const [data, setData] = useState<CapitalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dataRef = useRef<CapitalData | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const next = await fetchJson<CapitalData>("/api/market?action=capital"); dataRef.current = next; setData(next); updateConnection(next.meta, "capital"); }
    catch (err) { const previous = dataRef.current; setError(err instanceof Error ? err.message : "资金数据加载失败"); updateConnection({ mode: previous ? "stale" : "offline", updatedAt: previous?.meta.updatedAt || 0, source: previous?.meta.source || "资金流暂不可用" }, "capital"); }
    finally { setLoading(false); }
  }, [updateConnection]);
  useEffect(() => { load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000); return () => window.clearInterval(timer); }, [load]);
  const mainNet = data?.flow.at(-1)?.main ?? null;
  if (loading && !data) return <div className="capital-layout" id="main-content"><section className="capital-main panel"><LoadingRows count={12} /></section></div>;
  if (error && !data) return <div className="capital-layout" id="main-content"><section className="capital-main panel"><EmptyState title="资金流连接失败" detail={error} /><button type="button" className="retry" onClick={load}>重新连接</button></section></div>;
  return <div className="capital-layout" id="main-content">
    <main className="capital-main panel">
      <div className="capital-hero"><div><span>资金流向 · 000300</span><h1>沪深300资金温度</h1><p>主力资金净流入逐分钟累计值</p><DataStamp meta={data?.meta} label="资金流向" compact /></div><div className="capital-price"><small>{data?.quote.name}</small><strong>{number(data?.quote.price)}</strong><em className={tone(data?.quote.changePercent)}>{signed(data?.quote.changePercent)}</em></div></div>
      <div className="capital-kpis"><div><span>主力净流入</span><strong className={tone(mainNet)}>{amount(mainNet)}</strong><em>当前累计</em></div><div><span>沪深300涨幅</span><strong className={tone(data?.quote.changePercent)}>{signed(data?.quote.changePercent)}</strong><em>指数表现</em></div><div><span>行情涨速</span><strong className={tone(data?.quote.speed)}>{signed(data?.quote.speed)}</strong><em>短时动量</em></div><div><span>最近同步</span><strong>{shortTime(data?.meta.updatedAt)}</strong><em>{data?.meta.mode === "stale" ? "缓存保护" : "实时数据"}</em></div></div>
      <div className="flow-card"><div className="section-head"><div><span>盘中主力资金</span><strong>主力资金轨迹</strong></div><button onClick={load} disabled={loading}>{loading ? "同步中…" : "重新同步"}</button></div><FlowChart rows={data?.flow || []} /></div>
    </main>
    <aside className="capital-rank panel"><div className="panel-title"><div><span>行业资金</span><strong>行业资金榜</strong></div><em>前5名</em></div><div className="flow-ranks"><section><div className="rank-title up"><span>▲</span><strong>净流入领先</strong></div>{data?.inflow.map((item, index) => <div className="rank-row" key={item.code}><em>{index + 1}</em><span>{item.name}</span><strong className="up">{amount(item.amount)}</strong></div>)}</section><section><div className="rank-title down"><span>▼</span><strong>净流出领先</strong></div>{data?.outflow.map((item, index) => <div className="rank-row" key={item.code}><em>{index + 1}</em><span>{item.name}</span><strong className="down">{amount(item.amount)}</strong></div>)}</section></div><div className="rank-note"><strong>口径说明</strong><p>主力净流入来自行情源资金流接口；榜单按申万/东财行业板块净额排序，显示当前累计值。</p></div></aside>
  </div>;
}
