// A 股超短线数据层（浏览器 / 服务端通用，仅依赖内置 fetch）
// 数据源：东方财富 push2ex 涨跌停池、行情快照；腾讯实时快照
// 口径：沪深主板 + 创业板 + 科创板普通股；剔除 ST/*ST、N/C 类新股、含"退"；不含北交所

export type PoolKind = "zt" | "zb" | "dt";

export type PoolStock = {
  code: string;
  market: number;
  name: string;
  price: number;
  changePercent: number;
  amount: number;
  floatCap: number;
  turnover: number;
  lbc: number;
  firstSealAt: number | null;
  lastSealAt: number | null;
  brokenCount: number;
  sealedAmount: number;
  sector: string;
};

/** 昨日涨停池个股：ylbc 为"昨日板位"，changePercent 为今日涨跌幅 */
export type PrevZtStock = {
  code: string;
  market: number;
  name: string;
  ylbc: number;
  changePercent: number;
  amount: number;
  floatCap: number;
  turnover: number;
  sector: string;
  open: number;
  prevClose: number;
  boardDays: number | null;
  boardCount: number | null;
};

export type Snapshot = { code: string; name: string; open: number; close: number; prevClose: number; changePercent: number };

export type Breadth = {
  up: number;
  down: number;
  flat: number;
  total: number;
  ratio: number;
  bigLoss: number;
  bigLossRatio: number;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const PUSH2EX = "https://push2ex.eastmoney.com";
const PUSH2EX_UT = "7eea3edcaed734bea9cbfc24409ed989";
const TENCENT_SNAPSHOT = "https://qt.gtimg.cn/q=";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type CacheEntry = { value: unknown; freshUntil: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.freshUntil > now) return Promise.resolve(hit.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const task = (async () => {
    try {
      const value = await loader();
      cache.set(key, { value, freshUntil: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

export function clearCache(prefix = "") {
  for (const key of Array.from(cache.keys())) if (key.startsWith(prefix)) cache.delete(key);
}

export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const size = Math.min(Math.max(limit, 1), Math.max(items.length, 1));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function httpText(url: string, timeoutMs = 6_000, attempts = 2, decode: "utf8" | "gbk" = "utf8"): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        mode: "cors",
        headers: { Accept: "*/*", Referer: "https://quote.eastmoney.com/", "User-Agent": UA },
      });
      if (!response.ok) throw new Error(`上游返回 ${response.status}`);
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder(decode).decode(buffer);
      if (!text.trim()) throw new Error("上游返回空内容");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(220 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("行情网络暂不可用");
}

async function httpJson<T = Record<string, unknown>>(url: string, timeoutMs = 6_000, attempts = 2): Promise<T> {
  const text = await httpText(url, timeoutMs, attempts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("上游返回非 JSON");
  }
}

/** 东财交易代码 → 腾讯行情代码 */
export function tencentSymbol(code: string, market: number): string {
  if (/^(4|8|92)/.test(code)) return `bj${code}`;
  if (market === 1 || /^(6|9)/.test(code)) return `sh${code}`;
  return `sz${code}`;
}

export function shanghaiNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function compact(date: string): string {
  return date.replace(/-/g, "");
}

/** 上海时区当前分钟数（0~1439）与星期 */
export function shanghaiClock(): { date: string; minutes: number; weekday: number } {
  const now = shanghaiNow();
  const weekday = now.getDay();
  return { date: ymd(now), minutes: now.getHours() * 60 + now.getMinutes(), weekday };
}

/** 名称/代码过滤：剔除 ST、退市、新股首日(N)与注册制初期(C)、北交所 */
export function isEligible(code: string, name: string): boolean {
  if (/^(4|8|92)/.test(code)) return false;
  if (/^\*?ST|退/.test(name)) return false;
  if (/^[NC]/.test(name)) return false;
  if (!/^\d{6}$/.test(code)) return false;
  return true;
}

const POOL_PATH: Record<PoolKind, string> = {
  zt: "getTopicZTPool",
  zb: "getTopicZBPool",
  dt: "getTopicDTPool",
};

function poolTime(value: unknown): number | null {
  const raw = numeric(value);
  if (raw === null || raw <= 0) return null;
  const text = String(Math.trunc(raw)).padStart(6, "0");
  return Number(text.slice(0, 2)) * 3_600 + Number(text.slice(2, 4)) * 60 + Number(text.slice(4, 6));
}

/** 涨停 / 炸板 / 跌停池（支持历史日期，约 1 个月回溯窗口） */
export async function topicPool(kind: PoolKind, date: string, ttlMs = 300_000): Promise<PoolStock[]> {
  return cached(`pool:${kind}:${date}`, ttlMs, async () => {
    // 注意：zb 池使用 fund:asc 会返回空池，必须用 zdp:asc
    const sort = kind === "zt" ? "fund:asc" : "zdp:asc";
    const url = `${PUSH2EX}/${POOL_PATH[kind]}?ut=${PUSH2EX_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=800&sort=${encodeURIComponent(sort)}&date=${compact(date)}`;
    const json = await httpJson<{ data?: { pool?: Array<Record<string, unknown>> } }>(url, 5_000, 2);
    const rows = json.data?.pool ?? [];
    return rows
      .map((row) => ({
        code: String(row.c ?? ""),
        market: Number(row.m ?? 0),
        name: String(row.n ?? ""),
        price: (numeric(row.p) ?? 0) / 1000,
        changePercent: numeric(row.zdp) ?? 0,
        amount: numeric(row.amount) ?? 0,
        floatCap: numeric(row.ltsz) ?? 0,
        turnover: numeric(row.hs) ?? 0,
        lbc: numeric(row.lbc) ?? 1,
        firstSealAt: poolTime(row.fbt),
        lastSealAt: poolTime(row.lbt ?? row.fbt),
        brokenCount: numeric(row.zbc) ?? 0,
        sealedAmount: numeric(row.fund) ?? 0,
        sector: String(row.hybk ?? "未分类"),
      }))
      .filter((row) => isEligible(row.code, row.name));
  });
}

/** 昨日涨停池：昨日板位 + 今日涨跌幅（用 date 指定"今日"） */
export async function yesterdayPool(date: string, ttlMs = 300_000): Promise<PrevZtStock[]> {
  return cached(`yzt:${date}`, ttlMs, async () => {
    const url = `${PUSH2EX}/getYesterdayZTPool?ut=${PUSH2EX_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=800&sort=${encodeURIComponent("zdp:desc")}&date=${compact(date)}`;
    const json = await httpJson<{ data?: { pool?: Array<Record<string, unknown>> } }>(url, 5_000, 2);
    const rows = json.data?.pool ?? [];
    return rows
      .map((row) => {
        const stat = (row.zttj ?? {}) as Record<string, unknown>;
        return {
          code: String(row.c ?? ""),
          market: Number(row.m ?? 0),
          name: String(row.n ?? ""),
          ylbc: numeric(row.ylbc) ?? 1,
          changePercent: numeric(row.zdp) ?? 0,
          amount: numeric(row.amount) ?? 0,
          floatCap: numeric(row.ltsz) ?? 0,
          turnover: numeric(row.hs) ?? 0,
          sector: String(row.hybk ?? "未分类"),
          open: 0,
          prevClose: 0,
          boardDays: numeric(stat.days),
          boardCount: numeric(stat.ct),
        };
      })
      .filter((row) => isEligible(row.code, row.name));
  });
}

/** 全市场涨跌家数分布（仅最新交易日可得） */
export async function marketBreadth(ttlMs = 120_000): Promise<Breadth | null> {
  try {
    return await cached("breadth", ttlMs, async () => {
      const json = await httpJson<{ data?: { fenbu?: Array<Record<string, number>> } }>(
        `${PUSH2EX}/getTopicZDFenBu?ut=${PUSH2EX_UT}&dpt=wz.ztzt`,
        5_000,
        2,
      );
      const buckets = json.data?.fenbu ?? [];
      let up = 0;
      let down = 0;
      let flat = 0;
      let bigLoss = 0;
      for (const bucket of buckets) {
        for (const [bucketKey, count] of Object.entries(bucket)) {
          const level = Number(bucketKey);
          const value = Number(count) || 0;
          if (level > 0) up += value;
          else if (level < 0) down += value;
          else flat += value;
          if (level <= -5) bigLoss += value;
        }
      }
      const total = up + down + flat;
      if (total <= 0) return null;
      return { up, down, flat, total, ratio: up / total, bigLoss, bigLossRatio: bigLoss / total };
    });
  } catch {
    return null;
  }
}

/** 腾讯实时快照（批量，GBK）；返回 现价 / 今开 / 昨收 / 涨跌幅 */
export async function tencentSnapshots(stocks: Array<{ code: string; market: number }>): Promise<Map<string, Snapshot>> {
  const result = new Map<string, Snapshot>();
  const unique = Array.from(new Map(stocks.map((item) => [item.code, item])).values());
  const chunks: Array<Array<{ code: string; market: number }>> = [];
  for (let index = 0; index < unique.length; index += 50) chunks.push(unique.slice(index, index + 50));
  await mapLimit(chunks, 4, async (chunk) => {
    const symbols = chunk.map((item) => tencentSymbol(item.code, item.market)).join(",");
    try {
      const text = await httpText(`${TENCENT_SNAPSHOT}${symbols}`, 5_000, 2, "gbk");
      for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
        const code = match[1].slice(2);
        const parts = match[2].split("~");
        const close = numeric(parts[3]);
        const prevClose = numeric(parts[4]);
        const open = numeric(parts[5]);
        if (close === null || prevClose === null || prevClose <= 0) continue;
        const changePercent = numeric(parts[32]);
        result.set(code, {
          code,
          name: String(parts[1] ?? ""),
          open: open === null || open <= 0 ? prevClose : open,
          close,
          prevClose,
          changePercent: changePercent === null ? ((close - prevClose) / prevClose) * 100 : changePercent,
        });
      }
    } catch {
      // 单批失败不影响其他批次
    }
  });
  return result;
}

/**
 * 交易日序列（升序，末尾为最近一个已收盘交易日）
 * 识别方式：逐日探测涨停池，池内有标的即视为交易日。
 * 当日仅在 15:30 之后才纳入，避免使用盘中不完整数据。
 */
export async function tradingCalendar(backDays = 30): Promise<string[]> {
  const now = shanghaiNow();
  const includeToday = now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() * 60 + now.getMinutes() >= 15 * 60 + 30;
  const candidates: string[] = [];
  for (let offset = backDays; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86_400_000);
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const label = ymd(day);
    if (label === ymd(now) && !includeToday) continue;
    candidates.push(label);
  }
  const pools = await mapLimit(candidates, 8, (date) => topicPool("zt", date).catch(() => [] as PoolStock[]));
  const days = candidates.filter((_, index) => pools[index].length > 0);
  cached("calendar:list", 300_000, async () => days);
  return days;
}
