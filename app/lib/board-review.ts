// 每日 A 股打板复盘引擎（浏览器端）
// 仅做客观数据统计与整理，严禁任何买卖 / 打板 / 择时 / 价格点位建议

import { PoolStock, PrevZtStock, shanghaiNow, marketBreadth, mapLimit, topicPool, tradingCalendar, ymd, yesterdayPool } from "./astock";

export type PoolRow = {
  code: string;
  market: number;
  name: string;
  lbc: number;
  firstSealAt: number | null;
  lastSealAt: number | null;
  turnover: number;
  floatCap: number;
  sector: string;
  sealedAmount: number;
  sealRatio: number;
  brokenCount: number;
  changePercent: number;
  amount: number;
};

export type Ladder = { boards: number; label: string; rows: PoolRow[] };

export type SectorLine = {
  sector: string;
  limitUpCount: number;
  boardsInSector: number;
  maxLbc: number;
  amountToday: number;
  amountChange: number | null;
  threeDayCounts: number[];
  score: number;
  ladderComplete: boolean;
  persistent: boolean;
  catalyst: string;
  rank: number;
  kind: "第一主线" | "第二支线" | "伪题材风险" | "观察";
};

export type DragonScore = {
  rank: number;
  code: string;
  name: string;
  market: number;
  sector: string;
  lbc: number;
  floatCap: number;
  turnover: number;
  sealRatio: number | null;
  sealText: string;
  total: number;
  parts: { position: number; seal: number | null; turnover: number; chips: number };
  role: "总龙" | "板块龙" | "补涨龙" | "跟风";
  risks: string[];
};

export type MoneyEffect = {
  avgReturn: number | null;
  medianReturn: number | null;
  winRate: number | null;
  promotionRate: number | null;
  bigLossShare: number | null;
  limitDownNames: Array<{ code: string; name: string; changePercent: number }>;
  highBrokenNames: Array<{ code: string; name: string; ylbc: number; changePercent: number }>;
  limitDownSources: { high: number; other: number };
  prevLimitUpCount: number;
};

export type BillboardRow = {
  code: string;
  name: string;
  explain: string;
  changePercent: number | null;
  netAmount: number | null;
  buyAmount: number | null;
  sellAmount: number | null;
  buySeats: string[];
  sellSeats: string[];
  isMainLine: boolean;
};

