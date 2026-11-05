import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const stage = $('.stage');
const viewport = $('#viewport');
const host = $('#three');
const feedback = $('#feedback');
const state = {
  model: 'tee', color: '#E7E4DC', text: 'FEITO À MÃO', textColor: '#1C2620', textSize: 50,
  rotation: 0, tilt: 0, zoom: 1, painting: false, paintColor: '#D6EF55', paintSize: 8,
  background: '#282C31', image: null, imageUrl: '', animation: false,
  hue: 0, saturation: 0, lightness: 68,
};
const strokes = { front: [], back: [] };
let modelGroup = new THREE.Group();
let modelBounds = new THREE.Box3();
let modelReady = false;
let modelLoadToken = 0;
let garmentMaterials = [];
let frontArt = null;
let backArt = null;
let frontTexture = null;
let backTexture = null;
let frontCanvas = null;
let backCanvas = null;
let frontContext = null;
let backContext = null;
let activeStroke = null;
let drag = null;
let feedbackTimer = 0;
let wheelDragging = false;
let fittedSize = 4.8;
let wheelBasePixels = null;
const gltfLoader = new GLTFLoader();

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-2.6, 2.6, 2.6, -2.6, 0.1, 60);
camera.position.set(0, 0, 12);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x000000, 0);
host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x55575b, 1.65));
const keyLight = new THREE.DirectionalLight(0xfff4df, 2.4);
keyLight.position.set(-4, 6, 7);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xd8e2ff, 1.1);
fillLight.position.set(4, 2.5, 5);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 1.15);
rimLight.position.set(0, 4, -4);
scene.add(rimLight);

function showFeedback(message) {
  feedback.textContent = message;
  feedback.classList.add('visible');
  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => feedback.classList.remove('visible'), 2200);
}

function ensureArtworkCanvases() {
  if (frontCanvas) return;
  frontCanvas = document.createElement('canvas');
  backCanvas = document.createElement('canvas');
  frontCanvas.width = backCanvas.width = 512;
  frontCanvas.height = backCanvas.height = 560;
  frontContext = frontCanvas.getContext('2d');
  backContext = backCanvas.getContext('2d');
}

const modelCatalog = {
  tee: { name: 'Camiseta clássica', src: '/models/tee-essential.glb', orientation: { up: 'y', front: 'z' } },
  teeAlt: { name: 'Camiseta em ângulo', src: '/models/tee-gradient.glb', orientation: { up: 'y', front: 'z' } },
  hoodie: { name: 'Moletom', src: '/models/hoodie.glb', orientation: { up: 'y', front: 'z' } },
  polo: { name: 'Polo', src: '/models/polo.glb', orientation: { up: 'z', front: 'x' } },
  button: { name: 'Camisa xadrez', src: '/models/plaid-shirt.glb', orientation: { up: 'y', front: 'z' } },
};
const modelNames = Object.fromEntries(Object.entries(modelCatalog).map(([key, model]) => [key, model.name]));

function axisVector(axis) {
  const vector = new THREE.Vector3();
  vector[axis] = 1;
  return vector;
}

function orientGarment(frame, orientation) {
  const up = axisVector(orientation.up);
  const front = axisVector(orientation.front);
  const right = new THREE.Vector3().crossVectors(up, front).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, front).transpose();
  frame.quaternion.setFromRotationMatrix(basis);
}

function prepareColorMap(source) {
  const image = source?.image;
  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  if (!width || !height) return source;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    let luminanceSum = 0;
    let samples = 0;
    for (let i = 0; i < pixels.data.length; i += 32) {
      if (pixels.data[i + 3] < 16) continue;
      luminanceSum += 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      samples += 1;
    }
    const average = samples ? luminanceSum / samples : 255;
    if (average >= 72) return source;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] < 8) continue;
      const light = 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      const neutral = Math.max(112, Math.min(238, Math.round(166 + (light - average) * 1.35)));
      pixels.data[i] = neutral;
      pixels.data[i + 1] = neutral;
      pixels.data[i + 2] = neutral;
    }
    context.putImageData(pixels, 0, 0);
    const editable = new THREE.CanvasTexture(canvas);
    editable.colorSpace = source.colorSpace || THREE.SRGBColorSpace;
    editable.flipY = source.flipY;
    editable.wrapS = source.wrapS;
    editable.wrapT = source.wrapT;
    editable.repeat.copy(source.repeat);
    editable.offset.copy(source.offset);
    editable.center.copy(source.center);
    editable.rotation = source.rotation;
    editable.magFilter = source.magFilter;
    editable.minFilter = source.minFilter;
    editable.anisotropy = source.anisotropy;
    editable.needsUpdate = true;
    source.dispose();
    return editable;
  } catch (error) {
    console.warn('A textura original foi mantida porque não pôde ser preparada para recoloração.', error);
    return source;
  }
}

