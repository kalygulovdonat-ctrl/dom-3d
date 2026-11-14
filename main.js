// ЮЖНЫЙ 17 — макет дома: солнце по времени суток, разбор по этажам, выбор квартиры.
import * as THREE from 'three';
import { createLife, blocked } from './life.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = (id) => document.getElementById(id);
const rnd = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* ------------------------------------------------------------------ */
/* Данные дома (заглушки)                                              */
/* ------------------------------------------------------------------ */
// размеры этажа в условных единицах: ширина (запад–восток), глубина (север–юг), сдвиг на север
const dimsOf = (i) => (i < 7 ? { w: 16, d: 10, oz: 0 } : i === 7 ? { w: 12, d: 8, oz: -1 } : { w: 9, d: 6, oz: -1.6 });
const heightOf = (i) => (i === 0 ? 1.4 : 1);
const ROOMS = { 1: '1 комната', 2: '2 комнаты', 3: '3 комнаты', 4: '4 комнаты', 5: 'Пентхаус' };
const STATUS = { free: 'Свободна', hold: 'Бронь', sold: 'Продана' };
const FLOORS = [];
{
  let num = 0, y = 0;
  for (let i = 0; i < 9; i++) {
    const { w, d, oz } = dimsOf(i), h = heightOf(i);
    const W = w - 0.7, D = d - 0.7, x0 = -W / 2, x1 = W / 2, z0 = oz - D / 2, z1 = oz + D / 2;
    let layout = [];
    if (i >= 1 && i <= 6) {
      const xs = x0 + W * 0.45, xn = x0 + W * 0.55, zs = oz + 0.3;
      layout = [
        { rooms: 2, side: 'юг-запад', r: [x0, xs, zs, z1], south: 1 },
        { rooms: 3, side: 'юг-восток', r: [xs, x1, zs, z1], south: 1 },
        { rooms: 3, side: 'север-запад', r: [x0, xn, z0, zs] },
        { rooms: 2, side: 'север-восток', r: [xn, x1, z0, zs] },
      ];
    } else if (i === 7) {
      layout = [
        { rooms: 4, side: 'запад, терраса', r: [x0, 0, z0, z1], south: 1 },
        { rooms: 4, side: 'восток, терраса', r: [0, x1, z0, z1], south: 1 },
      ];
    } else if (i === 8) {
      layout = [{ rooms: 5, side: 'все стороны, терраса', r: [x0, x1, z0, z1], south: 1 }];
    }
    const apts = layout.map((a, k) => {
      num += 1;
      const area = Math.round((a.r[1] - a.r[0]) * (a.r[3] - a.r[2]) * (i === 8 ? 4.2 : i === 7 ? 3 : 2));
      const ppm = (212000 + i * 7000) * (a.south ? 1.06 : 1) * (i >= 7 ? 1.25 : 1);
      const hash = (num * 7 + i * 3) % 11;
      const status = i === 8 ? 'free' : hash === 0 || hash === 5 ? 'sold' : hash === 3 ? 'hold' : 'free';
      return { id: `f${i}a${k}`, num, floor: i, rooms: a.rooms, side: a.side, rect: a.r, area, price: Math.round((area * ppm) / 100000) / 10, status };
    });
    FLOORS.push({ i, n: i + 1, w, d, oz, h, y0: y, apts });
    y += h;
  }
}
const aptById = (id) => { for (const f of FLOORS) for (const a of f.apts) if (a.id === id) return a; return null; };
const priceText = (p) => `${p.toFixed(1).replace('.', ',')} млн ₽`;

/* ------------------------------------------------------------------ */
/* Состояние и интерфейс — работают и без WebGL                        */
/* ------------------------------------------------------------------ */
const state = { section: 'hero', floor: null, apt: null, hoverFloor: null, hoverApt: null, time: 18.5 };
const dirty = { paint: true, sun: true };

