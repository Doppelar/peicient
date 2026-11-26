// 患者の移動の地図：院内がん登録の「住所」から、都道府県をまたいで受診した患者さんを矢印で描く。
// 青＝他県から選んだ都道府県の病院へ来た人、橙＝選んだ都道府県に住んでいて他県の病院へ行った人。
import { useEffect, useMemo, useState } from "react";
import { geoArea, geoCentroid, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry, MultiPoint, MultiPolygon } from "geojson";
import { formatReg, regValue, type RegDetailCount } from "./lib/hospitals";
import { flowsOf, hospitalInflow, sumFlow, type Flow, type PrefFlow } from "./lib/flows";

type PrefProps = { code: number; name: string; center: [number, number]; box: [number, number, number, number] };
type Japan = FeatureCollection<MultiPolygon, PrefProps>;

const W = 760;
const H = 560;
const IN = "#2563eb";
const OUT = "#ea580c";

function useJapan() {
  const [japan, setJapan] = useState<Japan | null>(null);
  useEffect(() => {
    fetch("/geo/japan.json").then((r) => r.json()).then(setJapan).catch(() => setJapan(null));
  }, []);
  return japan;
}

/** 市区町村（コード5桁）の中心の経度・緯度。病院の位置に使う */
function useMuniCenter(muni: string | undefined) {
  const [center, setCenter] = useState<[number, number] | null>(null);
  useEffect(() => {
    setCenter(null);
    if (!muni) return;
    let alive = true;
    fetch(`/geo/${muni.slice(0, 2)}.json`)
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, Object.values(topo.objects)[0]) as unknown as FeatureCollection<Geometry, { N03_007: string | null }>;
        // 島などで分かれていても、一番大きい図形の中心
        const parts = fc.features.filter((x) => x.properties.N03_007 === muni).sort((a, b) => geoArea(b) - geoArea(a));
        if (alive && parts[0]) setCenter(geoCentroid(parts[0]));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [muni]);
  return center;
}

/** 病院を選んだときの移動：病院の名前・所在市区町村と、他県から来た人 */
export type HospitalFlow = { name: string; muni: string; ll?: [number, number]; from: ReadonlyArray<[number, RegDetailCount]> };

