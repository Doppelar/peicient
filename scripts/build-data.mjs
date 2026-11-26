// 元データ（Excel）から、アプリが読む JSON（public/data/*.json）を作る。
//
// 使い方: node scripts/build-data.mjs <元データのフォルダ>
//   フォルダに置くもの（README の「データの更新」を参照）
//   - pref_cancer_incidenceNCR(2016-2023).xls … 全国がん登録 都道府県別罹患数（年齢・性別）
//   - cancer_incidenceNCR(2016-2023).xls      … 全国がん登録 全国罹患数（ICD-10 の詳細部位）
//   - cancer_survivalNCR(2016-2018).xlsx       … 全国がん登録 5年相対生存率
//   - muni_age.xlsx                             … 総務省 住民基本台帳 年齢階級別人口（市区町村別・総計）
//   - dpc_mdc13_<年度>.xlsx                     … 厚生労働省 DPC 退院患者調査「疾患別手術別集計_MDC13」（年度ごと、例 dpc_mdc13_2023.xlsx）
//   - dpc_facilities_<年度>.xlsx                … 同「施設概要表」（同じ年度）
//   - hbcr_facilities.xlsx                      … 国立がん研究センター 院内がん登録症例集計「集計対象施設一覧」（任意）
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import XLSX from "xlsx";
import { shortHospitalName } from "../src/lib/hospitals.ts";

const src = process.argv[2];
if (!src) throw new Error("元データのフォルダを指定してください");
const out = join(import.meta.dirname, "..", "public", "data");
mkdirSync(out, { recursive: true });

/** 平均をとる診断年（最新3年） */
const YEARS = [2021, 2022, 2023];
/** 年齢階級：0-4歳 … 80-84歳, 85歳以上 の18区分 */
const AGE_BINS = 18;
const SEXES = { 男: "m", 女: "f" };

/**
 * 推計するがん（血液内科で扱うもの）。
 * base が都道府県別・年齢別の率を持つ部位。detail があるものは、全国の詳細部位の割合（性別）を掛けて推計する。
 */
const SITES = [
  { id: "mm", name: "多発性骨髄腫", icd: "C88-C90", base: 26, survival: "多発性骨髄腫", dpc: "130040", reg: "多発性骨髄腫" },
  { id: "myeloid", name: "骨髄性白血病（AMLが中心）", icd: "C92", base: 27, detail: ["C92"], survival: "白血病", dpc: "130010", reg: "白血病",
    note: "全国がん登録では AML だけの集計がないため、骨髄性白血病（C92）で示します。CML なども含みます。" },
  { id: "leukemia", name: "白血病（すべて）", icd: "C91-C95", base: 27, survival: "白血病", dpc: "130010", reg: "白血病" },
  { id: "lymphoma", name: "悪性リンパ腫", icd: "C81-C85, C96", base: 25, survival: "悪性リンパ腫", dpc: "130030", reg: "悪性リンパ腫" },
  { id: "dlbcl", name: "びまん性大細胞型などのびまん性リンパ腫（DLBCLが中心）", icd: "C83", base: 25, detail: ["C83"], survival: "悪性リンパ腫", dpc: "130030", reg: "悪性リンパ腫" },
  { id: "fl", name: "ろ胞性リンパ腫", icd: "C82", base: 25, detail: ["C82"], survival: "悪性リンパ腫", dpc: "130030", reg: "悪性リンパ腫" },
];
/** 詳細部位の割合の分母（base の部位に含まれる ICD） */
const DETAIL_PARENT = { 27: ["C91", "C92", "C93", "C94", "C95"], 25: ["C81", "C82", "C83", "C84", "C85", "C96"] };
/** DPC の疾患（MDC13 の6桁コード）。病院の表に出す */
const DPC_DISEASES = { "130010": "急性白血病", "130030": "非ホジキンリンパ腫", "130040": "多発性骨髄腫・免疫系悪性新生物", "130060": "骨髄異形成症候群" };

