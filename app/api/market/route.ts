export const runtime = "nodejs";
export const preferredRegion = "hkg1";

type CacheMode = "live" | "cache" | "stale";

type CacheEntry = {
  value: unknown;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
};

const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<{ value: any; fetchedAt: number; mode: CacheMode }>>();
const EASTMONEY = "https://push2.eastmoney.com/api/qt";
const EASTMONEY_HISTORY = "https://push2his.eastmoney.com/api/qt";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type RequestOptions = { attempts?: number; timeoutMs?: number };

async function resilientJson(url: string, ttlMs = 8_000, options: RequestOptions = {}) {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached && cached.freshUntil > now) {
    return { value: cached.value, fetchedAt: cached.fetchedAt, mode: "cache" as CacheMode };
  }

  const pending = inflight.get(url);
  if (pending) return pending;

  const request = (async () => {
    let lastError: unknown;
    const attempts = options.attempts ?? 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_500);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json,text/plain,*/*" },
        });
        if (!response.ok) throw new Error(`上游服务返回 ${response.status}`);
        const value = await response.json();
        if (!value || (typeof value === "object" && "rc" in value && value.rc !== 0)) {
          throw new Error("上游数据暂不可用");
        }
        const fetchedAt = Date.now();
        responseCache.set(url, {
          value,
          fetchedAt,
          freshUntil: fetchedAt + ttlMs,
          staleUntil: fetchedAt + Math.max(180_000, ttlMs * 20),
        });
        return { value, fetchedAt, mode: "live" as CacheMode };
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await sleep(260 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }

    const fallback = responseCache.get(url);
    if (fallback && fallback.staleUntil > Date.now()) {
      return { value: fallback.value, fetchedAt: fallback.fetchedAt, mode: "stale" as CacheMode };
    }
    throw lastError instanceof Error ? lastError : new Error("行情网络暂不可用");
  })();

  inflight.set(url, request);
  try {
    return await request;
  } finally {
    inflight.delete(url);
  }
}

async function resilientText(url: string, ttlMs = 8_000, options: RequestOptions = {}) {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached && cached.freshUntil > now && typeof cached.value === "string") {
    return { value: cached.value, fetchedAt: cached.fetchedAt, mode: "cache" as CacheMode };
  }
  let lastError: unknown;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_500);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "*/*", Referer: "https://finance.sina.com.cn/" },
      });
      if (!response.ok) throw new Error(`备用行情返回 ${response.status}`);
      const value = await response.text();
      if (!value) throw new Error("备用行情为空");
      const fetchedAt = Date.now();
      responseCache.set(url, { value, fetchedAt, freshUntil: fetchedAt + ttlMs, staleUntil: fetchedAt + Math.max(180_000, ttlMs * 20) });
      return { value, fetchedAt, mode: "live" as CacheMode };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(260 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  const fallback = responseCache.get(url);
  if (fallback && fallback.staleUntil > Date.now() && typeof fallback.value === "string") {
    return { value: fallback.value, fetchedAt: fallback.fetchedAt, mode: "stale" as CacheMode };
  }
  throw lastError instanceof Error ? lastError : new Error("备用行情暂不可用");
}

async function resilientTencentText(url: string, ttlMs = 8_000, options: RequestOptions = {}) {
  const cacheKey = `tencent:${url}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.freshUntil > now && typeof cached.value === "string") {
    return { value: cached.value, fetchedAt: cached.fetchedAt, mode: "cache" as CacheMode };
  }

  let lastError: unknown;
  const attempts = options.attempts ?? 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_500);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "*/*",
          Referer: "https://stockapp.finance.qq.com/",
          "User-Agent": "Mozilla/5.0 (compatible; XinghaiMarketDesk/1.0)",
        },
      });
      if (!response.ok) throw new Error(`腾讯行情返回 ${response.status}`);
      const value = new TextDecoder("gbk").decode(await response.arrayBuffer());
      if (!value.includes("v_")) throw new Error("腾讯行情为空");
      const fetchedAt = Date.now();
      responseCache.set(cacheKey, {
        value,
        fetchedAt,
        freshUntil: fetchedAt + ttlMs,
        staleUntil: fetchedAt + Math.max(180_000, ttlMs * 20),
      });
      return { value, fetchedAt, mode: "live" as CacheMode };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(180 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  const fallback = responseCache.get(cacheKey);
  if (fallback && fallback.staleUntil > Date.now() && typeof fallback.value === "string") {
    return { value: fallback.value, fetchedAt: fallback.fetchedAt, mode: "stale" as CacheMode };
  }
  throw lastError instanceof Error ? lastError : new Error("腾讯行情暂不可用");
}

async function resilientThsText(url: string, ttlMs = 8_000, options: RequestOptions = {}) {
  const cacheKey = `ths:${url}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.freshUntil > now && typeof cached.value === "string") {
    return { value: cached.value, fetchedAt: cached.fetchedAt, mode: "cache" as CacheMode };
  }
  let lastError: unknown;
  const attempts = options.attempts ?? 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "*/*",
          Referer: "https://q.10jqka.com.cn/",
          "User-Agent": "Mozilla/5.0 (compatible; XinghaiMarketDesk/1.0)",
        },
      });
      if (!response.ok) throw new Error(`同花顺行情返回 ${response.status}`);
      const value = await response.text();
      if (!value) throw new Error("同花顺行情为空");
      const fetchedAt = Date.now();
      responseCache.set(cacheKey, { value, fetchedAt, freshUntil: fetchedAt + ttlMs, staleUntil: fetchedAt + Math.max(180_000, ttlMs * 20) });
      return { value, fetchedAt, mode: "live" as CacheMode };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(260 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  const fallback = responseCache.get(cacheKey);
  if (fallback && fallback.staleUntil > Date.now() && typeof fallback.value === "string") {
    return { value: fallback.value, fetchedAt: fallback.fetchedAt, mode: "stale" as CacheMode };
  }
  throw lastError instanceof Error ? lastError : new Error("同花顺行情暂不可用");
}

