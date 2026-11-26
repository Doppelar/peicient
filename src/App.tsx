import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  addPopulations,
  estimate,
  formatCount,
  isWard,
  type Municipality,
  type Rates,
  type Survival,
} from "./lib/estimate";

type Meta = {
  incidenceYears: number[];
  populationAsOf: string;
  survivalYear: number;
  sites: { code: number; name: string; icd: string }[];
  prefs: { code: number; name: string }[];
  ageBins: string[];
};
type Data = {
  meta: Meta;
  rates: Record<string, Record<string, Rates>>;
  survival: Record<string, Survival>;
  municipalities: Municipality[];
};

const DEFAULT_SITE = 26; // 多発性骨髄腫
const DEFAULT_PREF = "群馬県";

function useData() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const get = (name: string) => fetch(`/data/${name}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(name))));
    Promise.all([get("meta"), get("rates"), get("survival"), get("municipalities")])
      .then(([meta, rates, survival, municipalities]) => setData({ meta, rates, survival, municipalities }))
      .catch(() => setError("データを読み込めませんでした"));
  }, []);
  return { data, error };
}

export default function App() {
  const { data, error } = useData();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">がん患者数の推計（全国がん登録から）</h1>
          <p className="mt-1 text-sm text-slate-600">
            都道府県の年齢別・性別の罹患率を、市区町村の人口に当てはめて、地域ごとの年間新規患者数と5年有病者数（概算）を推計します。
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
  const [site, setSite] = useState(DEFAULT_SITE);
  const [pref, setPref] = useState(DEFAULT_PREF);
  const [rateSource, setRateSource] = useState<"pref" | "national">("pref");
  const [showWards, setShowWards] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const prefCode = meta.prefs.find((p) => p.name === pref)?.code ?? 0;
  const rates = data.rates[String(rateSource === "pref" ? prefCode : 0)]?.[String(site)] ?? {};
  const survival = data.survival[String(site)];
  const siteName = meta.sites.find((s) => s.code === site)?.name ?? "";

  const inPref = useMemo(() => data.municipalities.filter((m) => m.pref === pref), [data, pref]);
  const wardCodes = useMemo(() => new Set(inPref.filter((m) => isWard(m, inPref)).map((m) => m.code)), [inPref]);
  const rows = useMemo(
    () =>
      inPref
        .filter((m) => (showWards || !wardCodes.has(m.code)) && (!query || m.name.includes(query.trim())))
        .map((m) => ({ m, e: estimate(m, rates, survival) }))
        .sort((a, b) => b.e.annual.total - a.e.annual.total),
    [inPref, wardCodes, showWards, query, rates, survival],
  );

  // 都道府県全体（区は市と重なるので除く）と、選んだ地域の合計
  const prefTotal = useMemo(
    () => estimate(addPopulations(inPref.filter((m) => !wardCodes.has(m.code))), rates, survival),
    [inPref, wardCodes, rates, survival],
  );
  const chosen = inPref.filter((m) => selected.has(m.code));
  const overlap = chosen.some((m) => wardCodes.has(m.code)) && chosen.some((m) => inPref.some((w) => wardCodes.has(w.code) && w.name.startsWith(m.name)));
  const chosenTotal = chosen.length ? estimate(addPopulations(chosen), rates, survival) : null;

  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">がんの種類</span>
          <select value={site} onChange={(e) => setSite(Number(e.target.value))} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2">
            {meta.sites.map((s) => <option key={s.code} value={s.code}>{s.name}（{s.icd}）</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">都道府県</span>
          <select value={pref} onChange={(e) => { setPref(e.target.value); setSelected(new Set()); setQuery(""); }} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2">
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
          <span className="font-medium text-slate-700">市区町村を探す</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2 top-3 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例：前橋" className="h-10 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2" />
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard title={`${pref}全体`} subtitle={siteName} e={prefTotal} />
        {chosenTotal ? (
          <SummaryCard
            title={`選んだ地域（${chosen.length}）`}
            subtitle={chosen.map((m) => m.name).join("・")}
            e={chosenTotal}
            warning={overlap ? "市とその区を両方選んでいるため、重なりがあります" : undefined}
            onClear={() => setSelected(new Set())}
          />
        ) : (
          <div className="flex items-center rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            表の左のチェックで市区町村を選ぶと、担当エリアなどの合計をここに出します。
          </div>
        )}
      </div>

      {chosenTotal && <AgeBars labels={meta.ageBins} values={chosenTotal.byAge} title="選んだ地域の年齢別（年間新規患者数）" />}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="text-slate-600">{rows.length}市区町村（年間新規患者数の多い順）</span>
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
            {rows.map(({ m, e }) => {
              const on = selected.has(m.code);
              return (
                <tr key={m.code} className={`border-t border-slate-100 ${on ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" aria-label={`${m.name}を選ぶ`} checked={on} onChange={() => toggle(m.code)} />
                  </td>
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

      <Notes meta={meta} />
    </div>
  );
}

