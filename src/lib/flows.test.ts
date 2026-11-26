import { describe, expect, it } from "vitest";
import { flowsOf, sumFlow, type Flow } from "./flows";

describe("都道府県をまたぐ患者の移動", () => {
  const flows: Flow[] = [[11, 10, 10], [9, 10, [4, 6]], [10, 13, [4, 6]], [1, 10, [1, 3]], [13, 11, 50]];

  it("他県から来た移動と他県へ出た移動を、件数の多い順に分ける", () => {
    const { inflow, outflow } = flowsOf(flows, 10);
    expect(inflow).toEqual([{ code: 11, count: [10, 10] }, { code: 9, count: [4, 6] }, { code: 1, count: [1, 3] }]);
    expect(outflow).toEqual([{ code: 13, count: [4, 6] }]);
  });

  it("合計は幅のまま足す", () => {
    expect(sumFlow(flowsOf(flows, 10).inflow)).toEqual([15, 19]);
  });
});
