// STCI：A 股短线连板情绪指数（浏览器端计算引擎）
// 流程：原始指标 → 分项 0~100 分（历史分位优先，样本 <10 退回静态锚定）→ 四维分指数 → 综合分 → 阶段 / 预警 / 评分归因

import {
  Breadth,
  PoolStock,
  PrevZtStock,
  shanghaiNow,
  marketBreadth,
  mapLimit,
  tencentSnapshots,
  topicPool,
  tradingCalendar,
  ymd,
  yesterdayPool,
} from "./astock";

// ===================== 类型 =====================

export type Tier = "一进二" | "二进三" | "三板+延续";
export type Basis = "pct" | "abs" | "fixed" | "missing";

export type RawIndicators = {
  date: string;
  limitUp: number;
  broken: number;
  limitDown: number;
  sealRate: number;
  brokenRate: number;
  maxLbc: number;
  ladder: Array<{ boards: string; count: number }>;
  breadthRatio: number | null;
  bigLossRatio: number | null;
  avgReturn: number | null;
  medianReturn: number | null;
  openPremium: number | null;
  winRate: number | null;
  bigLossShare: number | null;
  limitDownShare: number | null;
  boardReturn: number | null;
  highReturn: number | null;
  highDown: number | null;
  highLimitDown: number | null;
  highBreak: number | null;
  j12: number | null;
  j23: number | null;
  j3p: number | null;
  activity: number | null;
  promotion: Array<{ tier: Tier; promoted: number; total: number; rate: number | null }>;
  prevLimitUpCount: number;
};

export type MetricScore = {
  key: string; name: string; raw: number | null; rawText: string;
  score: number | null; basis: Basis; reverse: boolean; samples: number;
};

export type SubIndex = { key: "A" | "B" | "C" | "D"; name: string; score: number; weight: number; formula: string; metrics: MetricScore[] };
export type Attribution = {
  expression: string;
  contributions: Array<{ key: string; name: string; score: number; weight: number; impact: number }>;
  support: string | null; drag: string | null;
};
export type GroupItem = { name: string; rawText: string; score: number | null; basis: Basis; weight: number; effectiveWeight: number | null; impact: number | null };
export type GroupAttribution = { key: "A" | "B" | "C" | "D"; name: string; score: number; level: string; conclusion: string; extremes: string[]; items: GroupItem[] };
export type Warning = { level: "高" | "中"; title: string; detail: string };
export type StciDay = { date: string; stci: number; a: number; b: number; c: number; d: number; phase: string; trend: string; delta3: number | null; delta5: number | null };

export type StciPayload = {
  date: string;
  isToday: boolean;
  stci: number;
  indices: SubIndex[];
  attribution: Attribution;
  groups: GroupAttribution[];
  warnings: Warning[];
  phase: string;
  trend: string;
  delta3: number | null;
  delta5: number | null;
  confidence: { level: "高" | "中" | "低"; samples: number; pctItems: number; absItems: number; missingItems: number };
  indicators: RawIndicators;
  boardSplit: Array<{ name: string; count: number }>;
  history: StciDay[];
  notes: string[];
  meta: { updatedAt: number; source: string; cutoff: string };
};

// ===================== 静态锚定表（分段线性，[原始值, 分值] 单调） =====================

