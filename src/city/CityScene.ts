import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { CameraMode, CitySettings } from "../app/config";
import { BlockPlanner, rooftopPoint, type BuildingPlan, type CityPlan } from "./BlockPlanner";
import { createGlyphTexture, createRoadTexture, createSignTexture, createWindowTexture } from "../rendering/PixelTextures";
import { SeededRandom } from "../utils/SeededRandom";

interface Vehicle { group: THREE.Group; phase: number; speed: number; flying: boolean; lane: number; direction: number }
interface Pedestrian { phase: number; speed: number; radius: number; y: number }
interface CitySceneCallbacks {
  onSelect(building: BuildingPlan | null): void;
  onHover(active: boolean): void;
  onReady(plan: CityPlan): void;
  onMetrics(fps: number, camera: { x: number; z: number }, qualityNote: string): void;
}

const qualityOptions = {
  low: { pixelRatio: 0.75, rain: 600, vehicles: 12, pedestrians: 35, bloom: false },
  medium: { pixelRatio: 1, rain: 1100, vehicles: 18, pedestrians: 55, bloom: true },
  high: { pixelRatio: 1.35, rain: 1700, vehicles: 26, pedestrians: 80, bloom: true },
  ultra: { pixelRatio: 1.7, rain: 2400, vehicles: 36, pedestrians: 120, bloom: true },
} as const;

