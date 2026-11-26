import { describe, expect, it } from "vitest";
import { dpcValue, forYear, formatDpc, formatReg, formatShare, hasNoMuni, regShare, rankHospitals, rankPoints, regTrendOf, regValue, shortHospitalName, spreadOffsets, trendOf, type Hospital, type HospitalByYear, type HospitalData } from "./hospitals";

describe("DPCの件数", () => {
  it("伏せられた区分があるときは「以上」を付ける", () => {
    expect(formatDpc([69])).toBe("69");
    expect(formatDpc([14, 1])).toBe("14以上");
    expect(formatDpc(undefined)).toBe("—");
    expect(dpcValue(undefined)).toBe(0);
  });

  it("都道府県で絞り、件数の多い順に並べる（その病気の件数がない病院は除く）", () => {
    const h = (id: string, muni: string, n?: number): Hospital => ({
      id, name: id, muni, beds: 0, type: "", counts: n ? { "130040": [n] } : {},
    });
    const list = [h("a", "10201", 40), h("b", "10208", 69), h("c", "11100", 99), h("d", "10202")];
    expect(rankHospitals(list, 10, "130040").map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("病院名を短くする", () => {
  it("法人名を外す", () => {
    expect(shortHospitalName("独立行政法人国立病院機構　渋川医療センター")).toBe("渋川医療センター");
    expect(shortHospitalName("国立大学法人群馬大学医学部附属病院")).toBe("群馬大学医学部附属病院");
    expect(shortHospitalName("医療法人島門会本島総合病院")).toBe("本島総合病院");
    expect(shortHospitalName("前橋赤十字病院")).toBe("前橋赤十字病院");
    expect(shortHospitalName("医療法人　社団　日高会　日高病院")).toBe("日高病院");
  });
});

describe("重ならない位置", () => {
  it("1つ目は中心、2つ目以降は中心から離れる", () => {
    const o = spreadOffsets(4);
    expect(o[0]).toEqual([0, 0]);
    for (const [x, y] of o.slice(1)) expect(Math.hypot(x, y)).toBeGreaterThan(5);
  });
});

describe("年度の切り替え", () => {
  const h: HospitalByYear = {
    id: "a", name: "A病院", muni: "10208", beds: 0, type: "",
    counts: { 2023: { "130040": [69] }, 2020: { "130040": [48], "130010": [12, 1] } },
  };

  it("選んだ年度の件数だけにする（その年度がない病院は除く）", () => {
    expect(forYear([h], 2020)[0].counts).toEqual({ "130040": [48], "130010": [12, 1] });
    expect(forYear([h], 2021)).toEqual([]);
  });

  it("推移は古い年度から並べ、ない年度は undefined", () => {
    expect(trendOf(h, "130040", [2023, 2021, 2020])).toEqual([
      { year: 2020, count: [48] },
      { year: 2021, count: undefined },
      { year: 2023, count: [69] },
    ]);
  });
});

describe("院内がん登録の件数", () => {
  const h = (id: string, muni: string, reg?: Record<string, [number, number]>, dpc?: number): HospitalData => ({
    id, name: id, muni, beds: 0, type: "",
    counts: dpc ? { 2023: { "130040": [dpc] } } : {},
    reg: reg ? { 多発性骨髄腫: reg } : undefined,
  });

  it("幅のある件数は「1〜3」、0件や不明は区別して表示する", () => {
    expect(formatReg([12, 12])).toBe("12");
    expect(formatReg([1, 3])).toBe("1〜3");
    expect(formatReg([0, 0])).toBe("0");
    expect(formatReg(undefined)).toBe("—");
    expect(regValue([1, 3])).toBe(2);
  });

  it("選んだ診断年で並べ、0件の病院は除く（DPC を選べば DPC の件数で並べる）", () => {
    const list = [
      h("a", "10201", { 2023: [41, 41] }, 69),
      h("b", "10204", { 2023: [1, 3] }),
      h("c", "10202", { 2023: [0, 0] }, 80),
      h("d", "11100", { 2023: [99, 99] }),
    ];
    expect(rankPoints(list, 10, { kind: "reg", year: 2023, reg: "多発性骨髄腫" }).map((x) => [x.h.id, x.label])).toEqual([["a", "41"], ["b", "1〜3"]]);
    expect(rankPoints(list, 10, { kind: "dpc", year: 2023, dpc: "130040" }).map((x) => x.h.id)).toEqual(["c", "a"]);
  });

  it("推移は古い年から並べる", () => {
    expect(regTrendOf(h("a", "10201", { 2023: [41, 41], 2021: [26, 26] }), "多発性骨髄腫", [2023, 2022, 2021])).toEqual([
      { year: 2021, count: [26, 26] },
      { year: 2022, count: undefined },
      { year: 2023, count: [41, 41] },
    ]);
  });

  it("所在地がわからない病院は市区町村コードの末尾が000", () => {
    expect(hasNoMuni({ muni: "10000" })).toBe(true);
    expect(hasNoMuni({ muni: "10201" })).toBe(false);
  });
});

describe("院内がん登録の内訳の割合", () => {
  it("選んだ列の割合を出し、幅のある件数があれば「約」を付ける", () => {
    expect(formatShare(regShare([15, 5], [0]))).toBe("75%");
    expect(formatShare(regShare([[1, 3], 8], [1]))).toBe("約80%");
    expect(formatShare(regShare([10, [1, 3], 0], [0, 2]))).toBe("約83%");
    expect(formatShare(regShare([[1, 3], 0], [1]))).toBe("0%");
    expect(formatShare(regShare([0, 0], [0]))).toBe("—");
    expect(formatShare(regShare(undefined, [0]))).toBe("—");
  });
});