async function resilientGbkText(url: string, ttlMs = 30_000, options: RequestOptions = {}) {
  const cacheKey = `gbk:${url}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.freshUntil > now && typeof cached.value === "string") {
    return { value: cached.value, fetchedAt: cached.fetchedAt, mode: "cache" as CacheMode };
  }
  let lastError: unknown;
  const attempts = options.attempts ?? 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://q.10jqka.com.cn/",
          "User-Agent": "Mozilla/5.0 (compatible; XinghaiMarketDesk/1.0)",
        },
      });
      if (!response.ok) throw new Error(`同花顺分类返回 ${response.status}`);
      const value = new TextDecoder("gbk").decode(await response.arrayBuffer());
      if (!value.includes("<html")) throw new Error("同花顺分类为空");
      const fetchedAt = Date.now();
      responseCache.set(cacheKey, { value, fetchedAt, freshUntil: fetchedAt + ttlMs, staleUntil: fetchedAt + Math.max(300_000, ttlMs * 20) });
      return { value, fetchedAt, mode: "live" as CacheMode };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(320 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  const fallback = responseCache.get(cacheKey);
  if (fallback && fallback.staleUntil > Date.now() && typeof fallback.value === "string") {
    return { value: fallback.value, fetchedAt: fallback.fetchedAt, mode: "stale" as CacheMode };
  }
  throw lastError instanceof Error ? lastError : new Error("同花顺分类暂不可用");
}

function htmlCellText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlCells(row: string) {
  return Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi), (match) => htmlCellText(match[1]));
}

function parseSinaJsonp(text: string) {
  const marker = "callback(";
  const start = text.indexOf(marker);
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("备用行情格式异常");
  return JSON.parse(text.slice(start + marker.length, end));
}

function metaFrom(...results: Array<{ fetchedAt: number; mode: CacheMode }>) {
  const mode: CacheMode = results.some((item) => item.mode === "stale")
    ? "stale"
    : results.every((item) => item.mode === "cache")
      ? "cache"
      : "live";
  return {
    mode,
    updatedAt: Math.min(...results.map((item) => item.fetchedAt)),
    source: "东方财富",
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function parseQuote(item: Record<string, unknown>) {
  return {
    code: String(item.f12 ?? item.f57 ?? ""),
    market: Number(item.f13 ?? 0),
    name: String(item.f14 ?? item.f58 ?? ""),
    price: numeric(item.f2 ?? item.f43),
    changePercent: numeric(item.f3 ?? item.f170),
    speed: numeric(item.f22),
    high: numeric(item.f15 ?? item.f44),
    low: numeric(item.f16 ?? item.f45),
    open: numeric(item.f17 ?? item.f46),
    prevClose: numeric(item.f18 ?? item.f60),
    volume: numeric(item.f5 ?? item.f47),
    amount: numeric(item.f6 ?? item.f48),
    marketCap: numeric(item.f20),
    turnover: numeric(item.f8 ?? item.f168),
    amplitude: numeric(item.f7 ?? item.f171),
    netInflow: numeric(item.f62),
    limitUp: numeric(item.f51),
    limitDown: numeric(item.f52),
    limitState: null as "up" | "down" | null,
    sealedAmount: null as number | null,
  };
}

function normalizeSecids(raw: string | null) {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter((item) => /^\d{1,3}\.[A-Z0-9]{4,8}$/i.test(item)).slice(0, 80);
}

function parseSinaQuotes(text: string, requested: string[]) {
  const requestedBySymbol = new Map<string, string>();
  requested.forEach((secid) => {
    const [market, code] = secid.split(".");
    if (market === "1" && /^\d{6}$/.test(code)) requestedBySymbol.set(`sh${code}`, secid);
    if (market === "0" && /^\d{6}$/.test(code)) requestedBySymbol.set(`sz${code}`, secid);
    if (market === "100" && code === "KS11") requestedBySymbol.set("b_KOSPI", secid);
    if (market === "101" && code === "CNOW") requestedBySymbol.set("hf_CHA50CFD", secid);
  });
  const items: ReturnType<typeof parseQuote>[] = [];
  const pattern = /var\s+hq_str_(sh\d{6}|sz\d{6}|b_KOSPI|hf_CHA50CFD)="([^"]*)";/g;
  for (const match of text.matchAll(pattern)) {
    const secid = requestedBySymbol.get(match[1]);
    if (!secid) continue;
    const [marketText, code] = secid.split(".");
    const parts = match[2].split(",");
    if (match[1] === "hf_CHA50CFD") {
      const price = numeric(parts[0]);
      const prevClose = numeric(parts[7]);
      items.push({
        code,
        market: Number(marketText),
        name: "富时A50期指",
        price,
        changePercent: price !== null && prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null,
        speed: null,
        high: numeric(parts[4]),
        low: numeric(parts[5]),
        open: numeric(parts[8]),
        prevClose,
        volume: numeric(parts[9]),
        amount: null,
        marketCap: null,
        turnover: null,
        amplitude: prevClose && prevClose > 0 && numeric(parts[4]) !== null && numeric(parts[5]) !== null
          ? (((numeric(parts[4]) as number) - (numeric(parts[5]) as number)) / prevClose) * 100
          : null,
        netInflow: null,
        limitUp: null,
        limitDown: null,
        limitState: null,
        sealedAmount: null,
      });
      continue;
    }
    if (match[1] === "b_KOSPI") {
      items.push({
        code,
        market: Number(marketText),
        name: "",
        price: numeric(parts[1]),
        changePercent: numeric(parts[3]),
        speed: null,
        high: numeric(parts[10]),
        low: numeric(parts[11]),
        open: numeric(parts[8]),
        prevClose: numeric(parts[9]),
        volume: numeric(parts[12]),
        amount: null,
        marketCap: null,
        turnover: null,
        amplitude: null,
        netInflow: null,
        limitUp: null,
        limitDown: null,
        limitState: null,
        sealedAmount: null,
      });
      continue;
    }
    const open = numeric(parts[1]);
    const prevClose = numeric(parts[2]);
    const current = numeric(parts[3]);
    const price = current && current > 0 ? current : prevClose;
    const changePercent = price !== null && prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
    const bidOneVolume = numeric(parts[10]);
    const bidOnePrice = numeric(parts[11]);
    const askOneVolume = numeric(parts[20]);
    const askOnePrice = numeric(parts[21]);
    const samePrice = (left: number | null, right: number | null) => left !== null && right !== null && Math.abs(left - right) < 0.001;
    const limitState: "up" | "down" | null = price !== null && prevClose !== null && price > prevClose && samePrice(bidOnePrice, price) && (!askOnePrice || askOnePrice <= 0)
      ? "up"
      : price !== null && prevClose !== null && price < prevClose && samePrice(askOnePrice, price) && (!bidOnePrice || bidOnePrice <= 0)
        ? "down"
        : null;
    const sealedAmount = limitState === "up" && bidOneVolume !== null && price !== null
      ? bidOneVolume * price
      : limitState === "down" && askOneVolume !== null && price !== null
        ? askOneVolume * price
        : null;
    items.push({
      code,
      market: Number(marketText),
      name: "",
      price,
      changePercent,
      speed: null,
      high: numeric(parts[4]),
      low: numeric(parts[5]),
      open,
      prevClose,
      volume: numeric(parts[8]),
      amount: numeric(parts[9]),
      marketCap: null,
      turnover: null,
      amplitude: prevClose && prevClose > 0 && numeric(parts[4]) !== null && numeric(parts[5]) !== null
        ? (((numeric(parts[4]) as number) - (numeric(parts[5]) as number)) / prevClose) * 100
        : null,
      netInflow: null,
      limitUp: null,
      limitDown: null,
      limitState,
      sealedAmount,
    });
  }
  return items;
}

function parseTencentQuotes(text: string, requested: string[]) {
  const requestedBySymbol = new Map<string, string>();
  requested.forEach((secid) => {
    const [market, code] = secid.split(".");
    if (market === "1" && /^\d{6}$/.test(code)) requestedBySymbol.set(`sh${code}`, secid);
    if (market === "0" && /^\d{6}$/.test(code)) requestedBySymbol.set(`sz${code}`, secid);
  });

  const items: ReturnType<typeof parseQuote>[] = [];
  const pattern = /v_(sh\d{6}|sz\d{6})="([^"]*)";/g;
  for (const match of text.matchAll(pattern)) {
    const secid = requestedBySymbol.get(match[1]);
    if (!secid) continue;
    const [marketText, code] = secid.split(".");
    const parts = match[2].split("~");
    const price = numeric(parts[3]);
    const prevClose = numeric(parts[4]);
    const high = numeric(parts[33]);
    const low = numeric(parts[34]);
    const limitUp = numeric(parts[47]);
    const limitDown = numeric(parts[48]);
    const bidOneVolume = numeric(parts[10]);
    const askOneVolume = numeric(parts[20]);
    const samePrice = (left: number | null, right: number | null) => left !== null && right !== null && Math.abs(left - right) < 0.005;
    const limitState: "up" | "down" | null = samePrice(price, limitUp)
      ? "up"
      : samePrice(price, limitDown)
        ? "down"
        : null;
    const sealedAmount = limitState === "up" && bidOneVolume !== null && price !== null
      ? bidOneVolume * price * 100
      : limitState === "down" && askOneVolume !== null && price !== null
        ? askOneVolume * price * 100
        : null;
    const amountWan = numeric(parts[37]);
    const marketCapYi = numeric(parts[45]);
    items.push({
      code,
      market: Number(marketText),
      name: String(parts[1] ?? ""),
      price: price && price > 0 ? price : prevClose,
      changePercent: numeric(parts[32]),
      speed: null,
      high,
      low,
      open: numeric(parts[5]),
      prevClose,
      volume: numeric(parts[36] || parts[6]),
      amount: amountWan === null ? null : amountWan * 10_000,
      marketCap: marketCapYi === null ? null : marketCapYi * 100_000_000,
      turnover: numeric(parts[38]),
      amplitude: numeric(parts[43]),
      netInflow: null,
      limitUp,
      limitDown,
      limitState,
      sealedAmount,
    });
  }
  return items;
}

function parseThsJsonp(text: string) {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("同花顺行情格式异常");
  return JSON.parse(text.slice(start + 1, end));
}

function parseThsIndexQuote(text: string, secid: string) {
  const payload = parseThsJsonp(text);
  const row = payload?.items ?? {};
  const [marketText, code] = secid.split(".");
  const price = numeric(row["10"]);
  const prevClose = numeric(row["6"]);
  const high = numeric(row["8"]);
  const low = numeric(row["9"]);
  return {
    code,
    market: Number(marketText),
    name: String(row.name ?? ""),
    price,
    changePercent: price !== null && prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null,
    speed: null,
    high,
    low,
    open: numeric(row["7"]),
    prevClose,
    volume: numeric(row["13"]),
    amount: numeric(row["19"]),
    marketCap: null,
    turnover: null,
    amplitude: prevClose && prevClose > 0 && high !== null && low !== null ? ((high - low) / prevClose) * 100 : null,
    netInflow: null,
    limitUp: null,
    limitDown: null,
    limitState: null,
    sealedAmount: null,
  };
}

function parseThsIndexTrends(text: string) {
  const payload = parseThsJsonp(text);
  const data = Object.values(payload ?? {})[0] as { date?: string; data?: string } | undefined;
  const date = String(data?.date ?? "");
  return String(data?.data ?? "").split(";").map((row) => {
    const parts = row.split(",");
    return {
      time: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${parts[0]?.slice(0, 2)}:${parts[0]?.slice(2, 4)}`,
      price: numeric(parts[1]),
      average: null,
      volume: numeric(parts[4]),
      amount: numeric(parts[2]),
    };
  }).filter((item) => item.price !== null);
}

