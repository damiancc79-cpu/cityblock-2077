"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { CityScene } from "../city/CityScene";
import type { BuildingPlan, CityPlan } from "../city/BlockPlanner";
import { defaultSettings, serializeSettings, validateSettings, visualPresets, type CameraMode, type CitySettings, type QualityLevel, type WeatherMode } from "./config";

const cameraPresets = ["Street", "Rooftop", "Aerial", "Isometric", "Alley", "Transit"] as const;
const qualityLevels: QualityLevel[] = ["low", "medium", "high", "ultra"];
const weatherModes: Array<{ value: WeatherMode; label: string }> = [
  { value: "clear", label: "Clear" }, { value: "light-rain", label: "Light rain" },
  { value: "heavy-rain", label: "Heavy rain" }, { value: "electrical-storm", label: "Storm" },
  { value: "toxic-haze", label: "Toxic haze" },
];

function initialSettings(): CitySettings {
  if (typeof window === "undefined") return defaultSettings;
  const params = new URLSearchParams(window.location.search);
  const stored = localStorage.getItem("cityblock-active-preset");
  let parsed: CitySettings | null = null;
  if (stored) {
    try { parsed = validateSettings(JSON.parse(stored) as unknown); } catch { parsed = null; }
  }
  return {
    ...(parsed ?? defaultSettings),
    seed: params.get("seed")?.slice(0, 64) || parsed?.seed || defaultSettings.seed,
    weather: (params.get("weather") as WeatherMode) || parsed?.weather || defaultSettings.weather,
  };
}