/** a→b の弧（進行方向の右へふくらませ、行きと帰りが重ならないように）。端は丸に重ならないよう少し縮める。 */
function arc(a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const pad = Math.min(14, len / 4);
  const s: [number, number] = [a[0] + ux * pad, a[1] + uy * pad];
  const e: [number, number] = [b[0] - ux * pad, b[1] - uy * pad];
  const bend = Math.min(40, len * 0.18);
  const c: [number, number] = [(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend];
  // 弧の中ほど（ラベルの位置）
  const mid: [number, number] = [(s[0] + 2 * c[0] + e[0]) / 4, (s[1] + 2 * c[1] + e[1]) / 4];
  return { d: `M${s[0]},${s[1]} Q${c[0]},${c[1]} ${e[0]},${e[1]}`, mid };
}

export function FlowMap({ prefCode, flows, year, site, hospital }: { prefCode: number; flows: Flow[]; year: number; site: string; hospital?: HospitalFlow }) {
  const japan = useJapan();
  // 病院の位置：わかればその場所、わからなければ所在市区町村の中心
  const muniCenter = useMuniCenter(hospital && !hospital.ll ? hospital.muni : undefined);
  const hospitalAt = hospital?.ll ?? muniCenter;
  const { inflow, outflow } = useMemo(
    () => (hospital ? { inflow: hospitalInflow(hospital.from), outflow: [] } : flowsOf(flows, prefCode)),
    [flows, prefCode, hospital],
  );

  const drawn = useMemo(() => {
    if (!japan) return null;
    const self = japan.features.find((f) => f.properties.code === prefCode);
    if (!self) return null;
    const partners = new Set([...inflow, ...outflow].map((f) => f.code));
    // 選んだ都道府県と、近く（中心どうし約4度以内）で行き来のある都道府県が入るように寄せる。遠い県は地図の端に置く
    const [hx, hy] = self.properties.center;
    const near = (f: (typeof japan.features)[number]) => Math.hypot(f.properties.center[0] - hx, f.properties.center[1] - hy) <= 4;
    const focus: MultiPoint = {
      type: "MultiPoint",
      coordinates: japan.features.filter((f) => f.properties.code === prefCode || (partners.has(f.properties.code) && near(f))).flatMap(({ properties: { box: [x0, y0, x1, y1] } }) => [[x0, y0], [x1, y1]]),
    };
    const projection = geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], focus);
    const path = geoPath(projection);
    const home = projection(hospital && hospitalAt ? hospitalAt : self.properties.center) as [number, number];
    // 地図の外に出る県は、自県からその県へ向かう線が地図の枠（少し内側）に当たる点に置く
    const M = 36;
    const clamp = (p: [number, number]): { p: [number, number]; far: boolean } => {
      if (p[0] >= M && p[0] <= W - M && p[1] >= M && p[1] <= H - M) return { p, far: false };
      const [dx, dy] = [p[0] - home[0], p[1] - home[1]];
      const t = Math.min(
        dx > 0 ? (W - M - home[0]) / dx : dx < 0 ? (M - home[0]) / dx : Infinity,
        dy > 0 ? (H - M - home[1]) / dy : dy < 0 ? (M - home[1]) / dy : Infinity,
      );
      return { p: [home[0] + dx * t, home[1] + dy * t], far: true };
    };
    const placed = new Map(japan.features.map((f) => [f.properties.code, clamp(projection(f.properties.center) as [number, number])]));
    if (!hospital) placed.set(prefCode, { p: home, far: false });
    const center = new Map([...placed].map(([c, v]) => [c, v.p]));
    const name = new Map(japan.features.map((f) => [f.properties.code, f.properties.name]));
    return { path, center, name, partners, placed, home };
  }, [japan, prefCode, inflow, outflow, hospital, hospitalAt]);

  if (!japan) return <div className="flex h-64 items-center justify-center text-sm text-slate-500">地図を読み込み中…</div>;
  if (!drawn) return null;

  const max = Math.max(1, ...[...inflow, ...outflow].map((f) => regValue(f.count)));
  const width = (f: PrefFlow) => 1.2 + Math.sqrt(regValue(f.count) / max) * 7;
  // 矢印の行き先：県全体なら県の中心、病院を選んだら病院の所在地
  const home = drawn.home;
  const prefName = drawn.name.get(prefCode) ?? "";
  /** 矢印の行き先の名前（県全体なら都道府県、病院を選んだら病院） */
  const selfName = hospital?.name ?? prefName;
  const dest = hospital ? selfName : `${selfName}の病院`;
  const arrows = [
    ...inflow.map((f) => ({ f, dir: "in" as const, ...arc(drawn.center.get(f.code)!, home) })),
    ...outflow.map((f) => ({ f, dir: "out" as const, ...arc(home, drawn.center.get(f.code)!) })),
  ].sort((a, b) => regValue(a.f.count) - regValue(b.f.count)); // 太い矢印を上に
  // 件数を書くのは大きいものだけ（重なりを避ける）
  const labeled = new Set(arrows.filter((a) => a.f.count[0] >= 4).map((a) => a));

  const list = (title: string, items: PrefFlow[], color: string) => (
    <div>
      <p className="font-semibold" style={{ color }}>{title}</p>
      {items.length === 0 ? <p className="text-slate-400">なし</p> : (
        <ul className="mt-0.5 space-y-0.5 text-slate-600">
          {items.map((f) => (
            <li key={f.code} className="flex justify-between gap-3"><span>{drawn.name.get(f.code)}</span><span className="tabular-nums">{formatReg(f.count)}件</span></li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${selfName}をまたぐ患者の移動の地図`}>
        <defs>
          {[["in", IN], ["out", OUT]].map(([id, color]) => (
            <marker key={id} id={`flow-head-${id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={color} />
            </marker>
          ))}
          <clipPath id="flow-clip"><rect width={W} height={H} /></clipPath>
        </defs>
        <g clipPath="url(#flow-clip)">
          {japan.features.map((f) => (
            <path
              key={f.properties.code}
              d={drawn.path(f) ?? undefined}
              fill={f.properties.code === prefCode ? "#cbd5e1" : drawn.partners.has(f.properties.code) ? "#f1f5f9" : "#f8fafc"}
              stroke="#ffffff"
              strokeWidth={1}
            />
          ))}
          {japan.features
            // 病院を選んだときは、病院の名前と重ならないよう自県の名前は出さない
            .filter((f) => (f.properties.code === prefCode && !hospital) || drawn.partners.has(f.properties.code))
            .map((f) => {
              const { p: [x, y], far } = drawn.placed.get(f.properties.code)!;
              return (
                <text key={f.properties.code} x={x} y={far ? (y > H / 2 ? y + 18 : y - 10) : f.properties.code === prefCode && !hospital ? y - 22 : y + 16} textAnchor="middle" fontSize={f.properties.code === prefCode && !hospital ? 14 : 11} fontWeight={f.properties.code === prefCode && !hospital ? 700 : 400} fill="#334155" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                  {f.properties.name}{drawn.placed.get(f.properties.code)!.far ? "方面" : ""}
                </text>
              );
            })}
          {arrows.map((a) => (
            <path key={`${a.dir}-${a.f.code}`} d={a.d} fill="none" stroke={a.dir === "in" ? IN : OUT} strokeOpacity={0.8} strokeWidth={width(a.f)} strokeLinecap="round" markerEnd={`url(#flow-head-${a.dir})`}>
              <title>{a.dir === "in" ? `${drawn.name.get(a.f.code)}に住む人 → ${dest}` : `${selfName}に住む人 → ${drawn.name.get(a.f.code)}の病院`}：{formatReg(a.f.count)}件</title>
            </path>
          ))}
          {arrows.filter((a) => labeled.has(a)).map((a) => (
            <text key={`l-${a.dir}-${a.f.code}`} x={a.mid[0]} y={a.mid[1]} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill={a.dir === "in" ? "#1e3a8a" : "#7c2d12"} stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {formatReg(a.f.count)}
            </text>
          ))}
          <circle cx={home[0]} cy={home[1]} r={5} fill="#0f172a" stroke="#fff" strokeWidth={1.5} />
          {hospital && (
            <text x={home[0]} y={home[1] + 20} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a" stroke="#fff" strokeWidth={3} paintOrder="stroke">{hospital.name}</text>
          )}
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-1 w-5 rounded" style={{ background: IN }} />他県から{dest}へ：計{formatReg(sumFlow(inflow))}件</span>
        {!hospital && <span className="flex items-center gap-1"><span className="inline-block h-1 w-5 rounded" style={{ background: OUT }} />{selfName}から他県の病院へ：計{formatReg(sumFlow(outflow))}件</span>}
        <span>線の太さ＝件数（{year}年診断・{site}）。矢印にマウスを重ねると件数が出ます</span>
      </div>
      {inflow.length + outflow.length === 0 && <p className="mt-2 text-sm text-slate-500">この年は都道府県をまたぐ受診の登録がありません。</p>}
    </div>
    <div className="space-y-3 text-xs">
      {list(hospital ? `${prefName}の外から${selfName}へ（計${formatReg(sumFlow(inflow))}件）` : `他県から${selfName}の病院へ（計${formatReg(sumFlow(inflow))}件）`, inflow, IN)}
      {!hospital && list(`${selfName}から他県の病院へ（計${formatReg(sumFlow(outflow))}件）`, outflow, OUT)}
    </div>
    </div>
  );
}
