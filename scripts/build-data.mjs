// 元データ（Excel）から、アプリが読む JSON（public/data/*.json）を作る。
//
// 使い方: node scripts/build-data.mjs <元データのフォルダ>
//   フォルダに置くもの（README の「データの更新」を参照）
//   - pref_cancer_incidenceNCR(2016-2023).xls … 全国がん登録 都道府県別罹患数（年齢・性別）
//   - cancer_incidenceNCR(2016-2023).xls      … 全国がん登録 全国罹患数（ICD-10 の詳細部位）
//   - cancer_survivalNCR(2016-2018).xlsx       … 全国がん登録 5年相対生存率
//   - muni_age.xlsx                             … 総務省 住民基本台帳 年齢階級別人口（市区町村別・総計）
//   - dpc_mdc13.xlsx                            … 厚生労働省 DPC 退院患者調査「疾患別手術別集計_MDC13」
//   - dpc_facilities.xlsx                       … 同「施設概要表」
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import XLSX from "xlsx";

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
  { id: "mm", name: "多発性骨髄腫", icd: "C88-C90", base: 26, survival: "多発性骨髄腫", dpc: "130040" },
  { id: "myeloid", name: "骨髄性白血病（AMLが中心）", icd: "C92", base: 27, detail: ["C92"], survival: "白血病", dpc: "130010",
    note: "全国がん登録では AML だけの集計がないため、骨髄性白血病（C92）で示します。CML なども含みます。" },
  { id: "leukemia", name: "白血病（すべて）", icd: "C91-C95", base: 27, survival: "白血病", dpc: "130010" },
  { id: "lymphoma", name: "悪性リンパ腫", icd: "C81-C85, C96", base: 25, survival: "悪性リンパ腫", dpc: "130030" },
  { id: "dlbcl", name: "びまん性大細胞型などのびまん性リンパ腫（DLBCLが中心）", icd: "C83", base: 25, detail: ["C83"], survival: "悪性リンパ腫", dpc: "130030" },
  { id: "fl", name: "ろ胞性リンパ腫", icd: "C82", base: 25, detail: ["C82"], survival: "悪性リンパ腫", dpc: "130030" },
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

// ---- DPC：病院ごとの血液疾患の退院件数 ----
const facilities = new Map();
for (const r of rows("dpc_facilities.xlsx", "施設概要表").slice(1)) {
  const [id, , muni, , name, type, , , , , , , , , beds] = r;
  if (!id) continue;
  facilities.set(String(id), { muni: String(muni ?? "").padStart(5, "0"), name, type, beds: num(beds) });
}
const mdc = rows("dpc_mdc13.xlsx", "MDC13");
const diseaseCol = Object.fromEntries(mdc[0].map((v, i) => [v, i]).filter(([v]) => DPC_DISEASES[v]));
const hospitals = [];
for (const r of mdc.slice(4)) {
  const id = String(r[0] ?? "");
  const f = facilities.get(id);
  if (!f || !/^\d{5}$/.test(f.muni)) continue;
  const counts = {};
  for (const [code, col] of Object.entries(diseaseCol)) {
    // 99（手術なし）と 97（その他の手術あり）の合計。「-」は10件未満（0件を含む）
    const cells = [r[col], r[col + 1]];
    const known = cells.filter((c) => typeof c === "number");
    const n = known.reduce((a, b) => a + b, 0);
    const masked = cells.some((c) => typeof c !== "number");
    if (n > 0) counts[code] = masked ? [n, 1] : [n];
  }
  if (Object.keys(counts).length === 0) continue;
  hospitals.push({ id, name: f.name, muni: f.muni, beds: f.beds, type: f.type, counts });
}

const prefs = [...prefNames].filter(([code]) => code !== 0).map(([code, name]) => ({ code, name }));
const meta = {
  incidenceYears: YEARS,
  populationAsOf: asOf,
  survivalYear: 2018,
  dpcYear: "令和5年度（2023年4月〜2024年3月退院）",
  sites: SITES.map(({ id, name, icd, dpc, note, detail }) => ({ id, name, icd, dpc, note: note ?? null, derived: Boolean(detail) })),
  shares,
  dpcDiseases: DPC_DISEASES,
  prefs,
  ageBins: [...Array.from({ length: 17 }, (_, i) => `${i * 5}-${i * 5 + 4}歳`), "85歳以上"],
};

writeFileSync(join(out, "meta.json"), JSON.stringify(meta));
writeFileSync(join(out, "rates.json"), JSON.stringify(rates));
writeFileSync(join(out, "survival.json"), JSON.stringify(survival));
writeFileSync(join(out, "municipalities.json"), JSON.stringify(muniList));
writeFileSync(join(out, "hospitals.json"), JSON.stringify(hospitals));
console.log(`がん ${SITES.length}、都道府県 ${prefs.length}、市区町村（区を含む） ${muniList.length}（人口 ${asOf}）、DPC病院 ${hospitals.length}`);
console.log("全国の詳細部位の割合", shares);