async function quotes(secids: string[]) {
  if (!secids.length) return { items: [], meta: { mode: "live", updatedAt: Date.now(), source: "腾讯行情" } };
  type QuoteBatch = {
    items: ReturnType<typeof parseQuote>[];
    results: Array<{ value: unknown; fetchedAt: number; mode: CacheMode }>;
    source: string;
  };

  const aShareSecids = secids.filter((secid) => /^[01]\.\d{6}$/.test(secid));
  const legacySecids = secids.filter((secid) => /^(100|101)\./.test(secid));
  const thsSecids = secids.filter((secid) => /^102\.\d{6}$/.test(secid));

  const loadTencentQuotes = async (requested: string[]): Promise<QuoteBatch> => {
    const symbols = requested.map((secid) => {
      const [market, code] = secid.split(".");
      return market === "1" ? `sh${code}` : market === "0" ? `sz${code}` : "";
    }).filter(Boolean);
    if (!symbols.length) return { items: [], results: [], source: "腾讯行情" };
    const result = await resilientTencentText(`https://web.sqt.gtimg.cn/q=${symbols.join(",")}`, 2_000, { attempts: 1, timeoutMs: 1_800 });
    return { items: parseTencentQuotes(result.value, requested), results: [result], source: "腾讯行情" };
  };

  const loadSpecialQuotes = async (): Promise<QuoteBatch> => {
    const tasks: Array<Promise<{ result: Awaited<ReturnType<typeof resilientText>> | Awaited<ReturnType<typeof resilientThsText>>; secids: string[]; type: "sina" | "ths" }>> = [];
    if (legacySecids.length) {
      const symbols = legacySecids.map((secid) => secid === "100.KS11" ? "b_KOSPI" : secid === "101.CNOW" ? "hf_CHA50CFD" : "").filter(Boolean);
      if (symbols.length) tasks.push(
        resilientText(`https://hq.sinajs.cn/list=${symbols.join(",")}`, 2_000, { attempts: 1, timeoutMs: 900 })
          .then((result) => ({ result, secids: legacySecids, type: "sina" as const })),
      );
    }
    thsSecids.forEach((secid) => {
      const code = secid.split(".")[1];
      tasks.push(
        resilientThsText(`https://d.10jqka.com.cn/v2/realhead/48_${code}/last.js`, 2_000, { attempts: 1, timeoutMs: 900 })
          .then((result) => ({ result, secids: [secid], type: "ths" as const })),
      );
    });
    const settled = await Promise.allSettled(tasks);
    const results: QuoteBatch["results"] = [];
    const items: QuoteBatch["items"] = [];
    const sources: string[] = [];
    settled.forEach((entry) => {
      if (entry.status !== "fulfilled") return;
      results.push(entry.value.result);
      if (entry.value.type === "sina") {
        items.push(...parseSinaQuotes(entry.value.result.value, entry.value.secids));
        sources.push("新浪行情");
      } else {
        items.push(parseThsIndexQuote(entry.value.result.value, entry.value.secids[0]));
        sources.push("同花顺");
      }
    });
    return { items, results, source: Array.from(new Set(sources)).join(" + ") };
  };

  const loadEastmoneyQuotes = async (requested: string[]): Promise<QuoteBatch> => {
    const fields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f20,f22,f62";
    const chunks: string[][] = [];
    for (let index = 0; index < requested.length; index += 6) chunks.push(requested.slice(index, index + 6));
    const settled = await Promise.allSettled(chunks.map((chunk) => {
      const url = `${EASTMONEY}/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${encodeURIComponent(chunk.join(","))}`;
      return resilientJson(url, 2_000, { attempts: 1, timeoutMs: 2_400 });
    }));
    const results = settled
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof resilientJson>>> => result.status === "fulfilled")
      .map((result) => result.value);
    if (!results.length) throw new Error("东方财富行情暂不可用");
    const items = results.flatMap((result) => (result.value?.data?.diff ?? [])
      .map((item: Record<string, unknown>) => parseQuote(item))
      .filter((item: ReturnType<typeof parseQuote>) => item.code));
    return { items, results, source: "东方财富" };
  };

  const primary = await Promise.allSettled([loadTencentQuotes(aShareSecids), loadSpecialQuotes()]);
  const quoteMap = new Map<string, ReturnType<typeof parseQuote>>();
  const results: QuoteBatch["results"] = [];
  const sources: string[] = [];
  primary.forEach((entry) => {
    if (entry.status !== "fulfilled") return;
    entry.value.items.forEach((item) => quoteMap.set(`${item.market}.${item.code}`, item));
    results.push(...entry.value.results);
    if (entry.value.source) sources.push(entry.value.source);
  });

  const missingAShares = aShareSecids.filter((secid) => !quoteMap.has(secid));
  if (missingAShares.length) {
    const fallback = await Promise.allSettled([
      (async (): Promise<QuoteBatch> => {
        const symbols = missingAShares.map((secid) => `${secid.startsWith("1.") ? "sh" : "sz"}${secid.split(".")[1]}`);
        const result = await resilientText(`https://hq.sinajs.cn/list=${symbols.join(",")}`, 2_000, { attempts: 1, timeoutMs: 1_200 });
        return { items: parseSinaQuotes(result.value, missingAShares), results: [result], source: "新浪行情" };
      })(),
      loadEastmoneyQuotes(missingAShares),
    ]);
    fallback.forEach((entry) => {
      if (entry.status !== "fulfilled") return;
      entry.value.items.forEach((item) => quoteMap.set(`${item.market}.${item.code}`, item));
      results.push(...entry.value.results);
      sources.push(entry.value.source);
    });
  }

  const items = secids.map((secid) => quoteMap.get(secid)).filter((item): item is ReturnType<typeof parseQuote> => Boolean(item));
  if (!items.length || !results.length) throw new Error("自选行情暂时无法连接");
  const meta = metaFrom(...results);
  return {
    items,
    meta: {
      ...meta,
      mode: items.length < secids.length ? "stale" as CacheMode : meta.mode,
      source: Array.from(new Set(sources)).join(" + "),
    },
  };
}