const rows = (file, sheet) => {
  const wb = XLSX.readFile(join(src, file), sheet ? { sheets: [sheet] } : undefined);
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { header: 1 });
};
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ---- 都道府県別・年齢階級別の罹患率（最新3年の平均、人口10万人あたり） ----
const incidenceFile = "pref_cancer_incidenceNCR(2016-2023).xls";
const pop = new Map();
for (const r of rows(incidenceFile, "pop").slice(1)) {
  const [, pref, , sex, year] = r;
  if (!SEXES[sex] || !YEARS.includes(year)) continue;
  pop.set(`${pref}|${sex}|${year}`, r.slice(6, 6 + AGE_BINS).map(num));
}
const baseCodes = [...new Set(SITES.map((s) => s.base))];
const prefNames = new Map();
const baseRates = {}; // baseRates[pref][baseCode][m|f]
for (const r of rows(incidenceFile, "number").slice(1)) {
  const [pref, prefName, site, , , sex, year] = r;
  if (!baseCodes.includes(site) || !SEXES[sex] || !YEARS.includes(year)) continue;
  prefNames.set(pref, prefName);
  const counts = [...r.slice(8, 8 + 17).map(num), num(r[r.length - 1])];
  const p = pop.get(`${pref}|${sex}|${year}`);
  if (!p) throw new Error(`人口がありません: ${pref} ${sex} ${year}`);
  const acc = (((baseRates[pref] ??= {})[site] ??= {})[SEXES[sex]] ??= new Array(AGE_BINS).fill(0));
  counts.forEach((c, i) => { acc[i] += p[i] ? (c / p[i]) * 1e5 / YEARS.length : 0; });
}

// ---- 全国の詳細部位の割合（性別、最新3年の合計） ----
const detailCount = {}; // detailCount[icd][m|f]
for (const r of rows("cancer_incidenceNCR(2016-2023).xls", "detail").slice(1)) {
  const [, icd, sex, year, count] = r;
  if (!SEXES[sex] || !YEARS.includes(year)) continue;
  (detailCount[icd] ??= { m: 0, f: 0 })[SEXES[sex]] += num(count);
}
const shareOf = (site, sex) => {
  if (!site.detail) return 1;
  const part = site.detail.reduce((a, icd) => a + (detailCount[icd]?.[sex] ?? 0), 0);
  const whole = DETAIL_PARENT[site.base].reduce((a, icd) => a + (detailCount[icd]?.[sex] ?? 0), 0);
  if (!whole) throw new Error(`詳細部位がありません: ${site.base}`);
  return part / whole;
};
const shares = Object.fromEntries(SITES.map((s) => [s.id, { m: round(shareOf(s, "m"), 4), f: round(shareOf(s, "f"), 4) }]));

const rates = {}; // rates[pref][siteId][m|f]
for (const [pref, bySite] of Object.entries(baseRates)) {
  for (const s of SITES) {
    const base = bySite[s.base];
    rates[pref] ??= {};
    rates[pref][s.id] = Object.fromEntries(
      Object.entries(base).map(([sex, arr]) => [sex, arr.map((v) => round(v * shares[s.id][sex], 3))]),
    );
  }
}

// ---- 5年相対生存率（2018年診断） ----
const survRows = rows("cancer_survivalNCR(2016-2018).xlsx", "最新データ（性別）");
const survival = {};
for (const s of SITES) {
  const r = survRows.find((x) => x[0] === s.survival);
  if (!r) throw new Error(`生存率の行がありません: ${s.survival}`);
  const pct = (v) => (typeof v === "number" ? round(v, 1) : null);
  survival[s.id] = { m: pct(r[3]), f: pct(r[7]), t: pct(r[11]) };
}

