// «Жизнь» макета: мебель и жильцы внутри этажей, двор с детской площадкой, прохожие, парковка.
import * as THREE from 'three';

const rnd = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const CLOTHES = ['#d8593a', '#e9a820', '#2f8f83', '#283a6b', '#e58a9b', '#7a5cc4', '#3f6fd8', '#b8442a', '#4f9a55'];
const SKIN = ['#f1d3b8', '#e3bd97', '#c99268', '#8d5d3f'];
const SOFT = ['#8d99a6', '#b9a88f', '#a3b29b', '#c7a08c', '#9aa3bd', '#d6b06a'];
const WHITE = '#f3f0ea', PLASTER = '#e4dfd6', WOOD = '#b98f62', DARK = '#2c3036', GREEN = '#6f9b68';
const Y0 = 0.15; // верх пола внутри этажа

export const PLAY = { x: 0, z: 10.7, r: 4.15 };
const PATH = { rx: 9.4, rz: 6.9 };
const PARK = { x0: 10.2, x1: 14.3, z0: -4.6, z1: 1.6 };
// где нельзя сажать деревья
export function blocked(x, z) {
  if (Math.hypot(x - PLAY.x, z - PLAY.z) < PLAY.r + 0.9) return true;
  if (Math.abs(Math.hypot(x / PATH.rx, z / PATH.rz) - 1) < 0.12) return true;
  return x > PARK.x0 - 0.9 && x < PARK.x1 + 0.9 && z > PARK.z0 - 0.9 && z < PARK.z1 + 0.9;
}

/* ---------- общая геометрия и материалы ---------- */
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const ballGeo = new THREE.SphereGeometry(1, 14, 10);
const bodyGeo = new THREE.CapsuleGeometry(0.085, 0.24, 4, 10);
const headGeo = new THREE.SphereGeometry(0.078, 12, 9);
const matte = new THREE.MeshStandardMaterial({ roughness: 0.82 });
const dummy = new THREE.Object3D();
const col = new THREE.Color();

// сборщик: копим коробки, шары и людей, потом превращаем в несколько инстанс-мешей
function builder() {
  const boxes = [], balls = [], actors = [];
  return {
    boxes, balls, actors,
    box(x, y, z, sx, sy, sz, color, rx = 0, rz = 0, centered = false) { boxes.push({ x, y: centered ? y : y + sy / 2, z, sx, sy, sz, color, rx, rz }); },
    ball(x, y, z, r, color) { balls.push({ x, y, z, r, color }); },
    actor(o) { actors.push({ pose: 0, s: 1, y: 0, ph: 0, ...o }); },
  };
}
function realize(b, parent, r) {
  const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; parent.add(m); return m; };
  if (b.boxes.length) {
    const m = shadow(new THREE.InstancedMesh(boxGeo, matte, b.boxes.length));
    b.boxes.forEach((o, k) => {
      dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(o.rx, 0, o.rz); dummy.scale.set(o.sx, o.sy, o.sz); dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, col.set(o.color));
    });
  }
  if (b.balls.length) {
    const m = shadow(new THREE.InstancedMesh(ballGeo, matte, b.balls.length));
    b.balls.forEach((o, k) => {
      dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(o.r); dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, col.set(o.color));
    });
  }
  let crowd = null;
  if (b.actors.length) {
    const bodies = shadow(new THREE.InstancedMesh(bodyGeo, matte, b.actors.length));
    const heads = shadow(new THREE.InstancedMesh(headGeo, matte, b.actors.length));
    b.actors.forEach((a, k) => {
      bodies.setColorAt(k, col.set(a.color || CLOTHES[Math.floor(r() * CLOTHES.length)]));
      heads.setColorAt(k, col.set(SKIN[Math.floor(r() * SKIN.length)]));
    });
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage); heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crowd = { bodies, heads, actors: b.actors };
  }
  return crowd;
}