async function detail(secid: string, since = "", includeKline = true) {
  if (!/^\d{1,3}\.[A-Z0-9]{4,8}$/i.test(secid)) throw new Error("证券代码格式不正确");
  const [specialMarketText, specialCode] = secid.split(".");
  const specialMarket = Number(specialMarketText);
  if (specialMarket === 101 || specialMarket === 102) {
    const quoteData = await quotes([secid]);
    const quote = quoteData.items[0];
    if (!quote) throw new Error("指数行情暂时无法连接");
    let trends: Array<{ time: string; price: number | null; average: number | null; volume: number | null; amount: number | null }> = [];
    let trendMeta: { fetchedAt: number; mode: CacheMode } | null = null;
    if (specialMarket === 102) {
      try {
        const result = await resilientThsText(`https://d.10jqka.com.cn/v6/time/48_${specialCode}/last.js`, 2_000, { attempts: 2, timeoutMs: 3_200 });
        trends = parseThsIndexTrends(result.value);
        trendMeta = result;
      } catch { /* The live quote remains useful if minute history is temporarily unavailable. */ }
    }
    return {
      quote,
      trends: since ? trends.filter((row) => row.time > since) : trends,
      klines: [],
      preClose: quote.prevClose,
      meta: trendMeta
        ? { ...metaFrom(trendMeta), source: specialMarket === 102 ? "同花顺" : quoteData.meta.source }
        : quoteData.meta,
    };
  }

  if (specialMarket === 0 || specialMarket === 1) {
    const symbol = `${specialMarket === 1 ? "sh" : "sz"}${specialCode}`;
    const quotePromise = resilientTencentText(`https://web.sqt.gtimg.cn/q=${symbol}`, 2_000, { attempts: 1, timeoutMs: 1_800 });
    const trendPromise = resilientJson(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`, 2_000, { attempts: 1, timeoutMs: 1_800 });
    const klinePromise = includeKline
      ? resilientJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,45,qfq`, 90_000, { attempts: 1, timeoutMs: 2_000 })
      : Promise.resolve(null);
    const [quoteSettled, trendSettled, klineSettled] = await Promise.allSettled([quotePromise, trendPromise, klinePromise]);
    const quoteResult = quoteSettled.status === "fulfilled" ? quoteSettled.value : null;
    const trendResult = trendSettled.status === "fulfilled" ? trendSettled.value : null;
    const klineResult = klineSettled.status === "fulfilled" ? klineSettled.value : null;
    const quote = quoteResult ? parseTencentQuotes(quoteResult.value, [secid])[0] : null;
    const minutePayload = trendResult?.value?.data?.[symbol]?.data;
    const minuteDate = String(minutePayload?.date ?? "");
    const trends = ((minutePayload?.data ?? []) as string[]).map((row) => {
      const parts = row.split(" ");
      const hhmm = String(parts[0] ?? "");
      const clock = Number(hhmm);
      const volume = numeric(parts[2]);
      const amount = numeric(parts[3]);
      return {
        hhmm,
        clock,
        time: `${minuteDate.slice(0, 4)}-${minuteDate.slice(4, 6)}-${minuteDate.slice(6, 8)} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`,
        price: numeric(parts[1]),
        average: amount !== null && volume !== null && volume > 0 ? amount / (volume * 100) : null,
        volume,
        amount,
      };
    }).filter((row) => row.price !== null && ((row.clock >= 930 && row.clock <= 1130) || (row.clock >= 1300 && row.clock <= 1500)))
      .map(({ hhmm: _hhmm, clock: _clock, ...row }) => row);

    const rawKlines = (klineResult?.value?.data?.[symbol]?.qfqday ?? klineResult?.value?.data?.[symbol]?.day ?? []) as string[][];
    const klines = rawKlines.slice(-45).map((row, index) => {
      const close = numeric(row[2]);
      const previousClose = index > 0 ? numeric(rawKlines.slice(-45)[index - 1]?.[2]) : null;
      return {
        date: String(row[0] ?? ""),
        open: numeric(row[1]),
        close,
        high: numeric(row[3]),
        low: numeric(row[4]),
        volume: numeric(row[5]),
        amount: null,
        changePercent: close !== null && previousClose !== null && previousClose !== 0 ? ((close - previousClose) / previousClose) * 100 : null,
      };
    });
    const available = [quoteResult, trendResult, klineResult].filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (quote && trends.length && available.length) {
      return {
        quote,
        trends: since ? trends.filter((row) => row.time > since) : trends,
        klines,
        preClose: numeric(minutePayload?.prec) ?? quote.prevClose,
        meta: { ...metaFrom(...available), source: "腾讯行情" },
      };
    }
  }

  const quoteFields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f20,f22,f62";
  const quoteUrl = `${EASTMONEY}/ulist.np/get?fltt=2&invt=2&fields=${quoteFields}&secids=${encodeURIComponent(secid)}`;
  const trendsUrl = `${EASTMONEY_HISTORY}/stock/trends2/get?secid=${encodeURIComponent(secid)}&ndays=1&iscr=0&iscca=0&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const klineUrl = `${EASTMONEY_HISTORY}/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=101&fqt=1&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&end=20500101&lmt=45`;
  // Quote, intraday and daily data are independent. Running them together keeps
  // a three-second refresh from being delayed by three sequential round trips.
  const detailRequests = [
    resilientJson(quoteUrl, 2_000, { attempts: 2, timeoutMs: 4_000 }),
    resilientJson(trendsUrl, 2_000, { attempts: 2, timeoutMs: 4_000 }),
  ];
  if (includeKline) detailRequests.push(resilientJson(klineUrl, 90_000, { attempts: 2, timeoutMs: 4_000 }));
  const settled = await Promise.allSettled(detailRequests);
  const available = settled.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof resilientJson>>> => item.status === "fulfilled").map((item) => item.value);
  const quoteResult = settled[0].status === "fulfilled" ? settled[0].value : null;
  const trendsResult = settled[1].status === "fulfilled" ? settled[1].value : null;
  const klineResult = includeKline && settled[2]?.status === "fulfilled" ? settled[2].value : null;
  const realtimeAvailable = [quoteResult, trendsResult].filter((item): item is Awaited<ReturnType<typeof resilientJson>> => Boolean(item));

  let trends: Array<{ time: string; price: number | null; average: number | null; volume: number | null; amount: number | null }> = (trendsResult?.value?.data?.trends ?? []).map((row: string) => {
    const parts = row.split(",");
    return { time: parts[0], price: numeric(parts[2]), average: numeric(parts[7]), volume: numeric(parts[5]), amount: numeric(parts[6]) };
  }).filter((item: { price: number | null }) => item.price !== null);

  let klines = (klineResult?.value?.data?.klines ?? []).map((row: string) => {
    const parts = row.split(",");
    return {
      date: parts[0], open: numeric(parts[1]), close: numeric(parts[2]), high: numeric(parts[3]),
      low: numeric(parts[4]), volume: numeric(parts[5]), amount: numeric(parts[6]), changePercent: numeric(parts[8]),
    };
  });

  let quote = parseQuote(quoteResult?.value?.data?.diff?.[0] ?? {});
  let usedSina = false;
  const [marketText, code] = secid.split(".");
  const market = Number(marketText);
  if ((quote.price === null || !trends.length || !klines.length) && (market === 0 || market === 1)) {
    const symbol = `${market === 1 ? "sh" : "sz"}${code}`;
    if (quote.price === null) {
      try {
        const sinaQuote = await resilientText(`https://hq.sinajs.cn/list=${symbol}`, 2_000, { attempts: 2, timeoutMs: 4_000 });
        const fallbackQuote = parseSinaQuotes(sinaQuote.value, [secid])[0];
        if (fallbackQuote) {
          quote = fallbackQuote;
          available.push(sinaQuote);
          realtimeAvailable.push(sinaQuote);
          usedSina = true;
        }
      } catch { /* Intraday or daily data can still keep the panel useful. */ }
    }
    if (!trends.length) {
      try {
        const sinaTrend = await resilientText(`https://quotes.sina.cn/cn/api/jsonp_v2.php/callback/CN_MinlineService.getMinlineData?symbol=${symbol}`, 2_000, { attempts: 2, timeoutMs: 4_000 });
        const rows = parseSinaJsonp(sinaTrend.value) ?? [];
        trends = rows.map((row: Record<string, unknown>) => ({
          time: String(row.m ?? ""), price: numeric(row.p), average: numeric(row.avg_p),
          volume: numeric(row.v ?? row.tot_v), amount: numeric(row.amount),
        })).filter((item: { price: number | null }) => item.price !== null);
        available.push(sinaTrend); realtimeAvailable.push(sinaTrend); usedSina = true;
      } catch { /* Quote data remains usable if the backup intraday feed also fails. */ }
    }
    if (includeKline && !klines.length) {
      try {
        const sinaKline = await resilientText(`https://quotes.sina.cn/cn/api/jsonp_v2.php/callback/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=45`, 90_000);
        const rows = parseSinaJsonp(sinaKline.value) ?? [];
        klines = rows.map((row: Record<string, unknown>) => ({
          date: String(row.day ?? ""), open: numeric(row.open), close: numeric(row.close), high: numeric(row.high),
          low: numeric(row.low), volume: numeric(row.volume), amount: numeric(row.amount), changePercent: null,
        }));
        available.push(sinaKline); usedSina = true;
      } catch { /* The page will label an unavailable chart instead of inventing data. */ }
    }
  }

  if (!available.length) throw new Error("个股行情暂时无法连接");

  return {
    quote: { ...quote, market: Number(secid.split(".")[0]) },
    trends: since ? trends.filter((row) => row.time > since) : trends,
    klines,
    preClose: numeric(trendsResult?.value?.data?.preClose ?? trendsResult?.value?.data?.prePrice),
    meta: { ...metaFrom(...(realtimeAvailable.length ? realtimeAvailable : available)), source: usedSina ? "东方财富 + 新浪行情" : "东方财富" },
  };
}

