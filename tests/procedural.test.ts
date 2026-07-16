import { describe, expect, it } from "vitest";
import { defaultSettings, serializeSettings, validateSettings } from "../src/app/config";
import { BlockPlanner, rooftopPoint } from "../src/city/BlockPlanner";
import { SeededRandom } from "../src/utils/SeededRandom";

describe("seeded procedural city", () => {
  it("reproduces an identical plan for the same seed", () => {
    const first = new BlockPlanner({ ...defaultSettings, seed: "DETERMINISTIC-77" }).generate();
    const second = new BlockPlanner({ ...defaultSettings, seed: "DETERMINISTIC-77" }).generate();
    expect(second).toEqual(first);
  });

  it("creates visibly different plans from different seeds", () => {
    const first = new BlockPlanner({ ...defaultSettings, seed: "ALPHA" }).generate();
    const second = new BlockPlanner({ ...defaultSettings, seed: "BETA" }).generate();
    expect(second.buildings).not.toEqual(first.buildings);
  });

  it("keeps parcels inside the planned city block", () => {
    const plan = new BlockPlanner(defaultSettings).generate();
    for (const parcel of plan.parcels) {
      expect(Math.abs(parcel.x) + parcel.width / 2).toBeLessThanOrEqual(defaultSettings.blockWidth / 2 + 0.001);
      expect(Math.abs(parcel.z) + parcel.depth / 2).toBeLessThanOrEqual(defaultSettings.blockDepth / 2 + 0.001);
      expect(parcel.width).toBeGreaterThan(0);
      expect(parcel.depth).toBeGreaterThan(0);
    }
  });

  it("respects configured building height constraints", () => {
    const settings = { ...defaultSettings, minHeight: 22, maxHeight: 47, density: 1 };
    const plan = new BlockPlanner(settings).generate();
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const building of plan.buildings) {
      expect(building.height).toBeGreaterThanOrEqual(settings.minHeight);
      expect(building.height).toBeLessThanOrEqual(settings.maxHeight);
    }
  });

  it("keeps the street cross navigable and continuous", () => {
    const plan = new BlockPlanner(defaultSettings).generate();
    expect(plan.roads.some((road) => road.axis === "x" && road.level === 0 && road.width > defaultSettings.blockWidth)).toBe(true);
    expect(plan.roads.some((road) => road.axis === "z" && road.level === 0 && road.depth > defaultSettings.blockDepth)).toBe(true);
    for (const building of plan.buildings) {
      const overlapsCentralX = Math.abs(building.z) < 6 + building.depth / 2;
      const overlapsCentralZ = Math.abs(building.x) < 6 + building.width / 2;
      expect(overlapsCentralX || overlapsCentralZ).toBe(false);
    }
  });

  it("places rooftop props within roof boundaries", () => {
    const building = { x: 12, z: -9, width: 18, depth: 13 };
    const random = new SeededRandom("ROOFTOP");
    for (let index = 0; index < 100; index += 1) {
      const point = rooftopPoint(building, random);
      expect(point.x).toBeGreaterThanOrEqual(building.x - building.width / 2 + 1.2);
      expect(point.x).toBeLessThanOrEqual(building.x + building.width / 2 - 1.2);
      expect(point.z).toBeGreaterThanOrEqual(building.z - building.depth / 2 + 1.2);
      expect(point.z).toBeLessThanOrEqual(building.z + building.depth / 2 - 1.2);
    }
  });
});

describe("preset persistence", () => {
  it("round-trips a serialized preset", () => {
    const json = serializeSettings({ ...defaultSettings, seed: "SAVE-ME", neonIntensity: 1.72 });
    expect(validateSettings(JSON.parse(json) as unknown)).toEqual({ ...defaultSettings, seed: "SAVE-ME", neonIntensity: 1.72 });
  });

  it("rejects malformed or out-of-range imports", () => {
    expect(validateSettings(null)).toBeNull();
    expect(validateSettings({ ...defaultSettings, seed: "", density: 2 })).toBeNull();
    expect(validateSettings({ ...defaultSettings, seed: "BAD", minHeight: 70, maxHeight: 30 })).toBeNull();
    expect(validateSettings({ ...defaultSettings, seed: "BAD", weather: "acid-snow" })).toBeNull();
  });
});