// поза: 0 стоит, 1 сидит, 2 лежит (hd — в какую сторону по z голова)
function writeActor(crowd, k, x, y, z, s, pose, hd) {
  dummy.rotation.set(0, 0, 0);
  if (pose === 2) {
    dummy.position.set(x, y + 0.085 * s, z); dummy.rotation.x = Math.PI / 2; dummy.scale.setScalar(s); dummy.updateMatrix();
    crowd.bodies.setMatrixAt(k, dummy.matrix);
    dummy.rotation.x = 0; dummy.position.set(x, y + 0.09 * s, z + hd * 0.29 * s);
  } else if (pose === 1) {
    dummy.position.set(x, y + 0.145 * s, z); dummy.scale.set(s, 0.7 * s, s); dummy.updateMatrix();
    crowd.bodies.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, y + 0.36 * s, z);
  } else {
    dummy.position.set(x, y + 0.205 * s, z); dummy.scale.setScalar(s); dummy.updateMatrix();
    crowd.bodies.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, y + 0.49 * s, z);
  }
  dummy.scale.setScalar(s); dummy.updateMatrix();
  crowd.heads.setMatrixAt(k, dummy.matrix);
}

/* ------------------------------------------------------------------ */
/* Интерьер этажа                                                      */
/* ------------------------------------------------------------------ */
function furnish(f, r) {
  const b = builder();
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  if (!f.apts.length) { // лобби первого этажа
    const z = f.oz;
    b.box(-4.6, Y0, z + 2.6, 2.2, 0.34, 0.45, WOOD); b.box(-4.6, Y0 + 0.34, z + 2.6, 2.3, 0.03, 0.5, DARK);
    b.actor({ kind: 'sway', x: -4.6, z: z + 2.2, y: Y0 });
    for (const sx of [-1, 1]) {
      const x = 3.6 + sx * 1.1, c = pick(SOFT);
      b.box(x, Y0, z + 2.4, 1.3, 0.16, 0.5, c); b.box(x, Y0, z + 2.4 + sx * 0.0 - 0.22, 1.3, 0.32, 0.1, c);
      b.actor({ kind: 'still', pose: 1, x: x - 0.25, z: z + 2.4, y: Y0 + 0.16 });
    }
    b.box(3.6, Y0, z + 3.3, 0.7, 0.12, 0.4, WOOD); b.box(3.6, Y0, z + 2.9, 3.4, 0.015, 2, pick(SOFT));
    for (let k = 0; k < 6; k++) { b.box(-6.6 + k * 0.5, Y0, z - 3.6, 0.42, 0.6, 0.4, PLASTER); } // почтовые ящики и кладовые
    for (const [px, pz] of [[-7, 3.6], [7, 3.6], [0.2, 3.9], [-2, -3.5]]) { b.box(px, Y0, z + pz, 0.2, 0.18, 0.2, '#c9623f'); b.ball(px, Y0 + 0.42, z + pz, 0.24, GREEN); }
    b.box(-0.6, Y0, z + 3.2, 4.8, 0.015, 1.4, '#c7a08c');
    // коворкинг: столы с ноутбуками вдоль северной стены
    for (let k = 0; k < 5; k++) {
      const x = 2.2 + k * 1.15, dz = z - 2.6;
      b.box(x, Y0 + 0.2, dz, 0.8, 0.04, 0.4, WOOD); b.box(x, Y0, dz, 0.07, 0.2, 0.07, WOOD);
      b.box(x, Y0 + 0.24, dz, 0.16, 0.015, 0.11, DARK); b.box(x, Y0, dz + 0.36, 0.15, 0.15, 0.15, '#8d99a6');
      if (k !== 2) b.actor({ kind: 'still', pose: 1, x, z: dz + 0.36, y: Y0 + 0.15 });
    }
    b.box(4.5, Y0, z - 1.6, 5.4, 0.015, 2.6, pick(SOFT));
    // кофейная стойка и высокие стулья
    b.box(-4.2, Y0, z - 2.4, 2.6, 0.36, 0.5, PLASTER); b.box(-4.2, Y0 + 0.36, z - 2.4, 2.7, 0.03, 0.56, WOOD);
    for (let k = 0; k < 3; k++) b.box(-5 + k * 0.8, Y0, z - 1.9, 0.14, 0.24, 0.14, DARK);
    b.actor({ kind: 'sway', x: -4.2, z: z - 2.85, y: Y0 }); b.actor({ kind: 'still', pose: 1, x: -4.2, z: z - 1.9, y: Y0 + 0.24 });
    // колясочная у входа и колонны
    for (let k = 0; k < 3; k++) { b.box(-7 + k * 0.55, Y0 + 0.06, z + 0.6, 0.34, 0.2, 0.26, pick(CLOTHES)); b.box(-7 + k * 0.55, Y0 + 0.28, z + 0.44, 0.3, 0.03, 0.03, DARK); }
    for (const cx of [-6, -2.6, 2.6, 6]) for (const cz of [-1.4, 1.6]) b.box(cx, Y0, z + cz, 0.22, 0.9, 0.22, WHITE);
    b.actor({ kind: 'walk', ax: -6.4, az: z - 0.4, bx: 6.6, bz: z - 0.4, y: Y0, speed: 0.1, ph: 0.8 });
    b.actor({ kind: 'walk', ax: -2.6, az: z + 3.2, bx: 1.6, bz: z + 3.2, y: Y0, speed: 0.22, ph: 0.3 });
    b.actor({ kind: 'walk', ax: 6.4, az: z + 0.9, bx: -5.8, bz: z + 0.9, y: Y0, speed: 0.16, ph: 1.1, s: 0.62 });
    return b;
  }

  for (const a of f.apts) {
    const [x0, x1, z0, z1] = a.rect;
    const dir = Math.abs(z0 - f.oz) <= Math.abs(z1 - f.oz) ? 1 : -1; // от коридора к фасаду
    const cz = dir > 0 ? z0 : z1, depth = z1 - z0, W = x1 - x0;
    const hall = Math.min(1.0, depth * 0.24), zh = cz + dir * hall, rd = depth - hall;
    const n = a.rooms === 5 ? 4 : a.rooms;
    const living = n === 1 ? W : W * (n === 2 ? 0.46 : n === 3 ? 0.4 : 0.36), other = n > 1 ? (W - living) / (n - 1) : 0;
    const Z = (v) => zh + dir * v * rd;

    // санузел в прихожей и человек, который ходит по коридору
    b.box(x0 + 0.6, Y0, cz + dir * hall / 2, 1.0, 0.5, hall - 0.14, PLASTER);
    if (r() < 0.7) b.actor({ kind: 'walk', ax: x0 + 1.4, az: cz + dir * hall * 0.5, bx: x1 - 0.35, bz: cz + dir * hall * 0.5, y: Y0, speed: 0.12 + r() * 0.1, ph: r() * 2, s: r() < 0.3 ? 0.62 : 1 });

    let rx = x0;
    for (let k = 0; k < n; k++) {
      const rw = k === 0 ? living : other, X = (u) => rx + u * rw;
      // стена между прихожей и комнатой — с дверным проёмом
      const door = X(k === 0 ? 0.5 : 0.84), gap = 0.26;
      if (door - gap - rx > 0.1) b.box((rx + door - gap) / 2, Y0, zh, door - gap - rx, 0.5, 0.06, WHITE);
      if (rx + rw - door - gap > 0.1) b.box((door + gap + rx + rw) / 2, Y0, zh, rx + rw - door - gap, 0.5, 0.06, WHITE);
      if (k > 0) b.box(rx, Y0, Z(0.5), 0.06, 0.5, rd, WHITE);

      if (k === 0) { // гостиная с кухней
        const wide = rw > 2.8, lx = X(wide ? 0.36 : 0.5), sofaC = pick(SOFT), sw = Math.min(1.25, rw * 0.5);
        b.box(lx, Y0, Z(0.42), Math.min(rw * 0.6, 1.9), 0.015, Math.min(rd * 0.42, 1.25), pick(SOFT));
        b.box(lx, Y0, Z(0.16), sw, 0.16, 0.46, sofaC); b.box(lx, Y0, Z(0.16) - dir * 0.2, sw, 0.32, 0.1, sofaC);
        b.box(lx - sw / 2, Y0, Z(0.16), 0.08, 0.24, 0.46, sofaC); b.box(lx + sw / 2, Y0, Z(0.16), 0.08, 0.24, 0.46, sofaC);
        b.box(lx, Y0, Z(0.42), 0.5, 0.11, 0.3, WOOD);
        b.box(lx, Y0, Z(0.7), 0.85, 0.13, 0.18, PLASTER); b.box(lx, Y0 + 0.13, Z(0.7), 0.72, 0.28, 0.03, DARK);
        b.actor({ kind: 'still', pose: 1, x: lx - sw * 0.22, z: Z(0.16), y: Y0 + 0.16 });
        if (r() < 0.6) b.actor({ kind: 'still', pose: 1, x: lx + sw * 0.24, z: Z(0.16), y: Y0 + 0.16, s: r() < 0.5 ? 0.66 : 1 });
        if (r() < 0.55) { b.actor({ kind: 'still', pose: 1, x: lx + 0.42, z: Z(0.45), y: Y0 + 0.015, s: 0.55 }); b.box(lx + 0.62, Y0, Z(0.52), 0.09, 0.09, 0.09, pick(CLOTHES)); }
        // кухня вдоль стены
        const kx = rx + rw - 0.2, kl = rd * 0.46;
        b.box(kx, Y0, Z(0.34), 0.3, 0.3, kl, PLASTER); b.box(kx, Y0 + 0.3, Z(0.34), 0.32, 0.02, kl, DARK);
        b.box(kx, Y0, Z(0.34) + dir * (kl / 2 + 0.2), 0.3, 0.62, 0.3, WHITE); // холодильник
        b.actor({ kind: 'sway', x: kx - 0.34, z: Z(0.3), y: Y0 });
        if (wide) { // обеденный стол
          const tx = X(0.78), tz = Z(0.8);
          b.box(tx, Y0 + 0.2, tz, 0.6, 0.04, 0.44, WOOD); b.box(tx, Y0, tz, 0.08, 0.2, 0.08, WOOD);
          for (const [dx, dz] of [[-0.42, 0], [0.42, 0], [0, -0.34], [0, 0.34]]) b.box(tx + dx, Y0, tz + dz, 0.15, 0.15, 0.15, sofaC);
          if (r() < 0.6) b.actor({ kind: 'still', pose: 1, x: tx - 0.42, z: tz, y: Y0 + 0.15 });
        }
        b.box(X(0.07), Y0, Z(0.92), 0.14, 0.13, 0.14, '#c9623f'); b.ball(X(0.07), Y0 + 0.29, Z(0.92), 0.16, GREEN);
      } else { // спальня
        const bw = Math.min(0.8, rw * 0.58), bx = X(0.4), bz = zh + dir * 0.62;
        b.box(bx, Y0, bz, bw + 0.06, 0.07, 1.1, WOOD); b.box(bx, Y0 + 0.07, bz, bw, 0.13, 1.04, WHITE);
        b.box(bx, Y0, zh + dir * 0.06, bw + 0.06, 0.36, 0.06, WOOD);
        b.box(bx, Y0 + 0.2, bz + dir * 0.2, bw + 0.02, 0.03, 0.62, pick(SOFT)); b.box(bx, Y0 + 0.2, bz - dir * 0.4, bw * 0.72, 0.05, 0.18, '#ffffff');
        b.box(bx, Y0, Z(0.62), Math.min(rw * 0.7, 1.2), 0.015, 0.7, pick(SOFT));
        if (r() < 0.4) b.actor({ kind: 'still', pose: 2, hd: -dir, x: bx, z: bz + dir * 0.1, y: Y0 + 0.2 });
        if (rw > 1.5) { // рабочий стол у окна
          const dx = X(0.42), dz = Z(0.93);
          b.box(dx, Y0 + 0.2, dz, 0.62, 0.04, 0.26, WOOD); b.box(dx - 0.26, Y0, dz, 0.05, 0.2, 0.22, WOOD); b.box(dx + 0.26, Y0, dz, 0.05, 0.2, 0.22, WOOD);
          b.box(dx, Y0 + 0.24, dz, 0.16, 0.015, 0.11, DARK); b.box(dx, Y0, dz - dir * 0.3, 0.15, 0.15, 0.15, '#8d99a6');
          if (r() < 0.6) b.actor({ kind: 'still', pose: 1, x: dx, z: dz - dir * 0.3, y: Y0 + 0.15 });
        }
        if (rw > 1.9) b.box(rx + rw - 0.2, Y0, Z(0.5), 0.26, 0.6, 0.85, PLASTER); // шкаф
      }
      rx += rw;
    }
  }
  return b;
}

