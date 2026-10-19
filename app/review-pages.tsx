"use client";

// 新增两个页面：STCI 短线连板情绪指数面板 / 每日 A 股打板复盘
// 两个页面均在浏览器端自行取数与计算，不经过 /api/market，因此不影响其他页面的刷新速度。
// 刷新策略：进入页面时计算一次并复用缓存；此后在每个交易日 15:32（收盘后）自动刷新一次，另提供手动刷新。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shanghaiNow } from "./lib/astock";
import type { StciPayload, GroupAttribution, MetricScore, StciDay } from "./lib/stci";
import { computeStci } from "./lib/stci";
import type { BoardReviewPayload, DragonScore, PoolRow, SectorLine } from "./lib/board-review";
import { computeBoardReview } from "./lib/board-review";

type Meta = { mode: "live" | "cache" | "stale" | "offline"; updatedAt: number; source: string };
type UpdateConnection = (meta: Meta, feed?: "stci" | "board-review") => void;

const fmt = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const pct = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const sgn = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const toneOf = (value: number | null | undefined) => value === null || value === undefined || value === 0 ? "flat" : value > 0 ? "up" : "down";
const money = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return value.toFixed(0);
};
const boardOf = (code: string) => /^(688|689)/.test(code) ? "科创板" : /^(300|301)/.test(code) ? "创业板" : "主板";
const scoreClass = (score: number | null | undefined, isRisk = false) => {
  if (score === null || score === undefined || !Number.isFinite(score)) return "score-na";
  if (isRisk) return score >= 65 ? "score-good" : score >= 45 ? "score-mid" : score >= 25 ? "score-warn" : "score-bad";
  return score >= 75 ? "score-hot" : score >= 65 ? "score-good" : score >= 45 ? "score-mid" : score >= 25 ? "score-warn" : "score-bad";
};
const shortClock = (stamp: number) => new Date(stamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** 距下一个交易日 15:32 的毫秒数（上海时区） */
function nextRefreshDelay(): number {
  const now = shanghaiNow();
  const target = new Date(now.getTime());
  target.setHours(15, 32, 0, 0);
  let guard = 0;
  while ((target.getTime() <= now.getTime() || target.getDay() === 0 || target.getDay() === 6) && guard < 12) {
    target.setDate(target.getDate() + 1);
    target.setHours(15, 32, 0, 0);
    guard += 1;
  }
  return Math.max(60_000, target.getTime() - now.getTime());
}

function Stamp({ meta, label, nextAt }: { meta: Meta | null; label: string; nextAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const remain = Math.max(0, nextAt - now);
  const hours = Math.floor(remain / 3_600_000);
  const minutes = Math.floor((remain % 3_600_000) / 60_000);
  return <div className={`data-stamp ${meta?.mode || "offline"} compact`} title={`${label}｜${meta?.source || "尚未连接"}`}>
    <i aria-hidden="true" />
    <span>{label}</span>
    <b>{meta?.source || "尚未连接"}</b>
    <time>{meta?.updatedAt ? shortClock(meta.updatedAt) : "—"}</time>
    <em>收盘后自动刷新 · 距下次 {hours > 0 ? `${hours} 小时 ` : ""}{minutes} 分</em>
  </div>;
}

function LoadingBlock({ text }: { text: string }) {
  return <div className="review-loading" role="status"><div /><div /><div /><span>{text}</span></div>;
}

// ==================================================================================
// 一、STCI 短线连板情绪指数
// ==================================================================================

const stciCache: { value: StciPayload | null; at: number } = { value: null, at: 0 };

export function StciPage({ updateConnection }: { updateConnection: UpdateConnection }) {
  const [data, setData] = useState<StciPayload | null>(stciCache.value);
  const [loading, setLoading] = useState(!stciCache.value);
  const [error, setError] = useState("");
  const [nextAt, setNextAt] = useState(() => Date.now() + nextRefreshDelay());
  const [step, setStep] = useState("");
  const requestRef = useRef(0);
  const dataRef = useRef<StciPayload | null>(stciCache.value);

  const load = useCallback(async (force = false) => {
    const requestId = ++requestRef.current;
    setNextAt(Date.now() + nextRefreshDelay());
    if (!force && stciCache.value && Date.now() - stciCache.at < 30 * 60_000) {
      setData(stciCache.value);
      updateConnection({ mode: "cache", updatedAt: stciCache.at, source: stciCache.value.meta.source }, "stci");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setStep("正在拉取涨跌停池（约 1 分钟窗口）…");
      const payload = await computeStci();
      if (requestId !== requestRef.current) return;
      stciCache.value = payload;
      stciCache.at = Date.now();
      dataRef.current = payload;
      setData(payload);
      updateConnection({ mode: payload.isToday ? "live" : "cache", updatedAt: payload.meta.updatedAt, source: payload.meta.source }, "stci");
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const previous = dataRef.current;
      setError(err instanceof Error ? err.message : "STCI 数据获取失败");
      updateConnection({ mode: previous ? "stale" : "offline", updatedAt: previous?.meta.updatedAt || 0, source: previous?.meta.source || "STCI 数据源不可用" }, "stci");
    } finally {
      if (requestId === requestRef.current) { setLoading(false); setStep(""); }
    }
  }, [updateConnection]);

  useEffect(() => {
    let cancelled = false;
    void load(false);
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void load(true).finally(() => { if (!cancelled) schedule(); });
      }, nextRefreshDelay());
    };
    schedule();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [load]);

  if (!data && loading) return <main className="review-page" id="main-content"><LoadingBlock text={step || "正在计算 STCI 短线连板情绪指数…"} /></main>;
  if (!data) return <main className="review-page" id="main-content">
    <div className="review-error panel"><strong>STCI 数据获取失败</strong><p>{error || "上游接口不可用"}</p><button type="button" onClick={() => void load(true)}>重试</button></div>
  </main>;

  const { indicators: ind } = data;
  const sortedIndices = data.indices;

  return <main className="review-page" id="main-content">
    <header className="review-hero panel">
      <div className="review-hero-main">
        <span className="review-eyebrow">A 股短线连板情绪指数 STCI · {data.date}</span>
        <h1>短线情绪面板</h1>
        <div className="review-hero-tags">
          <b className="review-phase">{data.phase}</b>
          <b className={`review-trend ${data.trend.includes("升") ? "up" : data.trend.includes("降") ? "down" : "flat"}`}>{data.trend} Δ3 {sgn(data.delta3)} / Δ5 {sgn(data.delta5)}</b>
          <b className="review-confidence">置信度 {data.confidence.level}（样本 {data.confidence.samples} 日 · 分位 {data.confidence.pctItems} 项 / 锚定 {data.confidence.absItems} 项{data.confidence.missingItems ? ` / 缺失 ${data.confidence.missingItems} 项` : ""}）</b>
        </div>
      </div>
      <div className="review-score-block">
        <span>综合分 STCI</span>
        <strong className={scoreClass(data.stci)}>{data.stci.toFixed(2)}</strong>
        <em>{data.attribution.expression}</em>
      </div>
      <div className="review-hero-side">
        <Stamp meta={{ mode: data.isToday ? "live" : "cache", updatedAt: data.meta.updatedAt, source: data.meta.source }} label="STCI 数据" nextAt={nextAt} />
        <button type="button" onClick={() => void load(true)} disabled={loading}>{loading ? "同步中…" : "立即刷新"}</button>
      </div>
    </header>

    {data.warnings.length > 0 && <section className="review-alerts">
      {data.warnings.map((warning) => <div key={warning.title} className={`review-alert ${warning.level === "高" ? "high" : "mid"}`}>
        <strong>{warning.level}·{warning.title}</strong><span>{warning.detail}</span>
      </div>)}
    </section>}
    {data.warnings.length === 0 && <section className="review-alerts"><div className="review-alert none"><strong>无预警触发</strong><span>三项风险预警（高位退潮 / 亏钱效应 / 情绪急速降温）本次均未命中。</span></div></section>}

    <section className="review-grid4">
      {sortedIndices.map((group) => <article className="review-card panel" key={group.key}>
        <div className="review-card-head"><span>{group.key} · {group.name}</span><em>权重 {Math.round(group.weight * 100)}%</em></div>
        <strong className={scoreClass(group.score, group.key === "D")}>{group.score.toFixed(2)}</strong>
        <div className="review-bar"><i style={{ width: `${Math.max(2, Math.min(100, group.score))}%` }} /></div>
        <p>{group.formula}</p>
      </article>)}
    </section>

    <section className="panel review-section">
      <h2>评分归因（为什么是这个分数）</h2>
      <p className="review-attribution">{data.attribution.expression}</p>
      <div className="review-contrib">
        {data.attribution.contributions.map((item) => <div key={item.key}>
          <span>{item.key} {item.name}</span><strong className={toneOf(item.impact)}>{sgn(item.impact)}</strong>
          <em>{item.weight}×({item.score.toFixed(2)} − {data.stci.toFixed(2)})</em>
        </div>)}
      </div>
      <p className="review-note-line">最大支撑：{data.attribution.support || "无明显支撑（各项影响绝对值 &lt; 2 分）"}；最大拖累：{data.attribution.drag || "无明显拖累（各项影响绝对值 &lt; 2 分）"}。</p>
      <div className="review-groups">
        {data.groups.map((group: GroupAttribution) => <div className="review-group" key={group.key}>
          <h3>{group.key} · {group.name}</h3>
          <p className="review-conclusion">{group.conclusion}</p>
          {group.extremes.map((item) => <p className="review-extreme" key={item}>{item}</p>)}
          <table className="review-table">
            <thead><tr><th>分项</th><th>原始值</th><th>分项得分</th><th>权重</th><th>影响</th></tr></thead>
            <tbody>{group.items.map((item) => <tr key={item.name}>
              <td>{item.name}</td>
              <td>{item.rawText}</td>
              <td className={scoreClass(item.score)}>{item.score === null ? "缺失" : item.score.toFixed(2)}</td>
              <td>{item.effectiveWeight === null ? "—" : item.effectiveWeight.toFixed(2)}</td>
              <td className={toneOf(item.impact)}>{item.impact === null ? "—" : sgn(item.impact)}</td>
            </tr>)}</tbody>
          </table>
        </div>)}
      </div>
    </section>

    <section className="panel review-section">
      <h2>核心指标明细</h2>
      <table className="review-table">
        <thead><tr><th>指标</th><th>原始值</th><th>分项得分</th><th>得分依据</th></tr></thead>
        <tbody>
          {sortedIndices.flatMap((group) => group.metrics).map((metric: MetricScore) => <tr key={metric.key}>
            <td>{metric.name}</td>
            <td>{metric.rawText}</td>
            <td className={scoreClass(metric.score)}>{metric.score === null ? "缺失" : metric.score.toFixed(2)}</td>
            <td>{metric.basis === "pct" ? "历史分位" : metric.basis === "fixed" ? "固定算法" : metric.basis === "abs" ? "静态锚定（低置信度）" : "数据缺失未计入"}</td>
          </tr>)}
        </tbody>
      </table>
    </section>

    <section className="review-grid2">
      <article className="panel review-section">
        <h2>连板梯队与结构</h2>
        <div className="review-ladder">
          {ind.ladder.map((row) => <div key={row.boards}><span>{row.boards}</span><strong>{row.count}</strong><i style={{ width: `${Math.min(100, row.count * 6)}%` }} /></div>)}
        </div>
        <table className="review-table">
          <thead><tr><th>项目</th><th>数值</th></tr></thead>
          <tbody>
            <tr><td>最高连板</td><td>{ind.maxLbc} 板</td></tr>
            <tr><td>涨停 / 炸板 / 跌停</td><td>{ind.limitUp} / {ind.broken} / {ind.limitDown} 家</td></tr>
            <tr><td>封板率 / 炸板率</td><td>{fmt(ind.sealRate, 1)}% / {fmt(ind.brokenRate, 1)}%</td></tr>
            {ind.promotion.map((item) => <tr key={item.tier}><td>{item.tier}（贝叶斯平滑）</td><td>{pct(item.rate, 1)}（{item.promoted}/{item.total}）</td></tr>)}
          </tbody>
        </table>
      </article>
      <article className="panel review-section">
        <h2>板块分布</h2>
        <table className="review-table">
          <thead><tr><th>板块</th><th>涨停家数</th><th>占比</th></tr></thead>
          <tbody>{data.boardSplit.map((item) => <tr key={item.name}>
            <td>{item.name}</td><td>{item.count}</td>
            <td>{ind.limitUp > 0 ? `${((item.count / ind.limitUp) * 100).toFixed(1)}%` : "—"}</td>
          </tr>)}</tbody>
        </table>
        <p className="review-note-line">板块分布按涨停股代码前缀归属：主板 / 创业板 / 科创板；个股与所属题材板块明细见「每日打板复盘」页面。</p>
      </article>
    </section>

    <section className="panel review-section">
      <h2>近期 STCI 走势</h2>
      <div className="review-chart">
        {data.history.map((day: StciDay) => <div key={day.date} className="review-chart-col" title={`${day.date}｜STCI ${day.stci.toFixed(2)}｜A${day.a.toFixed(0)} B${day.b.toFixed(0)} C${day.c.toFixed(0)} D${day.d.toFixed(0)}｜${day.phase}`}>
          <span className={scoreClass(day.stci)}>{day.stci.toFixed(1)}</span>
          <i style={{ height: `${Math.max(2, Math.min(100, day.stci))}%` }} />
          <em>{day.date.slice(5)}</em>
        </div>)}
      </div>
    </section>

    <section className="panel review-section">
      <h2>口径说明与风险提示</h2>
      <ul className="review-notes">{data.notes.map((item) => <li key={item}>{item}</li>)}</ul>
      <ul className="review-notes">
        <li>分指数中 D 为「风险安全」维度，分值越高代表风险越低。</li>
        <li>历史样本不足 10 日的分项退回静态锚定，报告中已标注「静态锚定（低置信度）」。</li>
        <li>数据获取失败或风控拦截时如实标注，不做估算、不编造数据。</li>
      </ul>
    </section>

    <p className="review-disclaimer">本内容仅盘面客观复盘，不构成任何投资建议，股市有风险，入市需谨慎。</p>
  </main>;
}

