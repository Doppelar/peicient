// 元データ（Excel）から、アプリが読む JSON（public/data/*.json）を作る。
//
// 使い方: node scripts/build-data.mjs <元データのフォルダ>
//   フォルダには次の3つを置く（README の「データの更新」を参照）
//   - pref_cancer_incidenceNCR(2016-2023).xls … 国立がん研究センター 全国がん登録 都道府県別罹患数
//   - cancer_survivalNCR(2016-2018).xlsx       … 同 5年相対生存率
//   - muni_age.xlsx                             … 総務省 住民基本台帳 年齢階級別人口（市区町村別・総計）
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
/** 使う部位（上皮内がんを含む集計は除く） */
const SITES = [1, 3, 4, 5, 6, 7, 67, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
/** 罹患の部位コード → 生存率の表の部位名 */
const SURVIVAL_NAME = {
  1: "全部位", 3: "口腔・咽頭", 4: "食道", 5: "胃", 6: "結腸", 7: "直腸", 67: "大腸（結腸・直腸）",
  8: "肝および肝内胆管", 9: "胆のう・胆管", 10: "膵臓", 11: "喉頭", 12: "肺", 13: "皮膚 *2",
  14: "乳房（女性のみ）", 16: "子宮", 17: "子宮頸部", 18: "子宮体部", 19: "卵巣", 20: "前立腺",
  21: "膀胱", 22: "腎・尿路（膀胱除く）", 23: "脳・中枢神経系", 24: "甲状腺",
  25: "悪性リンパ腫", 26: "多発性骨髄腫", 27: "白血病",
};
const SEXES = { 男: "m", 女: "f" };

const rows = (file, sheet) => {
  const wb = XLSX.readFile(join(src, file), { sheets: [sheet] });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
};
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ---- 都道府県別・年齢階級別の罹患率（最新3年の平均、人口10万人あたり） ----
const incidenceFile = "pref_cancer_incidenceNCR(2016-2023).xls";
const pop = new Map(); // `${pref}|${sex}|${year}` -> number[18]
for (const r of rows(incidenceFile, "pop").slice(1)) {
  const [, pref, , sex, year] = r;
  if (!SEXES[sex] || !YEARS.includes(year)) continue;
  pop.set(`${pref}|${sex}|${year}`, r.slice(6, 6 + AGE_BINS).map(num));
}

const prefNames = new Map();
const sites = new Map();
const rates = {}; // rates[pref][site][m|f] = number[18]
for (const r of rows(incidenceFile, "number").slice(1)) {
  const [pref, prefName, site, siteName, icd, sex, year] = r;
  if (!SITES.includes(site) || !SEXES[sex] || !YEARS.includes(year)) continue;
  prefNames.set(pref, prefName);
  sites.set(site, { code: site, name: siteName, icd });
  // 0-4歳 … 80-84歳（17区分）と 85歳以上（再掲）
  const counts = [...r.slice(8, 8 + 17).map(num), num(r[r.length - 1])];
  const p = pop.get(`${pref}|${sex}|${year}`);
  if (!p) throw new Error(`人口がありません: ${pref} ${sex} ${year}`);
  const bySite = ((rates[pref] ??= {})[site] ??= {});
  const acc = (bySite[SEXES[sex]] ??= new Array(AGE_BINS).fill(0));
  counts.forEach((c, i) => { acc[i] += p[i] ? (c / p[i]) * 1e5 / YEARS.length : 0; });
}
for (const bySite of Object.values(rates))
  for (const bySex of Object.values(bySite))
    for (const k of Object.keys(bySex)) bySex[k] = bySex[k].map((v) => round(v, 3));

// ---- 5年相対生存率（2018年診断） ----
const survRows = rows("cancer_survivalNCR(2016-2018).xlsx", "最新データ（性別）");
const survival = {};
for (const [code, name] of Object.entries(SURVIVAL_NAME)) {
  const r = survRows.find((x) => x[0] === name);
  if (!r) throw new Error(`生存率の行がありません: ${name}`);
  const pct = (v) => (typeof v === "number" ? round(v, 1) : null);
  survival[code] = { m: pct(r[3]), f: pct(r[7]), t: pct(r[11]) };
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
  // 0-4歳 … 80-84歳（17区分）＋ 85歳以上（85-89, 90-94, 95-99, 100歳以上の合計）
  const ages = r.slice(5, 5 + 21).map(num);
  const bins = [...ages.slice(0, 17), ages.slice(17).reduce((a, b) => a + b, 0)];
  const m = municipalities.get(code) ?? { code, pref: prefName, name, m: [], f: [] };
  m[SEXES[sex]] = bins;
  municipalities.set(code, m);
}

const prefs = [...prefNames].filter(([code]) => code !== 0).map(([code, name]) => ({ code, name }));
const meta = {
  incidenceYears: YEARS,
  populationAsOf: asOf,
  survivalYear: 2018,
  sites: SITES.map((c) => sites.get(c)),
  prefs,
  ageBins: [...Array.from({ length: 17 }, (_, i) => `${i * 5}-${i * 5 + 4}歳`), "85歳以上"],
};

writeFileSync(join(out, "meta.json"), JSON.stringify(meta));
writeFileSync(join(out, "rates.json"), JSON.stringify(rates));
writeFileSync(join(out, "survival.json"), JSON.stringify(survival));
// 人口0（北方領土の村）は除く
const sumPop = (m) => [...m.m, ...m.f].reduce((x, y) => x + y, 0);
writeFileSync(join(out, "municipalities.json"), JSON.stringify([...municipalities.values()].filter((m) => sumPop(m) > 0)));
console.log(`部位 ${meta.sites.length}、都道府県 ${prefs.length}、市区町村（区を含む） ${[...municipalities.values()].filter((m) => sumPop(m) > 0).length}（人口 ${asOf}）`);