/* ------------------------------------------------------------------ */
/* Двор                                                                */
/* ------------------------------------------------------------------ */
function yard(scene, r) {
  const b = builder(), P = PLAY;
  const flat = (geo, color, y) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95 })); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m); return m; };

  // дорожка вокруг дома, покрытие площадки, парковка
  flat(new THREE.RingGeometry(0.945, 1.055, 120), '#ddd5c7', 0.008).scale.set(PATH.rx, PATH.rz, 1);
  flat(new THREE.CircleGeometry(P.r, 72), '#e6b796', 0.01).position.set(P.x, 0.01, P.z);
  const lot = flat(new THREE.PlaneGeometry(PARK.x1 - PARK.x0, PARK.z1 - PARK.z0), '#d3ccbf', 0.009);
  lot.position.set((PARK.x0 + PARK.x1) / 2, 0.009, (PARK.z0 + PARK.z1) / 2);
  const carC = ['#f3f0ea', '#283a6b', '#d8593a', '#8d99a6'];
  for (let k = 0; k < 4; k++) {
    const z = PARK.z0 + 0.85 + k * 1.5, x = 12.1 + (k % 2) * 0.25;
    b.box(12.25, 0.01, z - 0.75, 3.4, 0.012, 0.06, WHITE);
    if (k === 2) continue; // одно место свободно
    b.box(x, 0.08, z, 1.55, 0.22, 0.72, carC[k]); b.box(x - 0.08, 0.3, z, 0.82, 0.2, 0.64, '#3b4650');
    for (const [wx, wz] of [[-0.5, -0.33], [0.5, -0.33], [-0.5, 0.33], [0.5, 0.33]]) b.box(x + wx, 0, z + wz, 0.26, 0.2, 0.1, DARK);
  }
  b.box(12.25, 0.01, PARK.z0 + 0.85 + 4 * 1.5 - 0.75, 3.4, 0.012, 0.06, WHITE);

  // качели
  const SW = { x: P.x - 2.35, z: P.z - 1.2, top: 1.45, L: 1.02 };
  b.box(SW.x - 0.98, 0, SW.z, 0.07, SW.top, 0.07, WHITE); b.box(SW.x + 0.98, 0, SW.z, 0.07, SW.top, 0.07, WHITE);
  b.box(SW.x - 0.98, 0, SW.z - 0.35, 0.05, 1.5, 0.05, WHITE, 0.24, 0); b.box(SW.x + 0.98, 0, SW.z - 0.35, 0.05, 1.5, 0.05, WHITE, 0.24, 0);
  b.box(SW.x, SW.top, SW.z, 2.1, 0.07, 0.07, '#d8593a');
  const part = (color, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  const swings = [-0.46, 0.46].map((dx) => {
    const g = new THREE.Group(); g.position.set(SW.x + dx, SW.top, SW.z);
    g.add(part(DARK, 0.02, SW.L, 0.02, -0.15, -SW.L / 2, 0), part(DARK, 0.02, SW.L, 0.02, 0.15, -SW.L / 2, 0), part('#d8593a', 0.36, 0.04, 0.17, 0, -SW.L, 0));
    scene.add(g); return g;
  });
  swings.forEach((g, k) => b.actor({ kind: 'swing', k, px: g.position.x, pz: SW.z, s: 0.62 }));

  // горка
  const SL = { x: P.x + 2.2, z: P.z - 1.4 };
  for (const [dx, dz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) b.box(SL.x + dx, 0, SL.z + dz, 0.05, 1.15, 0.05, WHITE);
  b.box(SL.x, 0.85, SL.z, 0.62, 0.05, 0.62, '#e9a820'); b.box(SL.x, 1.15, SL.z, 0.7, 0.04, 0.7, '#d8593a');
  b.box(SL.x, 0.46, SL.z + 1.06, 0.42, 0.04, 1.72, '#e9a820', 0.49, 0, true);
  b.box(SL.x - 0.22, 0.52, SL.z + 1.06, 0.03, 0.12, 1.72, WHITE, 0.49, 0, true); b.box(SL.x + 0.22, 0.52, SL.z + 1.06, 0.03, 0.12, 1.72, WHITE, 0.49, 0, true);
  b.box(SL.x, 0.43, SL.z - 0.5, 0.36, 0.04, 0.95, WHITE, -1.15, 0, true);
  b.actor({ kind: 'slide', x: SL.x, z: SL.z, s: 0.62, ph: 0 }); b.actor({ kind: 'slide', x: SL.x, z: SL.z, s: 0.58, ph: 0.47 });

  // качалка-балансир
  const SS = { x: P.x - 0.2, z: P.z + 2.1 };
  b.box(SS.x, 0, SS.z, 0.22, 0.32, 0.22, WHITE);
  const seesaw = new THREE.Group(); seesaw.position.set(SS.x, 0.34, SS.z);
  seesaw.add(part('#2f8f83', 2.05, 0.05, 0.22, 0, 0, 0), part(WHITE, 0.04, 0.16, 0.2, -0.62, 0.1, 0), part(WHITE, 0.04, 0.16, 0.2, 0.62, 0.1, 0));
  scene.add(seesaw);
  b.actor({ kind: 'seesaw', sgn: -1, x: SS.x, z: SS.z, s: 0.6 }); b.actor({ kind: 'seesaw', sgn: 1, x: SS.x, z: SS.z, s: 0.6 });

  // карусель
  const CA = { x: P.x + 2.25, z: P.z + 2.25 };
  const carousel = new THREE.Group(); carousel.position.set(CA.x, 0, CA.z);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.07, 32), new THREE.MeshStandardMaterial({ color: '#7a5cc4', roughness: 0.8 }));
  disc.position.y = 0.16; disc.castShadow = true; disc.receiveShadow = true;
  carousel.add(disc, part(WHITE, 0.06, 0.5, 0.06, 0, 0.42, 0), part(WHITE, 1.3, 0.03, 0.03, 0, 0.66, 0), part(WHITE, 0.03, 0.03, 1.3, 0, 0.66, 0));
  scene.add(carousel);
  for (let k = 0; k < 3; k++) b.actor({ kind: 'spin', off: (k * Math.PI * 2) / 3, x: CA.x, z: CA.z, s: 0.6 });

  // песочница
  const SB = { x: P.x - 2.4, z: P.z + 1.45 };
  b.box(SB.x, 0, SB.z, 1.5, 0.06, 1.5, '#ecd9ac');
  for (const [dx, dz, sx, sz] of [[0, -0.78, 1.66, 0.1], [0, 0.78, 1.66, 0.1], [-0.78, 0, 0.1, 1.5], [0.78, 0, 0.1, 1.5]]) b.box(SB.x + dx, 0, SB.z + dz, sx, 0.16, sz, WOOD);
  b.actor({ kind: 'still', pose: 1, x: SB.x - 0.25, z: SB.z + 0.1, y: 0.06, s: 0.55 }); b.actor({ kind: 'still', pose: 1, x: SB.x + 0.3, z: SB.z - 0.25, y: 0.06, s: 0.5 });
  b.box(SB.x + 0.05, 0.06, SB.z + 0.25, 0.1, 0.1, 0.1, '#e9a820'); b.box(SB.x + 0.42, 0.06, SB.z + 0.2, 0.2, 0.12, 0.2, '#ecd9ac'); b.ball(SB.x - 0.45, 0.14, SB.z - 0.4, 0.08, '#3f6fd8');
  b.actor({ kind: 'sway', x: SB.x - 1.05, z: SB.z - 0.6, y: 0 });

  // дети бегают по кругу в центре площадки
  for (let k = 0; k < 3; k++) b.actor({ kind: 'run', x: P.x - 0.1, z: P.z - 0.1, rad: 1.0 + k * 0.08, ph: k * 0.9, s: 0.58 + k * 0.03 });
  b.ball(P.x + 0.2, 0.11, P.z + 0.5, 0.1, '#d8593a');

  // скамейки и взрослые
  [[-1.5, 2], [1.5, 1]].forEach(([dx, people]) => {
    const x = P.x + dx, z = P.z - 3.25;
    b.box(x, 0.26, z, 1.15, 0.05, 0.32, WOOD); b.box(x, 0.3, z - 0.17, 1.15, 0.3, 0.05, WOOD);
    b.box(x - 0.48, 0, z, 0.06, 0.26, 0.3, WHITE); b.box(x + 0.48, 0, z, 0.06, 0.26, 0.3, WHITE);
    for (let k = 0; k < people; k++) b.actor({ kind: 'still', pose: 1, x: x - 0.25 + k * 0.5, z, y: 0.31 });
    if (people === 1) { b.box(x + 0.75, 0.12, z + 0.1, 0.32, 0.2, 0.22, '#283a6b'); b.box(x + 0.75, 0.32, z - 0.02, 0.3, 0.03, 0.03, DARK); } // коляска
  });
  b.actor({ kind: 'sway', x: P.x + 1.2, z: P.z - 0.2, y: 0 });

  // прохожие на дорожке
  for (let k = 0; k < 8; k++) b.actor({ kind: 'loop', ph: k * 0.82 + r() * 0.4, speed: (k % 3 === 0 ? -1 : 1) * (0.05 + r() * 0.05) * (k === 5 ? 2.4 : 1), lane: (r() - 0.5) * 0.5, s: k === 6 ? 0.62 : 1 });

  // фонари
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xd9d4cb, toneMapped: false });
  const lamps = new THREE.InstancedMesh(ballGeo, lampMat, 8);
  for (let k = 0; k < 8; k++) {
    const a = 0.52 + (k * Math.PI) / 4, x = Math.cos(a) * PATH.rx * 1.1, z = Math.sin(a) * PATH.rz * 1.13;
    b.box(x, 0, z, 0.05, 1.25, 0.05, WHITE);
    dummy.position.set(x, 1.32, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.1); dummy.updateMatrix(); lamps.setMatrixAt(k, dummy.matrix);
  }
  scene.add(lamps);

  return { crowd: realize(b, scene, r), swings, seesaw, carousel, lampMat, SW, SL, SS, CA };
}