const ANCHORS: Record<string, Array<[number, number]>> = {
  limitUp: [[8, 4], [15, 14], [25, 26], [35, 38], [45, 48], [60, 62], [80, 78], [100, 88], [150, 100]],
  sealRate: [[30, 8], [38, 22], [45, 38], [52, 52], [60, 64], [68, 76], [76, 87], [85, 95], [93, 100]],
  breadthRatio: [[0.12, 4], [0.2, 14], [0.28, 26], [0.36, 38], [0.45, 50], [0.55, 63], [0.65, 76], [0.75, 88], [0.88, 100]],
  activity: [[-0.65, 4], [-0.45, 16], [-0.25, 30], [-0.1, 42], [0, 50], [0.15, 60], [0.35, 72], [0.6, 84], [1, 94], [1.6, 100]],
  j12: [[0.02, 4], [0.07, 18], [0.12, 32], [0.17, 45], [0.22, 57], [0.3, 70], [0.4, 84], [0.55, 96]],
  j23: [[0.01, 4], [0.08, 20], [0.15, 35], [0.22, 48], [0.3, 62], [0.4, 76], [0.5, 88], [0.65, 98]],
  j3p: [[0.01, 4], [0.08, 20], [0.18, 38], [0.28, 52], [0.4, 68], [0.55, 84], [0.7, 94], [0.85, 100]],
  maxLbc: [[2, 4], [3, 20], [4, 34], [5, 48], [6, 60], [7, 70], [8, 79], [9, 86], [11, 94], [13, 100]],
  nextReturn: [[-8, 2], [-6, 8], [-4, 18], [-2, 32], [-1, 42], [0, 54], [1, 65], [2, 74], [4, 88], [7, 100]],
  openPremium: [[-5, 3], [-3, 14], [-2, 24], [-1, 33], [0, 44], [1, 56], [2, 68], [3, 79], [4, 88], [6, 97]],
  boardReturn: [[-8, 3], [-6, 10], [-4, 22], [-2, 36], [0, 50], [2, 65], [4, 78], [6, 89], [9, 100]],
  winRate: [[0.12, 4], [0.2, 15], [0.28, 27], [0.36, 39], [0.45, 51], [0.54, 63], [0.63, 75], [0.72, 86], [0.85, 100]],
  bigLossShare: [[0.02, 98], [0.05, 90], [0.08, 80], [0.12, 68], [0.18, 54], [0.25, 40], [0.33, 26], [0.42, 14], [0.55, 4]],
  limitDown: [[0, 100], [1, 93], [2, 87], [4, 78], [6, 68], [10, 55], [15, 42], [25, 26], [40, 12], [60, 4]],
  brokenRate: [[0.04, 97], [0.1, 90], [0.16, 80], [0.24, 66], [0.32, 50], [0.4, 34], [0.48, 20], [0.58, 9], [0.7, 3]],
  bigLossRatio: [[0.01, 98], [0.03, 92], [0.06, 84], [0.1, 74], [0.16, 62], [0.24, 48], [0.34, 34], [0.45, 20], [0.6, 8]],
  highNegative: [[3, 3], [10, 10], [20, 22], [32, 36], [45, 50], [58, 64], [70, 78], [83, 90], [96, 100]],
};