function SummaryCard({ title, subtitle, e, warning, onClear }: {
  title: string; subtitle: string; e: ReturnType<typeof estimate>; warning?: string; onClear?: () => void;
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
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div><dt className="text-xs text-slate-500">人口</dt><dd className="text-lg font-semibold tabular-nums">{e.population.toLocaleString("ja-JP")}</dd></div>
        <div><dt className="text-xs text-slate-500">年間新規（推計）</dt><dd className="text-lg font-semibold tabular-nums">{formatCount(e.annual.total)}人</dd></div>
        <div><dt className="text-xs text-slate-500">5年有病者（概算）</dt><dd className="text-lg font-semibold tabular-nums">{e.prevalence5 == null ? "—" : `${formatCount(e.prevalence5)}人`}</dd></div>
      </dl>
      {warning && <p className="mt-2 flex items-center gap-1 text-xs text-amber-700"><Check className="h-3 w-3" />{warning}</p>}
    </section>
  );
}

function AgeBars({ labels, values, title }: { labels: string[]; values: number[]; title: string }) {
  const max = Math.max(...values, 0.0001);
  const start = values.findIndex((v) => v >= max * 0.01);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-1">
        {labels.map((label, i) =>
          i < Math.max(start, 0) ? null : (
            <div key={label} className="grid grid-cols-[5.5rem_1fr_4rem] items-center gap-2 text-xs">
              <span className="text-right text-slate-600">{label}</span>
              <span className="h-3 rounded-sm bg-slate-100">
                <span className="block h-3 rounded-sm bg-sky-600" style={{ width: `${(values[i] / max) * 100}%` }} />
              </span>
              <span className="tabular-nums text-slate-700">{formatCount(values[i])}人</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function Notes({ meta }: { meta: Meta }) {
  const years = `${meta.incidenceYears[0]}〜${meta.incidenceYears.at(-1)}年`;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">推計のしかたと注意</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>年間新規患者数＝市区町村の年齢（5歳階級、85歳以上はまとめ）・性別ごとの人口 × 都道府県（または全国）の同じ年齢・性別の罹患率（{years}の平均）。</li>
        <li>人口は住民基本台帳（{meta.populationAsOf}、日本人と外国人の合計）。罹患率の年より人口が新しいため、高齢化の分だけ登録の実数より多めに出ます（多発性骨髄腫の全国では、登録の約7,800人/年に対して約8,600人）。</li>
        <li>5年有病者数は、5年相対生存率（{meta.survivalYear}年診断）が5年間で一定の割合で下がると仮定した概算です。治療中の患者数そのものではありません。</li>
        <li>市区町村ごとの実際の罹患のばらつきや、病院への受診先（住所地と別の地域の病院にかかる人）は反映していません。数人規模の地域では特に幅をもって見てください。</li>
      </ul>
      <p>
        出典：国立がん研究センターがん情報サービス「がん統計」（全国がん登録）／総務省「住民基本台帳に基づく人口、人口動態及び世帯数」。これらの集計表をもとに、このサイトで推計値を計算しています（推計値は出典元によるものではありません）。
      </p>
    </section>
  );
}