/* ------------------------------------------------------------------ */
export function createLife({ scene, FLOORS }) {
  const r = rnd(41);
  for (const f of FLOORS) {
    f.interior = new THREE.Group();
    f.group.add(f.interior);
    f.crowd = realize(furnish(f, r), f.interior, r);
    f.interior.visible = false;
  }
  const Y = yard(scene, r);
  const dayLamp = new THREE.Color(0xd9d4cb), nightLamp = new THREE.Color(0xffd9a0);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animate(crowd, t) {
    crowd.actors.forEach((a, k) => {
      let x = a.x, y = a.y, z = a.z, pose = a.pose;
      const p = a.ph;
      if (a.kind === 'sway') { x += Math.sin(t * 0.9 + k) * 0.05; z += Math.cos(t * 0.7 + k * 2) * 0.04; }
      else if (a.kind === 'walk') {
        const u = (t * a.speed + p) % 2, v = smooth(u < 1 ? u : 2 - u);
        x = lerp(a.ax, a.bx, v); z = lerp(a.az, a.bz, v); y += Math.abs(Math.sin(t * 7 + k)) * 0.012;
      } else if (a.kind === 'loop') {
        const ang = p + t * a.speed, e = 1 + a.lane * 0.07;
        x = Math.cos(ang) * PATH.rx * e; z = Math.sin(ang) * PATH.rz * e; y = Math.abs(Math.sin(t * (6 + Math.abs(a.speed) * 30) + k)) * 0.014;
      } else if (a.kind === 'run') {
        const ang = p + t * 1.5, rad = a.rad + Math.sin(t * 0.7 + p) * 0.12;
        x += Math.cos(ang) * rad; z += Math.sin(ang) * rad; y = Math.abs(Math.sin(t * 11 + p)) * 0.05;
      } else if (a.kind === 'swing') {
        const phi = Y.swings[a.k].rotation.x;
        x = a.px; y = Y.SW.top - Math.cos(phi) * Y.SW.L + 0.02; z = a.pz - Math.sin(phi) * Y.SW.L; pose = 1;
      } else if (a.kind === 'seesaw') {
        const psi = Y.seesaw.rotation.z;
        x += a.sgn * 0.86 * Math.cos(psi); y = 0.37 + a.sgn * 0.86 * Math.sin(psi); pose = 1;
      } else if (a.kind === 'spin') {
        const ang = Y.carousel.rotation.y + a.off;
        x += Math.cos(ang) * 0.5; z -= Math.sin(ang) * 0.5; y = 0.2; pose = 1;
      } else if (a.kind === 'slide') { // обойти, залезть, съехать
        const u = (t * 0.16 + p) % 1;
        if (u < 0.36) { const v = u / 0.36, w = Math.sin(v * Math.PI); x = a.x + w * 0.95; z = lerp(a.z + 2.2, a.z - 1.05, v); y = Math.abs(Math.sin(t * 9)) * 0.03; }
        else if (u < 0.52) { const v = (u - 0.36) / 0.16; z = lerp(a.z - 1.05, a.z - 0.1, v); y = lerp(0, 0.88, v); }
        else if (u < 0.6) { z = a.z + 0.05; y = 0.88; }
        else if (u < 0.78) { const v = smooth((u - 0.6) / 0.18); z = lerp(a.z + 0.3, a.z + 1.85, v); y = lerp(0.88, 0.08, v); pose = 1; }
        else { z = a.z + 2.2; y = 0; }
      }
      writeActor(crowd, k, x, y, z, a.s, pose, a.hd || 1);
    });
    crowd.bodies.instanceMatrix.needsUpdate = true; crowd.heads.instanceMatrix.needsUpdate = true;
  }

  // первый проход — чтобы все стояли на местах даже без анимации
  for (const f of FLOORS) if (f.crowd) animate(f.crowd, 0);
  animate(Y.crowd, 0);

  return {
    update(time, night) {
      const t = still ? 0 : time;
      Y.swings.forEach((g, k) => { g.rotation.x = Math.sin(t * 2.1 + k * 1.4) * 0.55; });
      Y.seesaw.rotation.z = Math.sin(t * 1.7) * 0.25;
      Y.carousel.rotation.y = t * 0.9;
      Y.lampMat.color.copy(dayLamp).lerp(nightLamp, night);
      animate(Y.crowd, t);
      for (const f of FLOORS) if (f.crowd && f.interior.visible) animate(f.crowd, t);
    },
  };
}
