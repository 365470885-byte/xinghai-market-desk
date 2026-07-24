export const runtime = "nodejs";
export const preferredRegion = "iad1";

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
    turnover: numeric(item.f8 ?? item.f168),
    amplitude: numeric(item.f7 ?? item.f171),
    netInflow: numeric(item.f62),
    limitUp: numeric(item.f51),
    limitDown: numeric(item.f52),
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
  });
  const items: ReturnType<typeof parseQuote>[] = [];
  const pattern = /var\s+hq_str_(sh\d{6}|sz\d{6}|b_KOSPI)="([^"]*)";/g;
  for (const match of text.matchAll(pattern)) {
    const secid = requestedBySymbol.get(match[1]);
    if (!secid) continue;
    const [marketText, code] = secid.split(".");
    const parts = match[2].split(",");
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
        turnover: null,
        amplitude: null,
        netInflow: null,
        limitUp: null,
        limitDown: null,
      });
      continue;
    }
    const open = numeric(parts[1]);
    const prevClose = numeric(parts[2]);
    const current = numeric(parts[3]);
    const price = current && current > 0 ? current : prevClose;
    const changePercent = price !== null && prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
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
      turnover: null,
      amplitude: prevClose && prevClose > 0 && numeric(parts[4]) !== null && numeric(parts[5]) !== null
        ? (((numeric(parts[4]) as number) - (numeric(parts[5]) as number)) / prevClose) * 100
        : null,
      netInflow: null,
      limitUp: null,
      limitDown: null,
    });
  }
  return items;
}

async function quotes(secids: string[]) {
  if (!secids.length) return { items: [], meta: { mode: "live", updatedAt: Date.now(), source: "新浪行情" } };
  type QuoteBatch = {
    items: ReturnType<typeof parseQuote>[];
    results: Array<{ value: unknown; fetchedAt: number; mode: CacheMode }>;
    source: string;
  };

  const sinaPromise: Promise<QuoteBatch> = (async () => {
    const symbols = secids.map((secid) => {
      const [market, code] = secid.split(".");
      return market === "1" ? `sh${code}` : market === "0" ? `sz${code}` : secid === "100.KS11" ? "b_KOSPI" : "";
    }).filter(Boolean);
    const result = await resilientText(`https://hq.sinajs.cn/list=${symbols.join(",")}`, 2_000, { attempts: 1, timeoutMs: 2_400 });
    return { items: parseSinaQuotes(result.value, secids), results: [result], source: "新浪行情" };
  })();

  const eastmoneyPromise: Promise<QuoteBatch> = (async () => {
    const fields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f22,f62";
    const chunks: string[][] = [];
    for (let index = 0; index < secids.length; index += 6) chunks.push(secids.slice(index, index + 6));
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
  })();

  const requireComplete = (promise: Promise<QuoteBatch>) => promise.then((batch) => {
    const keys = new Set(batch.items.map((item) => `${item.market}.${item.code}`));
    if (secids.some((secid) => !keys.has(secid))) throw new Error(`${batch.source}返回不完整`);
    return batch;
  });

  let batch: QuoteBatch;
  try {
    batch = await Promise.any([requireComplete(sinaPromise), requireComplete(eastmoneyPromise)]);
  } catch {
    const partials = await Promise.allSettled([sinaPromise, eastmoneyPromise]);
    const quoteMap = new Map<string, ReturnType<typeof parseQuote>>();
    const results: QuoteBatch["results"] = [];
    const sources: string[] = [];
    partials.forEach((partial) => {
      if (partial.status !== "fulfilled") return;
      partial.value.items.forEach((item) => quoteMap.set(`${item.market}.${item.code}`, item));
      results.push(...partial.value.results);
      sources.push(partial.value.source);
    });
    const items = secids.map((secid) => quoteMap.get(secid)).filter((item): item is ReturnType<typeof parseQuote> => Boolean(item));
    if (!items.length || !results.length) throw new Error("自选行情暂时无法连接");
    batch = { items, results, source: sources.join(" + ") };
  }

  const meta = metaFrom(...batch.results);
  return {
    items: batch.items,
    meta: {
      ...meta,
      mode: batch.items.length < secids.length ? "stale" as CacheMode : meta.mode,
      source: batch.source,
    },
  };
}