// ==================================================================================
// 二、每日 A 股打板复盘
// ==================================================================================

const boardCache: { value: BoardReviewPayload | null; at: number } = { value: null, at: 0 };

function roleClass(role: DragonScore["role"]) {
  return role === "总龙" ? "role-leader" : role === "板块龙" ? "role-sector" : role === "补涨龙" ? "role-follow" : "role-weak";
}

export function BoardReviewPage({ updateConnection }: { updateConnection: UpdateConnection }) {
  const [data, setData] = useState<BoardReviewPayload | null>(boardCache.value);
  const [loading, setLoading] = useState(!boardCache.value);
  const [error, setError] = useState("");
  const [nextAt, setNextAt] = useState(() => Date.now() + nextRefreshDelay());
  const requestRef = useRef(0);
  const dataRef = useRef<BoardReviewPayload | null>(boardCache.value);

  const load = useCallback(async (force = false) => {
    const requestId = ++requestRef.current;
    setNextAt(Date.now() + nextRefreshDelay());
    if (!force && boardCache.value && Date.now() - boardCache.at < 30 * 60_000) {
      setData(boardCache.value);
      updateConnection({ mode: "cache", updatedAt: boardCache.at, source: boardCache.value.meta.source }, "board-review");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await computeBoardReview();
      if (requestId !== requestRef.current) return;
      boardCache.value = payload;
      boardCache.at = Date.now();
      dataRef.current = payload;
      setData(payload);
      updateConnection({ mode: "live", updatedAt: payload.meta.updatedAt, source: payload.meta.source }, "board-review");
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const previous = dataRef.current;
      setError(err instanceof Error ? err.message : "打板复盘数据获取失败");
      updateConnection({ mode: previous ? "stale" : "offline", updatedAt: previous?.meta.updatedAt || 0, source: previous?.meta.source || "复盘数据源不可用" }, "board-review");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [updateConnection]);

  useEffect(() => {
    let cancelled = false;
    void load(false);
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void load(true).finally(() => { if (!cancelled) schedule(); });
      }, nextRefreshDelay());
    };
    schedule();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [load]);

  if (!data && loading) return <main className="review-page" id="main-content"><LoadingBlock text="正在拉取涨跌停池、龙虎榜并计算主线龙头打分…" /></main>;
  if (!data) return <main className="review-page" id="main-content">
    <div className="review-error panel"><strong>打板复盘数据获取失败</strong><p>{error || "上游接口不可用"}</p><button type="button" onClick={() => void load(true)}>重试</button></div>
  </main>;

  const mainline = data.sectors.filter((item: SectorLine) => item.kind === "第一主线" || item.kind === "第二支线");
  const pseudo = data.sectors.filter((item: SectorLine) => item.kind === "伪题材风险");

  return <main className="review-page" id="main-content">
    <header className="review-hero panel">
      <div className="review-hero-main">
        <span className="review-eyebrow">每日 A 股打板复盘 · {data.date}（收盘口径）</span>
        <h1>涨停梯队与主线龙头</h1>
        <div className="review-hero-tags">
          <b className="review-phase">最高连板 {data.market.maxLbc} 板</b>
          <b className="review-trend flat">涨停 {data.market.limitUpCount} 家 · 炸板 {data.market.brokenCount} 家</b>
          <b className="review-confidence">炸板率 {fmt(data.market.brokenRate, 1)}% · 跌停 {data.market.limitDownCount} 家</b>
        </div>
      </div>
      <div className="review-score-block">
        <span>第一主线</span>
        <strong className="score-hot review-mainline-name">{mainline[0]?.sector || "无明确主线"}</strong>
        <em>{mainline[0] ? `板块涨停 ${mainline[0].limitUpCount} 家 · 板块内连板 ${mainline[0].boardsInSector} 只 · 综合分 ${mainline[0].score.toFixed(1)}` : "当日无满足条件的题材主线"}</em>
      </div>
      <div className="review-hero-side">
        <Stamp meta={{ mode: "live", updatedAt: data.meta.updatedAt, source: data.meta.source }} label="复盘数据" nextAt={nextAt} />
        <button type="button" onClick={() => void load(true)} disabled={loading}>{loading ? "同步中…" : "立即刷新"}</button>
      </div>
    </header>

    {data.alerts.length > 0 ? <section className="review-alerts">
      {data.alerts.map((item, index) => <div key={`${item.title}-${index}`} className={`review-alert ${item.level === "高" ? "high" : "mid"}`}>
        <strong>{item.level}·{item.title}</strong><span>{item.detail}</span>
      </div>)}
    </section> : <section className="review-alerts"><div className="review-alert none"><strong>无异动提醒触发</strong><span>六条异动提醒规则本次均未命中。</span></div></section>}

    <section className="panel review-section">
      <h2>一、市场总情绪概览</h2>
      <div className="review-metrics">
        {[
          ["上涨家数", data.market.total > 0 ? `${data.market.up}` : "数据获取失败"], ["下跌家数", data.market.total > 0 ? `${data.market.down}` : "数据获取失败"],
          ["平盘家数", data.market.total > 0 ? `${data.market.flat}` : "数据获取失败"],
          ["上涨占比", pct(data.market.upRatio, 2)], ["大阴线（≤-5%）", data.market.total > 0 ? `${data.market.bigLoss} 家` : "数据获取失败"],
          ["涨停（剔除 ST）", `${data.market.limitUpCount} 家`], ["跌停家数", `${data.market.limitDownCount} 家`],
          ["炸板家数 / 炸板率", `${data.market.brokenCount} 家 / ${fmt(data.market.brokenRate, 1)}%`],
          ["两市成交额", money(data.market.turnover)], ["较前日增减", "数据获取失败（历史成交额快照不可得）"],
          ["北向资金", data.market.northbound], ["最高连板", `${data.market.maxLbc} 板`],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {data.market.total === 0 && <p className="review-note-line">全市场涨跌家数接口仅提供当日实时数据；当前展示的复盘日非当日，故该项按「数据获取失败」标注，不跨日套用实时数据。</p>}
    </section>

    <section className="panel review-section">
      <h2>二、涨停连板梯队</h2>
      {data.ladders.map((ladder) => <div className="review-ladder-block" key={ladder.boards}>
        <h3>{ladder.label}　<em>{ladder.rows.length} 家{ladder.boards >= 4 ? "（高位梯队）" : ""}</em></h3>
        <table className="review-table">
          <thead><tr><th>名称</th><th>代码</th><th>连板</th><th>首封时间</th><th>换手</th><th>实际流通市值</th><th>所属题材板块</th><th>归类</th></tr></thead>
          <tbody>{ladder.rows.map((row: PoolRow) => {
            const inMain = mainline.some((item) => item.sector === row.sector);
            return <tr key={row.code}>
              <td>{row.name}</td><td>{row.code}</td><td>{row.lbc} 板</td>
              <td>{row.firstSealAt === null ? "—" : `${String(Math.floor(row.firstSealAt / 3600)).padStart(2, "0")}:${String(Math.floor(row.firstSealAt % 3600 / 60)).padStart(2, "0")}`}</td>
              <td>{fmt(row.turnover, 1)}%</td><td>{fmt(row.floatCap / 1e8, 1)} 亿</td><td>{row.sector}</td>
              <td className={inMain ? "up" : "flat"}>{inMain ? "主线梯队内" : "独立题材/非主流"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>)}
      {!data.ladders.length && <p className="review-note-line">当日无符合条件的涨停标的。</p>}
    </section>

    <section className="panel review-section">
      <h2>三、题材主线研判</h2>
      <table className="review-table">
        <thead><tr><th>排名</th><th>板块</th><th>综合分</th><th>涨停家数</th><th>连板数</th><th>最高板</th><th>成交额变化(近似)</th><th>近3日涨停数</th><th>梯队完整性</th><th>持续性</th><th>结论</th></tr></thead>
        <tbody>{data.sectors.slice(0, 12).map((item: SectorLine) => <tr key={item.sector}>
          <td>{item.rank}</td><td>{item.sector}</td><td>{item.score.toFixed(1)}</td><td>{item.limitUpCount}</td><td>{item.boardsInSector}</td>
          <td>{item.maxLbc} 板</td><td className={toneOf(item.amountChange)}>{item.amountChange === null ? "—" : pct(item.amountChange, 1)}</td>
          <td>{item.threeDayCounts.join(" / ")}</td>
          <td>{item.ladderComplete ? "完整" : "不完整"}</td><td>{item.persistent ? "有延续" : "单日"}</td>
          <td className={item.kind === "第一主线" ? "up" : item.kind === "伪题材风险" ? "down" : "flat"}>{item.kind}</td>
        </tr>)}</tbody>
      </table>
      <p className="review-note-line">三重校验：① 梯队完整性＝板块内最高板 ≥3 板且 2 板以上 ≥2 只；② 持续性＝近 3 个交易日中至少 2 日有涨停；③ 催化强度＝{mainline[0]?.catalyst || "需人工核对"}。</p>
      {pseudo.length > 0 && <p className="review-note-line">伪题材 / 边缘化风险标注：{pseudo.slice(0, 8).map((item) => item.sector).join("、")}（题材属性偏风格、状态或单日情绪，缺乏梯队与延续性）。</p>}
    </section>

    <section className="panel review-section">
      <h2>四、主线龙头候选池【量化打分排名｜实际流通市值 14~50 亿】</h2>
      <table className="review-table">
        <thead><tr><th>排名</th><th>标的</th><th>代码</th><th>板块</th><th>连板</th><th>流通市值(亿)</th><th>换手</th><th>封单占流通盘</th><th>总分</th><th>分项(板/封/换/筹)</th><th>定位</th><th>风险标签</th></tr></thead>
        <tbody>{data.dragons.map((item: DragonScore) => <tr key={item.code}>
          <td>{item.rank}</td><td>{item.name}</td><td>{item.code}</td><td>{item.sector}</td><td>{item.lbc} 板</td>
          <td>{fmt(item.floatCap / 1e8, 1)}</td><td>{fmt(item.turnover, 1)}%</td>
          <td>{item.sealText}</td>
          <td className={scoreClass(item.parts.seal === null ? item.total * 4 / 3 : item.total)}>{item.total.toFixed(1)}{item.parts.seal === null ? "*" : ""}</td>
          <td>{item.parts.position} / {item.parts.seal === null ? "—" : item.parts.seal} / {item.parts.turnover} / {item.parts.chips}</td>
          <td className={roleClass(item.role)}>{item.role}</td>
          <td>{item.risks.length ? item.risks.join("、") : "—"}</td>
        </tr>)}</tbody>
      </table>
      {data.dragons.length === 0 && <p className="review-note-line">主线板块内无 14~50 亿实际流通市值标的，本次不产生打分排名。</p>}
      {data.dragons.some((item) => item.parts.seal === null) && <p className="review-note-line">带 * 的标的封单数据不可得，该项不计分，总分按 75 分制折算展示（原始分 {data.dragons.filter((item) => item.parts.seal === null).map((item) => item.total.toFixed(1)).join("、")}）。</p>}

      <h3>主线其他标的观察区（市值出界，不参与打分）</h3>
      <table className="review-table">
        <thead><tr><th>标的</th><th>代码</th><th>板块</th><th>连板</th><th>实际流通市值(亿)</th><th>换手</th><th>封单占流通盘</th></tr></thead>
        <tbody>{data.watchlist.map((row: PoolRow) => <tr key={row.code}>
          <td>{row.name}</td><td>{row.code}</td><td>{row.sector}</td><td>{row.lbc} 板</td>
          <td>{fmt(row.floatCap / 1e8, 1)}</td><td>{fmt(row.turnover, 1)}%</td><td>{pct(row.sealRatio, 2)}</td>
        </tr>)}</tbody>
      </table>
      {!data.watchlist.length && <p className="review-note-line">无出界标的。</p>}
    </section>

    <section className="panel review-section">
      <h2>五、赚钱 / 亏钱效应总结</h2>
      <div className="review-metrics">
        {[
          ["昨日涨停股平均收益", `${sgn(data.money.avgReturn)}%`], ["中位数收益", `${sgn(data.money.medianReturn)}%`],
          ["红盘率", pct(data.money.winRate, 1)], ["一进二晋级率(平滑)", pct(data.money.promotionRate, 1)],
          ["大面比例(≤-5%)", pct(data.money.bigLossShare, 1)], ["昨日涨停家数", `${data.money.prevLimitUpCount} 家`],
          ["昨涨停今跌停", `${data.money.limitDownNames.length} 只`], ["跌停来源：高位 / 其他", `${data.money.limitDownSources.high} / ${data.money.limitDownSources.other}`],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {data.money.limitDownNames.length > 0 && <p className="review-note-line">昨涨停今跌停名单：{data.money.limitDownNames.map((item) => `${item.name}(${item.code}) ${sgn(item.changePercent)}%`).join("、")}</p>}
      {data.money.highBrokenNames.length > 0 && <p className="review-note-line">高位断板 / 回撤（三板及以上今日收跌）：{data.money.highBrokenNames.slice(0, 12).map((item) => `${item.name} ${item.ylbc}板 ${sgn(item.changePercent)}%`).join("、")}</p>}
    </section>

    <section className="panel review-section">
      <h2>六、盘后重要催化消息汇总</h2>
      <p className="review-note-line">个股公告 / 行业政策资讯接口当日不可用，本节仅呈现可获取的龙虎榜席位数据；公告与政策催化需人工核对，报告不做推断。</p>
      <table className="review-table">
        <thead><tr><th>标的</th><th>代码</th><th>涨跌幅</th><th>上榜原因</th><th>龙虎榜净买入</th><th>买入席位</th><th>卖出席位</th></tr></thead>
        <tbody>{data.billboard.map((row) => <tr key={row.code}>
          <td>{row.name}{row.isMainLine ? "（涨停/主线）" : ""}</td><td>{row.code}</td>
          <td className={toneOf(row.changePercent)}>{sgn(row.changePercent)}%</td>
          <td>{row.explain || "—"}</td>
          <td className={toneOf(row.netAmount)}>{money(row.netAmount)}</td>
          <td>{row.buySeats.length ? row.buySeats.join("；") : "数据获取失败"}</td>
          <td>{row.sellSeats.length ? row.sellSeats.join("；") : "数据获取失败"}</td>
        </tr>)}</tbody>
      </table>
      {!data.billboard.length && <p className="review-note-line">龙虎榜数据获取失败或当日无上榜记录。</p>}
    </section>

    <section className="panel review-section">
      <h2>七、明日观察要点（仅观察维度，不含任何操作建议）</h2>
      <ul className="review-notes">
        <li>空间高度：当前最高 {data.market.maxLbc} 板，需验证高位股次日是否维持封板与接力高度，是否出现断板后的负反馈扩散。</li>
        <li>主线延续：{mainline[0]?.sector || "主题材"}板块今日涨停 {mainline[0]?.limitUpCount ?? 0} 家，需验证次日涨停家数与成交额（近似口径）是否同步，判断是否为主升延续或退潮。</li>
        <li>梯队健康度：当前 2 板 / 3 板以上家数为 {data.ladders.filter((item) => item.boards === 2).reduce((sum, item) => sum + item.rows.length, 0)} / {data.ladders.filter((item) => item.boards >= 3).reduce((sum, item) => sum + item.rows.length, 0)}，需验证晋级率是否维持。</li>
        <li>风险信号：炸板率 {fmt(data.market.brokenRate, 1)}%、大面比例 {pct(data.money.bigLossShare, 1)}%、跌停 {data.market.limitDownCount} 家，需验证是否继续放大。</li>
        <li>伪题材风险：{pseudo.length ? pseudo.slice(0, 6).map((item) => item.sector).join("、") : "无"} 属于单日情绪型题材，需验证是否具备次日承接。</li>
      </ul>
    </section>

    <section className="panel review-section">
      <h2>口径说明</h2>
      <ul className="review-notes">{data.notes.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>

    <p className="review-disclaimer">本内容仅盘面客观复盘，不构成任何投资建议，股市有风险，入市需谨慎。</p>
  </main>;
}
