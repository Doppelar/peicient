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