function drawArt(side) {
  ensureArtworkCanvases();
  const ctx = side === 'front' ? frontContext : backContext;
  const texture = side === 'front' ? frontTexture : backTexture;
  ctx.clearRect(0, 0, 512, 560);
  if (state.image && state.image.complete && state.image.naturalWidth) {
    const scale = Math.min(240 / state.image.naturalWidth, 180 / state.image.naturalHeight, 1);
    const width = state.image.naturalWidth * scale;
    const height = state.image.naturalHeight * scale;
    ctx.drawImage(state.image, (512 - width) / 2, 68 + (180 - height) / 2, width, height);
  }
  if (state.text.trim()) {
    ctx.fillStyle = state.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${state.textSize}px Arial, sans-serif`;
    const maxTextWidth = 330;
    const measuredTextWidth = ctx.measureText(state.text.trim()).width;
    if (measuredTextWidth > maxTextWidth) {
      ctx.font = `700 ${Math.max(20, state.textSize * maxTextWidth / measuredTextWidth)}px Arial, sans-serif`;
    }
    ctx.fillText(state.text.trim(), 256, state.image ? 340 : 265);
  }
  for (const stroke of strokes[side]) {
    const points = stroke.points;
    if (!points.length) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size * 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x * 512, (1 - points[0].y) * 560, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x * 512, (1 - points[0].y) * 560);
      for (const point of points.slice(1)) ctx.lineTo(point.x * 512, (1 - point.y) * 560);
      ctx.stroke();
    }
  }
  if (texture) texture.needsUpdate = true;
}

function disposeGroup(group) {
  if (!group) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  group.traverse((item) => {
    if (item.geometry) geometries.add(item.geometry);
    if (item.material) (Array.isArray(item.material) ? item.material : [item.material]).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
    material.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
}

function buildModel(type) {
  const definition = modelCatalog[type];
  if (!definition) return Promise.resolve(false);
  const requestToken = ++modelLoadToken;
  $('#loadingMessage').textContent = 'Carregando malha 3D…';
  $('#loadingMessage').classList.remove('hidden');
  return new Promise((resolve) => {
    gltfLoader.load(definition.src, (gltf) => {
      if (requestToken !== modelLoadToken) {
        disposeGroup(gltf.scene);
        resolve(false);
        return;
      }
      const frame = new THREE.Group();
      frame.add(gltf.scene);
      orientGarment(frame, definition.orientation);
      frame.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(frame);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(sourceSize.y) || sourceSize.y <= 0) {
        disposeGroup(frame);
        $('#loadingMessage').classList.add('hidden');
        showFeedback('Este modelo não tem uma orientação 3D válida.');
        resolve(false);
        return;
      }
      const scale = 3.15 / sourceSize.y;
      const center = sourceBounds.getCenter(new THREE.Vector3());
      frame.scale.setScalar(scale);
      frame.position.copy(center).multiplyScalar(-scale);
      frame.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(frame);

      const previousGroup = modelGroup;
      scene.remove(previousGroup);
      frontTexture?.dispose();
      backTexture?.dispose();
      disposeGroup(previousGroup);
      frontTexture = new THREE.CanvasTexture(frontCanvas);
      backTexture = new THREE.CanvasTexture(backCanvas);
      frontTexture.colorSpace = THREE.SRGBColorSpace;
      backTexture.colorSpace = THREE.SRGBColorSpace;
      modelGroup = new THREE.Group();
      modelGroup.rotation.set(state.tilt, state.rotation, 0);
      scene.add(modelGroup);
      garmentMaterials = [];
      frame.traverse((item) => {
        if (!item.isMesh) return;
        if (!item.geometry.attributes.normal && item.geometry.attributes.position) item.geometry.computeVertexNormals();
        item.castShadow = true;
        item.receiveShadow = true;
        const materials = Array.isArray(item.material) ? item.material : [item.material];
        materials.forEach((material) => {
          if (material.map) material.map = prepareColorMap(material.map);
          if (material.color) material.color.set(state.color);
          if ('roughness' in material) material.roughness = Math.max(0.84, material.roughness ?? 0.84);
          if ('metalness' in material) material.metalness = 0;
          material.needsUpdate = true;
          garmentMaterials.push(material);
        });
      });
      modelGroup.add(frame);
      modelBounds.copy(fittedBounds);
      const boundsSize = fittedBounds.getSize(new THREE.Vector3());
      const artWidth = Math.max(boundsSize.x * 0.42, 0.42);
      const artHeight = Math.max(boundsSize.y * 0.24, 0.62);
      const artY = fittedBounds.min.y + boundsSize.y * 0.59;
      const artOffset = Math.max(boundsSize.z * 0.025, 0.008);
      const artworkMaterial = (texture) => new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, depthTest: true,
        side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      frontArt = new THREE.Mesh(new THREE.PlaneGeometry(artWidth, artHeight), artworkMaterial(frontTexture));
      backArt = new THREE.Mesh(new THREE.PlaneGeometry(artWidth, artHeight), artworkMaterial(backTexture));
      frontArt.position.set((fittedBounds.min.x + fittedBounds.max.x) / 2, artY, fittedBounds.max.z + artOffset);
      backArt.position.set((fittedBounds.min.x + fittedBounds.max.x) / 2, artY, fittedBounds.min.z - artOffset);
      backArt.rotation.y = Math.PI;
      frontArt.renderOrder = 5;
      backArt.renderOrder = 5;
      modelGroup.add(frontArt, backArt);
      drawArt('front');
      drawArt('back');
      state.model = type;
      state.zoom = 1;
      modelReady = true;
      $('#modelLabel').textContent = definition.name;
      $('#loadingMessage').classList.add('hidden');
      fitToFrame();
      resolve(true);
    }, undefined, (error) => {
      if (requestToken !== modelLoadToken) { resolve(false); return; }
      console.error('Falha ao carregar o modelo 3D.', error);
      $('#loadingMessage').classList.add('hidden');
      $$('.model-option').forEach((button) => {
        const active = button.dataset.model === state.model;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      showFeedback('Não foi possível carregar este modelo 3D. Tente outra opção.');
      resolve(false);
    });
  });
}

function fitToFrame() {
  if (!modelReady) return;
  const size = modelBounds.getSize(new THREE.Vector3());
  const element = host.getBoundingClientRect();
  const aspect = Math.max(0.25, element.width / Math.max(1, element.height));
  fittedSize = Math.max(size.y * 1.25, size.x / aspect * 1.25, size.z * 1.2, 3.65);
  updateCamera();
}

function updateCamera() {
  const element = host.getBoundingClientRect();
  if (!element.width || !element.height) return;
  const aspect = element.width / element.height;
  const vertical = fittedSize;
  camera.left = -(vertical * aspect) / 2;
  camera.right = (vertical * aspect) / 2;
  camera.top = vertical / 2;
  camera.bottom = -vertical / 2;
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  renderer.setSize(element.width, element.height, false);
  $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}

const resizeObserver = new ResizeObserver(() => {
  updateCamera();
  fitToFrame();
});
resizeObserver.observe(host);

function setColor(color) {
  state.color = color.toUpperCase();
  garmentMaterials.forEach((material) => { if (material.color) material.color.set(state.color); });
  $('#shirtColor').value = state.color;
  $('#shirtColorText').textContent = state.color;
  $('#colorLabel').textContent = `· ${state.color}`;
  $$('.swatch').forEach((button) => button.classList.toggle('active', button.dataset.color.toUpperCase() === state.color));
  refreshWheelMarker();
}

function hexToHsl(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = max === 0 ? 0 : delta / (1 - Math.abs(2 * (max + min) / 2 - 1));
  const l = (max + min) / 2;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: Math.max(0, Math.min(1, s)), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, s));
  const lightness = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;
  let rgb = [0, 0, 0];
  if (hue < 60) rgb = [c, x, 0]; else if (hue < 120) rgb = [x, c, 0]; else if (hue < 180) rgb = [0, c, x]; else if (hue < 240) rgb = [0, x, c]; else if (hue < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function drawWheel() {
  const canvas = $('#colorWheel');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 4;
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const index = (y * size + x) * 4;
      if (distance > radius) continue;
      const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      const sat = Math.min(1, distance / radius);
      const hex = hslToHex(hue, sat, state.lightness);
      imageData.data[index] = parseInt(hex.slice(1, 3), 16);
      imageData.data[index + 1] = parseInt(hex.slice(3, 5), 16);
      imageData.data[index + 2] = parseInt(hex.slice(5, 7), 16);
      imageData.data[index + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.38)';
  ctx.lineWidth = 2;
  ctx.stroke();
  wheelBasePixels = ctx.getImageData(0, 0, size, size);
  refreshWheelMarker();
}

function refreshWheelMarker() {
  const canvas = $('#colorWheel');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (wheelBasePixels) ctx.putImageData(wheelBasePixels, 0, 0);
  const center = canvas.width / 2;
  const radius = center - 7;
  const radians = state.hue * Math.PI / 180;
  const distance = state.saturation * radius;
  const x = center + Math.cos(radians) * distance;
  const y = center + Math.sin(radians) * distance;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = state.color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,.48)';
  ctx.stroke();
  canvas.setAttribute('aria-valuetext', `${Math.round(state.hue)} graus, saturação ${Math.round(state.saturation * 100)}%`);
}

function chooseWheelColor(event) {
  const canvas = $('#colorWheel');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const center = canvas.width / 2;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const dx = x - center;
  const dy = y - center;
  const radius = Math.max(1, center - 5);
  state.hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  state.saturation = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);
  setColor(hslToHex(state.hue, state.saturation, state.lightness));
}

$('#colorWheel').addEventListener('pointerdown', (event) => {
  wheelDragging = true;
  $('#colorWheel').setPointerCapture(event.pointerId);
  chooseWheelColor(event);
});
$('#colorWheel').addEventListener('pointermove', (event) => { if (wheelDragging) chooseWheelColor(event); });
$('#colorWheel').addEventListener('pointerup', () => { wheelDragging = false; });
$('#colorWheel').addEventListener('pointercancel', () => { wheelDragging = false; });
$('#colorWheel').addEventListener('keydown', (event) => {
  const directions = { ArrowRight: [5, 0], ArrowLeft: [-5, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  state.hue = (state.hue + direction[0] + 360) % 360;
  state.saturation = Math.max(0, Math.min(1, state.saturation + direction[1]));
  setColor(hslToHex(state.hue, state.saturation, state.lightness));
});
$('#shirtLightness').addEventListener('input', (event) => {
  state.lightness = Number(event.target.value);
  $('#shirtLightnessValue').textContent = `${state.lightness}%`;
  drawWheel();
  setColor(hslToHex(state.hue, state.saturation, state.lightness));
});
$$('.swatch').forEach((button) => button.addEventListener('click', () => {
  const hsl = hexToHsl(button.dataset.color);
  state.hue = hsl.h;
  state.saturation = hsl.s;
  state.lightness = hsl.l;
  $('#shirtLightness').value = String(state.lightness);
  $('#shirtLightnessValue').textContent = `${state.lightness}%`;
  drawWheel();
  setColor(button.dataset.color);
}));
$('#shirtColor').addEventListener('input', (event) => {
  const hsl = hexToHsl(event.target.value);
  state.hue = hsl.h;
  state.saturation = hsl.s;
  state.lightness = hsl.l;
  $('#shirtLightness').value = String(state.lightness);
  $('#shirtLightnessValue').textContent = `${state.lightness}%`;
  drawWheel();
  setColor(event.target.value);
});

function setPanel(name) {
  const labels = { modelo: 'Visão', modelos: 'Modelos', cores: 'Cores', arte: 'Arte e pintura', texto: 'Texto', cena: 'Cena', exportar: 'Exportar' };
  $$('.tool').forEach((button) => {
    const active = button.dataset.panel === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-panel-content]').forEach((panel) => { panel.hidden = panel.dataset.panelContent !== name; });
  $('#panelTitle').textContent = labels[name] || 'Personalização';
  if (window.matchMedia('(max-width: 760px)').matches && name !== 'modelo') {
    window.setTimeout(() => $('#inspector').scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }
}
$$('.tool').forEach((button) => button.addEventListener('click', () => setPanel(button.dataset.panel)));
$$('.model-option').forEach((button) => button.addEventListener('click', () => {
  $$('.model-option').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  buildModel(button.dataset.model).then((loaded) => {
    if (loaded) showFeedback(`${modelNames[button.dataset.model]} selecionada.`);
  });
}));

function normalizedAngle(angle) { return ((angle % 360) + 360) % 360; }
function displayAngle() {
  const angle = normalizedAngle(Math.round(state.rotation * 180 / Math.PI));
  const rounded = Math.round(angle / 90) * 90 % 360;
  if (Math.abs(angle - rounded) <= 5 || Math.abs(angle - rounded - 360) <= 5) {
    const label = rounded === 0 ? 'FRENTE' : rounded === 180 ? 'COSTAS' : rounded === 90 ? 'LATERAL' : 'LATERAL';
    $('#angleLabel').textContent = label;
  } else {
    $('#angleLabel').textContent = `${String(angle).padStart(3, '0')}° · MANUAL`;
  }
  const selected = angle > 90 && angle < 270 ? 'back' : 'front';
  $('#stageHint').textContent = state.painting ? 'Pinte diretamente na peça · desative o pincel para girar' : 'Arraste para girar · use a roda ou + / − para aproximar';
  return selected;
}
function syncAngleButtons() {
  const selected = normalizedAngle(Math.round(state.rotation * 180 / Math.PI));
  $$('[data-angle]').forEach((button) => {
    const value = Number(button.dataset.angle);
    const active = Math.abs((((selected - value) + 540) % 360) - 180) < 5;
    button.classList.toggle('active', active);
    if (button.classList.contains('view-button')) button.setAttribute('aria-pressed', String(active));
  });
}
function setAngle(degrees) {
  state.rotation = degrees * Math.PI / 180;
  modelGroup.rotation.y = state.rotation;
  displayAngle();
  syncAngleButtons();
}
$$('[data-angle]').forEach((button) => button.addEventListener('click', () => setAngle(Number(button.dataset.angle))));
$('#animateButton').addEventListener('click', () => {
  state.animation = !state.animation;
  $('#animateButton').innerHTML = state.animation ? '<span>Ⅱ</span> Pausar rotação' : '<span>⟳</span> Girar automaticamente';
  $('#animateButton').classList.toggle('active', state.animation);
});

function setBackground(color) {
  state.background = color.toUpperCase();
  stage.style.backgroundColor = state.background;
  $$('.background-option').forEach((button) => button.classList.toggle('active', button.dataset.bg.toUpperCase() === state.background));
}
$$('.background-option').forEach((button) => button.addEventListener('click', () => setBackground(button.dataset.bg)));

$('#shirtText').addEventListener('input', (event) => {
  state.text = event.target.value;
  $('#textCounter').textContent = `${state.text.length} / 48`;
  drawArt('front'); drawArt('back');
});
$('#textColor').addEventListener('input', (event) => {
  state.textColor = event.target.value.toUpperCase();
  $('#textColorValue').textContent = state.textColor;
  drawArt('front'); drawArt('back');
});
$('#textSize').addEventListener('input', (event) => {
  state.textSize = Number(event.target.value);
  drawArt('front'); drawArt('back');
});
$('#paintColor').addEventListener('input', (event) => { state.paintColor = event.target.value; });
$('#paintSize').addEventListener('input', (event) => {
  state.paintSize = Number(event.target.value);
  $('#paintSizeValue').textContent = `${state.paintSize} px`;
});
$('#paintButton').addEventListener('click', () => {
  state.painting = !state.painting;
  $('#paintButton').setAttribute('aria-pressed', String(state.painting));
  $('#paintButton').innerHTML = state.painting ? '<span>✎</span> Desativar pincel' : '<span>✎</span> Ativar pincel';
  viewport.classList.toggle('painting', state.painting);
  displayAngle();
});
$('#clearPaint').addEventListener('click', () => {
  strokes.front = []; strokes.back = [];
  drawArt('front'); drawArt('back');
  showFeedback('Pintura removida.');
});

$('#artUpload').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { showFeedback('A imagem precisa ter até 12 MB.'); event.target.value = ''; return; }
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { showFeedback('Escolha uma imagem PNG, JPG, SVG ou WebP.'); event.target.value = ''; return; }
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    state.image = image;
    $('#uploadName').textContent = file.name;
    $('#uploadState').hidden = false;
    drawArt('front'); drawArt('back');
    showFeedback('Imagem adicionada à estampa.');
  };
  image.onerror = () => showFeedback('Não foi possível abrir essa imagem.');
  image.src = state.imageUrl;
});
$('#removeArtwork').addEventListener('click', () => {
  state.image = null;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = '';
  $('#artUpload').value = '';
  $('#uploadState').hidden = true;
  drawArt('front'); drawArt('back');
});

function viewSide() {
  const angle = normalizedAngle(state.rotation * 180 / Math.PI);
  if (Math.abs(Math.cos(state.rotation)) < 0.25) return null;
  return angle > 90 && angle < 270 ? 'back' : 'front';
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pointerHit(event) {
  const side = viewSide();
  if (!side) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const surface = side === 'front' ? frontArt : backArt;
  const hit = raycaster.intersectObject(surface, false)[0];
  if (!hit?.uv) return null;
  return { side, x: hit.uv.x, y: hit.uv.y };
}
function pointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  if (state.painting) {
    const hit = pointerHit(event);
    if (!hit) { showFeedback('Vire para a frente ou para as costas para pintar.'); return; }
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    activeStroke = { color: state.paintColor, size: state.paintSize, points: [{ x: hit.x, y: hit.y }] };
    strokes[hit.side].push(activeStroke);
    drawArt(hit.side);
    return;
  }
  drag = { x: event.clientX, y: event.clientY, rotation: state.rotation, tilt: state.tilt };
  renderer.domElement.setPointerCapture(event.pointerId);
}
function pointerMove(event) {
  if (state.painting && activeStroke) {
    const hit = pointerHit(event);
    const side = viewSide();
    if (!hit || !side || hit.side !== side) return;
    const points = activeStroke.points;
    const last = points[points.length - 1];
    if (Math.hypot(hit.x - last.x, hit.y - last.y) < 0.0025) return;
    points.push({ x: hit.x, y: hit.y });
    drawArt(hit.side);
    return;
  }
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  state.rotation = drag.rotation + dx * 0.008;
  state.tilt = Math.max(-0.13, Math.min(0.13, drag.tilt + dy * 0.0016));
  modelGroup.rotation.y = state.rotation;
  modelGroup.rotation.x = state.tilt;
  displayAngle();
  syncAngleButtons();
}
function pointerUp() { drag = null; activeStroke = null; }
renderer.domElement.addEventListener('pointerdown', pointerDown);
renderer.domElement.addEventListener('pointermove', pointerMove);
renderer.domElement.addEventListener('pointerup', pointerUp);
renderer.domElement.addEventListener('pointercancel', pointerUp);
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = Math.max(0.62, Math.min(1.55, state.zoom * (event.deltaY < 0 ? 1.06 : 0.94)));
  updateCamera();
}, { passive: false });
$('#zoomIn').addEventListener('click', () => { state.zoom = Math.min(1.55, state.zoom + 0.1); updateCamera(); });
$('#zoomOut').addEventListener('click', () => { state.zoom = Math.max(0.62, state.zoom - 0.1); updateCamera(); });
$('#fitButton').addEventListener('click', () => { state.zoom = 1; fitToFrame(); });

function exportPng() {
  if (!modelReady) { showFeedback('Aguarde o carregamento da peça antes de exportar.'); return; }
  const exportWidth = 720;
  const exportHeight = 820;
  const gap = 30;
  const header = 74;
  const output = document.createElement('canvas');
  output.width = exportWidth * 2 + gap * 3;
  output.height = exportHeight + header + gap * 2;
  const ctx = output.getContext('2d');
  ctx.fillStyle = state.background;
  ctx.fillRect(0, 0, output.width, output.height);
  const dpr = renderer.getPixelRatio();
  const oldSize = new THREE.Vector2();
  renderer.getSize(oldSize);
  const oldRotation = state.rotation;
  const oldTilt = state.tilt;
  const oldZoom = state.zoom;
  const oldFittedSize = fittedSize;
  const oldBackground = stage.style.backgroundColor;
  renderer.setPixelRatio(1);
  renderer.setSize(exportWidth, exportHeight, false);
  const exportAspect = exportWidth / exportHeight;
  const exportModelSize = modelBounds.getSize(new THREE.Vector3());
  fittedSize = Math.max(exportModelSize.y * 1.25, exportModelSize.x / exportAspect * 1.25, exportModelSize.z * 1.2, 3.65);
  camera.left = -(fittedSize * exportAspect) / 2;
  camera.right = (fittedSize * exportAspect) / 2;
  camera.top = fittedSize / 2;
  camera.bottom = -fittedSize / 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  modelGroup.rotation.x = 0;
  for (const [index, view] of ['front', 'back'].entries()) {
    state.rotation = view === 'front' ? 0 : Math.PI;
    modelGroup.rotation.y = state.rotation;
    renderer.render(scene, camera);
    const x = gap + index * (exportWidth + gap);
    const y = header;
    ctx.drawImage(renderer.domElement, x, y, exportWidth, exportHeight);
    ctx.fillStyle = '#f2efe8';
    ctx.font = '600 17px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(view === 'front' ? 'FRENTE' : 'COSTAS', x + 16, 48);
    ctx.fillStyle = '#a5a7aa';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(modelNames[state.model], x + 16, 67);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.strokeRect(x, y, exportWidth, exportHeight);
  }
  renderer.setPixelRatio(dpr);
  renderer.setSize(oldSize.x, oldSize.y, false);
  state.rotation = oldRotation;
  state.tilt = oldTilt;
  state.zoom = oldZoom;
  fittedSize = oldFittedSize;
  modelGroup.rotation.set(state.tilt, state.rotation, 0);
  stage.style.backgroundColor = oldBackground || state.background;
  updateCamera();
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = 'oficina-camiseta-frente-costas.png';
  link.href = output.toDataURL('image/png');
  link.click();
  showFeedback('Prévia PNG de frente e costas exportada.');
}
$('#exportButton').addEventListener('click', exportPng);
$('#exportPanelButton').addEventListener('click', exportPng);

$('#resetButton').addEventListener('click', () => {
  state.model = 'tee'; state.color = '#E7E4DC'; state.text = 'FEITO À MÃO'; state.textColor = '#1C2620'; state.textSize = 50;
  state.rotation = 0; state.tilt = 0; state.zoom = 1; state.painting = false; state.paintColor = '#D6EF55'; state.paintSize = 8; state.animation = false;
  state.hue = 0; state.saturation = 0; state.lightness = 68;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.image = null; state.imageUrl = '';
  strokes.front = []; strokes.back = [];
  $('#shirtText').value = state.text; $('#textColor').value = state.textColor; $('#textSize').value = String(state.textSize);
  $('#paintColor').value = state.paintColor; $('#paintSize').value = String(state.paintSize); $('#paintSizeValue').textContent = '8 px';
  $('#artUpload').value = ''; $('#uploadState').hidden = true;
  $('#paintButton').setAttribute('aria-pressed', 'false'); $('#paintButton').innerHTML = '<span>✎</span> Ativar pincel'; viewport.classList.remove('painting');
  $('#textCounter').textContent = `${state.text.length} / 48`;
  $('#animateButton').innerHTML = '<span>⟳</span> Girar automaticamente'; $('#animateButton').classList.remove('active');
  $('#shirtLightness').value = '68'; $('#shirtLightnessValue').textContent = '68%';
  $$('.model-option').forEach((button) => { const active = button.dataset.model === 'tee'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  setPanel('modelo'); setBackground('#282C31'); drawWheel(); buildModel('tee'); setColor('#E7E4DC'); setAngle(0); showFeedback('Personalização reiniciada.');
});

function animate() {
  requestAnimationFrame(animate);
  if (state.animation && !state.painting) {
    state.rotation += 0.006;
    modelGroup.rotation.y = state.rotation;
    displayAngle();
    syncAngleButtons();
  }
  renderer.render(scene, camera);
}

function init() {
  ensureArtworkCanvases();
  drawWheel();
  buildModel('tee');
  setColor(state.color);
  setBackground(state.background);
  displayAngle();
  resizeObserver.observe(host);
  animate();
}
init();