// этажи
$('floorbar').innerHTML = FLOORS.map((f) => {
  const free = f.apts.filter((a) => a.status === 'free').length;
  return `<button type="button" data-floor="${f.i}" aria-pressed="false" aria-label="Этаж ${f.n}${f.apts.length ? `, свободно ${free}` : ', лобби'}">${f.n}<small>${f.apts.length ? free : '—'}</small></button>`;
}).join('');

function renderFloor() {
  const f = state.floor == null ? null : FLOORS[state.floor];
  document.querySelectorAll('#floorbar button').forEach((b) => b.setAttribute('aria-pressed', String(f && +b.dataset.floor === f.i)));
  if (!f) { $('floorTitle').textContent = 'Нажмите на номер этажа или прямо на макет'; $('apts').innerHTML = ''; return; }
  if (!f.apts.length) {
    $('floorTitle').textContent = `Этаж ${f.n} · общие пространства`;
    $('apts').innerHTML = '<li class="floor__note">Лобби с консьержем, коворкинг для жильцов, колясочная и кладовые. Квартир на этаже нет.</li>';
    return;
  }
  const free = f.apts.filter((a) => a.status === 'free').length;
  $('floorTitle').textContent = `Этаж ${f.n} · свободно ${free} из ${f.apts.length}`;
  $('apts').innerHTML = f.apts.map((a) => `
    <li><button class="apt" type="button" data-apt="${a.id}" aria-pressed="${state.apt === a.id}" ${a.status === 'sold' ? 'aria-disabled="true"' : ''}>
      <span class="apt__n">№${a.num}</span>
      <span><span class="apt__name">${ROOMS[a.rooms]} · ${a.area} м²</span><span class="apt__meta">${a.side}</span></span>
      <span class="apt__price">${a.status === 'sold' ? '—' : priceText(a.price)}<small>${STATUS[a.status]}</small></span>
    </button></li>`).join('');
}
function renderPick() {
  const a = state.apt ? aptById(state.apt) : null;
  $('pick').hidden = !a;
  $('formApt').hidden = !a;
  if (!a) return;
  const text = `№${a.num} · ${ROOMS[a.rooms].toLowerCase()} · ${a.area} м² · ${a.floor + 1} этаж · ${priceText(a.price)}`;
  $('pickText').textContent = text;
  $('formApt').textContent = `Квартира ${text}`;
}
function selectFloor(i) {
  state.floor = state.floor === i ? null : i;
  if (state.apt && (state.floor == null || aptById(state.apt).floor !== state.floor)) state.apt = null;
  state.hoverApt = null;
  renderFloor(); renderPick(); dirty.paint = true;
}
function selectApt(id) {
  const a = aptById(id);
  if (!a || a.status === 'sold') return;
  state.apt = state.apt === id ? null : id;
  if (state.floor !== a.floor) state.floor = a.floor;
  renderFloor(); renderPick(); dirty.paint = true;
}
function markHover() {
  document.querySelectorAll('#floorbar button').forEach((b) => b.classList.toggle('is-hover', +b.dataset.floor === state.hoverFloor));
  document.querySelectorAll('.apt').forEach((b) => b.classList.toggle('is-hover', b.dataset.apt === state.hoverApt));
  dirty.paint = true;
}
$('floorbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) selectFloor(+b.dataset.floor); });
$('floorbar').addEventListener('pointerover', (e) => { const b = e.target.closest('button'); state.hoverFloor = b ? +b.dataset.floor : null; markHover(); });
$('floorbar').addEventListener('pointerleave', () => { state.hoverFloor = null; markHover(); });
$('apts').addEventListener('click', (e) => { const b = e.target.closest('.apt'); if (b) selectApt(b.dataset.apt); });
$('apts').addEventListener('pointerover', (e) => { const b = e.target.closest('.apt'); state.hoverApt = b ? b.dataset.apt : null; markHover(); });
$('apts').addEventListener('pointerleave', () => { state.hoverApt = null; markHover(); });

// солнце
const SKY = [[5, '#1b2040'], [6.5, '#ef9f82'], [9, '#f2d6b3'], [13, '#dbe6e6'], [17, '#f1c58d'], [19.5, '#d8593a'], [21, '#3b2b4d'], [23, '#11152a']];
const skyAt = (h, out) => {
  let k = 0;
  while (k < SKY.length - 2 && h > SKY[k + 1][0]) k++;
  const a = SKY[k], b = SKY[k + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  const pa = parseInt(a[1].slice(1), 16), pb = parseInt(b[1].slice(1), 16);
  for (let c = 0; c < 3; c++) out[c] = Math.round(lerp((pa >> (16 - 8 * c)) & 255, (pb >> (16 - 8 * c)) & 255, t));
  return out;
};
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
function applyTime() {
  const h = state.time, hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  $('timeOut').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('timeState').textContent = h < 6 ? 'Перед рассветом' : h < 10 ? 'Утро' : h < 16.5 ? 'День' : h < 18.5 ? 'Вечер' : h < 20.5 ? 'Закат' : 'Ночь';
  $('time').value = h;
  document.querySelectorAll('.sun__presets button').forEach((b) => b.classList.toggle('is-on', Math.abs(+b.dataset.time - h) < 0.26));
  const c = skyAt(h, [0, 0, 0]);
  document.documentElement.style.setProperty('--bg', `rgb(${c[0]},${c[1]},${c[2]})`);
  document.documentElement.dataset.theme = lum(c) < 0.17 ? 'dark' : 'light';
  dirty.sun = true;
}
let timeTo = state.time;
$('time').addEventListener('input', (e) => { timeTo = state.time = +e.target.value; applyTime(); });
document.querySelector('.sun__presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  timeTo = +b.dataset.time;
  if (reduceMotion) { state.time = timeTo; applyTime(); }
});

// секции: какая сейчас в центре экрана
const secs = [...document.querySelectorAll('.sec')];
function readSection() {
  const mid = innerHeight * 0.55;
  let cur = secs[0];
  for (const s of secs) { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) cur = s; }
  state.section = cur.dataset.pose;
}
addEventListener('scroll', readSection, { passive: true });
addEventListener('resize', readSection);
const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.15 });
document.querySelectorAll('.panel').forEach((p) => io.observe(p));

