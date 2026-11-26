// 推移のグラフ・表の中の小さな折れ線・内訳の横棒。
import { useState } from "react";
import { niceTicks, spreadLabels } from "./lib/chart";

/** 1年分の値。幅で公表された件数は lo〜hi（同じなら1つの値）。なければ null */
export type Point = { lo: number; hi: number } | null;
export type Series = { name: string; label?: string; values: Point[] };

/** 系列の色（固定の順番。色だけに頼らないよう線の端に名前も書く） */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const INK = "#0b0b0b";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASE = "#c3c2b7";

/** 最後に値のある位置（なければ -1） */
const lastIndex = (values: Point[]) => values.reduce((k, p, i) => (p ? i : k), -1);
const mid = (p: NonNullable<Point>) => (p.lo + p.hi) / 2;
export const formatPoint = (p: Point) => (!p ? "—" : p.lo === p.hi ? p.lo.toLocaleString("ja-JP") : `${p.lo}〜${p.hi}`);

/** 線を null のところで切って描く d 属性 */
function linePath(values: Point[], x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let pen = false;
  values.forEach((p, i) => {
    if (!p) return void (pen = false);
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(mid(p)).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** 年ごとの推移の折れ線（マウスを重ねると、その年の値を出す）。系列が1つなら凡例なし */
export function TrendChart({ years, series, unit = "人", height = 240 }: { years: number[]; series: Series[]; unit?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const multi = series.length > 1;
  const W = 640;
  const H = height;
  const m = { l: 40, r: multi ? 150 : 20, t: 14, b: 26 };
  const pad = 18; // 端の点と目盛りの数字が重ならないよう、内側に寄せる
  const all = series.flatMap((s) => s.values.filter((p): p is NonNullable<Point> => !!p).map((p) => p.hi));
  const ticks = niceTicks(Math.max(1, ...all));
  const top = ticks.at(-1)!;
  const x = (i: number) => m.l + pad + (years.length === 1 ? (W - m.l - m.r) / 2 - pad : (i * (W - m.l - m.r - 2 * pad)) / (years.length - 1));
  const y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b);
  // 線の端（最後に値のある年）に名前を書く
  const ends = series.map((s) => {
    const i = lastIndex(s.values);
    return i < 0 ? null : { i, v: mid(s.values[i]!) };
  });
  const labelY = spreadLabels(ends.map((e) => (e ? y(e.v) : H)), 13, m.t, H - m.b);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * (W - m.l - m.r) - pad;
    setHover(Math.max(0, Math.min(years.length - 1, Math.round((px / (W - m.l - m.r - 2 * pad)) * (years.length - 1)))));
  };

  return (
    <div className="relative">
      {multi && (
        <ul className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
          {series.map((s, k) => (
            <li key={s.name} className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES_COLORS[k] }} />{s.name}</li>
          ))}
        </ul>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${series.map((s) => s.name).join("・")}の推移`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASE : GRID} strokeWidth={1} />
            <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED}>{t}</text>
          </g>
        ))}
        {years.map((yr, i) => (
          <text key={yr} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={hover === i ? INK : MUTED}>{yr}</text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke={BASE} strokeWidth={1} />}
        {series.map((s, k) => {
          const color = SERIES_COLORS[k];
          return (
            <g key={s.name}>
              <path d={linePath(s.values, x, y)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((p, i) => p && (
                <g key={i}>
                  {p.lo !== p.hi && <line x1={x(i)} x2={x(i)} y1={y(p.lo)} y2={y(p.hi)} stroke={color} strokeWidth={2} strokeOpacity={0.45} strokeLinecap="round" />}
                  <circle cx={x(i)} cy={y(mid(p))} r={hover === i ? 5 : 4} fill={color} stroke="#fff" strokeWidth={2} />
                </g>
              ))}
              {multi && ends[k] && (
                <text x={x(ends[k]!.i) + 9} y={labelY[k]} dominantBaseline="middle" fontSize={11} fill={INK}>
                  {(s.label ?? s.name).slice(0, 12)}
                </text>
              )}
              {!multi && s.values.map((p, i) => p && (
                <text key={`v${i}`} x={x(i)} y={y(p.hi) - 10} textAnchor="middle" fontSize={11} fill={INK}>{formatPoint(p)}</text>
              ))}
            </g>
          );
        })}
        <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%`, top: multi ? 24 : 0, transform: hover > years.length / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
        >
          <p className="font-semibold text-slate-800">{years[hover]}年</p>
          {series.map((s, k) => (
            <p key={s.name} className="flex items-center justify-between gap-3 text-slate-600">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[k] }} />{s.name}</span>
              <span className="tabular-nums text-slate-900">{formatPoint(s.values[hover])}{s.values[hover] ? unit : ""}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** 表の中の小さな折れ線（古い年→新しい年）。幅のある件数は縦の線で示す */
export function Sparkline({ years, values, unit = "" }: { years: number[]; values: Point[]; unit?: string }) {
  const W = 92;
  const H = 26;
  const max = Math.max(1, ...values.map((p) => p?.hi ?? 0));
  const x = (i: number) => 4 + (years.length === 1 ? 0 : (i * (W - 8)) / (years.length - 1));
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const last = lastIndex(values);
  const title = years.map((yr, i) => `${yr}年：${formatPoint(values[i])}${values[i] ? unit : ""}`).join("\n");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="inline-block align-middle">
      <title>{title}</title>
      <line x1={2} x2={W - 2} y1={H - 4} y2={H - 4} stroke={GRID} />
      <path d={linePath(values, x, y)} fill="none" stroke={SERIES_COLORS[0]} strokeWidth={1.5} strokeLinejoin="round" />
      {values.map((p, i) => p && (
        <g key={i}>
          {p.lo !== p.hi && <line x1={x(i)} x2={x(i)} y1={y(p.lo)} y2={y(p.hi)} stroke={SERIES_COLORS[0]} strokeOpacity={0.45} strokeWidth={1.5} />}
          <circle cx={x(i)} cy={y(mid(p))} r={i === last ? 2.6 : 1.6} fill={SERIES_COLORS[0]} />
        </g>
      ))}
    </svg>
  );
}

/** 内訳の横棒（行ごとに割合の長さの棒と件数）。 */
export function ShareBars({ rows }: { rows: Array<{ label: string; count: string; pct: number | null; share: string }> }) {
  return (
    <ul className="mt-1 space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2">
          <span className="truncate text-slate-600" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-sm bg-slate-200/70">
            <span className="block h-full rounded-sm" style={{ width: `${r.pct ?? 0}%`, background: SERIES_COLORS[0] }} />
          </span>
          <span className="w-20 text-right tabular-nums text-slate-700">{r.count}<span className="text-slate-500">（{r.share}）</span></span>
        </li>
      ))}
    </ul>
  );
}

/** 表のセルの割合に添える細い棒 */
export function ShareCell({ text, pct }: { text: string; pct: number | null }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span>{text}</span>
      {pct != null && (
        <span className="h-1.5 w-10 rounded-sm bg-slate-200/70" aria-hidden>
          <span className="block h-full rounded-sm" style={{ width: `${pct}%`, background: SERIES_COLORS[0] }} />
        </span>
      )}
    </span>
  );
}

