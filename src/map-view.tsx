// 地図：市区町村を推計患者数で塗り分け、病院を件数（院内がん登録または DPC）の大きさの丸で重ねる。
import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { formatCount } from "./lib/estimate";
import { shareStep, shortHospitalName, spreadOffsets, type HospitalPoint } from "./lib/hospitals";

type Props = { N03_004: string | null; N03_003: string | null; N03_007: string | null };

export type MuniValue = { code: string; name: string; value: number; population: number };

const W = 760;
const H = 640;
/** 塗り分けの5段階（青の濃淡） */
const STEPS = ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0284c7"];
/** 病院の丸を割合で塗るときの5段階（橙の濃淡、0〜19%・20〜39%…80%以上） */
const SHARE_STEPS = ["#fde0c5", "#fbb47e", "#f4843f", "#d9600f", "#9a3d07"];
const NO_SHARE = "#cbd5e1";

/** 病院の丸の色を、割合（内訳）で塗るとき */
export type ColorBy = { label: string; pctOf: (id: string) => number | null };

function useGeo(prefCode: number) {
  const [geo, setGeo] = useState<FeatureCollection<Geometry, Props> | null>(null);
  useEffect(() => {
    let alive = true;
    setGeo(null);
    fetch(`/geo/${String(prefCode).padStart(2, "0")}.json`)
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, Object.values(topo.objects)[0]) as unknown as FeatureCollection<Geometry, Props>;
        if (alive) setGeo(fc);
      })
      .catch(() => alive && setGeo({ type: "FeatureCollection", features: [] }));
    return () => { alive = false; };
  }, [prefCode]);
  return geo;
}

/** 値を5段階に分ける区切り（分位）。 */
function breaks(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [0, 0, 0, 0];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}