// ---- 市区町村別・年齢階級別人口（住民基本台帳） ----
const muniRows = rows("muni_age.xlsx", "年齢別人口（市区町村別）【総計】");
const asOf = String(muniRows[0][0]).match(/(令和\d+年\d+月\d+日)/)?.[1] ?? "";
const municipalities = new Map();
for (const r of muniRows.slice(3)) {
  const [code, prefName, name, sex] = r;
  if (!SEXES[sex] || !code || code === "-" || name === "-") continue;
  // 郡（「邑楽郡」など）と東京都の「島しょ」は町村の小計なので除く（二重に数えないため）
  if (/郡$/.test(name) || name === "島しょ") continue;
  const ages = r.slice(5, 5 + 21).map(num);
  const bins = [...ages.slice(0, 17), ages.slice(17).reduce((a, b) => a + b, 0)];
  const m = municipalities.get(code) ?? { code: String(code).slice(0, 5), pref: prefName, name, m: [], f: [] };
  m[SEXES[sex]] = bins;
  municipalities.set(code, m);
}
// 人口0（北方領土の村）は除く
const sumPop = (m) => [...m.m, ...m.f].reduce((x, y) => x + y, 0);
const muniList = [...municipalities.values()].filter((m) => sumPop(m) > 0);

/** 病院名を照合用にそろえる（法人名・空白・括弧を外す）。 */
const normName = (s) =>
  shortHospitalName(String(s)).normalize("NFKC").replace(/^(JCHO|NHO|KKR)(?=.)/, "").replace(/[\s・()（）]/g, "").replace(/^(JA)?[^\s]*?厚生連/, "").replace(/総合病院/g, "病院");

// ---- DPC：病院ごとの血液疾患の退院件数（年度ごと） ----
// dpc_mdc13_<年度>.xlsx と dpc_facilities_<年度>.xlsx の組をすべて読む。病院の名前・所在地・病床は新しい年度のものを使う
// 告示番号は年度によって変わるため、年度をまたぐ照合は「所在市区町村＋病院名」で行う
const dpcYears = readdirSync(src)
  .map((f) => f.match(/^dpc_mdc13_(\d{4})\.xlsx$/)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => b - a);
if (dpcYears.length === 0) throw new Error("dpc_mdc13_<年度>.xlsx がありません");
const byId = new Map();
/** すべての DPC 施設（血液の件数がない病院も）の所在地。院内がん登録の病院の場所を引くのに使う */
const facilityIndex = new Map();
for (const year of dpcYears) {
  const facilities = new Map();
  for (const r of rows(`dpc_facilities_${year}.xlsx`, "施設概要表").slice(1)) {
    const [id, , muni, , name, type, , , , , , , , , beds] = r;
    if (!id) continue;
    const f = { muni: String(muni ?? "").padStart(5, "0"), name, type, beds: num(beds) };
    facilities.set(String(id), f);
    const key = `${f.muni.slice(0, 2)}|${normName(name)}`;
    if (/^\d{5}$/.test(f.muni) && !facilityIndex.has(key)) facilityIndex.set(key, { id: String(id), ...f });
  }
  const mdc = rows(`dpc_mdc13_${year}.xlsx`, "MDC13");
  const diseaseCol = Object.fromEntries(mdc[0].map((v, i) => [v, i]).filter(([v]) => DPC_DISEASES[v]));
  for (const r of mdc.slice(4)) {
    const id = String(r[0] ?? "");
    const f = facilities.get(id);
    if (!f || !/^\d{5}$/.test(f.muni)) continue;
    const counts = {};
    for (const [code, col] of Object.entries(diseaseCol)) {
      // 99（手術なし）と 97（その他の手術あり）の合計。「-」は10件未満（0件を含む）
      const cells = [r[col], r[col + 1]];
      const n = cells.filter((c) => typeof c === "number").reduce((a, b) => a + b, 0);
      const masked = cells.some((c) => typeof c !== "number");
      if (n > 0) counts[code] = masked ? [n, 1] : [n];
    }
    if (Object.keys(counts).length === 0) continue;
    const key = `${f.muni}|${normName(f.name)}`;
    const h = byId.get(key) ?? { id, name: f.name, muni: f.muni, beds: f.beds, type: f.type, counts: {} };
    h.counts[year] = counts;
    byId.set(key, h);
  }
}
const hospitals = [...byId.values()];

const prefShort = new Map([...prefNames].map(([code, name]) => [String(code).padStart(2, "0"), name.replace(/[都府県]$/, "")]));

