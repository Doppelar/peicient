// 都道府県の輪郭（患者の移動の地図用）を、public/geo の市区町村の地図から作る。
// 市区町村をつなげて1つにし、座標を0.01度に丸めて小さな島を落とす。public/geo/japan.json に書く
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { merge } from "topojson-client";

const dir = join(import.meta.dirname, "..", "public", "geo");
const round = (v) => Math.round(v * 100) / 100;
const ringArea = (r) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const simplifyRing = (ring) => {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
};
const features = [];
for (let code = 1; code <= 47; code++) {
  const id = String(code).padStart(2, "0");
  const topo = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
  const obj = Object.values(topo.objects)[0];
  const name = obj.geometries.find((g) => g.properties?.N03_001)?.properties.N03_001 ?? id;
  const shape = merge(topo, obj.geometries);
  const polys = shape.coordinates
    .map((poly) => poly.map(simplifyRing).filter((r) => r.length >= 4))
    .filter((poly) => poly.length > 0);
  const largest = Math.max(...polys.map((p) => ringArea(p[0])));
  // 一番大きい図形の中心付近を矢印の起点にする（離島に引っぱられないように）
  const main = polys.find((p) => ringArea(p[0]) === largest)[0];
  const xs = main.map((p) => p[0]);
  const ys = main.map((p) => p[1]);
  features.push({
    type: "Feature",
    // box は一番大きい図形の範囲（小笠原などで地図が広がりすぎないよう、寄せるときに使う）
    properties: { code, name, center: [round((Math.min(...xs) + Math.max(...xs)) / 2), round((Math.min(...ys) + Math.max(...ys)) / 2)], box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] },
    geometry: { type: "MultiPolygon", coordinates: polys.filter((p) => ringArea(p[0]) >= Math.min(0.003, largest)) },
  });
}
writeFileSync(join(dir, "japan.json"), JSON.stringify({ type: "FeatureCollection", features }));
console.log("都道府県", features.length);
