import type { CitySettings } from "../app/config";
import { SeededRandom } from "../utils/SeededRandom";

export interface Rect { x: number; z: number; width: number; depth: number }
export interface RoadPlan extends Rect { axis: "x" | "z"; level: number }
export interface ParcelPlan extends Rect { id: string; zone: "tower" | "residential" | "market" | "industrial" | "park" }
export type BuildingFamily = "Corporate" | "Residential" | "Retro-market" | "Industrial" | "Civic" | "Arcology" | "Retrofit";
export interface BuildingPlan extends Rect {
  id: string;
  height: number;
  family: BuildingFamily;
  name: string;
  accent: string;
  year: number;
  occupancy: number;
  power: string;
  security: string;
  condition: string;
  district: string;
}
export interface CityPlan { roads: RoadPlan[]; parcels: ParcelPlan[]; buildings: BuildingPlan[] }

const families: readonly BuildingFamily[] = ["Corporate", "Residential", "Retro-market", "Industrial", "Civic", "Arcology", "Retrofit"];
const prefixes = ["Kairo", "Meridian", "Gridline", "Vanta", "Helix", "Sector Nine", "Axiom", "Nexora", "Lucent", "Orochi"];
const suffixes = ["Systems Annex", "Habitat", "Exchange", "Civic Stack", "Foodworks", "Relay", "Residential Core", "Archive", "Vertical", "Terminal"];
const accents = ["#00e5ff", "#ff2bd6", "#ffb000", "#ff365e", "#68f7a4", "#8f7cff"];

function parcel(id: string, x: number, z: number, width: number, depth: number, zone: ParcelPlan["zone"]): ParcelPlan {
  return { id, x, z, width, depth, zone };
}

export class BlockPlanner {
  constructor(private readonly settings: CitySettings) {}

  generate(): CityPlan {
    const random = new SeededRandom(this.settings.seed);
    const halfW = this.settings.blockWidth / 2;
    const halfD = this.settings.blockDepth / 2;
    const roadWidth = 12;
    const serviceWidth = 6;
    const roads: RoadPlan[] = [
      { x: 0, z: 0, width: this.settings.blockWidth + 24, depth: roadWidth, axis: "x", level: 0 },
      { x: 0, z: 0, width: roadWidth, depth: this.settings.blockDepth + 24, axis: "z", level: 0 },
      { x: 0, z: -halfD - 7, width: this.settings.blockWidth + 24, depth: 8, axis: "x", level: 0 },
      { x: 0, z: halfD + 7, width: this.settings.blockWidth + 24, depth: 8, axis: "x", level: 0 },
      { x: -halfW - 7, z: 0, width: 8, depth: this.settings.blockDepth + 24, axis: "z", level: 0 },
      { x: halfW + 7, z: 0, width: 8, depth: this.settings.blockDepth + 24, axis: "z", level: 0 },
    ];
    if (this.settings.elevatedInfrastructure > 0.25) {
      roads.push({ x: 0, z: -halfD * 0.52, width: this.settings.blockWidth + 18, depth: 5.5, axis: "x", level: 15 });
    }

    const usableW = halfW - roadWidth / 2 - 3;
    const usableD = halfD - roadWidth / 2 - 3;
    const zones: ParcelPlan["zone"][] = ["tower", "residential", "market", "industrial"];
    const parcels: ParcelPlan[] = [];
    let index = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const split = random.float(0.42, 0.58);
        const totalWidth = usableW;
        const leftWidth = totalWidth * split - serviceWidth / 2;
        const rightWidth = totalWidth - leftWidth - serviceWidth;
        const centerX = sx * (roadWidth / 2 + usableW / 2 + 1.5);
        const centerZ = sz * (roadWidth / 2 + usableD / 2 + 1.5);
        const zoneA = random.pick(zones);
        const parkA = random.chance(this.settings.greenSpace * 1.6);
        parcels.push(parcel(`P-${index++}`, centerX - sx * (totalWidth - leftWidth) / 2, centerZ, leftWidth, usableD, parkA ? "park" : zoneA));
        parcels.push(parcel(`P-${index++}`, centerX + sx * (totalWidth - rightWidth) / 2, centerZ, rightWidth, usableD, random.pick(zones)));
      }
    }

    const buildings: BuildingPlan[] = [];
    for (const plot of parcels) {
      if (plot.zone === "park" || !random.chance(this.settings.density)) continue;
      const margin = random.float(1.2, 2.4);
      const width = Math.max(7, plot.width - margin * 2);
      const depth = Math.max(8, plot.depth - margin * 2);
      const centrality = 1 - Math.min(1, Math.hypot(plot.x / halfW, plot.z / halfD) / 1.3);
      const heightBias = plot.zone === "tower" ? 0.72 : plot.zone === "industrial" ? 0.22 : 0.46;
      const heightFactor = Math.min(1, heightBias + centrality * 0.25 + random.float(-0.18, 0.18) * this.settings.variation);
      const height = Math.round(this.settings.minHeight + (this.settings.maxHeight - this.settings.minHeight) * heightFactor);
      const family = plot.zone === "tower" ? random.pick(["Corporate", "Arcology"] as const)
        : plot.zone === "residential" ? random.pick(["Residential", "Retrofit"] as const)
          : plot.zone === "industrial" ? random.pick(["Industrial", "Civic"] as const)
            : random.pick(["Retro-market", "Retrofit"] as const);
      buildings.push({
        id: `B-${plot.id}`, x: plot.x, z: plot.z, width, depth, height, family,
        name: `${random.pick(prefixes)} ${random.pick(suffixes)} ${random.int(2, 99)}`,
        accent: random.pick(accents), year: random.int(2029, 2076), occupancy: random.int(48, 99),
        power: `${random.float(1.2, 8.9).toFixed(1)} MW`, security: random.pick(["OPEN", "CIVIC", "LEVEL 3", "RESTRICTED"]),
        condition: random.pick(["NOMINAL", "WEATHERED", "RETROFITTED", "SERVICE DUE"]),
        district: random.pick(["NEXUS", "LOWLINE", "STACK-04", "MERCANTILE", "TRANSIT RING"]),
      });
    }
    return { roads, parcels, buildings };
  }
}

export function rooftopPoint(building: Pick<BuildingPlan, "x" | "z" | "width" | "depth">, random: SeededRandom): { x: number; z: number } {
  const inset = 1.2;
  return {
    x: random.float(building.x - building.width / 2 + inset, building.x + building.width / 2 - inset),
    z: random.float(building.z - building.depth / 2 + inset, building.z + building.depth / 2 - inset),
  };
}

export { families };
