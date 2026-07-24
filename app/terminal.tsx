"use client";

import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type PageKey = "watch" | "sector" | "capital";
type ChartMode = "time" | "day";
type MarketMeta = { mode: "live" | "cache" | "stale" | "offline"; updatedAt: number; source: string };
type Stock = { code: string; market: number; name: string };
type Quote = Stock & {
  price: number | null; changePercent: number | null; speed: number | null; high?: number | null;
  low?: number | null; open?: number | null; prevClose?: number | null; volume?: number | null;
  amount?: number | null; turnover?: number | null; amplitude?: number | null; netInflow?: number | null;
};
type Trend = { time: string; price: number | null; average: number | null; volume: number | null; amount: number | null };
type Kline = { date: string; open: number | null; close: number | null; high: number | null; low: number | null; volume: number | null; amount: number | null; changePercent: number | null };
type Detail = { quote: Quote; trends: Trend[]; klines: Kline[]; preClose: number | null; meta: MarketMeta };
type Sector = { code: string; name: string; change: number | null; speed: number | null; inflow: number | null };
type SectorStock = Stock & { price: number | null; change: number | null; speed: number | null; inflow: number | null };
type CapitalData = {
  quote: Quote;
  flow: Array<{ time: string; main: number | null; small: number | null; medium: number | null; large: number | null }>;
  inflow: Array<{ code: string; name: string; amount: number | null }>;
  outflow: Array<{ code: string; name: string; amount: number | null }>;
  meta: MarketMeta;
};

const DEFAULT_STOCKS: Stock[] = [
  { code: "000001", market: 1, name: "上证指数" }, { code: "399001", market: 0, name: "深证成指" },
  { code: "KS11", market: 100, name: "韩国KOSPI" }, { code: "601869", market: 1, name: "长飞光纤" },
  { code: "603019", market: 1, name: "中科曙光" }, { code: "000938", market: 0, name: "紫光股份" },
  { code: "001309", market: 0, name: "德明利" }, { code: "002384", market: 0, name: "东山精密" },
  { code: "002156", market: 0, name: "通富微电" }, { code: "300394", market: 0, name: "天孚通信" },
  { code: "300502", market: 0, name: "新易盛" }, { code: "600183", market: 1, name: "生益科技" },
  { code: "000725", market: 0, name: "京东方A" }, { code: "300308", market: 0, name: "中际旭创" },
  { code: "000988", market: 0, name: "华工科技" }, { code: "000977", market: 0, name: "浪潮信息" },
  { code: "600206", market: 1, name: "有研新材" }, { code: "002916", market: 0, name: "深南电路" },
  { code: "002409", market: 0, name: "雅克科技" }, { code: "002281", market: 0, name: "光迅科技" },
  { code: "600584", market: 1, name: "长电科技" }, { code: "603986", market: 1, name: "兆易创新" },
  { code: "600487", market: 1, name: "亨通光电" }, { code: "588060", market: 1, name: "科创50ETF" },
];
const DEFAULT_PINNED = ["1.000001", "0.399001", "100.KS11", "1.601869", "1.603019"];
const WATCHLIST_KEY = "xinghai_watchlist_v1";
const PINNED_KEY = "xinghai_pinned_v1";