async function fourMinuteSpeeds(secids: string[]) {
  if (!secids.length) return { items: [], meta: { mode: "live", updatedAt: Date.now(), source: "腾讯分时" } };
  const items: Array<{ code: string; market: number; speed4m: number; pointTime: string }> = [];
  const available: Array<Awaited<ReturnType<typeof resilientJson>>> = [];
  let usedEastmoney = false;
  let usedYahoo = false;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, secids.length) }, async () => {
    while (cursor < secids.length) {
      const secid = secids[cursor];
      cursor += 1;
      try {
        const [market, code] = secid.split(".");
        let result: Awaited<ReturnType<typeof resilientJson>>;
        let priced: Array<{ time: string; price: number }>;
        if (market === "0" || market === "1") {
          const symbol = `${market === "1" ? "sh" : "sz"}${code}`;
          result = await resilientJson(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`, 12_000, { attempts: 2, timeoutMs: 2_200 });
          const rows: string[] = result.value?.data?.[symbol]?.data?.data ?? [];
          priced = rows.map((row) => {
            const parts = row.split(" ");
            return { time: `${parts[0]?.slice(0, 2)}:${parts[0]?.slice(2, 4)}`, price: numeric(parts[1]) };
          }).filter((row): row is { time: string; price: number } => row.price !== null);
        } else if (secid === "100.KS11") {
          result = await resilientJson("https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?interval=1m&range=1d", 12_000, { attempts: 2, timeoutMs: 2_500 });
          const chart = result.value?.chart?.result?.[0];
          const timestamps: number[] = chart?.timestamp ?? [];
          const closes: Array<number | null> = chart?.indicators?.quote?.[0]?.close ?? [];
          priced = timestamps.map((timestamp, index) => ({ time: String(timestamp), price: numeric(closes[index]) }))
            .filter((row): row is { time: string; price: number } => row.price !== null);
          usedYahoo = true;
        } else {
          const url = `${EASTMONEY_HISTORY}/stock/trends2/get?secid=${encodeURIComponent(secid)}&ndays=1&iscr=0&iscca=0&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
          result = await resilientJson(url, 12_000, { attempts: 2, timeoutMs: 2_200 });
          const rows: string[] = result.value?.data?.trends ?? [];
          priced = rows.map((row) => {
            const parts = row.split(",");
            return { time: parts[0], price: numeric(parts[2]) };
          }).filter((row): row is { time: string; price: number } => row.price !== null);
          usedEastmoney = true;
        }
        const latest = priced.at(-1);
        const reference = priced.at(-5);
        if (latest && reference && reference.price !== 0) {
          items.push({ code, market: Number(market), speed4m: ((latest.price - reference.price) / reference.price) * 100, pointTime: latest.time });
          available.push(result);
        }
      } catch { /* Other symbols can still return while one upstream request fails. */ }
    }
  });
  await Promise.all(workers);
  if (!items.length || !available.length) throw new Error("四分钟涨速暂时无法连接");
  const itemMap = new Map(items.map((item) => [`${item.market}.${item.code}`, item]));
  const ordered = secids.map((secid) => itemMap.get(secid)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const meta = metaFrom(...available);
  return {
    items: ordered,
    meta: {
      ...meta,
      mode: ordered.length < secids.length ? "stale" as CacheMode : meta.mode,
      source: ["腾讯分时", usedYahoo ? "雅虎财经" : "", usedEastmoney ? "东方财富" : ""].filter(Boolean).join(" + "),
    },
  };
}

function aShareTradingMinute(time: string) {
  const match = time.match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  if (minute <= 11 * 60 + 30) return Math.min(Math.max(minute - (9 * 60 + 30), 0), 120);
  if (minute >= 13 * 60) return Math.min(Math.max(120 + minute - 13 * 60, 120), 240);
  return 120;
}

