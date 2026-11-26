import { describe, expect, it } from "vitest";
import {
  addPopulations,
  estimate,
  estimateAnnual,
  estimatePrevalence5,
  formatCount,
  isWard,
  survivorYears,
  type Municipality,
} from "./estimate";

const bins = (values: Record<number, number>) => Array.from({ length: 18 }, (_, i) => values[i] ?? 0);

describe("年間新規患者数", () => {
  it("年齢・性別ごとに 人口 × 罹患率（10万人あたり）を足す", () => {
    const pop = { m: bins({ 16: 10000, 17: 5000 }), f: bins({ 16: 20000 }) };
    const rates = { m: bins({ 16: 30, 17: 40 }), f: bins({ 16: 10 }) };
    const r = estimateAnnual(pop, rates);
    expect(r.m).toBeCloseTo(3 + 2);
    expect(r.f).toBeCloseTo(2);
    expect(r.total).toBeCloseTo(7);
    expect(r.byAge[16]).toBeCloseTo(5);
  });

  it("片方の性別の率がない部位（前立腺など）は0人として数える", () => {
    const r = estimateAnnual({ m: bins({ 0: 1e5 }), f: bins({ 0: 1e5 }) }, { m: bins({ 0: 50 }) });
    expect(r).toMatchObject({ m: 50, f: 0, total: 50 });
  });
});

describe("5年有病者数（概算）", () => {
  it("生存率100%なら5年分、0%なら0になる", () => {
    expect(survivorYears(100)).toBeCloseTo(5);
    expect(survivorYears(0)).toBe(0);
  });

  it("生存率50%なら 0.5^0.1 + … + 0.5^0.9 の合計", () => {
    const expected = [0.1, 0.3, 0.5, 0.7, 0.9].reduce((a, e) => a + 0.5 ** e, 0);
    expect(survivorYears(50)).toBeCloseTo(expected);
  });

  it("性別の生存率がなければ男女計の率を使い、どちらもなければ null", () => {
    expect(estimatePrevalence5({ m: 10, f: 0 }, { m: null, f: 60, t: 100 })).toBeCloseTo(50);
    expect(estimatePrevalence5({ m: 10, f: 1 }, { m: null, f: 60, t: null })).toBeNull();
    expect(estimatePrevalence5({ m: 10, f: 1 }, undefined)).toBeNull();
  });
});

describe("地域のまとめ", () => {
  it("人口を年齢・性別ごとに足し、合計人口と推計を返す", () => {
    const a = { m: bins({ 1: 100 }), f: bins({ 1: 50 }) };
    const b = { m: bins({ 1: 10 }), f: bins({ 2: 5 }) };
    const pop = addPopulations([a, b]);
    expect(pop.m[1]).toBe(110);
    expect(pop.f[2]).toBe(5);
    const e = estimate(pop, { m: bins({ 1: 1e5 }), f: bins({}) }, { m: 100, f: 100, t: 100 });
    expect(e.population).toBe(165);
    expect(e.annual.total).toBe(110);
    expect(e.prevalence5).toBeCloseTo(550);
  });

  it("政令指定都市の区だけを区とみなし、東京23区は区とみなさない", () => {
    const m = (pref: string, name: string): Municipality => ({ code: name, pref, name, m: [], f: [] });
    const all = [m("北海道", "札幌市"), m("北海道", "札幌市中央区"), m("東京都", "千代田区")];
    expect(isWard(all[1], all)).toBe(true);
    expect(isWard(all[0], all)).toBe(false);
    expect(isWard(all[2], all)).toBe(false);
  });

  it("10未満は小数1桁、10以上は整数で表示する", () => {
    expect(formatCount(3.14)).toBe("3.1");
    expect(formatCount(1234.6)).toBe("1,235");
  });
});
