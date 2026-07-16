# CITYBLOCK // 2077

CITYBLOCK // 2077 is a browser-based real-time city diorama built with Vite, TypeScript, Three.js, WebGL, React, and procedural Canvas textures. Each seed assembles a coherent near-future block with modular architecture, roads, elevated infrastructure, markets, artificial green space, traffic, pedestrians, weather, holographic signage, and inspectable buildings.

## Run locally

```bash
npm install
npm run dev
```

The development server prints the local URL. Production and verification commands:

```bash
npm run build
npm run test
npm run test:e2e
```

The first end-to-end run may require the Playwright Chromium runtime:

```bash
npx playwright install chromium
```

## Controls

- Drag to orbit, scroll to zoom, and right-drag to pan.
- Click a building to inspect its generated identity and operating data.
- Use the left camera rail for Orbit, Flythrough, Cinematic, and Isometric modes.
- In Flythrough mode, hold the primary mouse button to look, use `WASD` to move, `Q`/`E` vertically, and Shift to accelerate.
- Camera presets include Street, Rooftop, Aerial, Isometric, Alley, and Transit.
- The configuration panel exposes city form, activity, atmosphere, weather, quality, accessibility, persistence, and export controls.

## Procedural architecture

`BlockPlanner` owns deterministic road, parcel, zoning, building-family, and metadata planning. A string-seeded pseudo-random generator makes output repeatable. Parcels are split around a protected central street cross and perimeter access lanes. Zoning biases tower height and architectural family; parks occupy complete parcels; building entrances face public access; tall towers use setbacks; rooftop props use inset-safe coordinates.

The scene builder turns plans into modular podiums, shafts, setbacks, lobbies, caps, antennas, signs, elevated decks, bridges, parks, and markets. Window grids, road markings, holographic glyphs, and signs are generated as tiny Canvas textures with nearest-neighbor filtering.

## Simulation and rendering

- Ground and airborne vehicles follow deterministic loop paths at separate elevations.
- Instanced pedestrians circulate around pedestrian-safe paths.
- Rain and steam use buffer-based particle systems.
- Night lighting combines a cool hierarchy, selective real lights, emissive maps, controlled bloom, fog, wet materials, warning beacons, and animated billboard glitches.
- The render loop reuses scene state, caps pixel ratio, limits bloom by quality profile, and monitors sustained frame rate.

## Quality and accessibility

Low, Medium, High, and Ultra profiles control render scale, rain, traffic, pedestrian population, and bloom. Optional adaptive performance reduces bloom and render scale during sustained pressure. Controls are keyboard reachable, status changes are announced, contrast is high, and users can enable reduced motion or disable lightning flashes.

## Presets and export

Save and Load use localStorage on the current device. Settings can also be exported or imported as validated JSON. The seed and weather are reflected in shareable URL parameters. Capture exports the WebGL canvas as a PNG without interface overlays. Ambient audio is synthesized with the Web Audio API and starts only after direct user interaction.

## Testing

Vitest covers seed determinism, parcel boundaries, road validity, height constraints, rooftop prop placement, preset round-tripping, and invalid import rejection. Playwright performs a browser smoke test covering rendering, regeneration, inspector access, camera switching, and uncaught errors.

## Known limitations

- Reflections are stylized through physical wet materials and controlled bloom rather than screen-space ray tracing.
- Pedestrian and traffic movement favor ambient life and stable performance over full collision-aware AI.
- Flythrough protection keeps the camera above ground and within the district envelope; it does not resolve collisions against every facade detail.
- Audio is deliberately abstract and procedural; it does not use recorded samples or speech.

## Future improvements

Potential extensions include worker-based generation for much larger districts, texture atlasing across all facade families, screen-space reflections on Ultra, spatialized synthesized audio emitters, multiple connected blocks, and richer seeded pedestrian schedules.
