import { describe, expect, it } from "vitest";
import { niceTicks, spreadLabels } from "./chart";

describe("グラフの目盛り", () => {
  it("きりのよい刻みで最大値を含む", () => {
    expect(niceTicks(41)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(9)).toEqual([0, 5, 10]);
    expect(niceTicks(130)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("線の端のラベル", () => {
  it("近すぎるラベルを順番を保って離す", () => {
    expect(spreadLabels([50, 52, 200], 12, 0, 300)).toEqual([50, 62, 200]);
  });
  it("枠の下にはみ出すときは上へ押し戻す", () => {
    expect(spreadLabels([295, 298], 12, 0, 300)).toEqual([288, 300]);
  });
});