async function marketTurnover() {
  const symbols = ["sh000001", "sz399001"];
  const results = await Promise.all(symbols.map((symbol) => {
    return resilientJson(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${symbol}`, 12_000, { attempts: 2, timeoutMs: 3_000 });
  }));
  const exchanges = results.map((result, index) => {
    const days: Array<{ date: string; data: string[] }> = result.value?.data?.[symbols[index]]?.data ?? [];
    const parseDay = (day: { date: string; data: string[] } | undefined) => {
      if (!day?.date || !Array.isArray(day.data)) throw new Error("市场分钟成交额格式异常");
      const rows = day.data.map((row) => {
        const parts = row.split(" ");
        const time = `${parts[0]?.slice(0, 2)}:${parts[0]?.slice(2, 4)}`;
        return { time, minute: aShareTradingMinute(time), amount: numeric(parts[3]) };
      }).filter((row): row is { time: string; minute: number; amount: number } => row.minute !== null && row.amount !== null);
      return { date: `${day.date.slice(0, 4)}-${day.date.slice(4, 6)}-${day.date.slice(6, 8)}`, rows };
    };
    const current = parseDay(days[0]);
    const previous = parseDay(days[1]);
    return { current, previous, lastMinute: current.rows.at(-1)?.minute ?? 0 };
  });
  const cutoff = Math.min(...exchanges.map((exchange) => exchange.lastMinute));
  const amountAt = (key: "current" | "previous") => exchanges.reduce((total, exchange) => {
    const point = exchange[key].rows.filter((row) => row.minute <= cutoff).at(-1);
    return total + (point?.amount ?? 0);
  }, 0);
  const currentAmount = amountAt("current");
  const previousAmount = amountAt("previous");
  if (currentAmount <= 0 || previousAmount <= 0) throw new Error("市场成交额暂不可用");
  const point = exchanges[0].current.rows.filter((row) => row.minute <= cutoff).at(-1);
  const delta = currentAmount - previousAmount;
  return {
    currentAmount,
    previousAmount,
    delta,
    deltaPercent: (delta / previousAmount) * 100,
    currentDate: exchanges[0].current.date,
    previousDate: exchanges[0].previous.date,
    pointTime: point?.time ?? "—",
    meta: { ...metaFrom(...results), source: "腾讯沪深分钟成交额" },
  };
}

const sectorFilters: Record<string, string> = {
  concept: "m:90+t:3",
  industry: "m:90+t:2",
};

// Keep the industry selector aligned with the 90-category Tonghuashun industry
// directory. Eastmoney remains the quote source so change, speed, flow and
// constituent-stock fields use the same live feed as the rest of the app.
const THS_INDUSTRIES = new Set([
  "IT服务", "白酒", "白色家电", "半导体", "包装印刷", "保险", "厨卫电器", "电池", "电机", "电力",
  "电网设备", "电子化学品", "多元金融", "房地产", "纺织制造", "非金属材料", "风电设备", "服装家纺", "钢铁", "港口航运",
  "工程机械", "工业金属", "公路铁路运输", "光伏设备", "光学光电子", "轨交设备", "贵金属", "黑色家电", "互联网电商", "化学纤维",
  "化学原料", "化学制品", "化学制药", "环保设备", "环境治理", "机场航运", "计算机设备", "家居用品", "建筑材料", "建筑装饰",
  "教育", "金属新材料", "军工电子", "军工装备", "零售", "旅游及酒店", "贸易", "煤炭开采加工", "美容护理", "能源金属",
  "农产品加工", "农化制品", "其他电源设备", "其他电子", "其他社会服务", "汽车服务及其他", "汽车零部件", "汽车整车", "燃气", "软件开发",
  "生物制品", "石油加工贸易", "食品加工制造", "塑料制品", "通信服务", "通信设备", "通用设备", "文化传媒", "物流", "橡胶制品",
  "消费电子", "小家电", "小金属", "养殖业", "医疗服务", "医疗器械", "医药商业", "银行", "饮料制造", "影视院线",
  "油气开采及服务", "游戏", "元件", "造纸", "证券", "中药", "种植业与林业", "专用设备", "自动化设备", "综合",
]);

const THS_INDUSTRY_CATALOG = [
  { code: "THS881121", name: "半导体" }, { code: "THS881171", name: "自动化设备" },
  { code: "THS881279", name: "光伏设备" }, { code: "THS881281", name: "电池" },
  { code: "THS881277", name: "电机" },
  { code: "THS881129", name: "通信设备" }, { code: "THS881272", name: "软件开发" },
  { code: "THS881271", name: "IT服务" }, { code: "THS881126", name: "汽车零部件" },
  { code: "THS881125", name: "汽车整车" }, { code: "THS881124", name: "消费电子" },
  { code: "THS881170", name: "小金属" }, { code: "THS881267", name: "能源金属" },
  { code: "THS881145", name: "电力" }, { code: "THS881278", name: "电网设备" },
  { code: "THS881166", name: "军工装备" }, { code: "THS881276", name: "军工电子" },
  { code: "THS881155", name: "银行" }, { code: "THS881157", name: "证券" },
  { code: "THS881156", name: "保险" }, { code: "THS881273", name: "白酒" },
  { code: "THS881131", name: "白色家电" }, { code: "THS881122", name: "光学光电子" },
  { code: "THS881130", name: "计算机设备" }, { code: "THS881270", name: "元件" },
  { code: "THS881172", name: "电子化学品" }, { code: "THS881280", name: "风电设备" },
  { code: "THS881117", name: "通用设备" }, { code: "THS881118", name: "专用设备" },
  { code: "THS881268", name: "工程机械" }, { code: "THS881269", name: "轨交设备" },
  { code: "THS881168", name: "工业金属" }, { code: "THS881169", name: "贵金属" },
  { code: "THS881114", name: "金属新材料" }, { code: "THS881112", name: "钢铁" },
  { code: "THS881167", name: "非金属材料" }, { code: "THS881108", name: "化学原料" },
  { code: "THS881109", name: "化学制品" }, { code: "THS881264", name: "化学纤维" },
  { code: "THS881265", name: "塑料制品" }, { code: "THS881266", name: "橡胶制品" },
  { code: "THS881263", name: "农化制品" }, { code: "THS881105", name: "煤炭开采加工" },
  { code: "THS881107", name: "油气开采及服务" }, { code: "THS881180", name: "石油加工贸易" },
  { code: "THS881146", name: "燃气" }, { code: "THS881282", name: "其他电源设备" },
  { code: "THS881284", name: "环保设备" }, { code: "THS881181", name: "环境治理" },
  { code: "THS881140", name: "化学制药" }, { code: "THS881141", name: "中药" },
  { code: "THS881142", name: "生物制品" }, { code: "THS881143", name: "医药商业" },
  { code: "THS881144", name: "医疗器械" }, { code: "THS881175", name: "医疗服务" },
  { code: "THS881182", name: "美容护理" }, { code: "THS881101", name: "种植业与林业" },
  { code: "THS881102", name: "养殖业" }, { code: "THS881103", name: "农产品加工" },
  { code: "THS881134", name: "食品加工制造" }, { code: "THS881133", name: "饮料制造" },
  { code: "THS881173", name: "小家电" }, { code: "THS881174", name: "厨卫电器" },
  { code: "THS881132", name: "黑色家电" }, { code: "THS881139", name: "家居用品" },
  { code: "THS881138", name: "包装印刷" }, { code: "THS881137", name: "造纸" },
  { code: "THS881135", name: "纺织制造" }, { code: "THS881136", name: "服装家纺" },
  { code: "THS881123", name: "其他电子" }, { code: "THS881128", name: "汽车服务及其他" },
  { code: "THS881162", name: "通信服务" }, { code: "THS881153", name: "房地产" },
  { code: "THS881115", name: "建筑材料" }, { code: "THS881116", name: "建筑装饰" },
  { code: "THS881149", name: "公路铁路运输" }, { code: "THS881148", name: "港口航运" },
  { code: "THS881151", name: "机场航运" }, { code: "THS881152", name: "物流" },
  { code: "THS881177", name: "互联网电商" }, { code: "THS881158", name: "零售" },
  { code: "THS881159", name: "贸易" }, { code: "THS881160", name: "旅游及酒店" },
  { code: "THS881164", name: "文化传媒" }, { code: "THS881274", name: "影视院线" },
  { code: "THS881275", name: "游戏" }, { code: "THS881178", name: "教育" },
  { code: "THS881179", name: "其他社会服务" }, { code: "THS881283", name: "多元金融" },
  { code: "THS881165", name: "综合" },
] as const;

const THS_CONCEPTS = new Set([
  "2026一季报预增", "2026中报预增", "3D打印", "5G", "6G概念", "AI PC", "AI视频", "AI手机", "AI应用", "AI语料",
  "AI智能体", "BC电池", "DeepSeek概念", "EDR概念", "ERP概念", "ETC", "F5G概念", "MCU芯片", "MiniLED", "NFT概念",
  "OLED", "PCB概念", "PEEK材料", "PET铜箔", "PM2.5", "POE胶膜", "PPP概念", "ST板块", "TOPCON电池", "WiFi 6",
  "阿尔茨海默概念", "阿里巴巴概念", "安防", "白酒概念", "百度概念", "比亚迪概念", "冰雪产业", "兵装重组概念", "丙烯酸", "玻璃基板",
  "参股保险", "参股券商", "参股银行", "草甘膦", "超超临界发电", "超导概念", "超级电容", "超级品牌", "车联网(车路协同)", "成飞概念",
  "充电桩", "宠物经济", "抽水蓄能", "储能", "传感器", "创投", "创新药", "存储芯片", "大豆", "大飞机",
  "代糖概念", "地下管网", "低空经济", "第三代半导体", "电力物联网", "电子竞技", "电子身份证", "电子纸", "东数西算(算力)", "动力电池回收",
  "动物疫苗", "抖音概念(字节概念)", "独角兽概念", "短剧游戏", "多模态AI", "俄乌冲突概念", "钒电池", "仿制药一致性评价", "飞行汽车(eVTOL)", "芬太尼",
  "风电", "氟化工概念", "福建自贸区", "辅助生殖", "富士康概念", "钙钛矿电池", "肝炎概念", "高端装备", "高股息精选", "高铁",
  "高压快充", "高压氧舱", "工业大麻", "工业互联网", "工业母机", "供销社", "共封装光学(CPO)", "共同富裕示范区", "共享单车", "股权转让(并购重组)",
  "固废处理", "固态电池", "光伏概念", "光刻机", "光刻胶", "光热发电", "广东自贸区", "硅能源", "国产操作系统", "国产航母",
  "国家大基金持股", "国企改革", "国资云", "海工装备", "海南自贸区", "海峡两岸", "航空发动机", "航运概念", "毫米波雷达", "合成生物",
  "核电", "核污染防治", "黑龙江自贸区", "横琴新区", "鸿蒙概念", "猴痘概念", "互联网保险", "互联网金融", "沪股通", "华为概念",
  "华为海思概念股", "华为鲲鹏", "华为欧拉", "华为汽车", "华为昇腾", "化肥", "化债概念(AMC概念)", "环氧丙烷", "换电概念", "黄金概念",
  "机器人概念", "机器视觉", "基因测序", "家庭医生", "家用电器", "减肥药", "减速器", "建筑节能", "金属钴", "金属回收",
  "金属镍", "金属铅", "金属铜", "金属锌", "京津冀一体化", "净水概念", "举牌", "军工", "军工信息化", "军民融合",
  "科创次新股", "可降解塑料", "可控核聚变", "可燃冰", "空间计算", "空气能热泵", "跨境电商", "快手概念", "垃圾分类", "冷链物流",
  "锂电池概念", "粮食概念", "两轮车", "量子科技", "磷化工", "流感", "露营经济", "旅游概念", "绿色电力", "蚂蚁集团概念",
  "毛发医疗", "煤化工概念", "煤炭概念", "免税店", "民爆概念", "民营医院", "钠离子电池", "脑机接口", "宁德时代概念", "农村电商",
  "农机", "农业种植", "培育钻石", "啤酒概念", "拼多多概念", "苹果概念", "期货概念", "汽车拆解概念", "汽车电子", "汽车热管理",
  "汽车芯片", "禽流感", "青蒿素", "氢能源", "区块链", "燃料电池", "染料", "人工智能", "人脸识别", "人形机器人",
  "人造肉", "融资融券", "柔性屏(折叠屏)", "柔性直流输电", "乳业", "赛马概念", "三胎概念", "商业航天", "上海国企改革", "上海自贸区",
  "深股通", "深圳国企改革", "生态农业", "生物疫苗", "生物质能发电", "石墨电极", "石墨烯", "时空大数据", "食品安全", "手机游戏",
  "数据安全", "数据确权", "数据要素", "数据中心(AIDC)", "数字货币", "数字经济", "数字孪生", "数字水印", "数字乡村", "水利",
  "水泥概念", "算力租赁", "太赫兹", "钛白粉概念", "碳交易", "碳纤维", "碳中和", "特钢概念", "特高压", "特色小镇",
  "特斯拉概念", "腾讯概念", "体育产业", "天津自贸区", "天然气", "同花顺出海50", "同花顺漂亮100", "同花顺中特估100", "铜缆高速连接", "统一大市场",
  "土地流转", "土壤修复", "托育服务", "网红经济", "网络安全", "网络游戏", "网约车", "卫星导航", "文化传媒概念", "污水处理",
  "无人机", "无人驾驶", "无人零售", "无线充电", "无线耳机", "物联网", "物业管理", "稀土永磁", "细胞免疫治疗", "先进封装",
  "乡村振兴", "消毒剂", "消费电子概念", "小红书概念", "小金属概念", "小米概念", "小米汽车", "芯片概念", "新股与次新股", "新疆振兴",
  "新能源汽车", "新型城镇化", "新型工业化", "新型烟草(电子烟)", "信创", "信托概念", "星闪概念", "雄安新区", "虚拟电厂", "虚拟数字人",
  "虚拟现实", "血氧仪", "牙科医疗", "雅下水电概念", "烟草", "盐湖提锂", "眼科医疗", "央企国企改革", "养鸡", "养老概念",
  "页岩气", "液冷服务器", "一带一路", "一体化压铸", "医疗器械概念", "医美概念", "医药电商", "移动支付", "英伟达概念", "幽门螺杆菌概念",
  "有机硅概念", "语音技术", "玉米", "预制菜", "元宇宙", "粤港澳大湾区", "云办公", "云计算", "云游戏", "在线教育",
  "摘帽", "长安汽车概念", "长三角一体化", "证金持股", "知识产权保护", "职业教育", "智慧城市", "智慧灯杆", "智慧政务", "智能穿戴",
  "智能电网", "智能家居", "智能物流", "智能医疗", "智能音箱", "智能座舱", "中船系", "中俄贸易概念", "中国AI 50", "中韩自贸区",
  "中芯国际概念", "中字头股票", "重组蛋白", "猪肉", "注册制次新股", "专精特新", "转基因", "装配式建筑", "自由贸易港", "租售同权",
  "足球概念",
]);

// Eastmoney's concept universe also contains price-action screens such as
// yesterday's limit-up list and recent highs. Those are useful scanners, but
// they are not durable concept sectors and should not appear in Sector Radar.
const NON_CONCEPT_PATTERNS = [
  /昨日|涨停|跌停|连板|首板|一字板|打板/,
  /历史新高|历史新低|近期新高|近期新低|百日新高|百日新低/,
  /昨日表现|昨日触板|昨日炸板|昨日连板|昨日首板/,
  /^(B股|A股|ST股|含B股|次新股|融资融券|转融券标的|沪股通|深股通|QFII重仓|机构重仓)$/,
];

async function thsIndustrySectors() {
  const result = await resilientGbkText("https://q.10jqka.com.cn/thshy/", 30_000);
  const rows = Array.from(result.value.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const quoted = rows.map((row) => {
    const code = row[1].match(/thshy\/detail\/code\/(\d+)/i)?.[1] ?? "";
    const cells = htmlCells(row[1]);
    return {
      code: code ? `THS${code}` : "",
      name: cells[1] ?? "",
      change: numeric(cells[2]),
      speed: null,
      inflow: numeric(cells[5]) === null ? null : Number(cells[5]) * 1e8,
    };
  }).filter((item) => item.code && THS_INDUSTRIES.has(item.name));
  const quotedByCode = new Map(quoted.map((item) => [item.code, item]));
  const directorySeen = new Set<string>();
  const items = Array.from(result.value.matchAll(/thshy\/detail\/code\/(\d+)\/?"[^>]*>([^<]+)<\/a>/gi))
    .map((match) => ({ code: `THS${match[1]}`, name: htmlCellText(match[2]) }))
    .filter((item) => {
      if (!THS_INDUSTRIES.has(item.name) || directorySeen.has(item.code)) return false;
      directorySeen.add(item.code);
      return true;
    })
    .map((item) => quotedByCode.get(item.code) ?? { ...item, change: null, speed: null, inflow: null });
  if (!items.length) throw new Error("同花顺行业分类解析失败");
  return { items, result };
}

async function thsIndustryStocks(code: string) {
  const thsCode = code.replace(/^THS/i, "");
  const result = await resilientGbkText(`https://q.10jqka.com.cn/thshy/detail/code/${thsCode}/`, 16_000);
  const rows = Array.from(result.value.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const items = rows.map((row) => {
    const cells = htmlCells(row[1]);
    const stockCode = cells[1] ?? "";
    return {
      code: stockCode,
      market: /^[69]/.test(stockCode) ? 1 : 0,
      name: cells[2] ?? "",
      price: numeric(cells[3]),
      change: numeric(cells[4]),
      speed: numeric(cells[6]),
      inflow: null,
    };
  }).filter((item) => /^\d{6}$/.test(item.code) && item.name);
  if (!items.length) throw new Error("同花顺行业成分股暂不可用");
  const change = numeric(result.value.match(/<dt>\s*板块涨幅\s*<\/dt>\s*<dd[^>]*>([-+\d.]+)%/i)?.[1]);
  const inflowYi = numeric(result.value.match(/<dt>\s*资金净流入\(亿\)\s*<\/dt>\s*<dd[^>]*>([-+\d.]+)/i)?.[1]);
  return {
    items,
    sector: { change, inflow: inflowYi === null ? null : inflowYi * 1e8 },
    meta: { ...metaFrom(result), source: "同花顺行情" },
  };
}

async function sectors(type: string) {
  const fs = sectorFilters[type] ?? sectorFilters.concept;
  const pageCount = 2;
  const results: Array<Awaited<ReturnType<typeof resilientJson>>> = [];
  let pageCursor = 1;
  // Two small pages are enough for a useful concept radar and avoid making the
  // first screen wait for the full upstream taxonomy.
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (pageCursor <= pageCount) {
      const page = pageCursor;
      pageCursor += 1;
      const url = `${EASTMONEY}/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=f12,f14,f3,f22,f62`;
      try {
        results.push(await resilientJson(url, 30_000, { attempts: 1, timeoutMs: 2_500 }));
      } catch { /* A partial classified list is preferable to a blank radar. */ }
    }
  }));
  const raw = results.flatMap((result) => result.value?.data?.diff ?? []);
  const seen = new Set<string>();
  const eastmoneyItems = raw.map((item: Record<string, unknown>) => ({
    code: String(item.f12 ?? ""), name: String(item.f14 ?? ""), change: numeric(item.f3),
    speed: numeric(item.f22), inflow: numeric(item.f62),
  })).filter((item: { code: string; name: string }) => {
    if (!item.code || !item.name || seen.has(item.code)) return false;
    seen.add(item.code);
    if (type === "industry") return THS_INDUSTRIES.has(item.name) || !/[ⅠⅡⅢ]$/.test(item.name);
    return THS_CONCEPTS.has(item.name) && !NON_CONCEPT_PATTERNS.some((pattern) => pattern.test(item.name));
  }).sort((a, b) => (b.change ?? Number.NEGATIVE_INFINITY) - (a.change ?? Number.NEGATIVE_INFINITY));

  if (type === "industry") {
    try {
      const ths = await thsIndustrySectors();
      const eastmoneyByName = new Map(eastmoneyItems.map((item) => [item.name, item]));
      const items = ths.items.map((item) => eastmoneyByName.get(item.name) ?? item)
        .sort((a, b) => (b.change ?? Number.NEGATIVE_INFINITY) - (a.change ?? Number.NEGATIVE_INFINITY));
      return {
        items,
        meta: {
          ...metaFrom(...results, ths.result),
          source: results.length ? "同花顺行业分类 · 东方财富行情" : "同花顺行业行情",
        },
      };
    } catch {
      if (!eastmoneyItems.length || !results.length) {
        return {
          items: THS_INDUSTRY_CATALOG.map((item) => ({ ...item, change: null, speed: null, inflow: null })),
          meta: {
            mode: "stale" as CacheMode,
            updatedAt: 0,
            source: "同花顺行业分类缓存（行情不可用）",
          },
        };
      }
    }
  }

  if (!eastmoneyItems.length || !results.length) throw new Error("板块行情暂时无法连接");
  return {
    items: eastmoneyItems,
    meta: {
      ...metaFrom(...results),
      source: type === "industry" ? "同花顺行业分类 · 东方财富行情" : "概念主题筛选 · 东方财富行情",
    },
  };
}

async function sectorStocks(code: string) {
  if (/^THS\d+$/i.test(code)) return thsIndustryStocks(code);
  if (!/^BK\d+$/i.test(code)) throw new Error("板块代码格式不正确");
  const url = `${EASTMONEY}/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(`b:${code}`)}&fields=f12,f13,f14,f2,f3,f22,f62`;
  const result = await resilientJson(url, 16_000);
  const items = (result.value?.data?.diff ?? []).map((item: Record<string, unknown>) => ({
    code: String(item.f12 ?? ""), market: Number(item.f13 ?? (/^[69]/.test(String(item.f12 ?? "")) ? 1 : 0)),
    name: String(item.f14 ?? ""), price: numeric(item.f2), change: numeric(item.f3), speed: numeric(item.f22), inflow: numeric(item.f62),
  })).filter((item: { code: string; name: string }) => item.code && item.name);
  return { items, meta: metaFrom(result) };
}

const sectorBlacklist = ["股通", "融资", "融券", "MSCI", "罗素", "富时", "指数", "基金", "ETF", "LOF", "期货", "期权", "沪通", "深通", "昨日", "北交", "科创", "创业", "主板", "ST"];

async function capital() {
  const quoteFields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f22,f62";
  const quoteUrl = `${EASTMONEY}/ulist.np/get?fltt=2&invt=2&fields=${quoteFields}&secids=1.000300`;
  const flowUrl = `${EASTMONEY}/stock/fflow/kline/get?lmt=0&klt=1&secid=1.000300&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55`;
  const baseFlow = `${EASTMONEY}/clist/get?pn=1&pz=40&np=1&fltt=2&invt=2&fid=f62&fs=m%3A90%2Bt%3A2&fields=f12,f14,f62`;
  const firstPair = await Promise.allSettled([
    resilientJson(quoteUrl, 8_000), resilientJson(flowUrl, 8_000),
  ]);
  const inflowSettled = await Promise.allSettled([resilientJson(`${baseFlow}&po=1`, 18_000)]);
  const outflowSettled = await Promise.allSettled([resilientJson(`${baseFlow}&po=0`, 18_000)]);
  const allSettled = [...firstPair, ...inflowSettled, ...outflowSettled];
  const available = allSettled.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof resilientJson>>> => item.status === "fulfilled").map((item) => item.value);
  if (!available.length) throw new Error("资金流行情暂时无法连接");
  const quoteResult = firstPair[0].status === "fulfilled" ? firstPair[0].value : null;
  const flowResult = firstPair[1].status === "fulfilled" ? firstPair[1].value : null;
  const inflowResult = inflowSettled[0].status === "fulfilled" ? inflowSettled[0].value : null;
  const outflowResult = outflowSettled[0].status === "fulfilled" ? outflowSettled[0].value : null;
  const flow = (flowResult?.value?.data?.klines ?? []).map((row: string) => {
    const parts = row.split(",");
    return { time: parts[0], main: numeric(parts[1]), small: numeric(parts[2]), medium: numeric(parts[3]), large: numeric(parts[4]) };
  });
  const cleanSectors = (rows: Array<Record<string, unknown>>) => rows
    .filter((item) => !sectorBlacklist.some((word) => String(item.f14 ?? "").includes(word)))
    .slice(0, 5)
    .map((item) => ({ code: String(item.f12 ?? ""), name: String(item.f14 ?? ""), amount: numeric(item.f62) }));
  return {
    quote: { ...parseQuote(quoteResult?.value?.data?.diff?.[0] ?? {}), market: 1 },
    flow,
    inflow: cleanSectors(inflowResult?.value?.data?.diff ?? []),
    outflow: cleanSectors(outflowResult?.value?.data?.diff ?? []),
    meta: metaFrom(...available),
  };
}

async function rankings() {
  const loadSina = async (ascending: boolean) => {
    const pages = await Promise.all([1, 2].map((page) => resilientText(
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=changepercent&asc=${ascending ? 1 : 0}&node=hs_a&symbol=`,
      3_000,
      { attempts: 1, timeoutMs: 3_500 },
    )));
    const rows = pages.flatMap((result) => {
      try {
        const parsed = JSON.parse(result.value);
        return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
      } catch {
        return [];
      }
    });
    const items = rows
      .filter((item) => /^(sh|sz)\d{6}$/.test(String(item.symbol ?? "")))
      .map((item) => {
        const symbol = String(item.symbol ?? "");
        const marketCapWan = numeric(item.mktcap);
        return parseQuote({
          f2: item.trade,
          f3: item.changepercent,
          f5: item.volume,
          f6: item.amount,
          f7: null,
          f8: item.turnoverratio,
          f12: item.code,
          f13: symbol.startsWith("sh") ? 1 : 0,
          f14: item.name,
          f15: item.high,
          f16: item.low,
          f17: item.open,
          f18: item.settlement,
          f20: marketCapWan === null ? null : marketCapWan * 10_000,
          f22: null,
          f62: null,
        });
      })
      .filter((item) => item.code && item.name && item.price !== null)
      .slice(0, 100);
    return { items, results: pages };
  };

  const sinaSettled = await Promise.allSettled([loadSina(false), loadSina(true)]);
  if (sinaSettled.every((item) => item.status === "fulfilled")) {
    const gainers = sinaSettled[0].value;
    const losers = sinaSettled[1].value;
    if (gainers.items.length === 100 && losers.items.length === 100) {
      const metadata = metaFrom(...gainers.results, ...losers.results);
      return {
        gainers: gainers.items,
        losers: losers.items,
        meta: { ...metadata, source: "新浪财经 · 沪深A股" },
      };
    }
  }

  const universe = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
  const fields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f20,f22";
  const load = (order: 0 | 1) => resilientJson(
    `${EASTMONEY}/clist/get?pn=1&pz=100&po=${order}&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(universe)}&fields=${fields}`,
    3_000,
    { attempts: 1, timeoutMs: 3_500 },
  );
  const settled = await Promise.allSettled([load(1), load(0)]);
  const available = settled
    .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof resilientJson>>> => item.status === "fulfilled")
    .map((item) => item.value);
  if (!available.length) throw new Error("涨跌排行暂时无法连接");
  const parseRows = (result: Awaited<ReturnType<typeof resilientJson>> | null) => (result?.value?.data?.diff ?? [])
    .map((item: Record<string, unknown>) => parseQuote(item))
    .filter((item: ReturnType<typeof parseQuote>) => item.code && item.name && item.price !== null)
    .slice(0, 100);
  const gainersResult = settled[0].status === "fulfilled" ? settled[0].value : null;
  const losersResult = settled[1].status === "fulfilled" ? settled[1].value : null;
  return {
    gainers: parseRows(gainersResult),
    losers: parseRows(losersResult),
    meta: {
      ...metaFrom(...available),
      mode: settled.some((item) => item.status === "rejected") ? "stale" as CacheMode : metaFrom(...available).mode,
      source: "东方财富 · 沪深A股",
    },
  };
}

async function search(keyword: string) {
  const normalized = keyword.trim().slice(0, 30);
  if (!normalized) return { items: [], meta: { mode: "live", updatedAt: Date.now(), source: "腾讯搜索" } };
  const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(normalized)}&t=all`;
  const result = await resilientTencentText(url, 60_000, { attempts: 1, timeoutMs: 1_800 });
  const match = result.value.match(/v_hint="([\s\S]*?)";?/);
  if (!match) return { items: [], meta: { ...metaFrom(result), source: "腾讯搜索" } };
  let decoded = match[1];
  try { decoded = JSON.parse(`"${match[1].replace(/"/g, '\\"')}"`); } catch { /* Names without escape sequences are already usable. */ }
  const items = decoded.split("^").map((row) => {
    const [market, code, name, , classify] = row.split("~");
    return { code, market: market === "sh" ? 1 : market === "sz" ? 0 : -1, name, classify };
  }).filter((item) => /^\d{6}$/.test(item.code) && [0, 1].includes(item.market) && item.classify.startsWith("GP-A"))
    .slice(0, 12)
    .map(({ classify: _classify, ...item }) => item);
  return { items, meta: { ...metaFrom(result), source: "腾讯搜索" } };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "quotes";
  try {
    if (action === "quotes") return json(await quotes(normalizeSecids(url.searchParams.get("secids"))));
    if (action === "detail") return json(await detail(
      url.searchParams.get("secid") ?? "",
      url.searchParams.get("since") ?? "",
      url.searchParams.get("full") !== "0",
    ));
    if (action === "speeds") return json(await fourMinuteSpeeds(normalizeSecids(url.searchParams.get("secids"))));
    if (action === "market-turnover") return json(await marketTurnover());
    if (action === "sectors") return json(await sectors(url.searchParams.get("type") ?? "concept"));
    if (action === "sector-stocks") return json(await sectorStocks(url.searchParams.get("code") ?? ""));
    if (action === "capital") return json(await capital());
    if (action === "rankings") return json(await rankings());
    if (action === "search") return json(await search(url.searchParams.get("q") ?? ""));
    return json({ error: "未知数据请求" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "行情网络暂不可用";
    return json({ error: message, meta: { mode: "offline", updatedAt: Date.now(), source: "东方财富" } }, 502);
  }
}