// ---- 院内がん登録の集計対象（がん診療連携拠点病院かどうか）を病院名で結びつける ----
let hbcrMatched = 0;
try {
  const reg = rows("hbcr_facilities.xlsx", "集計対象施設一覧").slice(2).filter((r) => r[1]);
  const latest = (r) => [...r.slice(2, 10)].reverse().find((v) => v && v !== "提出なし") ?? null;
  const byPref = new Map();
  for (const r of reg) byPref.set(`${r[0]}|${normName(r[1])}`, latest(r));
  for (const h of hospitals) {
    const p = prefShort.get(h.muni.slice(0, 2)) ?? "";
    const status = byPref.get(`${p}|${normName(h.name)}`) ?? byPref.get(`${p === "北海" ? "北海道" : p}|${normName(h.name)}`);
    if (status) { h.hbcr = status; hbcrMatched++; }
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

// ---- 院内がん登録：病院ごとの新規登録数（診断年ごと） ----
// 「院内がん登録データ_<年>-<年>_<部位>.csv」（Shift_JIS、がん情報サービスの「部位別登録数」から CSV 出力）を読む。
// 件数は "12"・"1～3"（3件以下は幅で公表）・"該当なし"（0件）。[下限, 上限] で持つ。
// DPC の病院と同じ都道府県で病院名が一致すれば結びつける。結びつかない病院も、所在市区町村なしで表に出す
const prefCodeByShort = new Map([...prefShort].map(([code, name]) => [name, code]));
prefCodeByShort.set("北海道", "01");
const parseRegCount = (v) => {
  const s = String(v ?? "").normalize("NFKC");
  if (s === "該当なし") return [0, 0];
  const range = s.match(/^(\d+)[~～〜](\d+)$/);
  if (range) return [Number(range[1]), Number(range[2])];
  return /^\d+$/.test(s) ? [Number(s), Number(s)] : null;
};
const readSjisCsv = (file) =>
  new TextDecoder("shift_jis").decode(readFileSync(join(src, file)))
    .split(/\r?\n/).filter((l) => l.trim())
    .map((l) => [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1]));
const regFiles = readdirSync(src)
  .map((f) => ({ f, m: f.match(/^院内がん登録データ_(\d{4})-\d{4}_(.+?)(（都道府県全体）)?\.csv$/) }))
  .filter((x) => x.m);
const regYears = [...new Set(regFiles.map((x) => Number(x.m[1])))].sort((a, b) => b - a);
const regSites = [...new Set(regFiles.map((x) => x.m[2]))];
const regPrefTotals = {}; // regPrefTotals[部位][年][都道府県コード] = [下限, 上限]
let regMatched = 0;
let regOnly = 0;
/**
 * 院内がん登録の病院名を DPC の施設の照合キーにする。完全一致がなければ、同じ都道府県で
 * 一方の名前がもう一方の末尾と一致する施設（「日高会日高病院」と「日高病院」など）が1つだけのときにそれを使う。
 */
const facilityNamesByPref = new Map();
for (const key of facilityIndex.keys()) {
  const [p, n] = key.split("|");
  facilityNamesByPref.set(p, [...(facilityNamesByPref.get(p) ?? []), n]);
}
const resolveFacilityKey = (code, name) => {
  const n = normName(name);
  if (facilityIndex.has(`${code}|${n}`) || n.length < 3) return `${code}|${n}`;
  const hits = (facilityNamesByPref.get(code) ?? []).filter((f) => f.length >= 3 && (f.endsWith(n) || n.endsWith(f)));
  return hits.length === 1 ? `${code}|${hits[0]}` : `${code}|${n}`;
};
const hospitalByName = new Map(hospitals.map((h) => [`${h.muni.slice(0, 2)}|${normName(h.name)}`, h]));
for (const { f, m } of regFiles) {
  const [, yearText, siteName, whole] = m;
  const year = Number(yearText);
  const table = readSjisCsv(f).slice(1);
  if (whole) {
    for (const [prefName, , total] of table) {
      const code = prefCodeByShort.get(prefName);
      const n = parseRegCount(total);
      if (code && n) (((regPrefTotals[siteName] ??= {})[year] ??= {})[code] = n);
    }
    continue;
  }
  for (const [prefName, name, kind, , total] of table) {
    const code = prefCodeByShort.get(prefName);
    const n = parseRegCount(total);
    if (!code || !n) continue;
    const key = resolveFacilityKey(code, name);
    let h = hospitalByName.get(key);
    if (!h) {
      // 血液の DPC 件数がない病院：DPC の施設一覧で所在地を引く。見つからなければ都道府県だけわかる行として足す
      const f = facilityIndex.get(key);
      h = f
        ? { id: f.id, name: f.name, muni: f.muni, beds: f.beds, type: f.type, counts: {} }
        : { id: `reg:${code}:${name}`, name, muni: `${code}000`, beds: 0, type: "", counts: {} };
      h.hbcr = kind === "拠点外" ? "拠点外病院" : kind;
      hospitals.push(h);
      hospitalByName.set(key, h);
      regOnly++;
    } else if (!h.reg) regMatched++;
    ((h.reg ??= {})[siteName] ??= {})[year] = n;
  }
}

// ---- 院内がん登録：病院ごとの内訳（性別・年齢・住所など） ----
// 部位別登録数の CSV を、内訳の種類ごとのフォルダ（「性別」「住所」など）に入れて置く。
// 総数が10件未満の病院は内訳が「-」で伏せられているので持たない。住所は「県内・県外・不明」にまとめる
const regDims = {}; // regDims[内訳] = 列名
const regDetail = {}; // regDetail[病院id][部位][内訳][年] = [下限, 上限][]
const regFlows = {}; // regFlows[部位][年] = [住んでいる都道府県, 受診した都道府県, 件数][]（都道府県をまたぐものだけ）
const regHospFlows = {}; // regHospFlows[部位][年][病院id] = [住んでいる都道府県, 件数][]（病院のある都道府県の外から来た人だけ）
const sumCounts = (cs) => cs.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
for (const dir of readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const dim = dir.name;
  for (const f of readdirSync(join(src, dim))) {
    const m = f.match(/^院内がん登録データ_(\d{4})-\d{4}_(.+?)\.csv$/);
    if (!m) continue;
    const [header, ...table] = readSjisCsv(join(dim, f));
    if (m[2].endsWith("（都道府県全体）")) {
      // 住所の都道府県全体の表：行が受診した都道府県、列が住んでいる都道府県
      if (dim !== "住所") continue;
      const site = m[2].replace("（都道府県全体）", "");
      const flows = ((regFlows[site] ??= {})[m[1]] = []);
      for (const [toName, , , ...values] of table) {
        const to = prefCodeByShort.get(toName);
        if (!to) continue;
        header.slice(3).forEach((fromName, i) => {
          const from = prefCodeByShort.get(fromName);
          const n = parseRegCount(values[i]);
          if (from && from !== to && n && n[1] > 0) flows.push([Number(from), Number(to), n[0] === n[1] ? n[0] : n]);
        });
      }
      continue;
    }
    const cols = header.slice(5);
    regDims[dim] = dim === "住所" ? ["県内", "県外", "不明"] : cols;
    for (const [prefName, name, , , total, ...values] of table) {
      const code = prefCodeByShort.get(prefName);
      const n = parseRegCount(total);
      if (!code || !n || n[1] < 10) continue;
      const counts = values.map(parseRegCount);
      if (counts.some((c) => !c)) continue;
      const h = hospitalByName.get(resolveFacilityKey(code, name));
      if (!h) continue;
      const row = dim === "住所"
        ? [sumCounts(counts.filter((_, i) => cols[i] === prefName)),
           sumCounts(counts.filter((_, i) => cols[i] !== prefName && cols[i] !== "不明")),
           sumCounts(counts.filter((_, i) => cols[i] === "不明"))]
        : counts;
      if (dim === "住所") {
        const from = [];
        cols.forEach((col, i) => {
          const c = prefCodeByShort.get(col);
          if (c && col !== prefName && counts[i][1] > 0) from.push([Number(c), counts[i][0] === counts[i][1] ? counts[i][0] : counts[i]]);
        });
        if (from.length) (((regHospFlows[m[2]] ??= {})[m[1]] ??= {})[h.id] = from);
      }
      // 幅のない件数は数字だけにして小さくする
      ((((regDetail[h.id] ??= {})[m[2]] ??= {})[dim] ??= {})[m[1]] = row.map((c) => (c[0] === c[1] ? c[0] : c)));
    }
  }
}
writeFileSync(join(out, "reg-detail.json"), JSON.stringify({ dims: regDims, hospitals: regDetail, flows: regFlows, hospitalFlows: regHospFlows }));
console.log(`院内がん登録の内訳：${Object.keys(regDims).join("・") || "なし"}、病院 ${Object.keys(regDetail).length}`);

const prefs = [...prefNames].filter(([code]) => code !== 0).map(([code, name]) => ({ code, name }));
const meta = {
  incidenceYears: YEARS,
  populationAsOf: asOf,
  survivalYear: 2018,
  dpcYears,
  regYears,
  regPrefTotals,
  sites: SITES.map(({ id, name, icd, dpc, note, detail, reg }) => ({
    id, name, icd, dpc, note: note ?? null, derived: Boolean(detail), reg: reg && regSites.includes(reg) ? reg : null,
  })),
  shares,
  dpcDiseases: DPC_DISEASES,
  prefs,
  ageBins: [...Array.from({ length: 17 }, (_, i) => `${i * 5}-${i * 5 + 4}歳`), "85歳以上"],
};

// ---- 病院の位置：厚生労働省「医療情報ネット」オープンデータの病院（施設票）の緯度経度 ----
// hospital_facility_info_<日付>.csv を置くと、病院名と所在都道府県（できれば市区町村）で結びつけて ll = [経度, 緯度] を持たせる
const geoFile = readdirSync(src).filter((x) => /hospital_facility_info_\d+\.csv$/.test(x)).sort().at(-1);
let geoMatched = 0;
const geoMissed = [];
// 住所 → [経度, 緯度]（国土地理院の住所検索）。結果は scripts/geocode-cache.json に残して使い回す
const geocodeCachePath = new URL("./geocode-cache.json", import.meta.url);
const geocodeCache = (() => { try { return JSON.parse(readFileSync(geocodeCachePath, "utf8")); } catch { return {}; } })();
async function geocode(addr) {
  if (!addr) return null;
  if (addr in geocodeCache) return geocodeCache[addr];
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(addr)}`).then((r) => r.json()).catch(() => []);
  const c = res[0]?.geometry?.coordinates;
  geocodeCache[addr] = c ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : null;
  await new Promise((ok) => setTimeout(ok, 200)); // 間をあけて問い合わせる
  return geocodeCache[addr];
}
if (geoFile) {
  const parseCsvLine = (l) => {
    const r = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) {
        if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { r.push(cur); cur = ""; } else cur += c;
    }
    r.push(cur);
    return r;
  };
  const [head, ...lines] = readFileSync(join(src, geoFile), "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const col = (n) => head.indexOf(n);
  const [iName, iShort, iPref, iMuni, iAddr, iLat, iLon] = ["正式名称", "略称", "都道府県コード", "市区町村コード", "所在地", "所在地座標（緯度）", "所在地座標（経度）"].map(col);
  // 名前の表記ゆれ（空白の有無・旧字）をそろえた照合用の名前の候補
  const variants = (x) => {
    const t = String(x).replace(/廣/g, "広").replace(/濱/g, "浜").replace(/澤/g, "沢");
    return [normName(t), normName(t.replace(/[s　]+/g, ""))];
  };
  const raw = (x) => String(x).normalize("NFKC").replace(/s+/g, "");
  // 改称・表記違いで名前から結びつかない病院（院内がん登録・DPC の名前 → 医療情報ネットの正式名称）
  const RENAMED = {
    東京医科歯科大学: "東京科学大学病院",
    名古屋第一赤十字病院: "日本赤十字社愛知医療センター名古屋第一病院",
    名古屋第二赤十字病院: "日本赤十字社愛知医療センター名古屋第二病院",
    大阪市立大学医学部附属病院: "大阪公立大学医学部附属病院",
    第二大阪警察病院: "大阪けいさつ病院",
    "茨城県立中央病院・茨城県地域がんセンター": "茨城県立中央病院",
    東京女子医科大学八千代医療センター: "東京女子医科大学附属八千代医療センター",
    "東邦大学医療センタ-佐倉病院": "東邦大学医療センター佐倉病院",
    東京都保健医療公社豊島病院: "東京都立豊島病院",
    南奈良総合医療センター: "南奈良総合医療センター（災害拠点病院）",
    "紀南病院(和歌山)": "紀南病院",
    "沖縄県立南部医療センター・こども医療センター": "沖縄県立南部医療センター・こどもセンター",
  };
  const renamed = (name) => Object.entries(RENAMED).find(([k]) => raw(name).includes(raw(k)))?.[1];
  const byPref = new Map();
  for (const r of lines) {
    const lat = Number(r[iLat]);
    const lon = Number(r[iLon]);
    const pref = r[iPref].padStart(2, "0");
    // 緯度経度が 0 の施設もあるので、そのときは住所から引く（下の geocode）
    const e = { muni: pref + r[iMuni].padStart(3, "0"), names: [...new Set([r[iName], r[iShort]].filter(Boolean).flatMap(variants))], raw: raw(r[iName]), addr: r[iAddr], ll: lat && lon ? [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] : null };
    byPref.set(pref, [...(byPref.get(pref) ?? []), e]);
  }
  // 同じ市区町村の候補があればそちらを優先し、1つに決まるときだけ使う
  // 同名が複数あれば正式名称が完全に同じものを選ぶ
  const pick = (list, muni, name) => {
    const same = list.filter((e) => e.muni === muni);
    const pool = same.length ? same : list;
    if (pool.length === 1) return pool[0];
    const exact = pool.filter((e) => e.raw === raw(name));
    return exact.length === 1 ? exact[0] : null;
  };
  for (const h of hospitals) {
    const pref = h.muni.slice(0, 2);
    const ns = variants(renamed(h.name) ?? h.name);
    const list = byPref.get(pref) ?? [];
    const hit = pick(list.filter((e) => e.names.some((x) => ns.includes(x))), h.muni, renamed(h.name) ?? h.name)
      ?? pick(list.filter((e) => e.names.some((x) => x.length >= 4 && ns.some((n) => n.length >= 4 && (x.endsWith(n) || n.endsWith(x))))), h.muni, h.name);
    if (!hit) { if (h.reg) geoMissed.push(`${h.muni} ${h.name}`); continue; }
    h.ll = hit.ll ?? (await geocode(hit.addr));
    if (!h.ll) { delete h.ll; geoMissed.push(`${h.muni} ${h.name}（住所から位置を引けない）`); continue; }
    if (h.muni.endsWith("000") && municipalities.has(hit.muni)) h.muni = hit.muni;
    geoMatched++;
  }
  writeFileSync(geocodeCachePath, JSON.stringify(geocodeCache, null, 1));
}

writeFileSync(join(out, "meta.json"), JSON.stringify(meta));
writeFileSync(join(out, "rates.json"), JSON.stringify(rates));
writeFileSync(join(out, "survival.json"), JSON.stringify(survival));
writeFileSync(join(out, "municipalities.json"), JSON.stringify(muniList));
writeFileSync(join(out, "hospitals.json"), JSON.stringify(hospitals));
console.log(`院内がん登録の対象と結びついた病院 ${hbcrMatched}`);
console.log(`病院の位置（医療情報ネット）：${geoFile ?? "ファイルなし"}、結びついた ${geoMatched}／${hospitals.length}、院内がん登録の病院で見つからない ${geoMissed.length}`);
if (geoMissed.length) console.log("  例：" + geoMissed.slice(0, 15).join("、"));
console.log(`院内がん登録の件数：部位 ${regSites.join("・") || "なし"}、診断年 ${regYears.join(",")}、DPCの病院と結びついた ${regMatched}、DPCにない病院 ${regOnly}`);
console.log(`がん ${SITES.length}、都道府県 ${prefs.length}、市区町村（区を含む） ${muniList.length}（人口 ${asOf}）、DPC病院 ${hospitals.length}`);
console.log("全国の詳細部位の割合", shares);