const keyOf = (stock: Pick<Stock, "market" | "code">) => `${stock.market}.${stock.code}`;
const signed = (value: number | null | undefined, suffix = "%") => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const tone = (value: number | null | undefined) => value === null || value === undefined || value === 0 ? "flat" : value > 0 ? "up" : "down";
const number = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const amount = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return value.toFixed(0);
};
const shortTime = (stamp?: number) => stamp ? new Date(stamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";

async function fetchJson<T>(url: string, timeout = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "数据服务暂不可用");
    return body as T;
  } finally {
    clearTimeout(timer);
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
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
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

function MarketChart({ detail, mode }: { detail: Detail | null; mode: ChartMode }) {
  const ref = useCanvas((ctx, width, height) => {
    const pad = { l: 48, r: 18, t: 24, b: 36 };
    grid(ctx, width, height, pad);
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
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

      ctx.textAlign = "right"; ctx.fillStyle = "#7f8fa1";
      ctx.fillText(max.toFixed(2), pad.l - 8, pad.t + 4);
      ctx.fillText(base.toFixed(2), pad.l - 8, y(base) + 4);
      ctx.fillText(min.toFixed(2), pad.l - 8, height - pad.b);
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
        const color = up ? "#f05f68" : "#32b68a";
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
  return <canvas className="market-canvas" ref={ref} aria-label={mode === "time" ? "分时走势" : "日K走势"} />;
}

function Sparkline({ values, value }: { values: number[]; value: number | null | undefined }) {
  const ref = useCanvas((ctx, width, height) => {
    if (values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, 0.01);
    const color = (value || 0) >= 0 ? "#f05f68" : "#32b68a";
    ctx.beginPath();
    values.forEach((item, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = 4 + ((max - item) / span) * (height - 8);
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
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
    const color = last >= 0 ? "#f05f68" : "#32b68a";
    const gradient = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
    gradient.addColorStop(0, `${color}44`); gradient.addColorStop(1, `${color}00`);
    ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
    ctx.lineTo(x(values.length - 1), height - pad.b); ctx.lineTo(pad.l, height - pad.b); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#7f8fa1"; ctx.font = "11px ui-monospace, Consolas, monospace"; ctx.textAlign = "right";
    ctx.fillText(`${(maxAbs / 1e8).toFixed(0)}亿`, pad.l - 8, pad.t + 4); ctx.fillText("0", pad.l - 8, y(0) + 4); ctx.fillText(`${(-maxAbs / 1e8).toFixed(0)}亿`, pad.l - 8, height - pad.b);
    ctx.textAlign = "center";
    [0, Math.floor(rows.length / 2), rows.length - 1].forEach((index) => rows[index] && ctx.fillText(rows[index].time.slice(11, 16), x(index), height - 10));
  }, [rows]);
  return <canvas ref={ref} className="flow-canvas" aria-label="沪深300主力资金净流入曲线" />;
}

function LoadingRows({ count = 7 }: { count?: number }) {
  return <div className="loading-rows" aria-label="加载中">{Array.from({ length: count }, (_, index) => <div className="loading-row" key={index} />)}</div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-orbit">◎</div><strong>{title}</strong><span>{detail}</span></div>;
}

export function StockTerminal() {
  const [page, setPage] = useState<PageKey>("watch");
  const [watchlist, setWatchlist] = useState<Stock[]>(DEFAULT_STOCKS);
  const [pinned, setPinned] = useState<Set<string>>(new Set(DEFAULT_PINNED));
  const [hydrated, setHydrated] = useState(false);
  const [activeKey, setActiveKey] = useState(keyOf(DEFAULT_STOCKS[0]));
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("time");
  const [meta, setMeta] = useState<MarketMeta | null>(null);
  const [connection, setConnection] = useState<"loading" | "online" | "stale" | "offline">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Stock[]>([]);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const dragged = useRef<string | null>(null);
  const quoteRequest = useRef(0);
  const detailRequest = useRef(0);
  const quoteBusy = useRef(false);
  const detailBusy = useRef<string | null>(null);

  useEffect(() => {
    try {
      const storedStocks = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "null");
      const storedPinned = JSON.parse(localStorage.getItem(PINNED_KEY) || "null");
      if (Array.isArray(storedStocks) && storedStocks.length) {
        setWatchlist(storedStocks);
        setActiveKey(keyOf(storedStocks[0]));
      }
      if (Array.isArray(storedPinned)) setPinned(new Set(storedPinned));
    } catch { /* Ignore invalid browser storage. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(pinned)));
  }, [hydrated, pinned, watchlist]);

  const displayedStocks = useMemo(() => [
    ...watchlist.filter((stock) => pinned.has(keyOf(stock))),
    ...watchlist.filter((stock) => !pinned.has(keyOf(stock))),
  ], [pinned, watchlist]);

  const activeStock = watchlist.find((stock) => keyOf(stock) === activeKey) || watchlist[0] || null;
  const activeQuote = detail?.quote || (activeStock ? quotes[keyOf(activeStock)] : null);

  const updateConnection = useCallback((nextMeta: MarketMeta) => {
    setMeta(nextMeta);
    setConnection(nextMeta.mode === "stale" ? "stale" : "online");
  }, []);

  const refreshQuotes = useCallback(async (silent = false) => {
    if (!watchlist.length) return;
    if (silent && quoteBusy.current) return;
    const requestId = ++quoteRequest.current;
    quoteBusy.current = true;
    if (!silent) setRefreshing(true);
    try {
      const secids = watchlist.map(keyOf).join(",");
      const data = await fetchJson<{ items: Quote[]; meta: MarketMeta }>(`/api/market?action=quotes&secids=${encodeURIComponent(secids)}`);
      if (requestId !== quoteRequest.current) return;
      setQuotes((current) => {
        const next = { ...current };
        data.items.forEach((item) => {
          const local = watchlist.find((stock) => keyOf(stock) === keyOf(item));
          next[keyOf(item)] = { ...item, name: item.name || local?.name || item.code };
        });
        return next;
      });
      updateConnection(data.meta);
    } catch (error) {
      if (requestId === quoteRequest.current) {
        setConnection(Object.keys(quotes).length ? "stale" : "offline");
        if (!silent) setNotice(error instanceof Error ? error.message : "刷新失败");
      }
    } finally {
      if (requestId === quoteRequest.current) quoteBusy.current = false;
      if (!silent) setRefreshing(false);
    }
  }, [quotes, updateConnection, watchlist]);

  useEffect(() => { refreshQuotes(); }, [watchlist.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshQuotes(true);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshQuotes]);

  const refreshDetail = useCallback(async (silent = false) => {
    const stock = watchlist.find((item) => keyOf(item) === activeKey) || watchlist[0];
    if (!stock) { setDetail(null); return; }
    const stockKey = keyOf(stock);
    if (silent && detailBusy.current === stockKey) return;
    const requestId = ++detailRequest.current;
    detailBusy.current = stockKey;
    try {
      const data = await fetchJson<Detail>(`/api/market?action=detail&secid=${encodeURIComponent(stockKey)}`);
      if (requestId !== detailRequest.current) return;
      setDetail(data);
      updateConnection(data.meta);
    } catch (error) {
      if (requestId === detailRequest.current && !silent) {
        setNotice(error instanceof Error ? error.message : "个股数据加载失败");
      }
    } finally {
      if (requestId === detailRequest.current) detailBusy.current = null;
    }
  }, [activeKey, updateConnection, watchlist]);

  useEffect(() => {
    setDetail(null);
    refreshDetail(false);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (page === "watch" && document.visibilityState === "visible") refreshDetail(true);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [page, refreshDetail]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshQuotes(true), refreshDetail(true)]);
    setRefreshing(false);
  }, [refreshDetail, refreshQuotes]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!query.trim() || /^\d{6}$/.test(query.trim())) { setSuggestions([]); setSearching(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/market?action=search&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok) setSuggestions(data.items || []);
      } catch { /* A later keystroke cancels the previous search. */ }
      finally { setSearching(false); }
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const addStock = useCallback((stock: Stock) => {
    const key = keyOf(stock);
    setWatchlist((current) => current.some((item) => keyOf(item) === key) ? current : [...current, stock]);
    setActiveKey(key);
    setQuery(""); setSuggestions([]); setPage("watch");
    setNotice(watchlist.some((item) => keyOf(item) === key) ? "已在自选列表中" : `已添加 ${stock.name}`);
  }, [watchlist]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (suggestions[0]) { addStock(suggestions[0]); return; }
    if (/^\d{6}$/.test(value)) {
      const market = /^(6|5|9)/.test(value) ? 1 : 0;
      addStock({ code: value, market, name: value });
    } else if (value) setNotice("请输入六位代码，或从搜索结果中选择");
  };

  const removeStock = (key: string) => {
    setWatchlist((current) => {
      const next = current.filter((stock) => keyOf(stock) !== key);
      if (activeKey === key) setActiveKey(next[0] ? keyOf(next[0]) : "");
      return next;
    });
    setPinned((current) => { const next = new Set(current); next.delete(key); return next; });
    setMenu(null);
  };

  const moveStock = (key: string, target: "top" | "bottom") => {
    setWatchlist((current) => {
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
    setWatchlist((current) => {
      const next = [...current];
      const from = next.findIndex((stock) => keyOf(stock) === sourceKey);
      const to = next.findIndex((stock) => keyOf(stock) === targetKey);
      if (from < 0 || to < 0) return current;
      const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
    });
    dragged.current = null;
  };

  const indexStocks = [quotes["1.000001"], quotes["0.399001"], quotes["100.KS11"]].filter(Boolean);
  const chartLastPoint = chartMode === "time"
    ? detail?.trends.at(-1)?.time?.split(" ").at(-1)?.slice(0, 8)
    : detail?.klines.at(-1)?.date;

  return (
    <div className="terminal-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><span />〈</div>
          <div><strong>星辰大海</strong><small>MARKET INTELLIGENCE</small></div>
        </div>
        <nav className="main-tabs" aria-label="主要页面">
          {([ ["watch", "自选行情"], ["sector", "板块雷达"], ["capital", "资金流向"] ] as Array<[PageKey, string]>).map(([key, label]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)}>{label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <div className={`network-pill ${connection}`} title="页面保留最近一次成功数据，失败时不会伪造更新时间">
            <i />
            <span>{connection === "loading" ? "连接中" : connection === "online" ? "实时同步" : connection === "stale" ? "沿用缓存" : "网络中断"}</span>
            <time>{shortTime(meta?.updatedAt)}</time>
          </div>
          <form className="search" onSubmit={submitSearch}>
            <span className="search-icon">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="股票名称 / 代码" aria-label="搜索股票" />
            {query && <button type="button" className="search-clear" onClick={() => { setQuery(""); setSuggestions([]); }}>×</button>}
            {(searching || suggestions.length > 0) && <div className="suggestions">
              {searching && <div className="suggest-status">正在检索市场…</div>}
              {!searching && suggestions.map((stock) => <button type="button" key={keyOf(stock)} onClick={() => addStock(stock)}><span><strong>{stock.name}</strong><small>{stock.code}</small></span><em>{stock.market === 1 ? "沪市" : "深市"}</em></button>)}
            </div>}
          </form>
          <button className="refresh-button" onClick={refreshAll} disabled={refreshing} aria-label="立即刷新行情与分时图"><span className={refreshing ? "spin" : ""}>↻</span><b>刷新</b></button>
        </div>
      </header>

      <div className="market-strip">
        <div className="strip-label"><i /> 市场脉搏</div>
        {indexStocks.length ? indexStocks.map((quote) => (
          <button key={keyOf(quote)} className="ticker" onClick={() => { setPage("watch"); setActiveKey(keyOf(quote)); }}>
            <span>{quote.name}</span><strong>{number(quote.price)}</strong><em className={tone(quote.changePercent)}>{signed(quote.changePercent)}</em>
          </button>
        )) : <span className="strip-loading">正在连接行情源…</span>}
        <div className="source-note">数据源 {meta?.source || "东方财富"} · 3秒自动刷新</div>
      </div>

      {page === "watch" && <div className="watch-layout">
        <aside className="watch-sidebar panel">
          <div className="panel-title"><div><span>WATCHLIST</span><strong>我的自选</strong></div><em>{watchlist.length}</em></div>
          <div className="watch-columns"><span>名称 / 代码</span><span>最新 / 涨幅</span></div>
          <div className="watch-list">
            {displayedStocks.map((stock) => {
              const key = keyOf(stock); const quote = quotes[key];
              return <div key={key} draggable onDragStart={() => { dragged.current = key; }} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(key)}
                className={`watch-row ${activeKey === key ? "active" : ""}`} onClick={() => setActiveKey(key)} onContextMenu={(event) => { event.preventDefault(); setMenu({ key, x: event.clientX, y: event.clientY }); }}>
                <div className="stock-identity"><div><span>{pinned.has(key) ? "◆" : "◇"}</span><strong>{quote?.name || stock.name}</strong></div><small>{stock.code}<em>{stock.market === 1 ? "SH" : stock.market === 0 ? "SZ" : "KR"}</em></small></div>
                <div className="stock-quote"><strong>{number(quote?.price)}</strong><span className={tone(quote?.changePercent)}>{signed(quote?.changePercent)}</span></div>
                <button className="row-menu" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ key, x: rect.right - 150, y: rect.bottom + 6 }); }} aria-label={`${stock.name} 操作`}>•••</button>
              </div>;
            })}
            {!watchlist.length && <EmptyState title="自选列表为空" detail="在顶部搜索并添加股票" />}
          </div>
          <div className="sidebar-hint"><span>拖动排序</span><span>右键管理</span></div>
        </aside>

        <main className="research-main">
          <section className="quote-hero panel">
            {activeQuote ? <>
              <div className="quote-heading"><div className="quote-symbol"><span>{activeQuote.market === 1 ? "SH" : activeQuote.market === 0 ? "SZ" : "KR"}</span><div><h1>{activeQuote.name || activeStock?.name}</h1><p>{activeQuote.code} · {activeQuote.market === 100 ? "韩国交易所" : "人民币普通股"}</p></div></div><div className="quote-updated"><i className={connection === "online" ? "live" : ""} />行情时间 {shortTime(detail?.meta.updatedAt || meta?.updatedAt)}</div></div>
              <div className="price-cluster"><strong className={tone(activeQuote.changePercent)}>{number(activeQuote.price)}</strong><div className={tone(activeQuote.changePercent)}><span>{signed(activeQuote.changePercent)}</span><small>较前收 {number(activeQuote.prevClose)}</small></div></div>
              <div className="metric-grid">
                {[ ["今开", number(activeQuote.open)], ["最高", number(activeQuote.high)], ["最低", number(activeQuote.low)], ["涨速", signed(activeQuote.speed)], ["成交额", amount(activeQuote.amount)], ["换手率", signed(activeQuote.turnover)] ].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            </> : <div className="hero-loading"><div /><div /><div /></div>}
          </section>

          <section className="chart-panel panel">
            <div className="section-head"><div><span>PRICE ACTION</span><strong>{chartMode === "time" ? "盘中走势" : "日线结构"}</strong></div><div className="chart-switch"><button className={chartMode === "time" ? "active" : ""} onClick={() => setChartMode("time")}>分时</button><button className={chartMode === "day" ? "active" : ""} onClick={() => setChartMode("day")}>日K</button></div></div>
            <div className="chart-legend"><span><i className="price-line" />最新价</span>{chartMode === "time" && <span><i className="avg-line" />均价</span>}<em>{detail?.meta.mode === "stale" ? `上游波动 · 最近行情点 ${chartLastPoint || "—"}` : `${chartMode === "time" ? "实时行情点" : "最新交易日"} ${chartLastPoint || "—"} · 3秒更新`}</em></div>
            <MarketChart detail={detail} mode={chartMode} />
          </section>
        </main>

        <aside className="insight-rail">
          <section className="panel pulse-card"><div className="section-head compact"><div><span>MARKET PULSE</span><strong>指数快照</strong></div></div>{indexStocks.map((quote) => <button key={keyOf(quote)} onClick={() => setActiveKey(keyOf(quote))}><div><span>{quote.name}</span><strong>{number(quote.price)}</strong></div><Sparkline values={[0, quote.speed || 0, (quote.changePercent || 0) * .6, quote.changePercent || 0]} value={quote.changePercent} /><em className={tone(quote.changePercent)}>{signed(quote.changePercent)}</em></button>)}</section>
          <section className="panel reliability-card"><div className="section-head compact"><div><span>DATA HEALTH</span><strong>刷新环境</strong></div></div><div className="health-score"><strong>{connection === "online" ? "A" : connection === "stale" ? "B" : "—"}</strong><div><span>{connection === "online" ? "连接稳定" : connection === "stale" ? "容错保护中" : "等待连接"}</span><p>超时重试 · 请求合并 · 旧值保留</p></div></div><ul><li><span>浏览器跨域</span><b>已隔离</b></li><li><span>失败数据</span><b>不覆盖</b></li><li><span>页面隐藏</span><b>暂停轮询</b></li></ul></section>
          <section className="panel note-card"><span>使用说明</span><p>红涨绿跌。数据仅供研究，不构成投资建议；若上游中断，页面会明确标记并保留最近一次成功结果。</p></section>
        </aside>
      </div>}

      {page === "sector" && <SectorPage onPick={(stock) => addStock(stock)} updateConnection={updateConnection} />}
      {page === "capital" && <CapitalPage updateConnection={updateConnection} />}

      {menu && <div className="context-menu" style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => togglePin(menu.key)}><span>◆</span>{pinned.has(menu.key) ? "取消固定" : "固定置顶"}</button>
        <button onClick={() => moveStock(menu.key, "top")}><span>↑</span>移至顶部</button>
        <button onClick={() => moveStock(menu.key, "bottom")}><span>↓</span>移至底部</button>
        <button className="danger" onClick={() => removeStock(menu.key)}><span>×</span>删除自选</button>
      </div>}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function SectorPage({ onPick, updateConnection }: { onPick: (stock: Stock) => void; updateConnection: (meta: MarketMeta) => void }) {
  const [type, setType] = useState<"concept" | "industry">("concept");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [active, setActive] = useState<Sector | null>(null);
  const [stocks, setStocks] = useState<SectorStock[]>([]);
  const [sort, setSort] = useState<"change" | "speed" | "inflow">("change");
  const [stockSort, setStockSort] = useState<"change" | "speed" | "inflow">("change");
  const [descending, setDescending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    fetchJson<{ items: Sector[]; meta: MarketMeta }>(`/api/market?action=sectors&type=${type}`)
      .then((data) => { if (!cancelled) { setSectors(data.items); setActive(data.items[0] || null); updateConnection(data.meta); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "板块数据加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, updateConnection]);

  useEffect(() => {
    if (!active) { setStocks([]); return; }
    let cancelled = false; setDetailLoading(true);
    fetchJson<{ items: SectorStock[]; meta: MarketMeta }>(`/api/market?action=sector-stocks&code=${active.code}`)
      .then((data) => { if (!cancelled) { setStocks(data.items); updateConnection(data.meta); } })
      .catch(() => { if (!cancelled) setStocks([]); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [active, updateConnection]);

  const sortedSectors = useMemo(() => [...sectors].sort((a, b) => ((b[sort] || 0) - (a[sort] || 0)) * (descending ? 1 : -1)), [descending, sectors, sort]);
  const sortedStocks = useMemo(() => [...stocks].sort((a, b) => ((b[stockSort] || 0) - (a[stockSort] || 0))), [stockSort, stocks]);
  const changeSort = (next: typeof sort) => { if (sort === next) setDescending((value) => !value); else { setSort(next); setDescending(true); } };

  return <div className="sector-layout">
    <aside className="sector-sidebar panel">
      <div className="panel-title"><div><span>SECTOR RADAR</span><strong>板块强弱</strong></div><em>{sectors.length}</em></div>
      <div className="segmented"><button className={type === "concept" ? "active" : ""} onClick={() => setType("concept")}>概念板块</button><button className={type === "industry" ? "active" : ""} onClick={() => setType("industry")}>行业板块</button></div>
      <div className="sector-sort"><span>排序</span><button className={sort === "change" ? "active" : ""} onClick={() => changeSort("change")}>涨幅 {sort === "change" ? descending ? "↓" : "↑" : ""}</button><button className={sort === "speed" ? "active" : ""} onClick={() => changeSort("speed")}>涨速</button><button className={sort === "inflow" ? "active" : ""} onClick={() => changeSort("inflow")}>净流入</button></div>
      <div className="sector-list">{loading ? <LoadingRows count={10} /> : error ? <EmptyState title="板块连接失败" detail={error} /> : sortedSectors.map((sector, index) => <button key={sector.code} className={active?.code === sector.code ? "active" : ""} onClick={() => setActive(sector)}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{sector.name}</strong><small>{amount(sector.inflow)}</small></span><b className={tone(sector.change)}>{signed(sector.change)}</b></button>)}</div>
    </aside>
    <main className="sector-main panel">
      <div className="sector-hero"><div><span>{type === "concept" ? "CONCEPT" : "INDUSTRY"} / {active?.code || "—"}</span><h1>{active?.name || "选择一个板块"}</h1><p>板块成分股实时横向比较</p></div>{active && <div className="sector-stat"><span>板块涨幅</span><strong className={tone(active.change)}>{signed(active.change)}</strong><em>净流入 {amount(active.inflow)}</em></div>}</div>
      <div className="table-toolbar"><div><strong>成分股</strong><span>{stocks.length} 支</span></div><div className="table-sorts"><button className={stockSort === "change" ? "active" : ""} onClick={() => setStockSort("change")}>涨幅</button><button className={stockSort === "speed" ? "active" : ""} onClick={() => setStockSort("speed")}>涨速</button><button className={stockSort === "inflow" ? "active" : ""} onClick={() => setStockSort("inflow")}>资金</button></div></div>
      <div className="stock-table"><div className="table-head"><span>排名</span><span>股票</span><span>最新价</span><span>涨跌幅</span><span>涨速</span><span>主力净流入</span><span /></div>{detailLoading ? <LoadingRows count={9} /> : sortedStocks.map((stock, index) => <button className="table-row" key={`${stock.market}.${stock.code}`} onClick={() => onPick(stock)}><span>{String(index + 1).padStart(2, "0")}</span><span><strong>{stock.name}</strong><small>{stock.code}</small></span><span>{number(stock.price)}</span><span className={tone(stock.change)}>{signed(stock.change)}</span><span className={tone(stock.speed)}>{signed(stock.speed)}</span><span className={tone(stock.inflow)}>{amount(stock.inflow)}</span><span>＋自选</span></button>)}</div>
    </main>
  </div>;
}

function CapitalPage({ updateConnection }: { updateConnection: (meta: MarketMeta) => void }) {
  const [data, setData] = useState<CapitalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const next = await fetchJson<CapitalData>("/api/market?action=capital"); setData(next); updateConnection(next.meta); }
    catch (err) { setError(err instanceof Error ? err.message : "资金数据加载失败"); }
    finally { setLoading(false); }
  }, [updateConnection]);
  useEffect(() => { load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000); return () => window.clearInterval(timer); }, [load]);
  const mainNet = data?.flow.at(-1)?.main ?? null;
  if (loading && !data) return <div className="capital-layout"><section className="capital-main panel"><LoadingRows count={12} /></section></div>;
  if (error && !data) return <div className="capital-layout"><section className="capital-main panel"><EmptyState title="资金流连接失败" detail={error} /><button className="retry" onClick={load}>重新连接</button></section></div>;
  return <div className="capital-layout">
    <main className="capital-main panel">
      <div className="capital-hero"><div><span>CAPITAL FLOW / 000300</span><h1>沪深300资金温度</h1><p>主力资金净流入逐分钟累计值</p></div><div className="capital-price"><small>{data?.quote.name}</small><strong>{number(data?.quote.price)}</strong><em className={tone(data?.quote.changePercent)}>{signed(data?.quote.changePercent)}</em></div></div>
      <div className="capital-kpis"><div><span>主力净流入</span><strong className={tone(mainNet)}>{amount(mainNet)}</strong><em>当前累计</em></div><div><span>沪深300涨幅</span><strong className={tone(data?.quote.changePercent)}>{signed(data?.quote.changePercent)}</strong><em>指数表现</em></div><div><span>行情涨速</span><strong className={tone(data?.quote.speed)}>{signed(data?.quote.speed)}</strong><em>短时动量</em></div><div><span>最近同步</span><strong>{shortTime(data?.meta.updatedAt)}</strong><em>{data?.meta.mode === "stale" ? "缓存保护" : "实时数据"}</em></div></div>
      <div className="flow-card"><div className="section-head"><div><span>INTRADAY MAIN FLOW</span><strong>主力资金轨迹</strong></div><button onClick={load} disabled={loading}>{loading ? "同步中…" : "重新同步"}</button></div><FlowChart rows={data?.flow || []} /></div>
    </main>
    <aside className="capital-rank panel"><div className="panel-title"><div><span>SECTOR FLOW</span><strong>行业资金榜</strong></div><em>TOP 5</em></div><div className="flow-ranks"><section><div className="rank-title up"><span>▲</span><strong>净流入领先</strong></div>{data?.inflow.map((item, index) => <div className="rank-row" key={item.code}><em>{index + 1}</em><span>{item.name}</span><strong className="up">{amount(item.amount)}</strong></div>)}</section><section><div className="rank-title down"><span>▼</span><strong>净流出领先</strong></div>{data?.outflow.map((item, index) => <div className="rank-row" key={item.code}><em>{index + 1}</em><span>{item.name}</span><strong className="down">{amount(item.amount)}</strong></div>)}</section></div><div className="rank-note"><strong>口径说明</strong><p>主力净流入来自行情源资金流接口；榜单按申万/东财行业板块净额排序，显示当前累计值。</p></div></aside>
  </div>;
}
