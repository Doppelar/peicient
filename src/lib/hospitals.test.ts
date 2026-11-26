import { describe, expect, it } from "vitest";
import { dpcValue, forYear, formatDpc, rankHospitals, shortHospitalName, spreadOffsets, trendOf, type Hospital, type HospitalByYear } from "./hospitals";

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
