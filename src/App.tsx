import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  addPopulations,
  estimate,
  formatCount,
  isWard,
  type Municipality,
  type Rates,
  type Survival,
} from "./lib/estimate";
import {
  fiscalYearLabel, forYear, formatDpc, formatReg, formatShare, hasNoMuni, rankHospitals, rankPoints, regShare, regTrendOf, shortHospitalName, toRegCount, trendOf,
  type CountSource, type DpcCount, type Hospital, type HospitalByYear, type HospitalData, type HospitalPoint, type RegCount, type RegDetail,
} from "./lib/hospitals";
import { MapView, type MuniValue } from "./map-view";
import { FlowMap } from "./flow-map";
import { ShareBars, ShareCell, Sparkline, TrendChart, type Point, type Series } from "./charts";

type Site = { id: string; name: string; icd: string; dpc: string; note: string | null; derived: boolean; reg: string | null };
type Meta = {
  incidenceYears: number[];
  populationAsOf: string;
  survivalYear: number;
  dpcYears: number[];
  /** 院内がん登録の診断年（新しい順） */
  regYears: number[];
  /** 院内がん登録の都道府県ごとの合計 [部位][診断年][都道府県コード2桁] */
  regPrefTotals: Record<string, Record<string, Record<string, [number, number]>>>;
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
  hospitals: HospitalData[];
};

const DEFAULT_SITE = "mm";
const DEFAULT_PREF = "群馬県";
const TABS = [
  ["map", "地図"],
  ["areas", "市区町村"],
  ["hospitals", "病院"],
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
            全国がん登録の罹患率を市区町村の人口に当てはめた推計患者数と、病院ごとの患者数（院内がん登録の新規登録数、または DPC の退院件数）を、地図と表で見られます。
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
  const detail = useRegDetail();

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
  // 病院の件数：院内がん登録（診断年）か DPC（年度）。その病気の院内がん登録がなければ DPC にする
  const [countKey, setCountKey] = useState(meta.regYears.length ? `reg:${meta.regYears[0]}` : `dpc:${meta.dpcYears[0]}`);
  const source: CountSource = useMemo(() => {
    const [kind, year] = countKey.split(":");
    if (kind === "reg" && site.reg) return { kind: "reg", year: Number(year), reg: site.reg };
    return { kind: "dpc", year: kind === "dpc" ? Number(year) : meta.dpcYears[0], dpc: site.dpc };
  }, [countKey, site.reg, site.dpc, meta.dpcYears]);
  const dpcYear = source.kind === "dpc" ? source.year : meta.dpcYears[0];
  const countLabel = source.kind === "reg"
    ? `院内がん登録 ${source.reg} ${source.year}年診断の新規登録数`
    : `DPC ${dpcLabel} ${fiscalYearLabel(source.year)}の退院件数`;
  const points = useMemo(() => rankPoints(data.hospitals, prefCode, source), [data.hospitals, prefCode, source]);
  const hospitals = useMemo(() => rankHospitals(forYear(data.hospitals, dpcYear), prefCode, site.dpc), [data.hospitals, dpcYear, prefCode, site.dpc]);
  const regPrefTotal = source.kind === "reg" ? meta.regPrefTotals[source.reg]?.[source.year]?.[String(prefCode).padStart(2, "0")] : undefined;
  const byYear = useMemo(() => new Map(data.hospitals.map((h) => [h.id, h])), [data.hospitals]);
  const muniName = useMemo(() => new Map(data.municipalities.map((m) => [m.code, m.name])), [data.municipalities]);

  const chosen = inPref.filter((m) => selected.has(m.code));
  const chosenTotal = chosen.length ? estimate(addPopulations(chosen), rates, survival) : null;
  const chosenHospitals = points.filter((p) => selected.has(p.h.muni));
  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
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
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">病院の件数</span>
          <select value={`${source.kind}:${source.year}`} onChange={(e) => setCountKey(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2">
            {site.reg && (
              <optgroup label="院内がん登録（新規の患者数・診断年）">
                {meta.regYears.map((y) => <option key={y} value={`reg:${y}`}>院内がん登録 {y}年</option>)}
              </optgroup>
            )}
            <optgroup label="DPC（退院件数・年度）">
              {meta.dpcYears.map((y) => <option key={y} value={`dpc:${y}`}>DPC {fiscalYearLabel(y)}</option>)}
            </optgroup>
          </select>
        </label>
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
        <Summary
          title={`${pref}全体`}
          subtitle={site.name}
          e={prefTotal}
          hospitals={points.length}
          note={regPrefTotal && `院内がん登録 ${source.year}年診断：県内の参加病院の合計 ${formatReg(regPrefTotal)}人（他県から受診した人や、複数の病院で登録された人も含みます）`}
        />
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
            <MapView prefCode={prefCode} values={mapValues} perCapita={perCapita} points={points} countLabel={countLabel} selected={selected} onToggle={toggle} />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">病院（件数の多い順）</h2>
            <p className="mb-2 text-xs text-slate-500">{countLabel}</p>
            <ol className="space-y-1">
              {points.slice(0, 15).map(({ h, label }, i) => (
                <li key={h.id} className="flex justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1"><span className="truncate" title={h.name}>{i + 1}. {shortHospitalName(h.name)}</span>{h.hbcr === "拠点病院" && <HbcrBadge status={h.hbcr} />}</span>
                  <span className="shrink-0 tabular-nums font-medium">{label}</span>
                </li>
              ))}
            </ol>
            {points.length === 0 && <p className="text-slate-500">{source.kind === "dpc" ? "10件以上の病院がありません" : "登録のある病院がありません"}</p>}
          </section>
        </div>
      )}

      {tab === "map" && (
        <TrendSection pref={pref} prefCode={prefCode} source={source} meta={meta} hospitals={data.hospitals} points={points} dpcLabel={dpcLabel} />
      )}

      {tab === "map" && site.reg && detail?.flows?.[site.reg]?.[source.kind === "reg" ? source.year : meta.regYears[0]] && (
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="px-1 font-semibold">都道府県をまたぐ患者の移動</h2>
          <p className="mb-1 px-1 text-xs text-slate-500">院内がん登録の「住所」の集計から、{pref}の参加病院に他県から来た人と、{pref}に住んでいて他県の参加病院で登録された人を矢印で示します（{source.kind === "reg" ? source.year : meta.regYears[0]}年診断）。参加病院だけの数で、3件以下は「1〜3」のような幅です。</p>
          <FlowMap prefCode={prefCode} flows={detail.flows[site.reg][source.kind === "reg" ? source.year : meta.regYears[0]]} year={source.kind === "reg" ? source.year : meta.regYears[0]} site={site.reg} />
        </section>
      )}

      {tab === "areas" && (
        <AreaTable rows={inPref} wardCodes={wardCodes} estimates={estimates} selected={selected} onToggle={toggle} />
      )}

      {tab === "hospitals" && source.kind === "reg" && (
        <RegistryTable points={points} reg={source.reg} year={source.year} years={meta.regYears} dpc={site.dpc} dpcLabel={dpcLabel} dpcYear={meta.dpcYears[0]} muniName={muniName} estimates={estimates} detail={detail} />
      )}

      {tab === "hospitals" && source.kind === "dpc" && (
        <HospitalTable hospitals={hospitals} dpc={site.dpc} diseases={meta.dpcDiseases} muniName={muniName} estimates={estimates} dpcYear={dpcYear} years={meta.dpcYears} byYear={byYear} />
      )}

      <Notes meta={meta} />
    </div>
  );
}

