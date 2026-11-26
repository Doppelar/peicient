import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  addPopulations,
  estimate,
  formatCount,
  isWard,
  type Municipality,
  type Rates,
  type Survival,
} from "./lib/estimate";
import { formatDpc, rankHospitals, shortHospitalName, type Hospital } from "./lib/hospitals";
import { MapView, type MuniValue } from "./map-view";

type Site = { id: string; name: string; icd: string; dpc: string; note: string | null; derived: boolean };
type Meta = {
  incidenceYears: number[];
  populationAsOf: string;
  survivalYear: number;
  dpcYear: string;
  sites: Site[];
  shares: Record<string, { m: number; f: number }>;
  dpcDiseases: Record<string, string>;
  prefs: { code: number; name: string }[];
  ageBins: string[];
};
type Data = {
  meta: Meta;
  rates: Record<string, Record<string, Rates>>;
  survival: Record<string, Survival>;
  municipalities: Municipality[];
  hospitals: Hospital[];
};

const DEFAULT_SITE = "mm";
const DEFAULT_PREF = "群馬県";
const TABS = [
  ["map", "地図"],
  ["areas", "市区町村"],
  ["hospitals", "病院（DPC）"],
] as const;
type Tab = (typeof TABS)[number][0];

function useData() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const get = (name: string) => fetch(`/data/${name}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(name))));
    Promise.all(["meta", "rates", "survival", "municipalities", "hospitals"].map(get))
      .then(([meta, rates, survival, municipalities, hospitals]) => setData({ meta, rates, survival, municipalities, hospitals }))
      .catch(() => setError("データを読み込めませんでした"));
  }, []);
  return { data, error };
}

export default function App() {
  const { data, error } = useData();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold">血液がんの患者数の推計と病院</h1>
          <p className="mt-1 text-sm text-slate-600">
            全国がん登録の罹患率を市区町村の人口に当てはめた推計患者数と、厚生労働省 DPC データの病院ごとの退院件数を、地図と表で見られます。
          </p>
        </header>
        {error && <p className="text-red-600">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-500">読み込み中…</p>}
        {data && <Estimator data={data} />}
      </div>
    </div>
  );
}

function Estimator({ data }: { data: Data }) {
  const { meta } = data;
  const [siteId, setSiteId] = useState(DEFAULT_SITE);
  const [pref, setPref] = useState(DEFAULT_PREF);
  const [rateSource, setRateSource] = useState<"pref" | "national">("pref");
  const [perCapita, setPerCapita] = useState(false);
  const [tab, setTab] = useState<Tab>("map");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const site = meta.sites.find((s) => s.id === siteId) ?? meta.sites[0];
  const prefCode = meta.prefs.find((p) => p.name === pref)?.code ?? 0;
  const rates = data.rates[String(rateSource === "pref" ? prefCode : 0)]?.[site.id] ?? {};
  const survival = data.survival[site.id];
  const dpcLabel = meta.dpcDiseases[site.dpc] ?? "";

  const inPref = useMemo(() => data.municipalities.filter((m) => m.pref === pref), [data, pref]);
  const wardCodes = useMemo(() => new Set(inPref.filter((m) => isWard(m, inPref)).map((m) => m.code)), [inPref]);
  const estimates = useMemo(() => new Map(inPref.map((m) => [m.code, estimate(m, rates, survival)])), [inPref, rates, survival]);
  const prefTotal = useMemo(
    () => estimate(addPopulations(inPref.filter((m) => !wardCodes.has(m.code))), rates, survival),
    [inPref, wardCodes, rates, survival],
  );
  const mapValues = useMemo(
    () => new Map<string, MuniValue>(inPref.map((m) => {
      const e = estimates.get(m.code)!;
      return [m.code, { code: m.code, name: m.name, value: e.annual.total, population: e.population }];
    })),
    [inPref, estimates],
  );
  const hospitals = useMemo(() => rankHospitals(data.hospitals, prefCode, site.dpc), [data.hospitals, prefCode, site.dpc]);
  const muniName = useMemo(() => new Map(data.municipalities.map((m) => [m.code, m.name])), [data.municipalities]);

  const chosen = inPref.filter((m) => selected.has(m.code));
  const chosenTotal = chosen.length ? estimate(addPopulations(chosen), rates, survival) : null;
  const chosenHospitals = hospitals.filter((h) => selected.has(h.muni));
  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">病気</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2">
            {meta.sites.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.icd}）</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">都道府県</span>
          <select value={pref} onChange={(e) => { setPref(e.target.value); setSelected(new Set()); }} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2">
            {meta.prefs.map((p) => <option key={p.code}>{p.name}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium text-slate-700">使う罹患率</legend>
          <div className="flex h-10 items-center gap-4">
            <label className="flex items-center gap-1"><input type="radio" checked={rateSource === "pref"} onChange={() => setRateSource("pref")} />都道府県</label>
            <label className="flex items-center gap-1"><input type="radio" checked={rateSource === "national"} onChange={() => setRateSource("national")} />全国</label>
          </div>
        </fieldset>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium text-slate-700">地図の色</legend>
          <div className="flex h-10 items-center gap-4">
            <label className="flex items-center gap-1"><input type="radio" checked={!perCapita} onChange={() => setPerCapita(false)} />患者数</label>
            <label className="flex items-center gap-1"><input type="radio" checked={perCapita} onChange={() => setPerCapita(true)} />10万人あたり</label>
          </div>
        </fieldset>
      </div>

      {site.note && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{site.note}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Summary title={`${pref}全体`} subtitle={site.name} e={prefTotal} hospitals={hospitals.length} />
        {chosenTotal ? (
          <Summary
            title={`選んだ地域（${chosen.length}）`}
            subtitle={chosen.map((m) => m.name).join("・")}
            e={chosenTotal}
            hospitals={chosenHospitals.length}
            onClear={() => setSelected(new Set())}
          />
        ) : (
          <div className="flex items-center rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            地図の市区町村を押すか、表でチェックすると、担当エリアなどの合計をここに出します。
          </div>
        )}
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1" role="tablist">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${tab === value ? "bg-white shadow-sm" : "text-slate-600 hover:bg-white/60"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "map" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <MapView prefCode={prefCode} values={mapValues} perCapita={perCapita} hospitals={hospitals} dpc={site.dpc} dpcLabel={dpcLabel} selected={selected} onToggle={toggle} />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">病院（{dpcLabel}の退院件数）</h2>
            <p className="mb-2 text-xs text-slate-500">{meta.dpcYear}・上位</p>
            <ol className="space-y-1">
              {hospitals.slice(0, 15).map((h, i) => (
                <li key={h.id} className="flex justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1"><span className="truncate" title={h.name}>{i + 1}. {shortHospitalName(h.name)}</span>{h.hbcr === "拠点病院" && <HbcrBadge status={h.hbcr} />}</span>
                  <span className="shrink-0 tabular-nums font-medium">{formatDpc(h.counts[site.dpc])}</span>
                </li>
              ))}
            </ol>
            {hospitals.length === 0 && <p className="text-slate-500">10件以上の病院がありません</p>}
          </section>
        </div>
      )}

      {tab === "areas" && (
        <AreaTable rows={inPref} wardCodes={wardCodes} estimates={estimates} selected={selected} onToggle={toggle} />
      )}

      {tab === "hospitals" && (
        <HospitalTable hospitals={hospitals} dpc={site.dpc} diseases={meta.dpcDiseases} muniName={muniName} estimates={estimates} dpcYear={meta.dpcYear} />
      )}

      <Notes meta={meta} />
    </div>
  );
}

function Summary({ title, subtitle, e, hospitals, onClear }: {
  title: string; subtitle: string; e: ReturnType<typeof estimate>; hospitals: number; onClear?: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="truncate text-xs text-slate-500" title={subtitle}>{subtitle}</p>
        </div>
        {onClear && <button type="button" onClick={onClear} className="shrink-0 text-xs text-sky-700 underline">選択を外す</button>}
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        <div><dt className="text-xs text-slate-500">人口</dt><dd className="font-semibold tabular-nums">{e.population.toLocaleString("ja-JP")}</dd></div>
        <div><dt className="text-xs text-slate-500">年間新規（推計）</dt><dd className="text-lg font-semibold tabular-nums">{formatCount(e.annual.total)}人</dd></div>
        <div><dt className="text-xs text-slate-500">5年有病者（概算）</dt><dd className="text-lg font-semibold tabular-nums">{e.prevalence5 == null ? "—" : `${formatCount(e.prevalence5)}人`}</dd></div>
        <div><dt className="text-xs text-slate-500">病院（DPC）</dt><dd className="text-lg font-semibold tabular-nums">{hospitals}</dd></div>
      </dl>
    </section>
  );
}

function AreaTable({ rows, wardCodes, estimates, selected, onToggle }: {
  rows: Municipality[]; wardCodes: Set<string>; estimates: Map<string, ReturnType<typeof estimate>>; selected: Set<string>; onToggle: (code: string) => void;
}) {
  const [showWards, setShowWards] = useState(false);
  const [query, setQuery] = useState("");
  const list = rows
    .filter((m) => (showWards || !wardCodes.has(m.code)) && (!query || m.name.includes(query.trim())))
    .map((m) => ({ m, e: estimates.get(m.code)! }))
    .sort((a, b) => b.e.annual.total - a.e.annual.total);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="市区町村を探す" aria-label="市区町村を探す" className="h-9 rounded-md border border-slate-300 pl-8 pr-2" />
        </span>
        {wardCodes.size > 0 && (
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={showWards} onChange={(e) => setShowWards(e.target.checked)} />政令指定都市の区も表示
          </label>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="w-10 px-3 py-2"><span className="sr-only">選ぶ</span></th>
            <th className="px-3 py-2">市区町村</th>
            <th className="px-3 py-2 text-right">人口</th>
            <th className="px-3 py-2 text-right">年間新規（推計）</th>
            <th className="px-3 py-2 text-right">男 / 女</th>
            <th className="px-3 py-2 text-right">5年有病者（概算）</th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ m, e }) => {
            const on = selected.has(m.code);
            return (
              <tr key={m.code} className={`border-t border-slate-100 ${on ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`${m.name}を選ぶ`} checked={on} onChange={() => onToggle(m.code)} /></td>
                <td className={`px-3 py-1.5 ${wardCodes.has(m.code) ? "pl-6 text-slate-600" : "font-medium"}`}>{m.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{e.population.toLocaleString("ja-JP")}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatCount(e.annual.total)}人</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatCount(e.annual.m)} / {formatCount(e.annual.f)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.prevalence5 == null ? "—" : `${formatCount(e.prevalence5)}人`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HospitalTable({ hospitals, dpc, diseases, muniName, estimates, dpcYear }: {
  hospitals: Hospital[]; dpc: string; diseases: Record<string, string>; muniName: Map<string, string>;
  estimates: Map<string, ReturnType<typeof estimate>>; dpcYear: string;
}) {
  const codes = Object.keys(diseases);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <p className="px-4 py-2 text-xs text-slate-500">
        厚生労働省 DPC 退院患者調査（{dpcYear}）の退院件数。のべ件数なので、同じ患者さんが何度も入院すると重ねて数えます。10件未満は公表されていないため「—」または「以上」で示します。
      </p>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">病院</th>
            <th className="px-3 py-2">所在地</th>
            <th className="px-3 py-2">がん拠点</th>
            <th className="px-3 py-2 text-right">病床</th>
            {codes.map((c) => (
              <th key={c} className={`px-3 py-2 text-right ${c === dpc ? "text-slate-900" : ""}`}>{diseases[c]}</th>
            ))}
            <th className="px-3 py-2 text-right">所在地の推計患者数</th>
          </tr>
        </thead>
        <tbody>
          {hospitals.map((h) => (
            <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-1.5 font-medium" title={h.name}>{shortHospitalName(h.name)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{muniName.get(h.muni) ?? h.muni}</td>
              <td className="whitespace-nowrap px-3 py-1.5"><HbcrBadge status={h.hbcr} /></td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{h.beds || "—"}</td>
              {codes.map((c) => (
                <td key={c} className={`px-3 py-1.5 text-right tabular-nums ${c === dpc ? "font-semibold" : "text-slate-600"}`}>{formatDpc(h.counts[c])}</td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                {estimates.get(h.muni) ? `${formatCount(estimates.get(h.muni)!.annual.total)}人／年` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hospitals.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">この病気で10件以上の退院がある病院はありません。</p>}
    </div>
  );
}

function Notes({ meta }: { meta: Meta }) {
  const years = `${meta.incidenceYears[0]}〜${meta.incidenceYears.at(-1)}年`;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">推計のしかたと注意</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>年間新規患者数＝市区町村の年齢（5歳階級、85歳以上はまとめ）・性別ごとの人口 × 都道府県（または全国）の同じ年齢・性別の罹患率（全国がん登録、{years}の平均）。</li>
        <li>
          骨髄性白血病・びまん性リンパ腫・ろ胞性リンパ腫は、都道府県別の集計がないため、白血病・悪性リンパ腫の率に全国の割合を掛けています
          （骨髄性白血病は白血病の 男{pct(meta.shares.myeloid.m)}・女{pct(meta.shares.myeloid.f)}、
          C83 は悪性リンパ腫の 男{pct(meta.shares.dlbcl.m)}・女{pct(meta.shares.dlbcl.f)}、
          ろ胞性は 男{pct(meta.shares.fl.m)}・女{pct(meta.shares.fl.f)}）。年齢の分布は元の部位と同じと仮定しています。
        </li>
        <li>人口は住民基本台帳（{meta.populationAsOf}）。罹患率の年より人口が新しいため、高齢化の分だけ登録の実数より多めに出ます（多発性骨髄腫の全国では、登録の約7,800人/年に対して約8,600人）。</li>
        <li>5年有病者数は、5年相対生存率（{meta.survivalYear}年診断）が一定の割合で下がると仮定した概算で、治療中の患者数そのものではありません。</li>
        <li>「がん拠点」は国立がん研究センター 院内がん登録症例集計の集計対象施設一覧（最新の年）による区分で、病院名で結びつけています（名前の表記が違うと結びつかないことがあります）。院内がん登録の病院別の検索は上皮性のがんだけが対象で、血液がんの病院別の件数は公開されていないため、件数は DPC を使っています。</li>
        <li>病院は DPC 対象病院のみで、地図の丸は病院の所在市区町村の中心付近に置いています（正確な住所ではありません）。患者さんの住所と受診先は一致しないため、推計患者数と病院の件数は別の指標として見てください。</li>
      </ul>
      <p>
        出典：国立がん研究センターがん情報サービス「がん統計」（全国がん登録）／総務省「住民基本台帳に基づく人口、人口動態及び世帯数」／厚生労働省「DPC導入の影響評価に係る調査『退院患者調査』の結果報告」／国土交通省 国土数値情報（行政区域、SmartNews Media Research Institute による加工データ）。推計値はこのサイトで計算したもので、出典元によるものではありません。
      </p>
    </section>
  );
}

/** 院内がん登録での区分。拠点病院を目立たせる。 */
function HbcrBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const strong = status === "拠点病院";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${strong ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
      {status === "拠点病院" ? "拠点" : status === "拠点外病院" ? "登録参加" : status}
    </span>
  );
}
