import * as THREE from "three";
import { SeededRandom } from "../utils/SeededRandom";

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createWindowTexture(seed: string, accent: string, probability: number): THREE.CanvasTexture {
  const random = new SeededRandom(`${seed}-windows`);
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#080d19";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#111b2b";
  for (let y = 1; y < 32; y += 5) context.fillRect(0, y, 32, 1);
  for (let x = 2; x < 32; x += 6) {
    for (let y = 2; y < 32; y += 5) {
      context.fillStyle = random.chance(probability)
        ? random.pick([accent, "#ffd990", "#78dfff", "#ff6fca"])
        : random.pick(["#0b1523", "#101b2b", "#162236"]);
      context.fillRect(x, y, 3, 2);
    }
  }
  const texture = canvasTexture(canvas);
  texture.repeat.set(1, 4);
  return texture;
}

export function createRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#080b12";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#111823";
  for (let i = 0; i < 64; i += 1) {
    const x = (i * 17) % 32;
    const y = (i * 11) % 32;
    context.fillRect(x, y, 1, 1);
  }
  context.fillStyle = "#b6b27a";
  context.fillRect(15, 0, 2, 10);
  context.fillRect(15, 20, 2, 12);
  context.fillStyle = "#202c38";
  context.fillRect(0, 0, 1, 32);
  return canvasTexture(canvas);
}

export function createSignTexture(text: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#02040a";
  context.fillRect(0, 0, 128, 32);
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.strokeRect(1, 1, 126, 30);
  context.fillStyle = accent;
  context.font = "bold 11px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.toUpperCase().slice(0, 18), 64, 16);
  context.globalAlpha = 0.2;
  for (let y = 3; y < 32; y += 4) context.fillRect(2, y, 124, 1);
  return canvasTexture(canvas);
}

export function createGlyphTexture(seed: string, accent: string): THREE.CanvasTexture {
  const random = new SeededRandom(`${seed}-glyphs`);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#02040c";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = accent;
  context.font = "bold 9px monospace";
  for (let row = 0; row < 6; row += 1) {
    const glyphs = Array.from({ length: 6 }, () => random.pick(["A", "7", "//", "∆", "#", "0", "+"])).join(" ");
    context.fillText(glyphs, 4, 10 + row * 10);
  }
  context.globalAlpha = 0.24;
  context.fillRect(0, 18, 64, 2);
  context.fillRect(0, 45, 64, 1);
  return canvasTexture(canvas);
}
