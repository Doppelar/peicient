// DPC（厚生労働省 退院患者調査）の病院ごとの件数の扱い。外部依存なし。

/** [件数] または [わかっている件数, 1]（10件未満で伏せられた区分がある）。 */
export type DpcCount = [number] | [number, 1];

export type Hospital = {
  id: string;
  name: string;
  muni: string; // 市区町村コード（5桁）
  beds: number;
  type: string;
  counts: Record<string, DpcCount>;
  /** 院内がん登録での区分（拠点病院・拠点外病院・小児がん病院）。対象外ならなし */
  hbcr?: string;
};

/** 表示用。伏せられた区分があるときは「以上」を付ける。 */
export function formatDpc(c: DpcCount | undefined): string {
  if (!c) return "—";
  return c[1] ? `${c[0]}以上` : String(c[0]);
}

/** 並べ替え・大きさに使う件数（伏せられた区分は数えない）。 */
export const dpcValue = (c: DpcCount | undefined) => c?.[0] ?? 0;

/** 「独立行政法人国立病院機構　渋川医療センター」→「渋川医療センター」のように、法人名などを外して短くする。 */
export function shortHospitalName(name: string): string {
  // 「医療法人　社団　日高会」のように法人名の中に空白があるものは先に詰める
  const s = name.replace(/[\s　]+/g, " ").trim().replace(/^((?:社会)?医療法人) ?(社団|財団)? ?/, (_, a: string, b?: string) => `${a}${b ?? ""}`);
  const stripped = s
    // 「医療法人島門会本島総合病院」のような法人名は「〜会」までを外す
    .replace(/^(社会)?医療法人(社団|財団)?\S*?会\s?(?=\S)/, "")
    .replace(/^(独立行政法人|地方独立行政法人|国立大学法人|公立大学法人|学校法人|医療法人(社団|財団)?|社会医療法人(財団|社団)?|一般財団法人|公益財団法人|社会福祉法人|一般社団法人|公益社団法人)\S*?(\s|(?=[^\s]*病院))/, "")
    .replace(/^(国立病院機構|地域医療機能推進機構|労働者健康安全機構|東京都立病院機構)\s?/, "");
  return stripped.trim() || s;
}

/** 都道府県コード（2桁）で絞り、その病気の件数が多い順に並べる。 */
export function rankHospitals(hospitals: readonly Hospital[], prefCode: number, dpc: string): Hospital[] {
  const p = String(prefCode).padStart(2, "0");
  return hospitals
    .filter((h) => h.muni.startsWith(p) && dpcValue(h.counts[dpc]) > 0)
    .sort((a, b) => dpcValue(b.counts[dpc]) - dpcValue(a.counts[dpc]));
}

/** 同じ市区町村に複数の病院があるとき、重ならないよう少しずつずらす位置（ひまわり状）。 */
export function spreadOffsets(n: number, step = 9): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return [0, 0];
    const r = step * Math.sqrt(i);
    const a = i * 2.39996; // 黄金角
    return [Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10];
  });
}

/** データの形：年度ごとの件数を持つ病院。 */
export type HospitalByYear = Omit<Hospital, "counts"> & { counts: Record<string, Record<string, DpcCount>> };

/** 年度の表示名（DPC は4月〜翌3月の退院）。 */
export const fiscalYearLabel = (year: number) => `${year}年度`;

/** 1つの年度の件数だけを持つ病院に変える（その年度の件数がない病院は除く）。 */
export function forYear(hospitals: readonly HospitalByYear[], year: number): Hospital[] {
  return hospitals
    .filter((h) => h.counts[year])
    .map((h) => ({ ...h, counts: h.counts[year] }));
}

/** その病気の件数の年度ごとの推移（古い順）。 */
export function trendOf(h: HospitalByYear, dpc: string, years: readonly number[]): Array<{ year: number; count: DpcCount | undefined }> {
  return [...years].sort((a, b) => a - b).map((year) => ({ year, count: h.counts[year]?.[dpc] }));
}

/** 院内がん登録の新規登録数。[下限, 上限]（3件以下は「1～3」のように幅で公表）。 */
export type RegCount = [number, number];

/** データの形：DPC の年度ごとの件数と、院内がん登録の部位・診断年ごとの件数を持つ病院。 */
export type HospitalData = HospitalByYear & { reg?: Record<string, Record<string, RegCount>> };

export function formatReg(c: RegCount | undefined): string {
  if (!c) return "—";
  if (c[0] === c[1]) return String(c[0]);
  return `${c[0]}〜${c[1]}`;
}

/** 並べ替え・丸の大きさに使う値（幅があるときは真ん中）。 */
export const regValue = (c: RegCount | undefined) => (c ? (c[0] + c[1]) / 2 : 0);

/** 病院の件数の出どころ。 */
export type CountSource = { kind: "dpc"; year: number; dpc: string } | { kind: "reg"; year: number; reg: string };

/** 地図・一覧に出す病院と、その件数。 */
export type HospitalPoint = { h: HospitalData; value: number; label: string };

