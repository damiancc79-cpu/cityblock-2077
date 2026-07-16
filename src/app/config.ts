export type WeatherMode = "clear" | "light-rain" | "heavy-rain" | "electrical-storm" | "toxic-haze";
export type QualityLevel = "low" | "medium" | "high" | "ultra";
export type CameraMode = "orbit" | "fly" | "cinematic" | "isometric";

export interface CitySettings {
  seed: string;
  blockWidth: number;
  blockDepth: number;
  density: number;
  minHeight: number;
  maxHeight: number;
  variation: number;
  neonIntensity: number;
  trafficDensity: number;
  pedestrianDensity: number;
  rooftopClutter: number;
  weatherIntensity: number;
  windowProbability: number;
  greenSpace: number;
  elevatedInfrastructure: number;
  weather: WeatherMode;
  quality: QualityLevel;
  animationSpeed: number;
  reducedMotion: boolean;
  flashesEnabled: boolean;
  adaptiveQuality: boolean;
}

export const defaultSettings: CitySettings = {
  seed: "NOVA-77-ALPHA",
  blockWidth: 104,
  blockDepth: 104,
  density: 0.82,
  minHeight: 16,
  maxHeight: 62,
  variation: 0.78,
  neonIntensity: 1.4,
  trafficDensity: 0.75,
  pedestrianDensity: 0.7,
  rooftopClutter: 0.74,
  weatherIntensity: 0.82,
  windowProbability: 0.72,
  greenSpace: 0.12,
  elevatedInfrastructure: 0.65,
  weather: "heavy-rain",
  quality: "high",
  animationSpeed: 1,
  reducedMotion: false,
  flashesEnabled: true,
  adaptiveQuality: true,
};

export const visualPresets: Record<string, Partial<CitySettings>> = {
  "Neon Midnight": { weather: "heavy-rain", neonIntensity: 1.55, weatherIntensity: 0.8 },
  "Rainy Evening": { weather: "light-rain", neonIntensity: 1.1, weatherIntensity: 0.5 },
  "Toxic Dawn": { weather: "toxic-haze", neonIntensity: 0.8, weatherIntensity: 0.65 },
  "Corporate Blue Hour": { weather: "clear", neonIntensity: 1.15, weatherIntensity: 0.15 },
  "Emergency Lockdown": { weather: "electrical-storm", neonIntensity: 1.5, trafficDensity: 0.3 },
  Blackout: { weather: "heavy-rain", neonIntensity: 0.2, windowProbability: 0.08 },
  "Festival Night": { weather: "clear", neonIntensity: 1.8, pedestrianDensity: 1 },
};

const numericRanges: Record<keyof Pick<CitySettings,
  "blockWidth" | "blockDepth" | "density" | "minHeight" | "maxHeight" | "variation" |
  "neonIntensity" | "trafficDensity" | "pedestrianDensity" | "rooftopClutter" |
  "weatherIntensity" | "windowProbability" | "greenSpace" | "elevatedInfrastructure" |
  "animationSpeed">, readonly [number, number]> = {
    blockWidth: [72, 140], blockDepth: [72, 140], density: [0.35, 1], minHeight: [8, 36],
    maxHeight: [28, 84], variation: [0, 1], neonIntensity: [0, 2], trafficDensity: [0, 1],
    pedestrianDensity: [0, 1], rooftopClutter: [0, 1], weatherIntensity: [0, 1],
    windowProbability: [0, 1], greenSpace: [0, 0.35], elevatedInfrastructure: [0, 1],
    animationSpeed: [0, 2],
  };

export function validateSettings(value: unknown): CitySettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof CitySettings, unknown>>;
  const result: CitySettings = { ...defaultSettings };
  if (typeof candidate.seed !== "string" || candidate.seed.trim().length < 1 || candidate.seed.length > 64) return null;
  result.seed = candidate.seed;

  for (const [key, [min, max]] of Object.entries(numericRanges) as Array<[keyof typeof numericRanges, readonly [number, number]]>) {
    const number = candidate[key];
    if (number !== undefined) {
      if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) return null;
      result[key] = number;
    }
  }
  if (result.maxHeight < result.minHeight) return null;

  const weatherModes: WeatherMode[] = ["clear", "light-rain", "heavy-rain", "electrical-storm", "toxic-haze"];
  const qualityLevels: QualityLevel[] = ["low", "medium", "high", "ultra"];
  if (candidate.weather !== undefined && !weatherModes.includes(candidate.weather as WeatherMode)) return null;
  if (candidate.quality !== undefined && !qualityLevels.includes(candidate.quality as QualityLevel)) return null;
  if (candidate.weather) result.weather = candidate.weather as WeatherMode;
  if (candidate.quality) result.quality = candidate.quality as QualityLevel;
  for (const key of ["reducedMotion", "flashesEnabled", "adaptiveQuality"] as const) {
    if (candidate[key] !== undefined) {
      if (typeof candidate[key] !== "boolean") return null;
      result[key] = candidate[key] as boolean;
    }
  }
  return result;
}

export function serializeSettings(settings: CitySettings): string {
  return JSON.stringify(settings, null, 2);
}