async function detail(secid: string) {
  if (!/^\d{1,3}\.[A-Z0-9]{4,8}$/i.test(secid)) throw new Error("证券代码格式不正确");
  const quoteFields = "f2,f3,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f22,f62";
  const quoteUrl = `${EASTMONEY}/ulist.np/get?fltt=2&invt=2&fields=${quoteFields}&secids=${encodeURIComponent(secid)}`;
  const trendsUrl = `${EASTMONEY_HISTORY}/stock/trends2/get?secid=${encodeURIComponent(secid)}&ndays=1&iscr=0&iscca=0&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const klineUrl = `${EASTMONEY_HISTORY}/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=101&fqt=1&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&end=20500101&lmt=45`;
  // Quote, intraday and daily data are independent. Running them together keeps
  // a three-second refresh from being delayed by three sequential round trips.
  const settled = await Promise.allSettled([
    resilientJson(quoteUrl, 2_000, { attempts: 2, timeoutMs: 4_000 }),
    resilientJson(trendsUrl, 2_000, { attempts: 2, timeoutMs: 4_000 }),
    resilientJson(klineUrl, 90_000, { attempts: 2, timeoutMs: 4_000 }),
  ]);
  const available = settled.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof resilientJson>>> => item.status === "fulfilled").map((item) => item.value);
  const quoteResult = settled[0].status === "fulfilled" ? settled[0].value : null;
  const trendsResult = settled[1].status === "fulfilled" ? settled[1].value : null;
  const klineResult = settled[2].status === "fulfilled" ? settled[2].value : null;
  const realtimeAvailable = [quoteResult, trendsResult].filter((item): item is Awaited<ReturnType<typeof resilientJson>> => Boolean(item));

  let trends = (trendsResult?.value?.data?.trends ?? []).map((row: string) => {
    const parts = row.split(",");
    return { time: parts[0], price: numeric(parts[1]), average: numeric(parts[2]), volume: numeric(parts[3]), amount: numeric(parts[4]) };
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
    if (!klines.length) {
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
    trends,
    klines,
    preClose: numeric(trendsResult?.value?.data?.preClose ?? trendsResult?.value?.data?.prePrice),
    meta: { ...metaFrom(...(realtimeAvailable.length ? realtimeAvailable : available)), source: usedSina ? "东方财富 + 新浪行情" : "东方财富" },
  };
}

const sectorFilters: Record<string, string> = {
  concept: "m:90+t:3",
  industry: "m:90+t:2",
};

async function sectors(type: string) {
  const fs = sectorFilters[type] ?? sectorFilters.concept;
  const url = `${EASTMONEY}/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=f12,f14,f3,f22,f62`;
  const result = await resilientJson(url, 20_000);
  const items = (result.value?.data?.diff ?? []).map((item: Record<string, unknown>) => ({
    code: String(item.f12 ?? ""), name: String(item.f14 ?? ""), change: numeric(item.f3),
    speed: numeric(item.f22), inflow: numeric(item.f62),
  })).filter((item: { code: string; name: string }) => item.code && item.name);
  return { items, meta: metaFrom(result) };
}

async function sectorStocks(code: string) {
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

async function search(keyword: string) {
  const normalized = keyword.trim().slice(0, 30);
  if (!normalized) return { items: [], meta: { mode: "live", updatedAt: Date.now(), source: "东方财富" } };
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(normalized)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=12`;
  const result = await resilientJson(url, 60_000);
  const items = (result.value?.QuotationCodeTable?.Data ?? []).map((item: Record<string, unknown>) => ({
    code: String(item.Code ?? ""), market: Number(item.MktNum), name: String(item.Name ?? ""), classify: String(item.Classify ?? ""),
  })).filter((item: { code: string; market: number; classify: string }) => item.classify === "AStock" && /^\d{6}$/.test(item.code) && [0, 1].includes(item.market));
  return { items, meta: metaFrom(result) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "quotes";
  try {
    if (action === "quotes") return json(await quotes(normalizeSecids(url.searchParams.get("secids"))));
    if (action === "detail") return json(await detail(url.searchParams.get("secid") ?? ""));
    if (action === "sectors") return json(await sectors(url.searchParams.get("type") ?? "concept"));
    if (action === "sector-stocks") return json(await sectorStocks(url.searchParams.get("code") ?? ""));
    if (action === "capital") return json(await capital());
    if (action === "search") return json(await search(url.searchParams.get("q") ?? ""));
    return json({ error: "未知数据请求" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "行情网络暂不可用";
    return json({ error: message, meta: { mode: "offline", updatedAt: Date.now(), source: "东方财富" } }, 502);
  }
}
