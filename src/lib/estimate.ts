// 患者数の推計（外部依存のない計算）。
//
// 年間新規患者数 = Σ（年齢階級・性別ごとの人口 × 罹患率）
// 5年有病者数（概算）= 年間新規患者数 × Σ_{k=0..4} S5^((k+0.5)/5)
//   S5 は5年相対生存率。生存率が5年間で一定の割合で下がると仮定した、ざっくりした目安。

export type Sex = "m" | "f";
export type ByAge = number[]; // 18区分（0-4歳 … 80-84歳, 85歳以上）
export type Population = { m: ByAge; f: ByAge };
export type Rates = { m?: ByAge; f?: ByAge }; // 人口10万人あたり
export type Survival = { m: number | null; f: number | null; t: number | null }; // %

export type Municipality = { code: string; pref: string; name: string } & Population;

export type Estimate = {
  population: number;
  annual: { m: number; f: number; total: number };
  byAge: ByAge; // 男女計の年間新規患者数
  prevalence5: number | null;
};

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** 年間新規患者数（性別ごと・年齢別）。 */
export function estimateAnnual(pop: Population, rates: Rates) {
  const bySex = (sex: Sex) => pop[sex].map((p, i) => (p * (rates[sex]?.[i] ?? 0)) / 1e5);
  const m = bySex("m");
  const f = bySex("f");
  return { m: sum(m), f: sum(f), total: sum(m) + sum(f), byAge: m.map((v, i) => v + f[i]) };
}

/** 診断から k+0.5 年後に生きている割合の合計（k = 0..4）。 */
export function survivorYears(s5Percent: number): number {
  const s5 = Math.min(Math.max(s5Percent / 100, 0), 1);
  return sum([0, 1, 2, 3, 4].map((k) => s5 ** ((k + 0.5) / 5)));
}

/** 5年以内に診断されて生存している人数の概算。生存率がなければ null。 */
export function estimatePrevalence5(annual: { m: number; f: number }, survival: Survival | undefined): number | null {
  if (!survival) return null;
  const part = (n: number, s: number | null) => (n === 0 ? 0 : s == null ? null : n * survivorYears(s));
  const m = part(annual.m, survival.m ?? survival.t);
  const f = part(annual.f, survival.f ?? survival.t);
  return m == null || f == null ? null : m + f;
}

export function estimate(pop: Population, rates: Rates, survival: Survival | undefined): Estimate {
  const annual = estimateAnnual(pop, rates);
  return {
    population: sum(pop.m) + sum(pop.f),
    annual: { m: annual.m, f: annual.f, total: annual.total },
    byAge: annual.byAge,
    prevalence5: estimatePrevalence5(annual, survival),
  };
}

/** 複数地域の人口を足す。 */
export function addPopulations(pops: readonly Population[]): Population {
  const zero = () => new Array(18).fill(0) as ByAge;
  return pops.reduce<Population>(
    (acc, p) => ({ m: acc.m.map((v, i) => v + (p.m[i] ?? 0)), f: acc.f.map((v, i) => v + (p.f[i] ?? 0)) }),
    { m: zero(), f: zero() },
  );
}

/**
 * 政令指定都市の区（「札幌市中央区」など）か。
 * 同じ都道府県に「札幌市」があるときだけ区とみなす（東京23区は市区町村そのもの）。
 */
export function isWard(m: Municipality, all: readonly Municipality[]): boolean {
  const city = m.name.match(/^(.+市).+区$/)?.[1];
  return Boolean(city && all.some((x) => x.pref === m.pref && x.name === city));
}

/** 表示用：小さい数は小数1桁、10以上は整数。 */
export function formatCount(n: number): string {
  if (n >= 10) return Math.round(n).toLocaleString("ja-JP");
  return n.toFixed(1);
}

/** 年齢別（5歳階級・18区分）の人数を、70歳未満・70〜79歳・80歳以上にまとめる。 */
export function ageGroups(byAge: readonly number[]) {
  const under70 = sum(byAge.slice(0, 14));
  const age70s = sum(byAge.slice(14, 16));
  const over80 = sum(byAge.slice(16));
  return { under70, age70s, over70: age70s + over80, over80 };
}