export function MapView({ prefCode, values, perCapita, points, countLabel, selected, onToggle, colorBy, picked, onPick }: {
  prefCode: number;
  values: Map<string, MuniValue>;
  perCapita: boolean;
  /** 件数の多い順の病院 */
  points: HospitalPoint[];
  /** 丸の大きさが表すもの（例「院内がん登録 多発性骨髄腫 2023年診断の新規登録数」） */
  countLabel: string;
  selected: Set<string>;
  onToggle: (code: string) => void;
  colorBy?: ColorBy | null;
  /** 選んだ病院（太い枠で示す） */
  picked?: string | null;
  onPick?: (id: string) => void;
}) {
  const geo = useGeo(prefCode);
  const [hover, setHover] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);

  const shown = (v: MuniValue | undefined) => (v ? (perCapita ? (v.value / v.population) * 1e5 : v.value) : 0);
  const cuts = useMemo(() => breaks([...values.values()].map(shown)), [values, perCapita]);
  const colorOf = (x: number) => (x <= 0 ? "#f1f5f9" : STEPS[cuts.filter((c) => x > c).length]);

  const drawn = useMemo(() => {
    if (!geo || geo.features.length === 0) return null;
    const projection = geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], geo);
    const path = geoPath(projection);
    const centroid = new Map<string, [number, number]>();
    // 島などで複数の図形に分かれていても、市区町村ごとに一番大きい図形の中心を使う
    const area = new Map<string, number>();
    for (const f of geo.features) {
      const code = f.properties.N03_007;
      if (!code) continue;
      const a = path.area(f);
      if (a > (area.get(code) ?? -1)) {
        area.set(code, a);
        centroid.set(code, path.centroid(f) as [number, number]);
      }
    }
    return { path, centroid, projection };
  }, [geo]);

  const markers = useMemo(() => {
    if (!drawn) return [];
    const byMuni = new Map<string, HospitalPoint[]>();
    for (const p of points) byMuni.set(p.h.muni, [...(byMuni.get(p.h.muni) ?? []), p]);
    const max = Math.max(...points.map((p) => p.value), 1);
    return [...byMuni].flatMap(([muni, list]) => {
      const c = drawn.centroid.get(muni);
      if (!c) return [];
      // 位置がわかる病院はその場所に、わからない病院は市区町村の中心のまわりに少しずつずらして置く
      const offsets = spreadOffsets(list.length, 10);
      return list.map((p, i) => {
        const at = p.h.ll ? drawn.projection(p.h.ll) : null;
        return { ...p, x: at ? at[0] : c[0] + offsets[i][0], y: at ? at[1] : c[1] + offsets[i][1], r: 3 + Math.sqrt(p.value / max) * 15 };
      });
    }).sort((a, b) => b.r - a.r);
  }, [drawn, points]);

  if (!geo) return <div className="flex h-96 items-center justify-center text-sm text-slate-500">地図を読み込み中…</div>;
  if (!drawn) return <div className="flex h-96 items-center justify-center text-sm text-slate-500">この都道府県の地図がありません</div>;

  const unit = perCapita ? "人／10万人" : "人／年";
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="市区町村ごとの推計患者数と病院の地図" onMouseLeave={() => setHover(null)}>
        <g>
          {geo.features.map((f: Feature<Geometry, Props>, i) => {
            const code = f.properties.N03_007 ?? "";
            const v = values.get(code);
            const on = selected.has(code);
            return (
              <path
                key={`${code}-${i}`}
                d={drawn.path(f) ?? undefined}
                fill={colorOf(shown(v))}
                stroke={on ? "#0f172a" : "#ffffff"}
                strokeWidth={on ? 2 : 0.6}
                className="cursor-pointer"
                onClick={() => code && onToggle(code)}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                    html: v ? (
                      <>
                        <b>{v.name}</b>
                        <br />推計 {formatCount(v.value)}人／年（10万人あたり {formatCount((v.value / v.population) * 1e5)}）
                        <br />人口 {v.population.toLocaleString("ja-JP")}
                      </>
                    ) : (
                      <b>{f.properties.N03_004}</b>
                    ),
                  });
                }}
              />
            );
          })}
        </g>
        <g>
          {markers.map(({ h, label, x, y, r }) => {
            const pct = colorBy ? colorBy.pctOf(h.id) : null;
            return (
            <circle
              key={h.id}
              cx={x}
              cy={y}
              r={r}
              fill={!colorBy ? "#ea580c" : pct == null ? NO_SHARE : SHARE_STEPS[shareStep(pct)]}
              fillOpacity={colorBy ? 0.95 : 0.85}
              stroke={picked === h.id ? "#0f172a" : "#ffffff"}
              strokeWidth={picked === h.id ? 3 : 1.5}
              className={onPick ? "cursor-pointer" : undefined}
              onClick={() => onPick?.(h.id)}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  html: (
                    <>
                      <b>{shortHospitalName(h.name)}</b>
                      <br />{countLabel}：{label}件
                      {h.beds > 0 && <><br />{h.beds}床</>}
                      {h.hbcr && <><br />院内がん登録：{h.hbcr}</>}
                      {colorBy && <><br />{colorBy.label}：{pct == null ? "公表なし（10件未満）" : `${pct}%`}</>}
                      {onPick && <><br /><span className="text-slate-300">押すと、この病院の患者の流れを下の地図に出します</span></>}
                    </>
                  ),
                });
              }}
            />
            );
          })}
        </g>
        <g pointerEvents="none">
          {/* 件数の多い上位5病院は名前を出す */}
          {markers.slice(0, 5).map(({ h, x, y, r }) => (
            <text key={h.id} x={x} y={y - r - 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#7c2d12" stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {shortHospitalName(h.name)}
            </text>
          ))}
        </g>
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-md bg-slate-900/90 px-2 py-1 text-xs leading-relaxed text-white shadow"
          style={{ left: Math.min(hover.x + 12, 520), top: hover.y + 12 }}
        >
          {hover.html}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          推計患者数（{unit}）
          {STEPS.map((c, i) => (
            <span key={c} className="flex items-center gap-0.5">
              <span className="inline-block h-3 w-4 rounded-sm" style={{ background: c }} />
              {i === 0 ? `〜${formatCount(cuts[0])}` : i === STEPS.length - 1 ? `${formatCount(cuts[3])}〜` : ""}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1">
          {!colorBy && <span className="inline-block h-3 w-3 rounded-full bg-orange-600" />}
          病院（丸の大きさ＝{countLabel}）
        </span>
        {colorBy && (
          <span className="flex items-center gap-1">
            丸の色＝{colorBy.label}
            {SHARE_STEPS.map((c, i) => (
              <span key={c} className="flex items-center gap-0.5"><span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />{i === 0 ? "0%" : i === SHARE_STEPS.length - 1 ? "80%〜" : ""}</span>
            ))}
            <span className="ml-1 flex items-center gap-0.5"><span className="inline-block h-3 w-3 rounded-full" style={{ background: NO_SHARE }} />公表なし</span>
          </span>
        )}
        <span>市区町村を押すと選択できます</span>
      </div>
    </div>
  );
}