function Summary({ title, subtitle, e, hospitals, note, onClear }: {
  title: string; subtitle: string; e: ReturnType<typeof estimate>; hospitals: number; note?: string; onClear?: () => void;
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
        <div><dt className="text-xs text-slate-500">病院（件数あり）</dt><dd className="text-lg font-semibold tabular-nums">{hospitals}</dd></div>
      </dl>
      {note && <p className="mt-2 text-xs text-slate-600">{note}</p>}
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

function HospitalTable({ hospitals, dpc, diseases, muniName, estimates, dpcYear, years, byYear }: {
  hospitals: Hospital[]; dpc: string; diseases: Record<string, string>; muniName: Map<string, string>;
  estimates: Map<string, ReturnType<typeof estimate>>; dpcYear: number; years: number[]; byYear: Map<string, HospitalByYear>;
}) {
  const codes = Object.keys(diseases);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <p className="px-4 py-2 text-xs text-slate-500">
        厚生労働省 DPC 退院患者調査（{fiscalYearLabel(dpcYear)}：{dpcYear}年4月〜{dpcYear + 1}年3月退院）の退院件数。「推移」は選んだ病気の年度ごとの件数です（令和4年度＝2022年度は病院別のデータが見つからないため入っていません）。のべ件数なので、同じ患者さんが何度も入院すると重ねて数えます。10件未満は公表されていないため「—」または「以上」で示します。
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
            <th className="whitespace-nowrap px-3 py-2">推移（{diseases[dpc]}、{Math.min(...years)}〜{Math.max(...years)}年度）</th>
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
              <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-slate-600">
                {byYear.get(h.id) ? <Sparkline years={[...years].sort((a, b) => a - b)} values={trendOf(byYear.get(h.id)!, dpc, years).map((t) => dpcPoint(t.count))} unit="件" /> : "—"}
              </td>
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

const regPoint = (c: RegCount | undefined): Point => (c ? { lo: c[0], hi: c[1] } : null);
/** DPC の伏せられた区分は数えない（「以上」の値） */
const dpcPoint = (c: DpcCount | undefined): Point => (c ? { lo: c[0], hi: c[0] } : null);

/** 県全体と件数の多い病院の、年ごとの推移のグラフ */
function TrendSection({ pref, prefCode, source, meta, hospitals, points, dpcLabel }: {
  pref: string; prefCode: number; source: CountSource; meta: Meta; hospitals: HospitalData[]; points: HospitalPoint[]; dpcLabel: string;
}) {
  const pp = String(prefCode).padStart(2, "0");
  const years = useMemo(() => [...(source.kind === "reg" ? meta.regYears : meta.dpcYears)].sort((a, b) => a - b), [source.kind, meta]);
  const total: Series = useMemo(() => {
    const name = `${pref}全体`;
    if (source.kind === "reg") return { name, values: years.map((y) => regPoint(meta.regPrefTotals[source.reg]?.[y]?.[pp])) };
    const inPref = hospitals.filter((h) => h.muni.startsWith(pp));
    return {
      name,
      values: years.map((y) => {
        const n = inPref.reduce((s, h) => s + (h.counts[y]?.[source.dpc]?.[0] ?? 0), 0);
        return n ? { lo: n, hi: n } : null;
      }),
    };
  }, [source, years, meta, hospitals, pp, pref]);
  const top: Series[] = points.slice(0, 5).map(({ h }) => ({
    name: shortHospitalName(h.name),
    values: source.kind === "reg" ? regTrendOf(h, source.reg, years).map((t) => regPoint(t.count)) : trendOf(h, source.dpc, years).map((t) => dpcPoint(t.count)),
  }));
  const isReg = source.kind === "reg";
  const unit = isReg ? "人" : "件";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">患者数の推移</h2>
      <p className="mb-3 text-xs text-slate-500">
        {source.kind === "reg" ? `院内がん登録 ${source.reg}の新規登録数（診断年）。県全体は県内の参加病院の合計で、他県から来た人も含みます。縦の薄い線は「1〜3」のような幅のある件数です。` : `DPC ${dpcLabel}の退院件数（年度、のべ件数）。県全体は公表されている病院の件数（10件以上の区分）の合計です。2022年度は病院別のデータがありません。`}
        グラフにマウスを重ねると、その年の値が出ます。
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">{pref}全体</p>
          <TrendChart years={years} series={[total]} unit={unit} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">件数の多い病院（{source.year}{isReg ? "年" : "年度"}の上位{top.length}）</p>
          {top.length ? <TrendChart years={years} series={top} unit={unit} /> : <p className="text-sm text-slate-500">病院がありません</p>}
        </div>
      </div>
    </section>
  );
}

/** 院内がん登録の内訳（10件以上の病院だけ）。病院の表を開いたときに読み込む */
function useRegDetail() {
  const [detail, setDetail] = useState<RegDetail | null>(null);
  useEffect(() => {
    fetch("/data/reg-detail.json").then((r) => (r.ok ? r.json() : null)).then(setDetail).catch(() => setDetail(null));
  }, []);
  return detail;
}

/** 表に出す内訳の割合：[見出し, 内訳, 列名] */
const SHARE_COLUMNS: Array<[string, string, string[]]> = [
  ["男性", "性別", ["男性"]],
  ["75歳以上", "年齢", ["75～84歳", "85歳以上"]],
  ["県外から", "住所", ["県外"]],
  ["紹介で来院", "来院経路", ["他施設紹介"]],
  ["他院で診断", "症例区分", ["他施設診断自施設治療開始", "他施設診断自施設治療継続"]],
];

function RegistryTable({ points, reg, year, years, dpc, dpcLabel, dpcYear, muniName, estimates, detail }: {
  points: HospitalPoint[]; reg: string; year: number; years: number[]; dpc: string; dpcLabel: string; dpcYear: number;
  muniName: Map<string, string>; estimates: Map<string, ReturnType<typeof estimate>>; detail: RegDetail | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rowOf = (id: string, dim: string) => detail?.hospitals[id]?.[reg]?.[dim]?.[year];
  const shareOf = (id: string, dim: string, labels: string[]) =>
    regShare(rowOf(id, dim), labels.map((l) => detail?.dims[dim]?.indexOf(l) ?? -1).filter((i) => i >= 0));
  const hasDetail = Boolean(detail && points.some(({ h }) => detail.hospitals[h.id]?.[reg]));
  const columns = hasDetail ? SHARE_COLUMNS : [];
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <p className="px-4 py-2 text-xs text-slate-500">
        国立がん研究センター 院内がん登録の部位別登録数（{reg}、{year}年に診断された患者さん）。がん診療連携拠点病院などの参加病院だけで、その病院で初めて診療した患者さんを1人1回数えます。3件以下は「1〜3」のように幅で公表されています。「推移」は診断年ごと、「DPC」は同じ病気の{fiscalYearLabel(dpcYear)}の退院件数（のべ件数）です。
        {hasDetail && " 男性・75歳以上などの割合は10件以上の病院だけ公表されている内訳から計算したもので、幅のある件数を含むときは「約」を付けています。病院名を押すと内訳をすべて見られます。"}
      </p>
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">病院</th>
            <th className="px-3 py-2">所在地</th>
            <th className="px-3 py-2">がん拠点</th>
            <th className="px-3 py-2 text-right text-slate-900">新規登録（{year}年）</th>
            {columns.map(([label]) => <th key={label} className="whitespace-nowrap px-3 py-2 text-right">{label}</th>)}
            <th className="px-3 py-2">推移（{years.at(-1)}〜{years[0]}年）</th>
            <th className="px-3 py-2 text-right">DPC {dpcLabel}</th>
            <th className="px-3 py-2 text-right">所在地の推計患者数</th>
          </tr>
        </thead>
        <tbody>
          {points.map(({ h, label }) => {
            const expandable = Boolean(detail?.hospitals[h.id]?.[reg]);
            const isOpen = open === h.id && expandable;
            return (
              <Fragment key={h.id}>
                <tr className={`border-t border-slate-100 hover:bg-slate-50 ${expandable ? "cursor-pointer" : ""}`} onClick={() => expandable && setOpen(isOpen ? null : h.id)}>
                  <td className="min-w-48 px-3 py-1.5 font-medium" title={h.name}>
                    {shortHospitalName(h.name)}
                    {expandable && <ChevronDown className={`ml-1 inline h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{hasNoMuni(h) ? "—" : muniName.get(h.muni) ?? h.muni}</td>
                  <td className="whitespace-nowrap px-3 py-1.5"><HbcrBadge status={h.hbcr} /></td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{label}</td>
                  {columns.map(([label, dim, labels]) => (
                    <td key={label} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-600"><ShareCell text={formatShare(shareOf(h.id, dim, labels))} pct={shareOf(h.id, dim, labels)?.pct ?? null} /></td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-slate-600">
                    <Sparkline years={[...years].sort((a, b) => a - b)} values={regTrendOf(h, reg, years).map((t) => regPoint(t.count))} unit="人" />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatDpc(h.counts[dpcYear]?.[dpc])}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {estimates.get(h.muni) ? `${formatCount(estimates.get(h.muni)!.annual.total)}人／年` : "—"}
                  </td>
                </tr>
                {isOpen && detail && (
                  <tr className="bg-slate-50">
                    <td colSpan={7 + columns.length} className="px-4 py-3">
                      {/* 表が横に長くても、内訳は画面の幅に収める */}
                      <div className="sticky left-4 grid w-[calc(min(100vw,72rem)-6.5rem)] gap-x-8 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(detail.dims).map(([dim, labels]) => {
                          const row = rowOf(h.id, dim);
                          return (
                            <div key={dim}>
                              <p className="font-semibold text-slate-700">{dim}（{year}年）</p>
                              {row ? (
                                <ShareBars rows={labels.map((l, i) => ({ label: l, count: formatReg(toRegCount(row[i])), pct: regShare(row, [i])?.pct ?? null, share: formatShare(regShare(row, [i])) }))} />
                              ) : <p className="text-slate-400">公表なし</p>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {points.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">この病気の登録がある病院はありません。</p>}
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
        <li>「がん拠点」は国立がん研究センター 院内がん登録症例集計の集計対象施設一覧（最新の年）による区分で、病院名で結びつけています（名前の表記が違うと結びつかないことがあります）。</li>
        <li>
          病院の件数は2種類から選べます。「院内がん登録」は国立がん研究センターの部位別登録数（{meta.regYears.at(-1)}〜{meta.regYears[0]}年診断）で、その病院で新たに診療を始めた患者さんの数です（参加病院のみ）。
          「DPC」は退院件数で、同じ患者さんの入院を重ねて数えます。院内がん登録の病院は名前で DPC の施設一覧と結びつけて所在地を出しており、結びつかなかった病院は表にだけ出します（所在地「—」）。
        </li>
        <li>地図の丸は病院の所在市区町村の中心付近に置いています（正確な住所ではありません）。患者さんの住所と受診先は一致しないため、推計患者数と病院の件数は別の指標として見てください。</li>
      </ul>
      <p>
        出典：国立がん研究センターがん情報サービス「がん統計」（全国がん登録）・「院内がん登録 部位別登録数」／総務省「住民基本台帳に基づく人口、人口動態及び世帯数」／厚生労働省「DPC導入の影響評価に係る調査『退院患者調査』の結果報告」（令和2・3・5年度）／国土交通省 国土数値情報（行政区域、SmartNews Media Research Institute による加工データ）。推計値はこのサイトで計算したもので、出典元によるものではありません。
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