document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const t = document.querySelector(a.getAttribute('href')); if (!t) return;
  e.preventDefault();
  const panel = t.querySelector('.panel');
  const y = matchMedia('(max-width: 860px)').matches && panel ? panel.getBoundingClientRect().top + scrollY - innerHeight * 0.5 : t.getBoundingClientRect().top + scrollY;
  scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
}));

// форма: отправка не подключена — говорим об этом прямо
$('visitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget, name = f.elements.name, phone = f.elements.phone, st = $('formStatus');
  const okN = name.value.trim().length > 1, okP = phone.value.replace(/\D/g, '').length >= 10;
  name.setAttribute('aria-invalid', String(!okN)); phone.setAttribute('aria-invalid', String(!okP));
  st.classList.toggle('is-error', !(okN && okP));
  if (!okN) { st.textContent = 'Напишите, как к вам обращаться.'; name.focus(); return; }
  if (!okP) { st.textContent = 'Проверьте номер — нужно минимум 10 цифр.'; phone.focus(); return; }
  st.textContent = `${name.value.trim()}, заявка собрана. Демо-версия: отправка менеджеру ещё не подключена.`;
});

renderFloor(); renderPick(); applyTime(); readSection();

/* ------------------------------------------------------------------ */
/* 3D                                                                  */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { canvas.hidden = true; }
const reveal = () => { document.body.classList.remove('is-loading'); secs[0].classList.add('in'); };
if (renderer) init3d(); else reveal();