function download(filename: string, contents: string, type: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([contents], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Slider({ label, value, min, max, step, onChange, suffix = "" }: { label: string; value: number; min: number; max: number; step: number; onChange(value: number): void; suffix?: string }) {
  const display = step < 1 ? Math.round(value * 100) : value;
  return (
    <label className="slider-row">
      <span>{label}<output>{display}{suffix || (step < 1 ? "%" : "")}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function MiniMap({ plan, camera, selected }: { plan: CityPlan | null; camera: { x: number; z: number }; selected: BuildingPlan | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plan) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = canvas.width / 150;
    const toX = (x: number) => canvas.width / 2 + x * scale;
    const toY = (z: number) => canvas.height / 2 + z * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(2, 8, 17, 0.94)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(99, 179, 194, 0.22)";
    context.lineWidth = 1;
    for (let index = 0; index < canvas.width; index += 16) {
      context.beginPath(); context.moveTo(index, 0); context.lineTo(index, canvas.height); context.stroke();
      context.beginPath(); context.moveTo(0, index); context.lineTo(canvas.width, index); context.stroke();
    }
    context.fillStyle = "#18232f";
    for (const road of plan.roads) context.fillRect(toX(road.x - road.width / 2), toY(road.z - road.depth / 2), road.width * scale, road.depth * scale);
    for (const building of plan.buildings) {
      context.fillStyle = selected?.id === building.id ? "#ffb52d" : building.accent;
      context.globalAlpha = selected?.id === building.id ? 1 : 0.62;
      context.fillRect(toX(building.x - building.width / 2), toY(building.z - building.depth / 2), Math.max(2, building.width * scale), Math.max(2, building.depth * scale));
    }
    context.globalAlpha = 1;
    context.fillStyle = "#ffffff";
    context.beginPath(); context.arc(toX(camera.x), toY(camera.z), 3, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#ffffff";
    context.beginPath(); context.arc(toX(camera.x), toY(camera.z), 6, 0, Math.PI * 2); context.stroke();
  }, [plan, camera, selected]);
  return <canvas ref={canvasRef} width={176} height={176} aria-label="Top-down city minimap" />;
}

export default function CityBlockApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const [settings, setSettings] = useState<CitySettings>(initialSettings);
  const [plan, setPlan] = useState<CityPlan | null>(null);
  const [selected, setSelected] = useState<BuildingPlan | null>(null);
  const [fps, setFps] = useState(60);
  const [camera, setCamera] = useState({ x: 0, z: 0 });
  const [qualityNote, setQualityNote] = useState("AUTO / CALIBRATING");
  const [cameraMode, setCameraModeState] = useState<CameraMode>("orbit");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.25);
  const [status, setStatus] = useState("ASSEMBLING BLOCK");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [time, setTime] = useState("02:17:44");

  useEffect(() => {
    const timer = window.setInterval(() => {
      const date = new Date();
      setTime(date.toLocaleTimeString("en-GB", { hour12: false }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const scene = new CityScene(canvas, settings, {
        onSelect: setSelected,
        onHover: () => undefined,
        onReady: (nextPlan) => { setPlan(nextPlan); setStatus("CITY ONLINE"); },
        onMetrics: (nextFps, nextCamera, note) => { setFps(nextFps); setCamera(nextCamera); setQualityNote(note); },
      });
      sceneRef.current = scene;
      return () => { scene.dispose(); sceneRef.current = null; };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The city renderer could not start.";
      window.setTimeout(() => setFatalError(message), 0);
      return undefined;
    }
    // The renderer owns live setting updates after initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = useCallback((patch: Partial<CitySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      sceneRef.current?.updateSettings(next);
      return next;
    });
  }, []);

  const regenerate = useCallback((next?: CitySettings) => {
    const value = next ?? settings;
    setStatus("RECONFIGURING PARCELS");
    setSelected(null);
    sceneRef.current?.regenerate(value);
    const params = new URLSearchParams(window.location.search);
    params.set("seed", value.seed);
    params.set("weather", value.weather);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [settings]);

  const randomize = () => {
    const seed = `CB-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.floor(Math.random() * 90 + 10)}`;
    const next = { ...settings, seed };
    setSettings(next);
    regenerate(next);
  };

  const setCameraMode = (mode: CameraMode) => {
    setCameraModeState(mode);
    sceneRef.current?.setCameraMode(mode);
  };

  const chooseCameraPreset = (preset: string) => {
    sceneRef.current?.setCameraPreset(preset);
    setCameraModeState(preset === "Isometric" ? "isometric" : "orbit");
  };

  const savePreset = () => {
    localStorage.setItem("cityblock-active-preset", serializeSettings(settings));
    setStatus("PRESET SAVED LOCALLY");
    window.setTimeout(() => setStatus("CITY ONLINE"), 1800);
  };

  const loadPreset = () => {
    const stored = localStorage.getItem("cityblock-active-preset");
    const value = stored ? validateSettings(JSON.parse(stored) as unknown) : null;
    if (!value) { setStatus("NO VALID PRESET FOUND"); return; }
    setSettings(value);
    regenerate(value);
  };

  const exportSettings = () => download(`cityblock-${settings.seed}.json`, serializeSettings(settings), "application/json");

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value = validateSettings(JSON.parse(await file.text()) as unknown);
      if (!value) throw new Error("Invalid city preset");
      setSettings(value);
      regenerate(value);
    } catch {
      setStatus("IMPORT REJECTED / INVALID DATA");
    } finally {
      event.target.value = "";
    }
  };

  const toggleAudio = async () => {
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const gain = context.createGain();
      gain.gain.value = volume * 0.15;
      gain.connect(context.destination);
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = 46;
      const humGain = context.createGain();
      humGain.gain.value = 0.025;
      oscillator.connect(humGain).connect(gain);
      oscillator.start();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) channel[index] = (Math.random() * 2 - 1) * 0.24;
      const rain = context.createBufferSource();
      rain.buffer = buffer;
      rain.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 1700;
      const rainGain = context.createGain();
      rainGain.gain.value = 0.045;
      rain.connect(filter).connect(rainGain).connect(gain);
      rain.start();
      audioRef.current = { context, gain };
    }
    const audio = audioRef.current;
    if (muted) await audio.context.resume(); else await audio.context.suspend();
    setMuted(!muted);
  };

  const adjustVolume = (next: number) => {
    setVolume(next);
    if (audioRef.current) audioRef.current.gain.gain.value = next * 0.15;
  };

  const applyVisualPreset = (name: string) => {
    const next = { ...settings, ...visualPresets[name] };
    setSettings(next);
    sceneRef.current?.updateSettings(next);
  };

  const buildingCount = plan?.buildings.length ?? 0;
  const activeTraffic = Math.round(36 * settings.trafficDensity);

  return (
    <main className={`city-app ${uiHidden ? "ui-hidden" : ""}`} data-testid="city-app">
      <canvas ref={canvasRef} className="city-canvas" data-testid="city-canvas" aria-label="Interactive 3D futuristic city block" />
      <div className="scanlines" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
      <div className="frame-corners" aria-hidden="true"><i /><i /><i /><i /></div>

      {!uiHidden && (
        <div className="interface-layer">
          <header className="topbar glass-panel">
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true"><span>CB</span><i /></div>
              <div><h1>CITYBLOCK <b>{"// 2077"}</b></h1><p>URBAN SYSTEMS OBSERVATORY</p></div>
            </div>
            <div className="top-status">
              <span className="status-dot" />
              <div><small>SECTOR STATUS</small><strong>{status}</strong></div>
            </div>
            <div className="top-metrics">
              <Metric label="LOCAL TIME" value={time} />
              <Metric label="WEATHER" value={settings.weather.replace("-", " ").toUpperCase()} />
              <Metric label="FRAME RATE" value={`${fps} FPS`} />
            </div>
            <div className="top-actions">
              <button onClick={() => navigator.clipboard.writeText(settings.seed)} aria-label="Copy seed">COPY SEED</button>
              <button onClick={() => setSettingsOpen((value) => !value)} className={settingsOpen ? "active" : ""} aria-expanded={settingsOpen} aria-controls="settings-panel">CONFIG</button>
            </div>
          </header>

          <aside className="camera-rail glass-panel" aria-label="Camera modes">
            <span className="rail-label">CAM</span>
            {(["orbit", "fly", "cinematic", "isometric"] as CameraMode[]).map((mode, index) => (
              <button key={mode} className={cameraMode === mode ? "active" : ""} onClick={() => setCameraMode(mode)} aria-label={`${mode} camera mode`} title={`${mode} camera`}>
                <span>0{index + 1}</span>{mode === "orbit" ? "◎" : mode === "fly" ? "⌁" : mode === "cinematic" ? "▷" : "◇"}
              </button>
            ))}
            <span className="rail-rule" />
            <button onClick={() => setUiHidden(true)} aria-label="Hide interface" title="Hide UI"><span>UI</span>⌗</button>
          </aside>

          <section className="district-card glass-panel" aria-label="District overview">
            <div className="panel-kicker"><span>OBSERVATION NODE</span><b>NX-09</b></div>
            <h2>NEXUS MERCANTILE</h2>
            <p>A stacked commercial habitat retrofitted above the decommissioned blue-line interchange.</p>
            <div className="district-stats">
              <Metric label="STRUCTURES" value={buildingCount} />
              <Metric label="TRANSIT UNITS" value={activeTraffic} />
              <Metric label="POP. INDEX" value={`${Math.round(settings.pedestrianDensity * 9400).toLocaleString()}`} />
            </div>
            <button className="scan-button" data-testid="scan-nearest" onClick={() => plan?.buildings[0] && setSelected(plan.buildings[0])}>
              <i /> SCAN NEAREST STRUCTURE <span>↗</span>
            </button>
          </section>

          <section className="minimap-card glass-panel">
            <div className="panel-kicker"><span>BLOCK TOPOLOGY</span><b>LIVE</b></div>
            <MiniMap plan={plan} camera={camera} selected={selected} />
            <div className="map-legend"><span><i className="cyan" />BUILDING</span><span><i className="amber" />SELECTED</span><span><i className="white" />CAMERA</span></div>
          </section>

          <section className="seed-card glass-panel">
            <div><span>CURRENT GENERATION SEED</span><strong>{settings.seed}</strong></div>
            <button onClick={randomize}>RANDOMIZE <b>↻</b></button>
          </section>

          <nav className="preset-dock glass-panel" aria-label="Camera presets">
            <span className="dock-title">VIEW PRESETS</span>
            {cameraPresets.map((preset) => <button key={preset} onClick={() => chooseCameraPreset(preset)}>{preset}</button>)}
            <span className="dock-rule" />
            <button className={paused ? "active" : ""} onClick={() => { setPaused((value) => !value); sceneRef.current?.setPaused(!paused); }} aria-label={paused ? "Resume animation" : "Pause animation"}>{paused ? "PLAY" : "PAUSE"}</button>
            <button onClick={() => sceneRef.current?.screenshot()}>CAPTURE</button>
          </nav>

          <div className="performance-chip glass-panel"><span className="signal-bars"><i /><i /><i /><i /></span><div><small>RENDER PROFILE</small><b>{settings.quality.toUpperCase()} / {qualityNote}</b></div></div>

          {selected && (
            <aside className="inspector glass-panel" data-testid="building-inspector">
              <button className="inspector-close" onClick={() => setSelected(null)} aria-label="Close building inspector">×</button>
              <div className="panel-kicker"><span>STRUCTURE IDENTIFIED</span><b>{selected.id}</b></div>
              <div className="inspector-title"><i style={{ background: selected.accent }} /><div><h2>{selected.name}</h2><p>{selected.family.toUpperCase()} / {selected.district}</p></div></div>
              <div className="inspector-grid">
                <Metric label="CONSTRUCTED" value={selected.year} /><Metric label="HEIGHT" value={`${selected.height} M`} />
                <Metric label="OCCUPANCY" value={`${selected.occupancy}%`} /><Metric label="POWER DRAW" value={selected.power} />
                <Metric label="SECURITY" value={selected.security} /><Metric label="CONDITION" value={selected.condition} />
              </div>
              <p className="inspector-note">Municipal scan complete. Exterior transit links and rooftop comms are operating within nominal tolerances.</p>
            </aside>
          )}

          {settingsOpen && (
            <aside className="settings-panel glass-panel" id="settings-panel">
              <div className="settings-heading"><div><span>SYSTEM CONFIGURATION</span><h2>GENERATIVE CONTROL</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button></div>
              <label className="text-field"><span>GENERATION SEED</span><input value={settings.seed} maxLength={64} onChange={(event) => setSettings((current) => ({ ...current, seed: event.target.value }))} /></label>
              <div className="settings-actions"><button onClick={() => regenerate()}>GENERATE CITY</button><button onClick={randomize}>RANDOMIZE</button></div>
              <div className="setting-section"><h3>URBAN FORM</h3>
                <Slider label="Density" value={settings.density} min={0.35} max={1} step={0.01} onChange={(value) => updateSettings({ density: value })} />
                <Slider label="Minimum height" value={settings.minHeight} min={8} max={36} step={1} suffix="m" onChange={(value) => updateSettings({ minHeight: value })} />
                <Slider label="Maximum height" value={settings.maxHeight} min={36} max={84} step={1} suffix="m" onChange={(value) => updateSettings({ maxHeight: value })} />
                <Slider label="Variation" value={settings.variation} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ variation: value })} />
                <Slider label="Green space" value={settings.greenSpace} min={0} max={0.35} step={0.01} onChange={(value) => updateSettings({ greenSpace: value })} />
                <Slider label="Elevated infrastructure" value={settings.elevatedInfrastructure} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ elevatedInfrastructure: value })} />
              </div>
              <div className="setting-section"><h3>ATMOSPHERE & ACTIVITY</h3>
                <Slider label="Neon intensity" value={settings.neonIntensity} min={0} max={2} step={0.01} onChange={(value) => updateSettings({ neonIntensity: value })} />
                <Slider label="Traffic density" value={settings.trafficDensity} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ trafficDensity: value })} />
                <Slider label="Pedestrian density" value={settings.pedestrianDensity} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ pedestrianDensity: value })} />
                <Slider label="Rooftop clutter" value={settings.rooftopClutter} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ rooftopClutter: value })} />
                <Slider label="Weather intensity" value={settings.weatherIntensity} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ weatherIntensity: value })} />
                <Slider label="Lit windows" value={settings.windowProbability} min={0} max={1} step={0.01} onChange={(value) => updateSettings({ windowProbability: value })} />
              </div>
              <div className="select-row"><label>WEATHER<select value={settings.weather} onChange={(event) => updateSettings({ weather: event.target.value as WeatherMode })}>{weatherModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label><label>QUALITY<select value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value as QualityLevel })}>{qualityLevels.map((level) => <option key={level}>{level}</option>)}</select></label></div>
              <label className="toggle-row"><span>ADAPTIVE PERFORMANCE<small>Adjust expensive effects automatically</small></span><input type="checkbox" checked={settings.adaptiveQuality} onChange={(event) => updateSettings({ adaptiveQuality: event.target.checked })} /></label>
              <label className="toggle-row"><span>REDUCED MOTION<small>Slows ambient simulation</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSettings({ reducedMotion: event.target.checked })} /></label>
              <label className="toggle-row"><span>LIGHTNING FLASHES<small>Disable for photosensitivity</small></span><input type="checkbox" checked={settings.flashesEnabled} onChange={(event) => updateSettings({ flashesEnabled: event.target.checked })} /></label>
              <div className="preset-list"><h3>VISUAL PROFILES</h3>{Object.keys(visualPresets).map((name) => <button key={name} onClick={() => applyVisualPreset(name)}>{name}</button>)}</div>
              <div className="io-actions"><button onClick={savePreset}>SAVE</button><button onClick={loadPreset}>LOAD</button><button onClick={exportSettings}>EXPORT JSON</button><button onClick={() => fileInputRef.current?.click()}>IMPORT</button></div>
              <input ref={fileInputRef} type="file" accept="application/json" className="visually-hidden" onChange={importSettings} />
              <div className="audio-row"><button onClick={toggleAudio}>{muted ? "ENABLE AMBIENCE" : "MUTE AMBIENCE"}</button><input aria-label="Ambient volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => adjustVolume(Number(event.target.value))} /></div>
              <div className="utility-actions"><button onClick={() => document.documentElement.requestFullscreen?.()}>FULLSCREEN</button><button onClick={() => setUiHidden(true)}>HIDE UI</button></div>
            </aside>
          )}
        </div>
      )}

      {uiHidden && <button className="restore-ui" onClick={() => setUiHidden(false)}>RESTORE INTERFACE / H</button>}
      <div className="loading-indicator" data-testid="generation-status" role="status" aria-live="polite"><i className={status === "CITY ONLINE" ? "online" : ""} />{status}</div>
      <div className="help-text">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A STRUCTURE TO INSPECT · FLY MODE: WASD / Q / E</div>

      {fatalError && <div className="fatal-overlay" role="alert"><strong>RENDERER OFFLINE</strong><p>{fatalError}</p><small>Try enabling hardware acceleration or using a WebGL-capable browser.</small></div>}
    </main>
  );
}