export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 420);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly cityGroup = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly buildingMeshes: THREE.Mesh[] = [];
  private readonly textureCache: THREE.Texture[] = [];
  private readonly vehicles: Vehicle[] = [];
  private readonly pedestrians: Pedestrian[] = [];
  private readonly keys = new Set<string>();
  private readonly callbacks: CitySceneCallbacks;
  private selected: THREE.Mesh | null = null;
  private rain: THREE.Points | null = null;
  private rainBase: Float32Array | null = null;
  private pedestrianMesh: THREE.InstancedMesh | null = null;
  private settings: CitySettings;
  private plan: CityPlan;
  private animationFrame = 0;
  private running = true;
  private paused = false;
  private mode: CameraMode = "orbit";
  private cinematicTime = 0;
  private lightning = 0;
  private frames = 0;
  private fpsTime = 0;
  private qualityNote = "AUTO / STABLE";
  private onResizeBound: () => void;
  private pointerDown = { x: 0, y: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, settings: CitySettings, callbacks: CitySceneCallbacks) {
    this.settings = { ...settings };
    this.callbacks = callbacks;
    if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) throw new Error("This experience requires WebGL.");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color("#02040b");
    this.scene.fog = new THREE.FogExp2("#070b18", 0.009);
    this.camera.position.set(92, 73, 96);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.target.set(0, 17, 0);
    this.controls.minDistance = 18;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.panSpeed = 0.7;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.58, 0.78);
    this.composer.addPass(this.bloomPass);
    this.scene.add(this.cityGroup, this.animatedGroup);
    this.addLighting();
    this.plan = new BlockPlanner(this.settings).generate();
    this.generate();
    this.onResizeBound = () => this.resize();
    window.addEventListener("resize", this.onResizeBound);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("wheel", this.keepCameraAboveGround, { passive: true });
    this.resize();
    this.animate();
  }

  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight("#527cff", "#12051b", 1.15);
    const moon = new THREE.DirectionalLight("#a8c8ff", 2.2);
    moon.position.set(-45, 90, 38);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -90;
    moon.shadow.camera.right = 90;
    moon.shadow.camera.top = 90;
    moon.shadow.camera.bottom = -90;
    const cyanPool = new THREE.PointLight("#00d9ff", 28, 72, 2);
    cyanPool.position.set(-28, 16, -18);
    const magentaPool = new THREE.PointLight("#ff2bc2", 24, 62, 2);
    magentaPool.position.set(31, 13, 25);
    this.scene.add(hemisphere, moon, cyanPool, magentaPool);
  }

  regenerate(settings: CitySettings): void {
    this.settings = { ...settings };
    this.disposeGroup(this.cityGroup);
    this.disposeGroup(this.animatedGroup);
    this.cityGroup.clear();
    this.animatedGroup.clear();
    this.buildingMeshes.length = 0;
    this.textureCache.splice(0).forEach((texture) => texture.dispose());
    this.vehicles.length = 0;
    this.pedestrians.length = 0;
    this.selected = null;
    this.rain = null;
    this.rainBase = null;
    this.pedestrianMesh = null;
    this.plan = new BlockPlanner(settings).generate();
    this.generate();
    this.callbacks.onSelect(null);
    this.callbacks.onReady(this.plan);
  }

  private generate(): void {
    const random = new SeededRandom(this.settings.seed);
    this.createGround();
    this.createRoads();
    this.createParcels(random);
    this.plan.buildings.forEach((building, index) => this.createBuilding(building, index, random));
    this.createInfrastructure(random);
    this.createTraffic(random);
    this.createPedestrians(random);
    this.createRain(random);
    this.createSteam(random);
    this.applyQuality();
    this.callbacks.onReady(this.plan);
  }

  private createGround(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(this.settings.blockWidth + 42, 1.8, this.settings.blockDepth + 42),
      new THREE.MeshStandardMaterial({ color: "#070b12", roughness: 0.72, metalness: 0.35 }),
    );
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    this.cityGroup.add(ground);

    const underside = new THREE.Mesh(
      new THREE.BoxGeometry(this.settings.blockWidth + 38, 5, this.settings.blockDepth + 38),
      new THREE.MeshStandardMaterial({ color: "#03050a", roughness: 0.9, metalness: 0.25 }),
    );
    underside.position.y = -4.5;
    this.cityGroup.add(underside);
  }

  private createRoads(): void {
    const texture = createRoadTexture();
    this.textureCache.push(texture);
    for (const road of this.plan.roads.filter((entry) => entry.level === 0)) {
      const material = new THREE.MeshPhysicalMaterial({ map: texture, color: "#151b24", roughness: 0.26, metalness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.18 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(road.width, 0.18, road.depth), material);
      mesh.position.set(road.x, 0.02, road.z);
      mesh.receiveShadow = true;
      this.cityGroup.add(mesh);
    }
    const crossingMaterial = new THREE.MeshBasicMaterial({ color: "#9fb2bb", transparent: true, opacity: 0.55 });
    for (let lane = -4; lane <= 4; lane += 2) {
      const crossX = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 8), crossingMaterial);
      crossX.position.set(lane, 0.18, 0);
      const crossZ = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.9), crossingMaterial);
      crossZ.position.set(0, 0.18, lane);
      this.cityGroup.add(crossX, crossZ);
    }
  }

  private createParcels(random: SeededRandom): void {
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: "#19202b", roughness: 0.6, metalness: 0.3 });
    for (const plot of this.plan.parcels) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(plot.width + 2, 0.6, plot.depth + 2), sidewalkMaterial);
      slab.position.set(plot.x, 0.45, plot.z);
      slab.receiveShadow = true;
      this.cityGroup.add(slab);
      if (plot.zone === "park") this.createPark(plot, random);
      else if (plot.zone === "market") this.createMarket(plot, random);
    }
  }

  private createPark(plot: CityPlan["parcels"][number], random: SeededRandom): void {
    const turf = new THREE.Mesh(new THREE.BoxGeometry(plot.width - 2, 0.35, plot.depth - 2), new THREE.MeshStandardMaterial({ color: "#0c3a34", emissive: "#0b372e", emissiveIntensity: 0.35, roughness: 0.75 }));
    turf.position.set(plot.x, 0.9, plot.z);
    this.cityGroup.add(turf);
    const treeGeometry = new THREE.BoxGeometry(0.9, 3.8, 0.9);
    const treeMaterial = new THREE.MeshStandardMaterial({ color: "#44bc88", emissive: "#1e5e4a", emissiveIntensity: 0.5 });
    for (let i = 0; i < Math.min(8, Math.floor(plot.width / 3)); i += 1) {
      const tree = new THREE.Mesh(treeGeometry, treeMaterial);
      tree.position.set(random.float(plot.x - plot.width / 2 + 2, plot.x + plot.width / 2 - 2), 2.8, random.float(plot.z - plot.depth / 2 + 2, plot.z + plot.depth / 2 - 2));
      this.cityGroup.add(tree);
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(Math.min(plot.width, plot.depth) * 0.24, 0.16, 4, 20), new THREE.MeshBasicMaterial({ color: "#55ffc7" }));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(plot.x, 1.15, plot.z);
    this.cityGroup.add(halo);
  }

  private createMarket(plot: CityPlan["parcels"][number], random: SeededRandom): void {
    const colors = ["#00d9ff", "#ff2bc2", "#ffad28"];
    const count = Math.min(6, Math.max(3, Math.floor(plot.depth / 7)));
    for (let i = 0; i < count; i += 1) {
      const stall = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.5, 2.8), new THREE.MeshStandardMaterial({ color: "#161b25", roughness: 0.6, metalness: 0.45 }));
      shell.position.y = 2.05;
      const accent = random.pick(colors);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.22, 2.95), new THREE.MeshBasicMaterial({ color: accent }));
      strip.position.y = 3.3;
      stall.add(shell, strip);
      stall.position.set(plot.x - plot.width / 2 + 3, 0, plot.z - plot.depth / 2 + 4 + i * 5);
      this.cityGroup.add(stall);
    }
  }

  private createBuilding(building: BuildingPlan, index: number, random: SeededRandom): void {
    const group = new THREE.Group();
    group.position.set(building.x, 0.8, building.z);
    const texture = createWindowTexture(`${this.settings.seed}-${building.id}`, building.accent, this.settings.windowProbability);
    texture.repeat.set(Math.max(1, building.width / 12), Math.max(2, building.height / 12));
    this.textureCache.push(texture);
    const familyColor: Record<BuildingPlan["family"], string> = {
      Corporate: "#17283b", Residential: "#272334", "Retro-market": "#33251f", Industrial: "#202a2d", Civic: "#25293a", Arcology: "#1b2c36", Retrofit: "#2d262c",
    };
    const material = new THREE.MeshStandardMaterial({ color: familyColor[building.family], map: texture, emissiveMap: texture, emissive: building.accent, emissiveIntensity: this.settings.neonIntensity * 0.68, roughness: 0.5, metalness: 0.4 });
    const baseHeight = Math.min(7, building.height * 0.19);
    const podium = new THREE.Mesh(new THREE.BoxGeometry(building.width + 1.6, baseHeight, building.depth + 1.6), new THREE.MeshStandardMaterial({ color: "#191d27", roughness: 0.63, metalness: 0.32 }));
    podium.position.y = baseHeight / 2;
    podium.castShadow = true;
    group.add(podium);

    const shaftHeight = building.height - baseHeight;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(building.width, shaftHeight, building.depth), material);
    shaft.position.y = baseHeight + shaftHeight / 2;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    shaft.userData.building = building;
    shaft.userData.baseEmissive = new THREE.Color(building.accent);
    this.buildingMeshes.push(shaft);
    group.add(shaft);

    if (building.height > 38) {
      const topHeight = building.height * 0.28;
      shaft.scale.y = (shaftHeight - topHeight * 0.38) / shaftHeight;
      shaft.position.y -= topHeight * 0.19;
      const setback = new THREE.Mesh(new THREE.BoxGeometry(building.width * 0.72, topHeight, building.depth * 0.74), material.clone());
      setback.position.y = building.height - topHeight / 2;
      setback.castShadow = true;
      setback.userData.building = building;
      this.buildingMeshes.push(setback);
      group.add(setback);
    }

    const stripMaterial = new THREE.MeshBasicMaterial({ color: building.accent });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(building.width + 0.22, 0.28, building.depth + 0.22), stripMaterial);
    strip.position.y = baseHeight + random.float(2, Math.max(3, shaftHeight * 0.68));
    group.add(strip);

    const lobby = new THREE.Mesh(new THREE.BoxGeometry(Math.min(5, building.width * 0.4), 3.2, 0.35), new THREE.MeshBasicMaterial({ color: building.accent }));
    lobby.position.set(0, 2.1, building.z > 0 ? -building.depth / 2 - 0.86 : building.depth / 2 + 0.86);
    group.add(lobby);

    this.createRooftop(group, building, random);
    if (index % 2 === 0 || building.family === "Retro-market") this.createBillboard(group, building, index);
    this.cityGroup.add(group);
  }

  private createRooftop(group: THREE.Group, building: BuildingPlan, random: SeededRandom): void {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(building.width * 0.82, 1.2, building.depth * 0.82), new THREE.MeshStandardMaterial({ color: "#232b35", roughness: 0.65, metalness: 0.58 }));
    cap.position.y = building.height + 0.6;
    group.add(cap);
    const clutterCount = Math.floor(this.settings.rooftopClutter * 5);
    for (let i = 0; i < clutterCount; i += 1) {
      const point = rooftopPoint({ ...building, x: 0, z: 0 }, random);
      const height = random.float(0.8, 2.8);
      const unit = new THREE.Mesh(new THREE.BoxGeometry(random.float(1, 2.4), height, random.float(1, 2.2)), new THREE.MeshStandardMaterial({ color: "#3b4650", roughness: 0.7, metalness: 0.55 }));
      unit.position.set(point.x, building.height + 1.2 + height / 2, point.z);
      group.add(unit);
    }
    const antennaHeight = building.height > 38 ? random.float(6, 14) : random.float(2, 6);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, antennaHeight, 4), new THREE.MeshStandardMaterial({ color: "#7d8992", metalness: 0.8, roughness: 0.3 }));
    antenna.position.y = building.height + 1.2 + antennaHeight / 2;
    group.add(antenna);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: "#ff3159" }));
    beacon.position.y = building.height + 1.25 + antennaHeight;
    beacon.userData.beacon = true;
    group.add(beacon);
  }

  private createBillboard(group: THREE.Group, building: BuildingPlan, index: number): void {
    const useGlyphs = index % 3 === 0;
    const texture = useGlyphs ? createGlyphTexture(building.id, building.accent) : createSignTexture(building.name, building.accent);
    this.textureCache.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const width = Math.min(12, Math.max(6, building.width * 0.82));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, useGlyphs ? 7 : 3), material);
    sign.position.set(0, Math.min(building.height - 4, Math.max(8, building.height * 0.64)), building.depth / 2 + 0.08);
    sign.userData.billboard = true;
    group.add(sign);
  }

  private createInfrastructure(random: SeededRandom): void {
    if (this.settings.elevatedInfrastructure < 0.2) return;
    const y = 15;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(this.settings.blockWidth + 18, 1.5, 6), new THREE.MeshStandardMaterial({ color: "#202935", roughness: 0.56, metalness: 0.48 }));
    deck.position.set(0, y, -this.settings.blockDepth * 0.52);
    deck.castShadow = true;
    this.cityGroup.add(deck);
    const railMaterial = new THREE.MeshBasicMaterial({ color: "#ffb22e" });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(this.settings.blockWidth + 18, 0.18, 0.18), railMaterial);
      rail.position.set(0, y + 1.1, -this.settings.blockDepth * 0.52 + side * 2.65);
      this.cityGroup.add(rail);
    }
    for (let x = -this.settings.blockWidth / 2; x <= this.settings.blockWidth / 2; x += 18) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, y, 2.2), new THREE.MeshStandardMaterial({ color: "#242d37", roughness: 0.65 }));
      pillar.position.set(x, y / 2, -this.settings.blockDepth * 0.52);
      this.cityGroup.add(pillar);
    }

    const bridgeMaterial = new THREE.MeshStandardMaterial({ color: "#2a3a45", emissive: "#00a5c2", emissiveIntensity: 0.25, roughness: 0.45, metalness: 0.5 });
    for (let i = 0; i < this.plan.buildings.length - 1; i += 1) {
      const a = this.plan.buildings[i];
      const b = this.plan.buildings[i + 1];
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance < 34 && Math.min(a.height, b.height) > 22 && random.chance(this.settings.elevatedInfrastructure * 0.45)) {
        const length = distance;
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(length, 2.2, 2.4), bridgeMaterial);
        bridge.position.set((a.x + b.x) / 2, Math.min(a.height, b.height) * 0.55, (a.z + b.z) / 2);
        bridge.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        this.cityGroup.add(bridge);
      }
    }
  }

  private createTraffic(random: SeededRandom): void {
    const count = qualityOptions[this.settings.quality].vehicles;
    for (let index = 0; index < count; index += 1) {
      const flying = index >= count * 0.62;
      const group = new THREE.Group();
      const color = random.pick(["#253246", "#382334", "#27362d", "#3c3225", "#232a36"]);
      const body = new THREE.Mesh(new THREE.BoxGeometry(flying ? 2.8 : 2.2, flying ? 0.7 : 0.9, flying ? 1.15 : 1.25), new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.72 }));
      const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.38, 1.04), new THREE.MeshBasicMaterial({ color: flying ? "#7aeaff" : "#1f76a0" }));
      windowMesh.position.y = 0.45;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.23, 0.7), new THREE.MeshBasicMaterial({ color: "#e8ffff" }));
      front.position.x = 1.2;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.72), new THREE.MeshBasicMaterial({ color: "#ff315c" }));
      tail.position.x = -1.2;
      group.add(body, windowMesh, front, tail);
      this.animatedGroup.add(group);
      this.vehicles.push({ group, phase: random.next(), speed: random.float(0.018, 0.035), flying, lane: random.int(0, 2), direction: random.chance(0.5) ? 1 : -1 });
    }
  }

  private createPedestrians(random: SeededRandom): void {
    const count = Math.floor(qualityOptions[this.settings.quality].pedestrians * this.settings.pedestrianDensity);
    const geometry = new THREE.BoxGeometry(0.35, 1.15, 0.35);
    const material = new THREE.MeshBasicMaterial({ color: "#9ffaff" });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.animatedGroup.add(mesh);
    this.pedestrianMesh = mesh;
    for (let index = 0; index < count; index += 1) {
      this.pedestrians.push({ phase: random.next(), speed: random.float(0.009, 0.022), radius: random.float(9, this.settings.blockWidth * 0.44), y: random.float(1.2, 1.35) });
    }
  }

  private createRain(random: SeededRandom): void {
    const count = qualityOptions[this.settings.quality].rain;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = random.float(-95, 95);
      positions[index * 3 + 1] = random.float(2, 100);
      positions[index * 3 + 2] = random.float(-95, 95);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: "#8bcfff", size: 0.2, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const rain = new THREE.Points(geometry, material);
    rain.visible = this.settings.weather !== "clear" && this.settings.weather !== "toxic-haze";
    this.animatedGroup.add(rain);
    this.rain = rain;
    this.rainBase = positions;
  }

  private createSteam(random: SeededRandom): void {
    const geometry = new THREE.BufferGeometry();
    const count = 48;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = random.float(-48, 48);
      positions[index * 3 + 1] = random.float(2, 11);
      positions[index * 3 + 2] = random.pick([-1, 1]) * random.float(7, 50);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#bcd9dc", size: 1.6, transparent: true, opacity: 0.12, depthWrite: false }));
    points.userData.steam = true;
    this.animatedGroup.add(points);
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === "orbit" || mode === "isometric";
    if (mode === "isometric") this.moveCamera(new THREE.Vector3(105, 92, 105), new THREE.Vector3(0, 12, 0), 12);
    if (mode === "orbit") this.moveCamera(new THREE.Vector3(88, 68, 90), new THREE.Vector3(0, 18, 0), 42);
    if (mode === "fly") {
      this.camera.fov = 58;
      this.camera.position.set(-48, 7, 8);
      this.camera.lookAt(0, 9, 0);
      this.camera.updateProjectionMatrix();
    }
    if (mode === "cinematic") this.cinematicTime = 0;
  }

  setCameraPreset(preset: string): void {
    const presets: Record<string, [THREE.Vector3, THREE.Vector3, number]> = {
      Street: [new THREE.Vector3(-58, 7, 22), new THREE.Vector3(0, 10, 0), 54],
      Rooftop: [new THREE.Vector3(35, 61, 40), new THREE.Vector3(0, 34, 0), 44],
      Aerial: [new THREE.Vector3(0, 122, 98), new THREE.Vector3(0, 12, 0), 42],
      Isometric: [new THREE.Vector3(105, 92, 105), new THREE.Vector3(0, 12, 0), 12],
      Alley: [new THREE.Vector3(7, 5, -48), new THREE.Vector3(7, 8, 12), 58],
      Transit: [new THREE.Vector3(-52, 18, -47), new THREE.Vector3(12, 16, -48), 46],
    };
    const selected = presets[preset];
    if (!selected) return;
    if (preset === "Isometric") this.mode = "isometric";
    else this.mode = "orbit";
    this.controls.enabled = true;
    this.moveCamera(...selected);
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, fov: number): void {
    this.camera.position.copy(position);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
  }

  updateSettings(settings: CitySettings): void {
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = { ...settings };
    this.paused = settings.animationSpeed === 0;
    this.bloomPass.strength = settings.neonIntensity * 0.26;
    if (this.rain) this.rain.visible = settings.weather !== "clear" && settings.weather !== "toxic-haze";
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(settings.weather === "toxic-haze" ? "#27301a" : "#070b18");
      this.scene.fog.density = settings.weather === "toxic-haze" ? 0.017 : 0.009 + settings.weatherIntensity * 0.003;
    }
    if (qualityChanged) this.regenerate(settings);
    else this.applyQuality();
  }

  private applyQuality(): void {
    const quality = qualityOptions[this.settings.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.bloomPass.enabled = quality.bloom;
    this.resize();
  }

  setPaused(paused: boolean): void { this.paused = paused; }

  screenshot(): void {
    this.renderer.render(this.scene, this.camera);
    const link = document.createElement("a");
    link.download = `cityblock-${this.settings.seed}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  private animate = (): void => {
    if (!this.running) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(0.05, this.clock.getDelta());
    const speed = this.paused ? 0 : this.settings.animationSpeed * (this.settings.reducedMotion ? 0.35 : 1);
    this.updateCamera(delta, speed);
    this.updateTraffic(delta, speed);
    this.updatePedestrians(delta, speed);
    this.updateWeather(delta, speed);
    this.updateAnimatedDetails(delta, speed);
    if (this.controls.enabled) this.controls.update();
    this.keepCameraAboveGround();
    this.composer.render();
    this.frames += 1;
    this.fpsTime += delta;
    if (this.fpsTime >= 1) {
      const fps = Math.round(this.frames / this.fpsTime);
      this.callbacks.onMetrics(fps, { x: this.camera.position.x, z: this.camera.position.z }, this.qualityNote);
      this.adaptQuality(fps);
      this.frames = 0;
      this.fpsTime = 0;
    }
  };

  private updateCamera(delta: number, speed: number): void {
    if (this.mode === "cinematic") {
      this.cinematicTime = (this.cinematicTime + delta * 0.035 * speed) % 1;
      const angle = this.cinematicTime * Math.PI * 2;
      const radius = 82 + Math.sin(angle * 2) * 22;
      this.camera.position.set(Math.cos(angle) * radius, 24 + (Math.sin(angle * 1.7) + 1) * 30, Math.sin(angle) * radius);
      this.camera.lookAt(Math.sin(angle * 1.3) * 12, 18 + Math.cos(angle * 2) * 8, Math.cos(angle * 0.8) * 10);
    } else if (this.mode === "fly") {
      const amount = delta * 24 * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2.3 : 1);
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
      if (this.keys.has("KeyW")) this.camera.position.addScaledVector(forward, amount);
      if (this.keys.has("KeyS")) this.camera.position.addScaledVector(forward, -amount);
      if (this.keys.has("KeyA")) this.camera.position.addScaledVector(right, -amount);
      if (this.keys.has("KeyD")) this.camera.position.addScaledVector(right, amount);
      if (this.keys.has("KeyQ")) this.camera.position.y -= amount;
      if (this.keys.has("KeyE")) this.camera.position.y += amount;
      const limit = this.settings.blockWidth * 0.72;
      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -limit, limit);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -limit, limit);
    }
  }

  private updateTraffic(delta: number, speed: number): void {
    const w = this.settings.blockWidth / 2 + 7;
    const d = this.settings.blockDepth / 2 + 7;
    for (const vehicle of this.vehicles) {
      vehicle.phase = (vehicle.phase + delta * vehicle.speed * 12 * speed * vehicle.direction + 1) % 1;
      if (vehicle.flying) {
        const angle = vehicle.phase * Math.PI * 2;
        const radius = 44 + vehicle.lane * 17;
        vehicle.group.position.set(Math.cos(angle) * radius, 28 + vehicle.lane * 12 + Math.sin(angle * 3) * 1.1, Math.sin(angle) * radius * 0.74);
        vehicle.group.rotation.y = -angle;
      } else {
        const perimeter = 2 * (w + d);
        let distance = vehicle.phase * perimeter;
        const laneOffset = 1.7 + vehicle.lane * 0.7;
        if (distance < w) {
          vehicle.group.position.set(-w / 2 + distance, 1.05, -d / 2 + laneOffset);
          vehicle.group.rotation.y = 0;
        } else if ((distance -= w) < d) {
          vehicle.group.position.set(w / 2 - laneOffset, 1.05, -d / 2 + distance);
          vehicle.group.rotation.y = -Math.PI / 2;
        } else if ((distance -= d) < w) {
          vehicle.group.position.set(w / 2 - distance, 1.05, d / 2 - laneOffset);
          vehicle.group.rotation.y = Math.PI;
        } else {
          distance -= w;
          vehicle.group.position.set(-w / 2 + laneOffset, 1.05, d / 2 - distance);
          vehicle.group.rotation.y = Math.PI / 2;
        }
      }
    }
  }

  private updatePedestrians(delta: number, speed: number): void {
    if (!this.pedestrianMesh) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.pedestrians.length; index += 1) {
      const pedestrian = this.pedestrians[index];
      pedestrian.phase = (pedestrian.phase + delta * pedestrian.speed * 8 * speed) % 1;
      const angle = pedestrian.phase * Math.PI * 2;
      const x = Math.cos(angle) * pedestrian.radius;
      const z = Math.sin(angle) * pedestrian.radius;
      matrix.makeTranslation(x, pedestrian.y + Math.abs(Math.sin(angle * 12)) * 0.08, z);
      this.pedestrianMesh.setMatrixAt(index, matrix);
    }
    this.pedestrianMesh.instanceMatrix.needsUpdate = true;
  }

  private updateWeather(delta: number, speed: number): void {
    if (this.rain && this.rainBase) {
      const attribute = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const fall = delta * 52 * this.settings.weatherIntensity * speed;
      for (let index = 0; index < array.length; index += 3) {
        array[index] += fall * 0.1;
        array[index + 1] -= fall;
        if (array[index + 1] < 0) array[index + 1] = 100;
      }
      attribute.needsUpdate = true;
    }
    if (this.settings.weather === "electrical-storm" && this.settings.flashesEnabled && !this.settings.reducedMotion && Math.random() < delta * 0.05) this.lightning = 1;
    this.lightning = Math.max(0, this.lightning - delta * 4);
    this.renderer.toneMappingExposure = 1.08 + this.lightning * 1.5;
  }

  private updateAnimatedDetails(delta: number, speed: number): void {
    const elapsed = this.clock.elapsedTime * speed;
    this.cityGroup.traverse((object) => {
      if (object.userData.beacon && object instanceof THREE.Mesh) object.visible = Math.sin(elapsed * 3.4) > -0.25;
      if (object.userData.billboard && object instanceof THREE.Mesh) {
        const material = object.material as THREE.MeshBasicMaterial;
        material.opacity = Math.sin(elapsed * 2 + object.id) > -0.93 ? 0.9 : 0.18;
        if (material.map) material.map.offset.x = (material.map.offset.x + delta * 0.04 * speed) % 1;
      }
    });
    this.animatedGroup.traverse((object) => {
      if (object.userData.steam && object instanceof THREE.Points) object.rotation.y += delta * 0.025 * speed;
    });
  }

  private adaptQuality(fps: number): void {
    if (!this.settings.adaptiveQuality) { this.qualityNote = "AUTO / OFF"; return; }
    if (fps < 34 && this.settings.quality !== "low") {
      this.renderer.setPixelRatio(Math.max(0.7, this.renderer.getPixelRatio() - 0.1));
      this.bloomPass.enabled = false;
      this.qualityNote = "AUTO / BLOOM REDUCED";
    } else if (fps > 56) {
      this.bloomPass.enabled = qualityOptions[this.settings.quality].bloom;
      this.qualityNote = "AUTO / STABLE";
    }
  }

  private onPointerDown = (event: PointerEvent): void => { this.pointerDown = { x: event.clientX, y: event.clientY }; };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.mode === "fly" && event.buttons === 1) {
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y -= event.movementX * 0.003;
      this.camera.rotation.x = THREE.MathUtils.clamp(this.camera.rotation.x - event.movementY * 0.003, -1.45, 1.45);
      return;
    }
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.buildingMeshes, false)[0];
    this.canvas.style.cursor = hit ? "crosshair" : "grab";
    this.callbacks.onHover(Boolean(hit));
  };

  private onClick = (event: MouseEvent): void => {
    if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 5) return;
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.buildingMeshes, false)[0]?.object as THREE.Mesh | undefined;
    if (this.selected) {
      const material = this.selected.material as THREE.MeshStandardMaterial;
      const building = this.selected.userData.building as BuildingPlan;
      material.emissive.set(building.accent);
      material.emissiveIntensity = this.settings.neonIntensity * 0.68;
    }
    this.selected = hit ?? null;
    if (hit) {
      const material = hit.material as THREE.MeshStandardMaterial;
      material.emissive.set("#ffffff");
      material.emissiveIntensity = 1.25;
      this.callbacks.onSelect(hit.userData.building as BuildingPlan);
    } else this.callbacks.onSelect(null);
  };

  private setPointer(event: MouseEvent | PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onKeyDown = (event: KeyboardEvent): void => { this.keys.add(event.code); };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private keepCameraAboveGround = (): void => { this.camera.position.y = Math.max(2.2, this.camera.position.y); };

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResizeBound);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("click", this.onClick);
    this.controls.dispose();
    this.disposeGroup(this.cityGroup);
    this.disposeGroup(this.animatedGroup);
    this.textureCache.forEach((texture) => texture.dispose());
    this.composer.dispose();
    this.renderer.dispose();
  }
}