function anchorScore(key: string, value: number): number {
  const table = ANCHORS[key];
  if (!table || !Number.isFinite(value)) return 50;
  if (value <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (value >= last[0]) return last[1];
  for (let index = 1; index < table.length; index += 1) {
    const [x1, y1] = table[index - 1];
    const [x2, y2] = table[index];
    if (value <= x2) {
      const ratio = x2 === x1 ? 0 : (value - x1) / (x2 - x1);
      return y1 + (y2 - y1) * ratio;
    }
  }
  return last[1];
}

/** 历史分位得分：越大越好取 100×分位，越大越差取 100×(1−分位) */
function percentileScore(history: number[], value: number, reverse: boolean): number {
  const valid = history.filter((item) => Number.isFinite(item));
  if (!valid.length) return 50;
  const below = valid.filter((item) => item <= value).length;
  const equal = valid.filter((item) => item === value).length;
  const rank = (below - equal / 2) / valid.length;
  return Math.max(0, Math.min(100, (reverse ? 1 - rank : rank) * 100));
}

const MIN_SAMPLES = 10;

function scoreMetric(
  key: string, name: string, raw: number | null, history: number[],
  reverse: boolean, rawText: string, forced?: number,
): MetricScore {
  const samples = history.filter((item) => Number.isFinite(item)).length;
  if (raw === null || !Number.isFinite(raw)) {
    return { key, name, raw: null, rawText, score: null, basis: "missing", reverse, samples };
  }
  if (forced !== undefined) return { key, name, raw, rawText, score: forced, basis: "fixed", reverse, samples };
  if (samples >= MIN_SAMPLES) return { key, name, raw, rawText, score: percentileScore(history, raw, reverse), basis: "pct", reverse, samples };
  return { key, name, raw, rawText, score: anchorScore(key, raw), basis: "abs", reverse, samples };
}

// ===================== 工具 =====================

const mean = (values: number[]) => (values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

// ===================== 原始指标 =====================

type TimePrice = { open: number; prevClose: number; changePercent: number };

type DayInput = {
  date: string;
  zt: PoolStock[];
  zb: PoolStock[];
  dt: PoolStock[];
  prevZt: PrevZtStock[];
  prices: Map<string, TimePrice>;
  breadth: Breadth | null;
};

function buildRaw(input: DayInput, previousLimitUps: number[]): RawIndicators {
  const { zt, zb, dt, prevZt, prices, breadth } = input;
  const limitUp = zt.length;
  const broken = zb.length;
  const limitDown = dt.length;
  const total = limitUp + broken;
  const sealRate = total > 0 ? (limitUp / total) * 100 : 0;
  const brokenRate = total > 0 ? (broken / total) * 100 : 0;
  const maxLbc = zt.reduce((max, item) => Math.max(max, item.lbc), 0);

  const ladderCounts = new Map<number, number>();
  for (const item of zt) ladderCounts.set(item.lbc, (ladderCounts.get(item.lbc) || 0) + 1);
  const ladder: Array<{ boards: string; count: number }> = [];
  for (let boards = 1; boards <= Math.max(maxLbc, 1); boards += 1) {
    if (boards >= 6) {
      const six = Array.from(ladderCounts.entries()).filter(([key]) => key >= 6).reduce((sum, [, value]) => sum + value, 0);
      ladder.push({ boards: "六板及以上", count: six });
      break;
    }
    ladder.push({ boards: `${boards}板`, count: ladderCounts.get(boards) || 0 });
  }

  const returns: number[] = [];
  const opens: number[] = [];
  const boardReturns: number[] = [];
  const highReturns: number[] = [];
  let highDown = 0;
  let highLimitDown = 0;
  let highTotal = 0;
  const currentCodes = new Set(zt.map((item) => item.code));

  for (const stock of prevZt) {
    returns.push(stock.changePercent);
    if (prices.size) {
      const price = prices.get(stock.code);
      if (price && price.prevClose > 0 && price.open > 0) opens.push(((price.open - price.prevClose) / price.prevClose) * 100);
    }
    if (stock.ylbc >= 2) boardReturns.push(stock.changePercent);
    if (stock.ylbc >= 3) {
      highReturns.push(stock.changePercent);
      highTotal += 1;
      if (stock.changePercent < 0) highDown += 1;
      if (stock.changePercent <= -9.5) highLimitDown += 1;
    }
  }

  const highBase = prevZt.filter((item) => item.ylbc >= 3);
  const highContinued = highBase.filter((item) => currentCodes.has(item.code)).length;

  const tierOf = (boards: number): Tier => (boards === 1 ? "一进二" : boards === 2 ? "二进三" : "三板+延续");
  const promotion = ([1, 2, 3] as const).map((boards) => {
    const base = prevZt.filter((item) => (boards === 3 ? item.ylbc >= 3 : item.ylbc === boards));
    const promoted = base.filter((item) => currentCodes.has(item.code)).length;
    return {
      tier: tierOf(boards),
      promoted,
      total: base.length,
      rate: base.length > 0 ? (promoted + 2) / (base.length + 2 + 8) : null,
    };
  });

  const valid = previousLimitUps.filter((item) => Number.isFinite(item));
  const baseline = valid.length ? mean(valid) ?? 0 : 0;
  const activity = (limitUp + 1) / (baseline + 1) - 1;

  return {
    date: input.date,
    limitUp, broken, limitDown,
    sealRate: round(sealRate, 2),
    brokenRate: round(brokenRate, 2),
    maxLbc, ladder,
    breadthRatio: breadth ? round(breadth.ratio, 4) : null,
    bigLossRatio: breadth && breadth.total > 0 ? round(breadth.bigLossRatio, 4) : null,
    avgReturn: returns.length ? round(mean(returns) ?? 0, 2) : null,
    medianReturn: returns.length ? round(median(returns) ?? 0, 2) : null,
    openPremium: opens.length ? round(mean(opens) ?? 0, 2) : null,
    winRate: returns.length ? round(returns.filter((item) => item > 0).length / returns.length, 4) : null,
    bigLossShare: returns.length ? round(returns.filter((item) => item <= -5).length / returns.length, 4) : null,
    limitDownShare: returns.length ? round(returns.filter((item) => item <= -9.5).length / returns.length, 4) : null,
    boardReturn: boardReturns.length ? round(mean(boardReturns) ?? 0, 2) : null,
    highReturn: highReturns.length ? round(mean(highReturns) ?? 0, 2) : null,
    highDown: highTotal > 0 ? round(highDown / highTotal, 4) : null,
    highLimitDown: highTotal > 0 ? round(highLimitDown / highTotal, 4) : null,
    highBreak: highBase.length > 0 ? round(1 - highContinued / highBase.length, 4) : null,
    j12: promotion[0].rate === null ? null : round(promotion[0].rate, 4),
    j23: promotion[1].rate === null ? null : round(promotion[1].rate, 4),
    j3p: promotion[2].rate === null ? null : round(promotion[2].rate, 4),
    activity: round(activity, 4),
    promotion,
    prevLimitUpCount: prevZt.length,
  };
}

/** 高位股负反馈合成安全分：高位下跌占比（反向）+ 高位平均收益 + 高位断板率（反向）+ 高位跌停占比（反向），各占 1/4 */
function highNegativeOf(raw: RawIndicators, priorHighReturns: number[]): number | null {
  const highReturnScore = raw.highReturn === null
    ? null
    : (priorHighReturns.length >= MIN_SAMPLES
      ? percentileScore(priorHighReturns, raw.highReturn, false)
      : anchorScore("boardReturn", raw.highReturn));
  const parts = [
    raw.highDown === null ? null : (1 - raw.highDown) * 100,
    highReturnScore,
    raw.highBreak === null ? null : (1 - raw.highBreak) * 100,
    raw.highLimitDown === null ? null : (1 - raw.highLimitDown) * 100,
  ].filter((item): item is number => item !== null);
  return parts.length ? round(mean(parts) ?? 0, 2) : null;
}

// ===================== 权重 =====================

const WEIGHTS: Record<"A" | "B" | "C" | "D", Record<string, number>> = {
  A: { limitUp: 0.35, sealRate: 0.30, breadthRatio: 0.20, activity: 0.15 },
  B: { j12: 0.30, j23: 0.25, j3p: 0.20, maxLbc: 0.15, ladder: 0.10 },
  C: { nextReturn: 0.30, openPremium: 0.20, boardReturn: 0.25, winRate: 0.15, bigLossShare: 0.10 },
  D: { limitDown: 0.25, bigLossRatio: 0.25, highNegative: 0.30, brokenRate: 0.20 },
};

const WEIGHT_OF_STCI: Record<"A" | "B" | "C" | "D", number> = { A: 0.25, B: 0.30, C: 0.30, D: 0.15 };

function weightedScore(metrics: MetricScore[], weights: Record<string, number>): number {
  let numerator = 0;
  let denominator = 0;
  for (const metric of metrics) {
    const weight = weights[metric.key] ?? 0;
    if (metric.score === null || weight <= 0) continue;
    numerator += metric.score * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : 50;
}

function levelOf(score: number, isRisk = false): string {
  if (isRisk) {
    if (score >= 75) return "风险很低";
    if (score >= 65) return "风险偏低";
    if (score >= 45) return "风险中性";
    if (score >= 25) return "风险偏高";
    return "风险很高";
  }
  if (score >= 75) return "强";
  if (score >= 65) return "偏强";
  if (score >= 45) return "中性";
  if (score >= 25) return "偏弱";
  return "弱";
}

const basisText = (basis: Basis) => (basis === "pct" ? "历史分位" : basis === "fixed" ? "固定算法" : basis === "abs" ? "静态锚定" : "缺失");

// ===================== 单日打分 =====================

type ScoredDay = { stci: number; a: number; b: number; c: number; d: number; indices: SubIndex[]; attribution: Attribution; groups: GroupAttribution[] };

function scoreDay(raw: RawIndicators, prior: RawIndicators[], highNegHistory: number[], priorHighReturns: number[]): ScoredDay {
  const series = (pick: (item: RawIndicators) => number | null) => prior.map(pick).filter((item): item is number => item !== null && Number.isFinite(item));

  const hasTwo = raw.ladder.some((row) => row.boards === "2板" && row.count > 0);
  const hasThree = raw.ladder.some((row) => row.boards === "3板" && row.count > 0);
  const hasFourPlus = raw.ladder.some((row) => ["4板", "5板", "六板及以上"].includes(row.boards) && row.count > 0);
  const ladderScore = (0.4 * (hasTwo ? 1 : 0) + 0.35 * (hasThree ? 1 : 0) + 0.25 * (hasFourPlus ? 1 : 0)) * 100;

  const highNegative = highNegativeOf(raw, priorHighReturns);

  const metrics: MetricScore[] = [
    scoreMetric("limitUp", "涨停广度", raw.limitUp, series((item) => item.limitUp), false, `${raw.limitUp} 家`),
    scoreMetric("sealRate", "封板质量（封板率）", raw.sealRate, series((item) => item.sealRate), false, `${round(raw.sealRate, 1)}%`),
    scoreMetric("breadthRatio", "上涨广度", raw.breadthRatio, series((item) => item.breadthRatio), false, raw.breadthRatio === null ? "数据缺失" : `${(raw.breadthRatio * 100).toFixed(2)}%`),
    scoreMetric("activity", "涨停活跃度变化", raw.activity, series((item) => item.activity), false, raw.activity === null ? "数据缺失" : `${(raw.activity * 100).toFixed(1)}%`),
    scoreMetric("j12", "一进二", raw.j12, series((item) => item.j12), false, raw.j12 === null ? "数据缺失" : `${(raw.j12 * 100).toFixed(1)}%`),
    scoreMetric("j23", "二进三", raw.j23, series((item) => item.j23), false, raw.j23 === null ? "数据缺失" : `${(raw.j23 * 100).toFixed(1)}%`),
    scoreMetric("j3p", "三板+延续", raw.j3p, series((item) => item.j3p), false, raw.j3p === null ? "数据缺失" : `${(raw.j3p * 100).toFixed(1)}%`),
    scoreMetric("maxLbc", "连板高度", raw.maxLbc, series((item) => item.maxLbc), false, `${raw.maxLbc} 板`),
    scoreMetric("ladder", "梯队完整度", ladderScore, [], false, `${ladderScore.toFixed(0)}/100`, ladderScore),
    scoreMetric("nextReturn", "涨停股次日收益", raw.avgReturn, series((item) => item.avgReturn), false, raw.avgReturn === null ? "数据缺失" : `${raw.avgReturn.toFixed(2)}%`),
    scoreMetric("openPremium", "开盘溢价", raw.openPremium, series((item) => item.openPremium), false, raw.openPremium === null ? "数据缺失" : `${raw.openPremium.toFixed(2)}%`),
    scoreMetric("boardReturn", "连板股次日收益", raw.boardReturn, series((item) => item.boardReturn), false, raw.boardReturn === null ? "数据缺失" : `${raw.boardReturn.toFixed(2)}%`),
    scoreMetric("winRate", "上涨比例", raw.winRate, series((item) => item.winRate), false, raw.winRate === null ? "数据缺失" : `${(raw.winRate * 100).toFixed(1)}%`),
    scoreMetric("bigLossShare", "大面比例（反向）", raw.bigLossShare, series((item) => item.bigLossShare), true, raw.bigLossShare === null ? "数据缺失" : `${(raw.bigLossShare * 100).toFixed(1)}%`),
    scoreMetric("limitDown", "跌停家数（反向）", raw.limitDown, series((item) => item.limitDown), true, `${raw.limitDown} 家`),
    scoreMetric("brokenRate", "炸板率（反向）", raw.brokenRate, series((item) => item.brokenRate), true, `${round(raw.brokenRate, 1)}%`),
    scoreMetric("bigLossRatio", "全市场大面股比例（反向）", raw.bigLossRatio, series((item) => item.bigLossRatio), true, raw.bigLossRatio === null ? "数据缺失" : `${(raw.bigLossRatio * 100).toFixed(2)}%`),
    scoreMetric("highNegative", "高位股负反馈", highNegative, highNegHistory, false, highNegative === null ? "数据缺失" : `安全分 ${highNegative.toFixed(2)}`),
  ];

  const byKey = new Map(metrics.map((item) => [item.key, item]));
  const groups: SubIndex[] = [
    { key: "A", name: "市场热度", weight: WEIGHT_OF_STCI.A, formula: "0.35×涨停广度 + 0.30×封板质量 + 0.20×上涨广度 + 0.15×涨停活跃度", metrics: ["limitUp", "sealRate", "breadthRatio", "activity"].map((key) => byKey.get(key)!), score: 0 },
    { key: "B", name: "连板结构", weight: WEIGHT_OF_STCI.B, formula: "0.30×一进二 + 0.25×二进三 + 0.20×三板+延续 + 0.15×连板高度 + 0.10×梯队完整度", metrics: ["j12", "j23", "j3p", "maxLbc", "ladder"].map((key) => byKey.get(key)!), score: 0 },
    { key: "C", name: "赚钱效应", weight: WEIGHT_OF_STCI.C, formula: "0.30×涨停股次日收益 + 0.20×开盘溢价 + 0.25×连板股次日收益 + 0.15×上涨比例 + 0.10×大面比例(反向)", metrics: ["nextReturn", "openPremium", "boardReturn", "winRate", "bigLossShare"].map((key) => byKey.get(key)!), score: 0 },
    { key: "D", name: "风险安全", weight: WEIGHT_OF_STCI.D, formula: "0.25×跌停家数(反向) + 0.25×全市场大面股比例(反向) + 0.30×高位股负反馈 + 0.20×炸板率(反向)", metrics: ["limitDown", "bigLossRatio", "highNegative", "brokenRate"].map((key) => byKey.get(key)!), score: 0 },
  ];
  const indices = groups.map((group) => ({ ...group, score: round(weightedScore(group.metrics, WEIGHTS[group.key]), 2) }));
  const [a, b, c, d] = indices.map((item) => item.score);
  const stci = round(WEIGHT_OF_STCI.A * a + WEIGHT_OF_STCI.B * b + WEIGHT_OF_STCI.C * c + WEIGHT_OF_STCI.D * d, 2);

  const contributions = indices.map((group) => ({ key: group.key, name: group.name, score: group.score, weight: group.weight, impact: round(group.weight * (group.score - stci), 2) }));
  const ordered = [...contributions].sort((left, right) => right.impact - left.impact);
  const attribution: Attribution = {
    expression: `STCI = 0.25×${a.toFixed(2)}(市场热度) + 0.30×${b.toFixed(2)}(连板结构) + 0.30×${c.toFixed(2)}(赚钱效应) + 0.15×${d.toFixed(2)}(风险安全) = ${stci.toFixed(2)}`,
    contributions,
    support: ordered[0] && ordered[0].impact >= 2 ? `${ordered[0].name}（+${ordered[0].impact.toFixed(2)}）` : null,
    drag: ordered[ordered.length - 1] && ordered[ordered.length - 1].impact <= -2 ? `${ordered[ordered.length - 1].name}（${ordered[ordered.length - 1].impact.toFixed(2)}）` : null,
  };

  const groupAttribution: GroupAttribution[] = indices.map((group) => {
    const active = group.metrics.filter((metric) => metric.score !== null);
    const weightSum = active.reduce((sum, metric) => sum + (WEIGHTS[group.key][metric.key] ?? 0), 0);
    const items: GroupItem[] = group.metrics.map((metric) => {
      const weight = WEIGHTS[group.key][metric.key] ?? 0;
      const effectiveWeight = metric.score === null || weightSum <= 0 ? null : weight / weightSum;
      const impact = effectiveWeight === null || metric.score === null ? null : round(effectiveWeight * (metric.score - group.score), 2);
      return { name: metric.name, rawText: metric.rawText, score: metric.score === null ? null : round(metric.score, 2), basis: metric.basis, weight, effectiveWeight: effectiveWeight === null ? null : round(effectiveWeight, 4), impact };
    });
    const ranked = items.filter((item) => item.impact !== null).sort((left, right) => (right.impact || 0) - (left.impact || 0));
    const top = ranked.find((item) => (item.impact || 0) >= 2) || null;
    const bottom = [...ranked].reverse().find((item) => (item.impact || 0) <= -2) || null;
    const extremes = items
      .filter((item) => item.score !== null && (item.score <= 3 || item.score >= 97))
      .map((item) => `极端分项：${item.name}（${item.rawText}）得 ${item.score} 分，已处历史${(item.score || 0) >= 97 ? "最高" : "最低"}端`);
    const missing = items.filter((item) => item.score === null).map((item) => item.name);
    const conclusion = `${group.name} ${group.score.toFixed(2)} 分，属「${levelOf(group.score, group.key === "D")}」水平`
      + (top ? `：主要支撑为 ${top.name} ${top.rawText}（分项得分 ${top.score}，依据${basisText(top.basis)}），单独拉高 ${Math.abs(top.impact || 0).toFixed(2)} 分` : "：无明显支撑分项")
      + (bottom ? `；主要拖累为 ${bottom.name} ${bottom.rawText}（分项得分 ${bottom.score}，依据${basisText(bottom.basis)}），单独拉低 ${Math.abs(bottom.impact || 0).toFixed(2)} 分` : "；无明显拖累分项")
      + "。"
      + (missing.length ? `（${missing.join("、")} 因数据缺失未计入）` : "");
    return { key: group.key, name: group.name, score: group.score, level: levelOf(group.score, group.key === "D"), conclusion, extremes, items };
  });

  return { stci, a, b, c, d, indices, attribution, groups: groupAttribution };
}

// ===================== 预警与阶段 =====================

function rawWarnings(raw: RawIndicators, previousMaxLbc: number | null): Warning[] {
  const warnings: Warning[] = [];
  const highBreakWeak = raw.highBreak !== null && raw.highBreak > 0.6;
  const highReturnWeak = raw.highReturn !== null && raw.highReturn < 0;
  const threeWeak = raw.j3p !== null && raw.j3p < 0.2;
  const maxBoardDrop = previousMaxLbc !== null && previousMaxLbc - raw.maxLbc >= 3 && highReturnWeak;
  const retreat = (raw.highDown !== null && raw.highDown > 0.4 && raw.highReturn !== null && raw.highReturn < -3)
    || maxBoardDrop
    || (highReturnWeak && highBreakWeak)
    || (threeWeak && highBreakWeak);
  if (retreat) {
    warnings.push({
      level: "高",
      title: "高位退潮预警",
      detail: `高位下跌占比 ${raw.highDown === null ? "—" : `${(raw.highDown * 100).toFixed(1)}%`}，高位平均收益 ${raw.highReturn === null ? "—" : `${raw.highReturn.toFixed(2)}%`}，高位断板率 ${raw.highBreak === null ? "—" : `${(raw.highBreak * 100).toFixed(1)}%`}，三板+延续 ${raw.j3p === null ? "—" : `${(raw.j3p * 100).toFixed(1)}%`}${previousMaxLbc !== null ? `，最高连板由 ${previousMaxLbc} 板降至 ${raw.maxLbc} 板` : ""}。`,
    });
  }
  const loseMoney = (raw.avgReturn !== null && raw.avgReturn < -1 && raw.bigLossShare !== null && raw.bigLossShare > 0.25)
    || (raw.boardReturn !== null && raw.boardReturn < -2);
  if (loseMoney) {
    warnings.push({
      level: "高",
      title: "亏钱效应预警",
      detail: `昨日涨停股平均收益 ${raw.avgReturn === null ? "—" : `${raw.avgReturn.toFixed(2)}%`}，大面比例 ${raw.bigLossShare === null ? "—" : `${(raw.bigLossShare * 100).toFixed(1)}%`}，昨日连板股平均收益 ${raw.boardReturn === null ? "—" : `${raw.boardReturn.toFixed(2)}%`}。`,
    });
  }
  return warnings;
}

function coolingWarning(history: number[]): Warning | null {
  if (history.length < 3) return null;
  const three = history.slice(-3);
  const falling = three[2] < three[1] && three[1] < three[0];
  const drop = three[2] - three[0];
  if (falling && drop <= -15) return { level: "中", title: "情绪急速降温", detail: `近 3 日 STCI 累计变化 ${drop.toFixed(2)} 分，连续两日回落。` };
  return null;
}

function phaseOf(day: StciDay, hasWarning: boolean): string {
  const { stci, a, b, c, delta3 } = day;
  if (hasWarning) return "退潮 / 强分歧";
  if (stci < 25 && c < 25) return "冰点";
  if (stci >= 75 && a >= 70 && b >= 65 && c >= 65) return "高潮";
  if (stci >= 50 && b >= 55 && c >= 55 && delta3 !== null && delta3 > 0) return "发酵 / 主升";
  if (stci < 50 && delta3 !== null && delta3 >= 8) return "修复";
  if (delta3 !== null && delta3 <= -10 && c < 50) return "退潮 / 强分歧";
  if (stci < 45) return "偏弱 / 分歧";
  if (stci < 65) return "震荡 / 混沌";
  return "偏强 / 结构性";
}

function trendOf(delta3: number | null): string {
  if (delta3 === null) return "样本不足";
  if (delta3 >= 10) return "快速升温";
  if (delta3 > 5) return "缓慢升温";
  if (delta3 <= -10) return "快速降温";
  if (delta3 < -5) return "缓慢降温";
  return "横盘震荡";
}

// ===================== 主流程 =====================

// 按规格：分位序列取今日之前最近 120 个交易日。公开涨跌停池接口回溯窗口约 1 个月，
// 因此把 window 上限设为 120、日历回溯 45 天，在数据源允许范围内尽可能多地纳入样本。
const WINDOW_DAYS = 120;
const CALENDAR_BACK_DAYS = 45;

export async function computeStci(targetDate?: string): Promise<StciPayload> {
  const notes: string[] = [];
  const calendar = await tradingCalendar(CALENDAR_BACK_DAYS);
  if (!calendar.length) throw new Error("交易日历获取失败（涨停池不可用）");
  const anchorDay = targetDate && calendar.includes(targetDate) ? targetDate : calendar[calendar.length - 1];
  const windowDays = calendar.slice(Math.max(0, calendar.indexOf(anchorDay) + 1 - WINDOW_DAYS));

  const poolResults = await mapLimit(windowDays, 5, async (date) => ({
    date,
    zt: await topicPool("zt", date).catch(() => [] as PoolStock[]),
    zb: await topicPool("zb", date).catch(() => [] as PoolStock[]),
    dt: await topicPool("dt", date).catch(() => [] as PoolStock[]),
    prevZt: await yesterdayPool(date).catch(() => [] as PrevZtStock[]),
  }));

  const latestDate = poolResults[poolResults.length - 1].date;
  const latestPrevZt = poolResults[poolResults.length - 1].prevZt;
  // 全市场涨跌分布（getTopicZDFenBu）与腾讯快照只反映“当前实时交易日”。
  // 仅当窗口末日就是今天（且已收盘）时，二者才与目标日同源；否则按缺失处理，不跨日套用实时数据。
  const isRealTimeDay = latestDate === ymd(shanghaiNow());
  const snapshot = isRealTimeDay
    ? await tencentSnapshots(latestPrevZt.map((item) => ({ code: item.code, market: item.market }))).catch(() => new Map())
    : new Map();
  const breadth = isRealTimeDay ? await marketBreadth() : null;

  const raws: RawIndicators[] = [];
  const previousLimitUps: number[] = [];
  for (const pool of poolResults) {
    const prices = new Map<string, TimePrice>();
    if (pool.date === latestDate) {
      for (const stock of pool.prevZt) {
        const hit = snapshot.get(stock.code);
        if (hit) prices.set(stock.code, { open: hit.open, prevClose: hit.prevClose, changePercent: hit.changePercent });
      }
    }
    raws.push(buildRaw(
      { date: pool.date, zt: pool.zt, zb: pool.zb, dt: pool.dt, prevZt: pool.prevZt, prices, breadth: pool.date === latestDate ? breadth : null },
      previousLimitUps.slice(-5),
    ));
    previousLimitUps.push(pool.zt.length);
  }

  const scored: ScoredDay[] = [];
  const highNegSeries: number[] = [];
  const highReturnSeries: number[] = [];
  for (let index = 0; index < raws.length; index += 1) {
    scored.push(scoreDay(raws[index], raws.slice(0, index), [...highNegSeries], [...highReturnSeries]));
    const neg = highNegativeOf(raws[index], highReturnSeries);
    if (neg !== null) highNegSeries.push(neg);
    if (raws[index].highReturn !== null) highReturnSeries.push(raws[index].highReturn as number);
  }

  const history: StciDay[] = scored.map((item, index) => ({
    date: raws[index].date,
    stci: item.stci,
    a: item.a, b: item.b, c: item.c, d: item.d,
    phase: "",
    trend: "",
    delta3: index >= 3 ? round(item.stci - scored[index - 3].stci, 2) : null,
    delta5: index >= 5 ? round(item.stci - scored[index - 5].stci, 2) : null,
  }));

  history.forEach((day, index) => {
    const warnings = [...rawWarnings(raws[index], index > 0 ? raws[index - 1].maxLbc : null)];
    const cooling = coolingWarning(history.slice(0, index + 1).map((item) => item.stci));
    if (cooling) warnings.push(cooling);
    day.phase = phaseOf(day, warnings.length > 0);
    day.trend = trendOf(day.delta3);
  });

  const currentRaw = raws[raws.length - 1];
  const current = scored[scored.length - 1];
  const currentDay = history[history.length - 1];
  const currentWarnings = [...rawWarnings(currentRaw, raws.length > 1 ? raws[raws.length - 2].maxLbc : null)];
  const cooling = coolingWarning(history.map((item) => item.stci));
  if (cooling) currentWarnings.push(cooling);

  const allMetrics = current.indices.flatMap((group) => group.metrics);
  const pctItems = allMetrics.filter((item) => item.basis === "pct" || item.basis === "fixed").length;
  const absItems = allMetrics.filter((item) => item.basis === "abs").length;
  const missingItems = allMetrics.filter((item) => item.basis === "missing").length;
  const samples = Math.max(0, raws.length - 1);
  const confidence: "高" | "中" | "低" = samples >= 100 ? "高" : samples >= 40 ? "中" : "低";

  notes.push(`历史分位样本为最近 ${samples} 个交易日（公开涨跌停池约 1 个月回溯窗口所限，暂不足 120 日），随每日运行自动累积。`);
  notes.push("涨跌停判定按收盘口径：收盘封住涨停计入涨停，盘中触板收盘未封住计入炸板。");
  notes.push("已剔除 ST/*ST、退市风险股、名称以 N/C 开头的新股与北交所标的；范围为沪深主板 + 创业板 + 科创板。");
  if (missingItems > 0) notes.push(`本次有 ${missingItems} 个分项因数据不可得未计入加权（见分项明细）。`);
  if (!isRealTimeDay) notes.push(`当日为 ${latestDate}，非实时交易日：全市场涨跌分布与腾讯快照只反映当前实时交易日，故「上涨广度」「开盘溢价」按缺失处理，未跨日套用实时数据。`);
  if (absItems > 0) notes.push(`本次有 ${absItems} 个分项因样本不足退回静态锚定（低置信度），已标注依据为"静态锚定"。`);

  const latestZt = poolResults[poolResults.length - 1].zt;
  const boardNameOf = (code: string) => (/^(688|689)/.test(code) ? "科创板" : /^(300|301)/.test(code) ? "创业板" : "主板");
  const boardSplit = ["主板", "创业板", "科创板"].map((name) => ({ name, count: latestZt.filter((stock) => boardNameOf(stock.code) === name).length }));

  return {
    date: currentRaw.date,
    isToday: currentRaw.date === (calendar[calendar.length - 1] || ""),
    stci: current.stci,
    indices: current.indices,
    attribution: current.attribution,
    groups: current.groups,
    warnings: currentWarnings,
    phase: currentDay.phase,
    trend: currentDay.trend,
    delta3: currentDay.delta3,
    delta5: currentDay.delta5,
    confidence: { level: confidence, samples, pctItems, absItems, missingItems },
    indicators: currentRaw,
    boardSplit,
    history: history.slice(-20),
    notes,
    meta: { updatedAt: Date.now(), source: "东方财富涨跌停池 · 腾讯行情快照", cutoff: currentRaw.date },
  };
}
