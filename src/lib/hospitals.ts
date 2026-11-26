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
  const s = name.replace(/[\s　]+/g, " ").trim();
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