/** 年齢のまとまりの色（若い→高齢を薄い→濃い青で） */
export const AGE_COLORS = { under70: "#9ec5f4", age70s: "#3987e5", over80: "#184f95" };

/** 70歳未満・70〜79歳・80歳以上の割合の帯と人数 */
export function AgeSplit({ g, format }: { g: { under70: number; age70s: number; over70: number; over80: number }; format: (n: number) => string }) {
  const total = g.under70 + g.over70 || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const parts: Array<[string, number, string]> = [["70歳未満", g.under70, AGE_COLORS.under70], ["70〜79歳", g.age70s, AGE_COLORS.age70s], ["80歳以上", g.over80, AGE_COLORS.over80]];
  const item = (label: string, n: number, swatches: string[]) => (
    <div>
      <dt className="flex items-center gap-1 text-slate-500">
        <span className="flex">{swatches.map((c) => <span key={c} className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />)}</span>
        {label}
      </dt>
      <dd className="font-semibold tabular-nums text-slate-800">{format(n)}人 <span className="font-normal text-slate-500">{pct(n)}%</span></dd>
    </div>
  );
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-sm" role="img" aria-label={parts.map(([l, n]) => `${l} ${format(n)}人`).join("、")}>
        {parts.map(([l, n, c]) => n > 0 && <span key={l} style={{ width: `${(n / total) * 100}%`, background: c }} title={`${l}：${format(n)}人（${pct(n)}%）`} />)}
      </div>
      <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
        {item("70歳未満", g.under70, [AGE_COLORS.under70])}
        {item("70歳以上", g.over70, [AGE_COLORS.age70s, AGE_COLORS.over80])}
        {item("うち80歳以上", g.over80, [AGE_COLORS.over80])}
      </dl>
    </div>
  );
}

/** 上の角だけ丸い棒 */
function roundedTop(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** 5歳階級ごとの人数の縦棒（70歳以上・80歳以上を濃い色で） */
export function AgeHistogram({ byAge, labels, format }: { byAge: number[]; labels: string[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const m = { l: 40, r: 8, t: 12, b: 34 };
  const ticks = niceTicks(Math.max(...byAge, 0.1));
  const top = ticks.at(-1)!;
  const bw = (W - m.l - m.r) / byAge.length;
  const y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b);
  const color = (i: number) => (i >= 16 ? AGE_COLORS.over80 : i >= 14 ? AGE_COLORS.age70s : AGE_COLORS.under70);
  const mark = (i: number, label: string, dy: number) => (
    <g>
      <line x1={m.l + i * bw} x2={m.l + i * bw} y1={m.t + dy} y2={H - m.b + 4} stroke={MUTED} strokeDasharray="3 3" />
      <text x={m.l + i * bw + 4} y={m.t + dy + 10} fontSize={11} fill={INK}>{label}</text>
    </g>
  );
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="年齢別の推計患者数">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASE : GRID} />
            <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED}>{t}</text>
          </g>
        ))}
        {byAge.map((v, i) => (
          <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <rect x={m.l + i * bw} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" />
            <path d={roundedTop(m.l + i * bw + 1, y(v), bw - 2, H - m.b - y(v))} fill={color(i)} opacity={hover == null || hover === i ? 1 : 0.6} />
            {i % 2 === 0 && <text x={m.l + i * bw + bw / 2} y={H - m.b + 14} textAnchor="middle" fontSize={10} fill={MUTED}>{i * 5}</text>}
          </g>
        ))}
        <text x={m.l + 17.5 * bw} y={H - m.b + 14} textAnchor="middle" fontSize={10} fill={MUTED}>85+</text>
        <text x={W - m.r} y={H - 4} textAnchor="end" fontSize={10} fill={MUTED}>歳</text>
        {mark(14, "70歳", 0)}
        {mark(16, "80歳", 16)}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: `${((m.l + (hover + 0.5) * bw) / W) * 100}%`, top: 0, transform: hover > 11 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}>
          <p className="font-semibold text-slate-800">{labels[hover]}</p>
          <p className="tabular-nums text-slate-600">{format(byAge[hover])}人／年</p>
        </div>
      )}
    </div>
  );
}