function init3d() {
  const small = matchMedia('(max-width: 860px)').matches;
  const maxDpr = small ? 1.6 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb9a48c, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1536 : 2560, small ? 1536 : 2560);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 30, bottom: -22, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  sun.target.position.set(0, 4, 0);
  scene.add(hemi, sun, sun.target);

  /* ---------- материалы макета ---------- */
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.92 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5b6b76, roughness: 0.4, metalness: 0 });
  const lit = new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, toneMapped: false });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.9 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const cube = (mat, sx, sy, sz, x, y, z) => { const m = cast(new THREE.Mesh(box, mat)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; };

  /* ---------- участок ---------- */
  const site = cast(new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 0.24, 96), white));
  site.position.y = -0.12; site.castShadow = false;
  scene.add(site);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.ShadowMaterial({ opacity: 0.26 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.24; ground.receiveShadow = true;
  scene.add(ground);
  {
    const r = rnd(7), spots = [];
    while (spots.length < 22) {
      const a = r() * Math.PI * 2, d = 9.5 + r() * 5, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.95;
      if (Math.abs(x) < 9.6 && Math.abs(z) < 7.2) continue;
      if (blocked(x, z) || Math.hypot(x, z) > 14.6) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 1.7)) continue;
      spots.push({ x, z, s: 0.7 + r() * 0.7 });
    }
    const trunks = cast(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 1, 6), white, spots.length));
    const crowns = cast(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 1), white, spots.length));
    spots.forEach((s, k) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(s.x, 0.5 * s.s, s.z); dummy.scale.set(1, s.s, 1); dummy.updateMatrix(); trunks.setMatrixAt(k, dummy.matrix);
      dummy.position.set(s.x, s.s * 1.25, s.z); dummy.scale.setScalar(s.s); dummy.rotation.set(0, k, 0); dummy.updateMatrix(); crowns.setMatrixAt(k, dummy.matrix);
    });
    scene.add(trunks, crowns);
    scene.add(cube(white, 3.4, 0.9, 2.2, -11.2, 0.45, 6.2), cube(white, 4.2, 0.08, 2.9, -11.2, 0.94, 6.2)); // павильон
    scene.add(cube(white, 0.5, 0.35, 5, 10.6, 0.17, 5.5), cube(white, 5, 0.35, 0.5, 8.2, 0.17, 8)); // подпорные стенки
  }

  /* ---------- этажи ---------- */
  const zoneMeshes = [], hitBoxes = [];
  const rand = rnd(17);
  for (const f of FLOORS) {
    const { i, w, d, oz, h } = f;
    const g = new THREE.Group();
    f.group = g; f.plateMat = white.clone();
    g.add(cube(f.plateMat, w, 0.1, d, 0, 0.05, oz));
    const wallH = h - 0.16, yc = 0.1 + wallH / 2, inset = 0.32;
    // стороны фасада: [начало, направление, нормаль, длина]
    const sides = [
      { len: w, at: (t) => [-w / 2 + t, oz + d / 2 - inset], rot: 0, n: [0, 1] },
      { len: w, at: (t) => [-w / 2 + t, oz - d / 2 + inset], rot: 0, n: [0, -1] },
      { len: d, at: (t) => [w / 2 - inset, oz - d / 2 + t], rot: Math.PI / 2, n: [1, 0] },
      { len: d, at: (t) => [-w / 2 + inset, oz - d / 2 + t], rot: Math.PI / 2, n: [-1, 0] },
    ];
    const panels = [], fins = [], lights = [];
    for (const s of sides) {
      const bays = Math.round(s.len - 0.6), step = (s.len - 0.64) / bays;
      for (let b = 0; b <= bays; b++) {
        const [x, z] = s.at(0.32 + b * step);
        fins.push({ x: x + s.n[0] * 0.14, z: z + s.n[1] * 0.14, rot: s.rot });
        if (b === bays) break;
        const [px, pz] = s.at(0.32 + (b + 0.5) * step);
        panels.push({ x: px, z: pz, rot: s.rot, len: step });
        if (rand() < (i === 0 ? 0.85 : 0.42)) lights.push({ x: px + s.n[0] * 0.035, z: pz + s.n[1] * 0.035, rot: s.rot, len: step });
      }
    }
    const inst = (mat, list, sx, sy, sz, shadow) => {
      const m = new THREE.InstancedMesh(box, mat, list.length);
      list.forEach((p, k) => {
        dummy.position.set(p.x, yc, p.z); dummy.rotation.set(0, p.rot, 0);
        dummy.scale.set(sx === null ? p.len : sx, sy, sz); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix);
      });
      m.castShadow = shadow; m.receiveShadow = shadow;
      g.add(m);
      return m;
    };
    inst(glass, panels, null, wallH, 0.05, true);
    inst(white, fins, 0.1, wallH, 0.36, true);
    inst(lit, lights, null, wallH * 0.92, 0.05, false).renderOrder = 2;
    // балконы на южной стороне
    if (i >= 1 && i <= 6) {
      for (const sgn of [-1, 1]) {
        const bx = sgn * 4 + (i % 2 ? 1.1 : -1.1);
        g.add(cube(white, 3.2, 0.1, 1.15, bx, 0.05, oz + d / 2 + 0.55), cube(white, 3.2, 0.42, 0.05, bx, 0.31, oz + d / 2 + 1.1));
      }
    }
    // планировка: зоны квартир и перегородки
    f.zones = f.apts.map((a) => {
      const [ax0, ax1, az0, az1] = a.rect;
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const z = new THREE.Mesh(box, mat);
      z.scale.set(ax1 - ax0 - 0.1, 0.05, az1 - az0 - 0.1);
      z.position.set((ax0 + ax1) / 2, 0.125, (az0 + az1) / 2);
      z.receiveShadow = true; z.userData = { apt: a.id, floor: i };
      g.add(z); zoneMeshes.push(z);
      g.add(cube(white, ax1 - ax0, 0.5, 0.07, (ax0 + ax1) / 2, 0.35, az0), cube(white, 0.07, 0.5, az1 - az0, ax0, 0.35, (az0 + az1) / 2));
      return z;
    });
    g.add(cube(coreMat, 2.1, wallH, 1.5, 0, yc, oz - 0.4)); // лифтовое ядро
    const hit = new THREE.Mesh(box, hitMat);
    hit.scale.set(w, h, d); hit.position.set(0, h / 2, oz); hit.userData = { floor: i };
    g.add(hit); hitBoxes.push(hit);
    // перекрытие сверху — отдельно: при открытии этажа уезжает вместе с верхними
    f.lid = cube(white, w, 0.06, d, 0, 0, oz);
    scene.add(g, f.lid);
    f.cy = f.y0 + 16 + i * 2; f.ly = f.cy + h;
  }

  const life = createLife({ scene, FLOORS });
  let nightK = 0;

  /* ---------- раскраска: наведение и выбор ---------- */
  const COL = { free: new THREE.Color(0xffffff), hold: new THREE.Color(0xc9c0ae), sold: new THREE.Color(0x7d776d), hover: new THREE.Color(0x9bb1ff), pick: new THREE.Color(0x1f4fff), off: new THREE.Color(0x000000) };
  function paint() {
    for (const f of FLOORS) {
      const hov = state.hoverFloor === f.i && state.floor !== f.i;
      f.plateMat.emissive.copy(hov ? COL.pick : COL.off);
      f.plateMat.emissiveIntensity = hov ? 0.9 : 0;
      f.zones.forEach((z, k) => {
        const a = f.apts[k];
        z.material.color.copy(state.apt === a.id ? COL.pick : state.hoverApt === a.id && a.status !== 'sold' ? COL.hover : COL[a.status]);
      });
    }
  }

  /* ---------- солнце ---------- */
  const warm = new THREE.Color(0xff8a4a), noon = new THREE.Color(0xfff3e2), moon = new THREE.Color(0x8fa6ff);
  const skyCol = new THREE.Color(), tmp = [0, 0, 0];
  function applySun() {
    const h = state.time, u = (h - 5.5) / 15.5;
    const el = Math.sin(Math.PI * u) * 62, az = THREE.MathUtils.degToRad(lerp(-100, 100, u));
    const night = 1 - sstep(-3, 9, el);
    if (el > 1.5) {
      const e = THREE.MathUtils.degToRad(el);
      sun.position.set(-Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)).multiplyScalar(70);
      sun.color.copy(warm).lerp(noon, sstep(4, 34, el));
      sun.intensity = 3.4 * sstep(0, 14, el);
    } else { // луна: холодный свет с юго-востока
      sun.position.set(34, 44, 30);
      sun.color.copy(moon);
      sun.intensity = 0.75 * night;
    }
    sun.position.y += 4;
    const c = skyAt(h, tmp);
    skyCol.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    hemi.color.copy(skyCol).lerp(noon, 0.45 * (1 - night));
    hemi.groundColor.copy(skyCol).multiplyScalar(0.55);
    hemi.intensity = lerp(1.15, 0.5, night);
    lit.opacity = sstep(0.15, 0.85, night);
    nightK = night;
    glass.emissive.setHex(0xffb060); glass.emissiveIntensity = 0.1 * night;
  }

  /* ---------- камера ---------- */
  const POSES = {
    hero: { az: 38, el: 21, H: 25, cy: 4.2, ox: 0.23, oy: 0 },
    sun: { az: -30, el: 30, H: 26, cy: 4.2, ox: -0.17, oy: 0 },
    yard: { az: 24, el: 33, H: 11.5, cy: 0.5, cx: 0.2, cz: 10.3, ox: -0.17, oy: 0, W: 10.5 },
    floors: { az: 40, el: 31, H: 31, cy: 6.6, ox: -0.2, oy: 0 },
    open: { az: 40, el: 50, H: 23, cy: 0, ox: -0.2, oy: 0 },
    visit: { az: 142, el: 19, H: 25, cy: 4.2, ox: 0.22, oy: 0 },
  };
  const pose = { ...POSES.hero, az: POSES.hero.az - 50, H: 34, cx: 0, cz: 0 };
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), target = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let userAz = 0, aspect = innerWidth / innerHeight;
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
    renderer.setSize(innerWidth, innerHeight, false);
    aspect = innerWidth / innerHeight;
  }
  addEventListener('resize', resize);

  /* ---------- указатель: вращение, наведение, выбор ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let drag = null, pointer = null;
  function pick(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (state.section === 'floors' && state.floor != null) {
      const z = ray.intersectObjects(FLOORS[state.floor].zones, false)[0];
      if (z) return { apt: z.object.userData.apt, floor: state.floor };
    }
    const hit = ray.intersectObjects(hitBoxes, false)[0];
    return hit ? { floor: hit.object.userData.floor } : null;
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, last: e.clientX, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.last; drag.last = e.clientX; drag.moved += Math.abs(dx);
      userAz -= dx * 0.28;
      if (drag.moved > 6) { canvas.classList.add('is-drag'); document.body.classList.add('has-dragged'); }
    } else if (e.pointerType === 'mouse') pointer = e;
  });
  const up = (e) => {
    if (!drag) return;
    const click = drag.moved < 6 && Math.abs(e.clientY - drag.y) < 6;
    drag = null; canvas.classList.remove('is-drag');
    if (!click) return;
    const p = pick(e);
    if (!p) return;
    if (p.apt) { selectApt(p.apt); return; }
    if (state.floor !== p.floor) selectFloor(p.floor);
    if (state.section !== 'floors') document.querySelector('a[href="#floors"]').click();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('is-drag'); });
  canvas.addEventListener('pointerleave', () => { pointer = null; if (state.hoverFloor != null || state.hoverApt) { state.hoverFloor = null; state.hoverApt = null; markHover(); } });

  /* ---------- кадр ---------- */
  const clock = new THREE.Clock();
  const outCubic = (t) => 1 - (1 - t) ** 3;
  let started = false, t0 = 0, explode = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (document.hidden) return;
    const time = clock.elapsedTime;
    if (!started) { started = true; t0 = time; reveal(); }
    const k = (r) => (reduceMotion ? 1 : 1 - Math.exp(-dt * r));

    // время суток плавно идёт к выбранному пресету
    if (Math.abs(timeTo - state.time) > 0.01) {
      state.time = Math.abs(timeTo - state.time) < 0.06 ? timeTo : lerp(state.time, timeTo, k(3.2));
      applyTime();
    }
    if (dirty.sun) { applySun(); dirty.sun = false; }

    if (pointer) { // наведение на макет
      const p = pick(pointer); pointer = null;
      const hf = p && !p.apt ? p.floor : null, ha = p && p.apt ? p.apt : null;
      canvas.classList.toggle('is-point', !!p);
      if (hf !== state.hoverFloor || ha !== state.hoverApt) { state.hoverFloor = hf; state.hoverApt = ha; markHover(); }
    }
    if (dirty.paint) { paint(); dirty.paint = false; }

    // этажи: сборка при загрузке, разбор в секции «Этажи», подъём верхних над выбранным
    const inFloors = state.section === 'floors', sel = inFloors ? state.floor : null;
    explode = lerp(explode, inFloors ? 1 : 0, k(3));
    for (const f of FLOORS) {
      const intro = reduceMotion ? 0 : 15 * (1 - outCubic(clamp((time - t0 - 0.25 - f.i * 0.1) / 1.1, 0, 1)));
      const base = f.y0 + f.i * 0.62 * explode + intro;
      const rate = 5.2 - f.i * 0.28;
      f.cy = intro > 0.001 ? base : lerp(f.cy, base + (sel != null && f.i > sel ? 18 : 0), k(rate));
      f.ly = intro > 0.001 ? base + f.h - 0.03 : lerp(f.ly, base + f.h - 0.03 + (sel != null && f.i >= sel ? 18 : 0), k(rate));
      f.group.position.y = f.cy; f.lid.position.y = f.ly;
      f.interior.visible = f.ly - (f.cy + f.h - 0.03) > 0.04; // мебель и жильцы видны только под снятым перекрытием
    }
    life.update(time, nightK);

    // поза камеры
    const P = sel != null ? POSES.open : POSES[state.section] || POSES.hero;
    const cy = sel != null ? FLOORS[sel].y0 + sel * 0.62 + 1.2 : P.cy;
    const portrait = aspect < 0.85;
    const needW = P.W || (sel != null ? 26 : 31);
    const H = portrait ? Math.max(P.H, needW / aspect) : P.H;
    const kk = k(2.6);
    pose.az = lerp(pose.az, P.az, kk); pose.el = lerp(pose.el, P.el, kk); pose.H = lerp(pose.H, H, kk);
    pose.cy = lerp(pose.cy, cy, kk); pose.cx = lerp(pose.cx, sel != null ? 0 : P.cx || 0, kk); pose.cz = lerp(pose.cz, sel != null ? 0 : P.cz || 0, kk); pose.ox = lerp(pose.ox, portrait ? 0 : P.ox, kk); pose.oy = lerp(pose.oy, portrait ? (sel != null ? 0.22 : 0.3) : P.oy, kk);
    const a = THREE.MathUtils.degToRad(pose.az + userAz + (reduceMotion ? 0 : Math.sin(time * 0.17) * 3.5));
    const e = THREE.MathUtils.degToRad(pose.el);
    dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    right.crossVectors(UP, dir).normalize(); upv.crossVectors(dir, right).normalize();
    const Wv = pose.H * aspect;
    target.set(pose.cx, pose.cy, pose.cz).addScaledVector(right, -pose.ox * Wv).addScaledVector(upv, -pose.oy * pose.H);
    camera.left = -Wv / 2; camera.right = Wv / 2; camera.top = pose.H / 2; camera.bottom = -pose.H / 2;
    camera.position.copy(target).addScaledVector(dir, 120);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    $('compass').style.transform = `rotate(${pose.az + userAz}deg)`;

    renderer.render(scene, camera);
  }
  frame();
}
