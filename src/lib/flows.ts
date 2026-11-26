// 院内がん登録の住所から見た、都道府県をまたぐ患者の移動。外部依存なし。
import { regValue, toRegCount, type RegCount, type RegDetailCount } from "./hospitals";

/** [住んでいる都道府県, 受診した都道府県, 件数] */
export type Flow = [number, number, RegDetailCount];
export type PrefFlow = { code: number; count: RegCount };

/** 選んだ都道府県に他県から来た移動（inflow）と、他県へ出た移動（outflow）を件数の多い順に。 */
export function flowsOf(flows: readonly Flow[], prefCode: number): { inflow: PrefFlow[]; outflow: PrefFlow[] } {
  const pick = (side: 0 | 1, other: 0 | 1) =>
    flows
      .filter((f) => f[side] === prefCode)
      .map((f) => ({ code: f[other], count: toRegCount(f[2]) }))
      .sort((a, b) => regValue(b.count) - regValue(a.count) || a.code - b.code);
  return { inflow: pick(1, 0), outflow: pick(0, 1) };
}

/** 件数の合計（幅のあるものは下限・上限をそれぞれ足す）。 */
export const sumFlow = (list: readonly PrefFlow[]): RegCount =>
  list.reduce<RegCount>((s, f) => [s[0] + f.count[0], s[1] + f.count[1]], [0, 0]);
