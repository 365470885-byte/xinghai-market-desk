export const runtime = "nodejs";
export const preferredRegion = "iad1";

type Quote = {
  code: string;
  market: number;
  name: string;
  price: number | null;
  changePercent: number | null;
  speed: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
  amplitude: number | null;
  netInflow: number | null;
  limitUp: number | null;
  limitDown: number | null;
  limitState: "up" | "down" | null;
  sealedAmount: number | null;
};

const numeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizeSecids(raw: string | null) {
  return String(raw ?? "").split(",").map((item) => item.trim())
    .filter((item) => /^(100\.(KS11)|101\.(CNOW)|102\.\d{6})$/.test(item))
    .slice(0, 12);
}

async function text(url: string, encoding: "utf-8" | "gbk", timeoutMs = 2_800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "*/*",
        Referer: url.includes("10jqka") ? "https://q.10jqka.com.cn/" : "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0 (compatible; XinghaiMarketDesk/1.0)",
      },
    });
    if (!response.ok) throw new Error(`上游返回 ${response.status}`);
    const value = new TextDecoder(encoding).decode(await response.arrayBuffer());
    if (!value) throw new Error("上游数据为空");
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function blankQuote(code: string, market: number): Quote {
  return {
    code, market, name: "", price: null, changePercent: null, speed: null,
    high: null, low: null, open: null, prevClose: null, volume: null,
    amount: null, turnover: null, amplitude: null, netInflow: null,
    limitUp: null, limitDown: null, limitState: null, sealedAmount: null,
  };
}

function parseSina(textValue: string, requested: string[]) {
  const items: Quote[] = [];
  const patterns = [
    { symbol: "b_KOSPI", secid: "100.KS11" },
    { symbol: "hf_CHA50CFD", secid: "101.CNOW" },
  ];
  patterns.forEach(({ symbol, secid }) => {
    if (!requested.includes(secid)) return;
    const match = textValue.match(new RegExp(`var\\s+hq_str_${symbol}="([^"]*)";`));
    if (!match) return;
    const parts = match[1].split(",");
    const [marketText, code] = secid.split(".");
    const row = blankQuote(code, Number(marketText));
    if (symbol === "hf_CHA50CFD") {
      row.name = "富时A50期指";
      row.price = numeric(parts[0]);
      row.prevClose = numeric(parts[7]);
      row.open = numeric(parts[8]);
      row.high = numeric(parts[4]);
      row.low = numeric(parts[5]);
      row.volume = numeric(parts[9]);
    } else {
      row.name = "韩国综合";
      row.price = numeric(parts[1]);
      row.changePercent = numeric(parts[3]);
      row.open = numeric(parts[8]);
      row.prevClose = numeric(parts[9]);
      row.high = numeric(parts[10]);
      row.low = numeric(parts[11]);
      row.volume = numeric(parts[12]);
    }
    if (row.changePercent === null && row.price !== null && row.prevClose !== null && row.prevClose !== 0) {
      row.changePercent = ((row.price - row.prevClose) / row.prevClose) * 100;
    }
    if (row.prevClose !== null && row.prevClose !== 0 && row.high !== null && row.low !== null) {
      row.amplitude = ((row.high - row.low) / row.prevClose) * 100;
    }
    items.push(row);
  });
  return items;
}

function parseThs(textValue: string, secid: string) {
  const start = textValue.indexOf("(");
  const end = textValue.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("同花顺数据格式异常");
  const payload = JSON.parse(textValue.slice(start + 1, end));
  const data = payload?.items ?? {};
  const [marketText, code] = secid.split(".");
  const row = blankQuote(code, Number(marketText));
  row.name = String(data.name ?? "");
  row.price = numeric(data["10"]);
  row.prevClose = numeric(data["6"]);
  row.open = numeric(data["7"]);
  row.high = numeric(data["8"]);
  row.low = numeric(data["9"]);
  row.volume = numeric(data["13"]);
  row.amount = numeric(data["19"]);
  if (row.price !== null && row.prevClose !== null && row.prevClose !== 0) row.changePercent = ((row.price - row.prevClose) / row.prevClose) * 100;
  if (row.high !== null && row.low !== null && row.prevClose !== null && row.prevClose !== 0) row.amplitude = ((row.high - row.low) / row.prevClose) * 100;
  return row;
}

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
  const secids = normalizeSecids(new URL(request.url).searchParams.get("secids"));
  if (!secids.length) return Response.json({ items: [], meta: { mode: "live", updatedAt: Date.now(), source: "特殊指数" } }, { headers });
  const tasks: Array<Promise<Quote[]>> = [];
  const sinaSecids = secids.filter((secid) => secid.startsWith("100.") || secid.startsWith("101."));
  if (sinaSecids.length) {
    const symbols = sinaSecids.map((secid) => secid === "100.KS11" ? "b_KOSPI" : "hf_CHA50CFD");
    tasks.push(text(`https://hq.sinajs.cn/list=${symbols.join(",")}`, "gbk").then((value) => parseSina(value, sinaSecids)));
  }
  secids.filter((secid) => secid.startsWith("102.")).forEach((secid) => {
    const code = secid.split(".")[1];
    tasks.push(text(`https://d.10jqka.com.cn/v2/realhead/48_${code}/last.js`, "utf-8").then((value) => [parseThs(value, secid)]));
  });
  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  if (!items.length) return Response.json({ error: "特殊指数暂时无法连接" }, { status: 502, headers });
  const itemMap = new Map(items.map((item) => [`${item.market}.${item.code}`, item]));
  const ordered = secids.map((secid) => itemMap.get(secid)).filter((item): item is Quote => Boolean(item));
  return Response.json({
    items: ordered,
    meta: {
      mode: ordered.length === secids.length ? "live" : "stale",
      updatedAt: Date.now(),
      source: "新浪行情 + 同花顺",
    },
  }, { headers });
}