/** 都道府県で絞り、選んだ出どころの件数が多い順に並べる（件数が0の病院は除く）。 */
export function rankPoints(hospitals: readonly HospitalData[], prefCode: number, source: CountSource): HospitalPoint[] {
  const p = String(prefCode).padStart(2, "0");
  return hospitals
    .filter((h) => h.muni.startsWith(p))
    .map((h) => {
      if (source.kind === "dpc") {
        const c = h.counts[source.year]?.[source.dpc];
        return { h, value: dpcValue(c), label: formatDpc(c) };
      }
      const c = h.reg?.[source.reg]?.[source.year];
      return { h, value: regValue(c), label: formatReg(c) };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** 院内がん登録の件数の推移（古い順）。 */
export function regTrendOf(h: HospitalData, reg: string, years: readonly number[]): Array<{ year: number; count: RegCount | undefined }> {
  return [...years].sort((a, b) => a - b).map((year) => ({ year, count: h.reg?.[reg]?.[year] }));
}

/** 所在市区町村がわからない（DPC の施設一覧で見つからなかった）病院か。 */
export const hasNoMuni = (h: { muni: string }) => h.muni.endsWith("000");

/** 院内がん登録の内訳。件数は数字か [下限, 上限]（幅で公表されたもの） */
export type RegDetailCount = number | RegCount;
export type RegDetail = {
  /** 内訳の種類（性別・年齢など）ごとの列名 */
  dims: Record<string, string[]>;
  /** hospitals[病院id][部位][内訳][診断年] = 列ごとの件数 */
  hospitals: Record<string, Record<string, Record<string, Record<string, RegDetailCount[]>>>>;
  /** flows[部位][診断年] = [住んでいる都道府県, 受診した都道府県, 件数][]（都道府県をまたぐものだけ） */
  flows?: Record<string, Record<string, Array<[number, number, RegDetailCount]>>>;
  /** hospitalFlows[部位][診断年][病院id] = [住んでいる都道府県, 件数][]（病院のある都道府県の外から来た人だけ） */
  hospitalFlows?: Record<string, Record<string, Record<string, Array<[number, RegDetailCount]>>>>;
};

export const toRegCount = (c: RegDetailCount): RegCount => (typeof c === "number" ? [c, c] : c);

/**
 * 内訳のうち選んだ列が全体に占める割合（%、整数）。幅のある件数は真ん中の値で計算し、
 * 幅のある件数が1つでもあれば「約」を付ける（0件ちょうどは付けない）。行がない・全体が0のときは null
 */
export function regShare(row: RegDetailCount[] | undefined, pick: readonly number[]): { pct: number; approx: boolean } | null {
  if (!row) return null;
  const counts = row.map(toRegCount);
  const total = counts.reduce((s, c) => s + regValue(c), 0);
  if (total === 0) return null;
  const part = pick.reduce((s, i) => s + regValue(counts[i]), 0);
  return { pct: Math.round((part / total) * 100), approx: part > 0 && counts.some((c) => c[0] !== c[1]) };
}

export const formatShare = (s: ReturnType<typeof regShare>) => (s ? `${s.approx ? "約" : ""}${s.pct}%` : "—");

/** 割合（%）を5段階の色の番号に（0〜19%→0 … 80%以上→4） */
export const shareStep = (pct: number) => Math.max(0, Math.min(4, Math.floor(pct / 20)));

export type AgeGroup = "under70" | "over70" | "over80";

/**
 * 院内がん登録の年齢（0～14・15～39・40～64・65～74・75～84・85歳以上）から、70歳未満・70歳以上・80歳以上の割合を出す。
 * 公表の区切りが70歳・80歳と合わないので、65～74歳は「70～74歳」、75～84歳は「80～84歳」の分を、
 * 同じ都道府県の推計患者数の5歳階級（byAge：0-4歳…85歳以上の18区分）の比で割り振る。推計なので常に「約」
 */
export function regAgeShare(row: RegDetailCount[] | undefined, labels: readonly string[], byAge: readonly number[], group: AgeGroup): { pct: number; approx: boolean } | null {
  if (!row) return null;
  const v = (prefix: string) => {
    const i = labels.findIndex((l) => l.startsWith(prefix));
    return i < 0 ? 0 : regValue(toRegCount(row[i]));
  };
  const total = row.reduce<number>((s, c) => s + regValue(toRegCount(c)), 0);
  if (total === 0) return null;
  const ratio = (a: number, b: number) => (a + b > 0 ? b / (a + b) : 0.5);
  const w70 = ratio(byAge[13] ?? 0, byAge[14] ?? 0); // 65～74歳のうち70～74歳
  const w80 = ratio(byAge[15] ?? 0, byAge[16] ?? 0); // 75～84歳のうち80～84歳
  const over80 = v("75") * w80 + v("85");
  const over70 = v("65") * w70 + v("75") + v("85");
  const part = group === "over80" ? over80 : group === "over70" ? over70 : total - over70;
  return { pct: Math.round((part / total) * 100), approx: true };
}