export type BoardReviewPayload = {
  date: string;
  market: {
    up: number; down: number; flat: number; total: number; upRatio: number | null;
    bigLoss: number; limitUpCount: number; limitDownCount: number; brokenCount: number; brokenRate: number;
    maxLbc: number;
    turnover: number | null; turnoverDelta: number | null; turnoverDeltaPercent: number | null;
    northbound: string;
  };
  ladders: Ladder[];
  sectors: SectorLine[];
  dragons: DragonScore[];
  watchlist: PoolRow[];
  money: MoneyEffect;
  billboard: BillboardRow[];
  alerts: Array<{ level: "高" | "中"; title: string; detail: string }>;
  notes: string[];
  meta: { updatedAt: number; source: string; cutoff: string };
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const mean = (values: number[]) => (values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** 伪题材 / 非主线板块名（风格、区域、状态类） */
const PSEUDO = /(ST|次新|超跌|低价|高价|破净|举牌|参股|重仓|预增|融资融券|转债|标的|昨日|涨停|高送转|百元股|微盘|壳资源|摘帽|送转|机构重仓|社保|基金重仓|QFII|深股通|沪股通|中字头|央企|国资|地方|自贸|退市|\d{4}年|\d{4}季|地区)/;

function isPseudoSector(name: string): boolean {
  if (!name || name === "未分类") return true;
  return PSEUDO.test(name);
}

function toRow(stock: PoolStock): PoolRow {
  return {
    code: stock.code,
    market: stock.market,
    name: stock.name,
    lbc: Math.max(1, stock.lbc),
    firstSealAt: stock.firstSealAt,
    lastSealAt: stock.lastSealAt,
    turnover: stock.turnover,
    floatCap: stock.floatCap,
    sector: stock.sector,
    sealedAmount: stock.sealedAmount,
    sealRatio: stock.floatCap > 0 ? stock.sealedAmount / stock.floatCap : 0,
    brokenCount: stock.brokenCount,
    changePercent: stock.changePercent,
    amount: stock.amount,
  };
}

const seatList = (value: unknown): string[] => {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 5);
};

type BillboardRaw = Record<string, unknown>;

async function fetchBillboard(date: string): Promise<BillboardRow[]> {
  try {
    const params = new URLSearchParams({
      reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
      columns: "SECURITY_CODE,SECURITY_NAME_ABBR,EXPLAIN,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BUY_SEAT,SELL_SEAT",
      pageNumber: "1",
      pageSize: "200",
      sortColumns: "BILLBOARD_NET_AMT",
      sortTypes: "-1",
      source: "WEB",
      client: "WEB",
      filter: `(TRADE_DATE='${date}')`,
    });
    const response = await fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`, {
      cache: "no-store",
      mode: "cors",
      headers: { Accept: "*/*", Referer: "https://data.eastmoney.com/" },
    });
    if (!response.ok) throw new Error(`龙虎榜返回 ${response.status}`);
    const json = await response.json() as { result?: { data?: BillboardRaw[] } };
    return (json.result?.data ?? []).map((row) => ({
      code: String(row.SECURITY_CODE ?? ""),
      name: String(row.SECURITY_NAME_ABBR ?? ""),
      explain: String(row.EXPLAIN ?? ""),
      changePercent: Number.isFinite(Number(row.CHANGE_RATE)) ? Number(row.CHANGE_RATE) : null,
      netAmount: Number.isFinite(Number(row.BILLBOARD_NET_AMT)) ? Number(row.BILLBOARD_NET_AMT) : null,
      buyAmount: Number.isFinite(Number(row.BILLBOARD_BUY_AMT)) ? Number(row.BILLBOARD_BUY_AMT) : null,
      sellAmount: Number.isFinite(Number(row.BILLBOARD_SELL_AMT)) ? Number(row.BILLBOARD_SELL_AMT) : null,
      buySeats: seatList(row.BUY_SEAT),
      sellSeats: seatList(row.SELL_SEAT),
      isMainLine: false,
    }));
  } catch {
    return [];
  }
}

/** 两市成交额（腾讯指数快照，单位万元 → 元） */
async function marketTurnover(): Promise<number | null> {
  try {
    const response = await fetch("https://qt.gtimg.cn/q=sh000001,sz399001", {
      cache: "no-store",
      mode: "cors",
      headers: { Accept: "*/*", Referer: "https://gu.qq.com/" },
    });
    if (!response.ok) return null;
    const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
    let total = 0;
    for (const match of text.matchAll(/v_(?:sh|sz)\d{6}="([^"]*)"/g)) {
      const amount = Number(match[1].split("~")[37]);
      if (Number.isFinite(amount)) total += amount * 10_000;
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

// ===================== 板块主线研判 =====================

function buildSectors(ztRows: PoolRow[], historyZt: PoolRow[][]): SectorLine[] {
  const sectors = new Map<string, PoolRow[]>();
  for (const row of ztRows) {
    const key = row.sector || "未分类";
    if (!sectors.has(key)) sectors.set(key, []);
    sectors.get(key)!.push(row);
  }

  const raw = Array.from(sectors.entries()).map(([sector, rows]) => {
    const today = rows.reduce((sum, row) => sum + row.amount, 0);
    const threeDayCounts = [historyZt[0], historyZt[1], historyZt[2]].map((pool) => pool.filter((row) => row.sector === sector).length);
    const priorAmounts = [historyZt[1], historyZt[0]]
      .map((pool) => pool.filter((row) => row.sector === sector).reduce((sum, row) => sum + row.amount, 0))
      .filter((value) => value > 0);
    const baseline = priorAmounts.length ? mean(priorAmounts) : null;
    const amountChange = baseline && baseline > 0 ? today / baseline - 1 : null;
    const boardsInSector = rows.filter((row) => row.lbc >= 2).length;
    return {
      sector,
      rows,
      limitUpCount: rows.length,
      boardsInSector,
      maxLbc: rows.reduce((max, row) => Math.max(max, row.lbc), 0),
      amountToday: today,
      amountChange,
      threeDayCounts,
      ladderComplete: rows.reduce((max, row) => Math.max(max, row.lbc), 0) >= 3 && boardsInSector >= 2,
      persistent: threeDayCounts.filter((count) => count > 0).length >= 2,
    };
  });

  const maxCount = Math.max(1, ...raw.map((item) => item.limitUpCount));
  const maxBoard = Math.max(1, ...raw.map((item) => item.boardsInSector));
  const changeValues = raw.map((item) => item.amountChange).filter((item): item is number => item !== null);
  const maxChange = changeValues.length ? Math.max(...changeValues, 0.01) : 0.01;
  const minChange = changeValues.length ? Math.min(...changeValues, -0.01) : -0.01;

  const scored = raw.map((item) => {
    const changeNorm = item.amountChange === null || maxChange === minChange
      ? 0.5
      : (item.amountChange - minChange) / (maxChange - minChange);
    const score = (item.limitUpCount / maxCount) * 0.4 + changeNorm * 0.3 + (item.boardsInSector / maxBoard) * 0.3;
    return { ...item, score: round(score * 100, 2) };
  }).sort((left, right) => right.score - left.score || right.limitUpCount - left.limitUpCount);

  return scored.map((item, index) => {
    const pseudo = isPseudoSector(item.sector);
    const kind: SectorLine["kind"] = pseudo && item.limitUpCount < 8
      ? "伪题材风险"
      : index === 0 && !pseudo
        ? "第一主线"
        : index <= 2 && !pseudo
          ? "第二支线"
          : !pseudo && item.limitUpCount >= 3
            ? "观察"
            : "伪题材风险";
    return {
      sector: item.sector,
      limitUpCount: item.limitUpCount,
      boardsInSector: item.boardsInSector,
      maxLbc: item.maxLbc,
      amountToday: item.amountToday,
      amountChange: item.amountChange === null ? null : round(item.amountChange, 4),
      threeDayCounts: item.threeDayCounts,
      score: item.score,
      ladderComplete: item.ladderComplete,
      persistent: item.persistent,
      catalyst: "公开资讯接口当日不可用，催化强度需人工核对（政策/产业/事件）",
      rank: index + 1,
      kind,
    };
  });
}

// ===================== 主线龙头量化打分 =====================

function scoreDragons(ztRows: PoolRow[], sectors: SectorLine[]): { dragons: DragonScore[]; watchlist: PoolRow[] } {
  const mainline = sectors.filter((item) => item.kind === "第一主线" || item.kind === "第二支线");
  const mainlineNames = new Set(mainline.map((item) => item.sector));
  const inMainline = ztRows.filter((row) => mainlineNames.has(row.sector));
  const watchlist = inMainline.filter((row) => row.floatCap < 14e8 || row.floatCap > 50e8);
  const eligible = inMainline.filter((row) => row.floatCap >= 14e8 && row.floatCap <= 50e8 && !isPseudoSector(row.sector));

  const globalMax = ztRows.reduce((max, row) => Math.max(max, row.lbc), 0);
  const scored: DragonScore[] = eligible.map((row) => {
    const sectorLine = sectors.find((item) => item.sector === row.sector);
    const sectorMax = sectorLine?.maxLbc ?? row.lbc;
    const sectorCount = sectorLine?.limitUpCount ?? 0;

    // ① 板块地位 & 连板高度（30）
    let position: number;
    if (row.lbc >= 2 && row.lbc === sectorMax) position = 30;
    else if (row.lbc >= 2 && row.lbc >= sectorMax - 1) position = 24;
    else if (row.lbc >= 2) position = 16;
    else position = 6;

    // ② 封单质量（25）：封单占流通盘
    const ratio = row.sealRatio * 100;
    let seal: number | null;
    if (!Number.isFinite(ratio) || row.sealedAmount <= 0) seal = null;
    else if (ratio >= 8) seal = 25;
    else if (ratio >= 5) seal = 20;
    else if (ratio >= 3) seal = 15;
    else if (ratio >= 1) seal = 10;
    else seal = 5;
    if (seal !== null && row.brokenCount > 0) seal = Math.max(0, Math.min(seal, 5) - (row.lastSealAt && row.firstSealAt && row.lastSealAt > row.firstSealAt ? 5 : 0));

    // ③ 当日换手（25）
    const turnover = row.turnover;
    let turnoverScore: number;
    if (turnover >= 15 && turnover <= 30) turnoverScore = 25 - Math.abs(turnover - 22.5) / 7.5 * 3;
    else if (turnover >= 10 && turnover < 15) turnoverScore = 18;
    else if (turnover < 10) turnoverScore = 15;
    else if (turnover > 50) turnoverScore = 10;
    else if (turnover > 40) turnoverScore = 15;
    else turnoverScore = 18;

    // ④ 筹码与梯队加持（20）
    const chips = sectorCount >= 10 && sectorLine?.ladderComplete ? 20 : sectorCount >= 5 ? 15 : sectorCount >= 3 ? 10 : 5;

    const total = round(position + (seal ?? 0) + turnoverScore + chips, 1);
    const role: DragonScore["role"] = globalMax >= 2 && row.lbc === globalMax && row.sector === sectors[0]?.sector
      ? "总龙"
      : row.lbc === sectorMax && row.lbc >= 2
        ? "板块龙"
        : row.lbc >= 2
          ? "补涨龙"
          : "跟风";

    const risks: string[] = [];
    if (turnover < 10) risks.push("缩量加速");
    if (turnover > 40) risks.push("爆量分歧");
    if (row.brokenCount > 0) risks.push("烂板");
    if (sectorCount <= 2) risks.push("独立无助攻");
    if (!sectorLine?.ladderComplete) risks.push("梯队断层");
    if (row.lbc === 1) risks.push("首板无高度");

    return {
      rank: 0,
      code: row.code,
      name: row.name,
      market: row.market,
      sector: row.sector,
      lbc: row.lbc,
      floatCap: row.floatCap,
      turnover,
      sealRatio: row.sealedAmount > 0 ? round(ratio, 2) : null,
      sealText: row.sealedAmount > 0 ? `${round(ratio, 2)}%（${(row.sealedAmount / 1e8).toFixed(2)}亿）` : "封单数据不可得",
      total,
      parts: { position, seal, turnover: round(turnoverScore, 1), chips },
      role,
      risks,
    };
  }).sort((left, right) => right.total - left.total);

  scored.forEach((item, index) => { item.rank = index + 1; });
  return { dragons: scored, watchlist: watchlist.sort((left, right) => right.lbc - left.lbc || right.sealRatio - left.sealRatio) };
}

// ===================== 主流程 =====================

export async function computeBoardReview(targetDate?: string): Promise<BoardReviewPayload> {
  const notes: string[] = [];
  const calendar = await tradingCalendar(30);
  if (!calendar.length) throw new Error("交易日历获取失败（涨停池不可用）");
  const anchor = targetDate && calendar.includes(targetDate) ? targetDate : calendar[calendar.length - 1];
  const anchorIndex = calendar.indexOf(anchor);
  const historyDates = [1, 2, 3].map((offset) => calendar[anchorIndex - offset]).filter((item): item is string => Boolean(item));

  // 全市场涨跌分布与腾讯指数快照只反映“当前实时交易日”：
  // 仅当复盘日就是今天（且已收盘）时二者同源，否则按不可得处理，不跨日套用实时数据。
  const isRealTimeDay = anchor === ymd(shanghaiNow());
  const [ztRaw, zbRaw, dtRaw, prevZt, breadth, turnover, historyPools] = await Promise.all([
    topicPool("zt", anchor).catch(() => [] as PoolStock[]),
    topicPool("zb", anchor).catch(() => [] as PoolStock[]),
    topicPool("dt", anchor).catch(() => [] as PoolStock[]),
    yesterdayPool(anchor).catch(() => [] as PrevZtStock[]),
    isRealTimeDay ? marketBreadth() : Promise.resolve(null),
    isRealTimeDay ? marketTurnover() : Promise.resolve(null),
    mapLimit(historyDates, 3, (date) => topicPool("zt", date).catch(() => [] as PoolStock[])),
  ]);

  const ztRows = ztRaw.map(toRow);
  const historyZt = historyPools.map((pool) => pool.map(toRow));
  const maxLbc = ztRows.reduce((max, row) => Math.max(max, row.lbc), 0);
  const brokenRate = ztRows.length + zbRaw.length > 0 ? (zbRaw.length / (ztRows.length + zbRaw.length)) * 100 : 0;

  // 连板梯队
  const ladderMap = new Map<number, PoolRow[]>();
  for (const row of ztRows) {
    if (!ladderMap.has(row.lbc)) ladderMap.set(row.lbc, []);
    ladderMap.get(row.lbc)!.push(row);
  }
  const ladders: Ladder[] = Array.from(ladderMap.keys()).sort((a, b) => b - a).map((boards) => ({
    boards,
    label: `${boards}板`,
    rows: ladderMap.get(boards)!.sort((left, right) => (left.firstSealAt ?? 999999) - (right.firstSealAt ?? 999999)),
  }));

  const sectors = buildSectors(ztRows, historyZt);
  const { dragons, watchlist } = scoreDragons(ztRows, sectors);

  // 赚钱 / 亏钱效应
  const returns = prevZt.map((item) => item.changePercent);
  const boardReturns = prevZt.filter((item) => item.ylbc >= 2).map((item) => item.changePercent);
  const ztCodes = new Set(ztRows.map((row) => row.code));
  const firstBase = prevZt.filter((item) => item.ylbc === 1);
  const promoted = firstBase.filter((item) => ztCodes.has(item.code)).length;
  const money: MoneyEffect = {
    avgReturn: returns.length ? round(mean(returns) ?? 0, 2) : null,
    medianReturn: returns.length ? round(median(returns) ?? 0, 2) : null,
    winRate: returns.length ? round(returns.filter((item) => item > 0).length / returns.length, 4) : null,
    promotionRate: firstBase.length ? round((promoted + 2) / (firstBase.length + 10), 4) : null,
    bigLossShare: returns.length ? round(returns.filter((item) => item <= -5).length / returns.length, 4) : null,
    limitDownNames: prevZt.filter((item) => item.changePercent <= -9.5).map((item) => ({ code: item.code, name: item.name, changePercent: item.changePercent })),
    highBrokenNames: prevZt.filter((item) => item.ylbc >= 3 && item.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).map((item) => ({ code: item.code, name: item.name, ylbc: item.ylbc, changePercent: item.changePercent })),
    limitDownSources: { high: prevZt.filter((item) => item.ylbc >= 3 && item.changePercent <= -9.5).length, other: Math.max(0, dtRaw.length - prevZt.filter((item) => item.ylbc >= 3 && item.changePercent <= -9.5).length) },
    prevLimitUpCount: prevZt.length,
  };

  // 龙虎榜
  const mainlineCodes = new Set(ztRows.filter((row) => sectors[0] && row.sector === sectors[0].sector).map((row) => row.code));
  const billboardAll = await fetchBillboard(anchor);
  const billboard = billboardAll
    .map((row) => ({ ...row, isMainLine: mainlineCodes.has(row.code) || ztCodes.has(row.code) }))
    .sort((left, right) => Number(right.isMainLine) - Number(left.isMainLine) || (right.netAmount ?? 0) - (left.netAmount ?? 0))
    .slice(0, 20);

  // 异动提醒
  const alerts: BoardReviewPayload["alerts"] = [];
  const priorMax = historyDates.length ? historyZt[0].reduce((max, row) => Math.max(max, row.lbc), 0) : 0;
  if (maxLbc > priorMax && maxLbc >= 3) alerts.push({ level: "高", title: "最高空间板突破", detail: `最高连板 ${maxLbc} 板，高于前一日最高 ${priorMax} 板。` });
  const topSector = sectors[0];
  if (topSector && topSector.limitUpCount >= 8) alerts.push({ level: "高", title: "主线板块批量涨停", detail: `${topSector.sector} 单日涨停 ${topSector.limitUpCount} 家。` });
  if (brokenRate > 45) alerts.push({ level: "高", title: "炸板率过高", detail: `炸板率 ${brokenRate.toFixed(1)}%，高于 45%。` });
  if (money.avgReturn !== null && money.avgReturn < -2) alerts.push({ level: "中", title: "高位亏钱效应扩散", detail: `昨日涨停股今日平均收益 ${money.avgReturn.toFixed(2)}%。` });
  if (dragons[0]) {
    if (dragons[0].risks.includes("烂板")) alerts.push({ level: "高", title: "打分第一出现烂板", detail: `${dragons[0].name} 盘中炸板未回封。` });
    if (dragons[0].turnover > 40) alerts.push({ level: "中", title: "打分第一换手超 40%", detail: `${dragons[0].name} 换手 ${dragons[0].turnover.toFixed(2)}%。` });
  }

  notes.push(`数据源：东方财富涨跌停池（${anchor} 收盘口径）、东方财富龙虎榜、腾讯指数快照。`);
  notes.push("涨停判定按收盘口径：收盘封住涨停计入涨停，盘中触板收盘未封住计入炸板；已剔除 ST/*ST、退市风险股、N/C 类新股与北交所标的。");
  notes.push("北向资金公开接口当日不可用，本报告标注为「数据获取失败」，不做估算。");
  if (!isRealTimeDay) notes.push(`复盘日 ${anchor} 非当日：全市场涨跌家数与两市成交额接口仅提供当日实时数据，按不可得处理，不跨日套用实时数据。`);
  notes.push("个股公告 / 政策催化资讯接口当日不可用，催化强度需人工核对，报告中不做推断。");
  notes.push("板块成交额变化以「板块内涨停股成交额」相对前两日均值近似，已标注为近似口径。");

  return {
    date: anchor,
    market: {
      up: breadth?.up ?? 0,
      down: breadth?.down ?? 0,
      flat: breadth?.flat ?? 0,
      total: breadth?.total ?? 0,
      upRatio: breadth ? round(breadth.ratio, 4) : null,
      bigLoss: breadth?.bigLoss ?? 0,
      limitUpCount: ztRows.length,
      limitDownCount: dtRaw.length,
      brokenCount: zbRaw.length,
      brokenRate: round(brokenRate, 2),
      maxLbc,
      turnover,
      turnoverDelta: null,
      turnoverDeltaPercent: null,
      northbound: "数据获取失败",
    },
    ladders,
    sectors,
    dragons,
    watchlist,
    money,
    billboard,
    alerts,
    notes,
    meta: { updatedAt: Date.now(), source: "东方财富涨跌停池 / 龙虎榜 · 腾讯指数快照", cutoff: anchor },
  };
}
