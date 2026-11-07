const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const view = $('view');

let scene, camera, renderer, world, pathGroup;
let names = [], H = {}, adj = {}, edgeList = [], meshes = {}, lines = {};
let S, T, gen = null, timer = null, finished = false, ready = false;
let lastW = 0, lastH = 0;
const cam = {th: 0.7, ph: 1.15, r: 15};

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  view.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(5, 10, 7);
  scene.add(light);

  world = new THREE.Group();
  pathGroup = new THREE.Group();
  scene.add(world, pathGroup);

  setBg();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setBg);
  new ResizeObserver(resize).observe(view);
  resize();

  let drag = false, lx = 0, ly = 0;
  const cv = renderer.domElement;
    cv.addEventListener('pointerdown', e => {
    drag = true;
    lx = e.clientX;
    ly = e.clientY;
    $('auto').checked = false;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointerup', () => drag = false);
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.th -= (e.clientX - lx) * 0.008;
    cam.ph = Math.min(Math.PI - 0.2, Math.max(0.2, cam.ph - (e.clientY - ly) * 0.008));
    lx = e.clientX;
    ly = e.clientY;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    cam.r = Math.min(40, Math.max(5, cam.r + e.deltaY * 0.01));
  }, {passive: false});

  loop();
}

function setBg() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--scene').trim();
  scene.background = new THREE.Color(c || '#0b0d13');
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loop() {
  if ($('auto').checked) cam.th += 0.003;
  camera.position.set(
    cam.r * Math.sin(cam.ph) * Math.cos(cam.th),
    cam.r * Math.cos(cam.ph),
    cam.r * Math.sin(cam.ph) * Math.sin(cam.th)
  );
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function label(t1, t2, size) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  x.textAlign = 'center';
  x.lineJoin = 'round';
  x.lineWidth = 7;
  x.strokeStyle = '#000';
  x.fillStyle = '#fff';
  x.font = 'bold 56px sans-serif';
  x.strokeText(t1, 128, t2 ? 56 : 80);
  x.fillText(t1, 128, t2 ? 56 : 80);
  if (t2) {
    x.font = '36px sans-serif';
    x.fillStyle = '#ffd166';
    x.strokeText(t2, 128, 106);
    x.fillText(t2, 128, 106);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), depthTest: false}));
  s.scale.set(2 * size, size, 1);
  s.renderOrder = 10;
  return s;
}

function layout() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const P = {};
  names.forEach(n => P[n] = new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(6));
  const k = 2.8, iters = 300;

  for (let it = 0; it < iters; it++) {
    const F = {};
    names.forEach(n => F[n] = new THREE.Vector3());
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const d = P[names[i]].clone().sub(P[names[j]]);
        const l = Math.max(d.length(), 0.05);
        const f = d.multiplyScalar(k * k / (l * l));
        F[names[i]].add(f);
        F[names[j]].sub(f);
      }
    }
    edgeList.forEach(([a, b]) => {
      const d = P[a].clone().sub(P[b]);
      const f = d.multiplyScalar(d.length() / k);
      F[a].sub(f);
      F[b].add(f);
    });
    names.forEach(n => {
      F[n].sub(P[n].clone().multiplyScalar(0.05));
      P[n].add(F[n].clampLength(0, 0.3 * (1 - it / iters) + 0.02));
    });
  }

  const c = new THREE.Vector3();
  names.forEach(n => c.add(P[n]));
  c.multiplyScalar(1 / names.length);
  names.forEach(n => P[n].sub(c));
  return P;
}

function parse() {
  const nm = [], h = {};
  const err = m => { throw new Error(m); };

  $('nodes').value.trim().split('\n').forEach(l => {
    const p = l.trim().split(/[\s,]+/);
    if (p.length < 2 || !p[0]) return;
    const v = parseFloat(p[1]);
    if (!isFinite(v) || v < 0) err('Bad heuristic value for node ' + p[0]);
    if (h[p[0]] !== undefined) err('Duplicate node ' + p[0]);
    h[p[0]] = v;
    nm.push(p[0]);
  });
  if (nm.length < 2) err('Enter at least 2 nodes.');

  const ad = {}, el = [];
  nm.forEach(n => ad[n] = []);
  $('edges').value.trim().split('\n').forEach(l => {
    const p = l.trim().split(/[\s,]+/);
    if (p.length < 3 || !p[0]) return;
    const w = parseFloat(p[2]);
    if (!(p[0] in h) || !(p[1] in h)) err('Edge uses unknown node: ' + l.trim());
    if (!isFinite(w) || w <= 0) err('Edge cost must be positive: ' + l.trim());
    ad[p[0]].push([p[1], w]);
    ad[p[1]].push([p[0], w]);
    el.push([p[0], p[1], w]);
  });
  if (!el.length) err('Enter at least 1 edge.');

  const s = $('start').value.trim(), t = $('goal').value.trim();
  if (!(s in h)) err('Start node not found.');
  if (!(t in h)) err('Goal node not found.');
  return {nm, h, ad, el, s, t};
}

function warnAdmissible() {
  const d = {};
  names.forEach(n => d[n] = Infinity);
  d[T] = 0;
  const seen = new Set();
  while (seen.size < names.length) {
    let u = null;
    for (const n of names) if (!seen.has(n) && (u === null || d[n] < d[u])) u = n;
    if (d[u] === Infinity) break;
    seen.add(u);
    adj[u].forEach(([m, w]) => { if (d[u] + w < d[m]) d[m] = d[u] + w; });
  }
  const bad = names.filter(n => d[n] < Infinity && H[n] > d[n] + 1e-9);
  return bad.length
    ? 'Warning: h overestimates at ' + bad.join(', ') + ' (not admissible, so the path may not be optimal).'
    : '';
}

function clearWorld() {
  [world, pathGroup].forEach(g => {
    while (g.children.length) g.remove(g.children[0]);
  });
}

function build() {
  stop();
  $('msg').textContent = '';
  $('result').textContent = '';
  try {
    const r = parse();
    names = r.nm;
    H = r.h;
    adj = r.ad;
    edgeList = r.el;
    S = r.s;
    T = r.t;
  } catch (e) {
    $('msg').textContent = e.message;
    ready = false;
    return;
  }

  clearWorld();
  const P = layout();
  meshes = {};
  lines = {};

  edgeList.forEach(([a, b, w]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([P[a], P[b]]);
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({color: 0x6b7280}));
    world.add(ln);
    lines[[a, b].sort().join('|')] = ln;
    const wl = label(String(w), null, 0.8);
    wl.position.copy(P[a]).add(P[b]).multiplyScalar(0.5);
    world.add(wl);
  });

  names.forEach(n => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 24, 24),
      new THREE.MeshStandardMaterial({color: 0x8892a6})
    );
    m.position.copy(P[n]);
    world.add(m);
    meshes[n] = m;
    const l = label(n, 'h=' + H[n], 1.5);
    l.position.copy(P[n]).add(new THREE.Vector3(0, 0.95, 0));
    world.add(l);
  });

  gen = null;
  finished = false;
  ready = true;
  paint(null);
  $('openbox').textContent = '-';
  $('closedbox').textContent = '-';
  $('log').textContent = 'Graph built. Press Run or Step.';
  $('msg').textContent = warnAdmissible();
}

function* astar() {
  const g = {[S]: 0}, parent = {}, open = new Set([S]), closed = new Set();
  let n = 0;
  while (open.size) {
    let cur = null, bf = Infinity;
    for (const x of open) {
      const f = g[x] + H[x];
      if (f < bf || (f === bf && H[x] < H[cur])) {
        bf = f;
        cur = x;
      }
    }
    open.delete(cur);
    closed.add(cur);
    n++;

    if (cur === T) {
      const path = [cur];
      while (parent[path[0]] !== undefined) path.unshift(parent[path[0]]);
      yield {
        cur, open, closed, g, parent, path, done: true, cost: g[cur],
        msg: `#${n} Pop ${cur} (f=${bf}). It is the goal! Cost = ${g[cur]}.`
      };
      return;
    }

    const upd = [];
    for (const [m, w] of adj[cur]) {
      const ng = g[cur] + w;
      if (g[m] === undefined || ng < g[m]) {
        g[m] = ng;
        parent[m] = cur;
        closed.delete(m);
        open.add(m);
        upd.push(`${m}(g=${ng})`);
      }
    }
    yield {
      cur, open, closed, g, parent, done: false,
      msg: `#${n} Pop ${cur} (lowest f=${bf}). ` +
        (upd.length ? 'Updated: ' + upd.join(', ') : 'No better routes found.')
    };
  }
  yield {cur: null, open, closed, g, parent, path: null, done: true, msg: 'Open list is empty: no path exists.'};
}

function paint(st) {
  const pe = new Set();
  if (st && st.path) {
    for (let i = 0; i < st.path.length - 1; i++) {
      pe.add([st.path[i], st.path[i + 1]].sort().join('|'));
    }
  }

  names.forEach(n => {
    let c = 0x8892a6, sc = 1;
    if (st) {
      if (st.closed.has(n)) c = 0x3b82f6;
      if (st.open.has(n)) c = 0xf59e0b;
    }
    if (n === S) c = 0x22c55e;
    if (n === T) c = 0xef4444;
    if (st && st.path && st.path.includes(n)) c = 0xfacc15;
    if (st && n === st.cur) {
      c = 0xfde047;
      sc = 1.5;
    }
    const m = meshes[n];
    m.material.color.setHex(c);
    m.scale.setScalar(sc);
  });

  Object.keys(lines).forEach(k => lines[k].material.color.setHex(0x6b7280));
  if (st) {
    Object.keys(st.parent).forEach(m => {
      const k = [m, st.parent[m]].sort().join('|');
      if (lines[k]) lines[k].material.color.setHex(0x60a5fa);
    });
  }
  pe.forEach(k => lines[k].material.color.setHex(0xfacc15));
}

function drawPath(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = meshes[path[i]].position, b = meshes[path[i + 1]].position;
    const dir = b.clone().sub(a);
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 1, 12),
      new THREE.MeshStandardMaterial({color: 0xfacc15, emissive: 0x806600})
    );
    cyl.position.copy(a).add(b).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    cyl.scale.set(1, dir.length(), 1);
    pathGroup.add(cyl);
  }
}

function render(st) {
  paint(st);

  const rows = [...st.open]
    .map(n => ({n, g: st.g[n], f: st.g[n] + H[n]}))
    .sort((a, b) => a.f - b.f || H[a.n] - H[b.n]);
  $('openbox').innerHTML = rows.length
    ? rows.map(r => `${esc(r.n)}: g=${r.g} + h=${H[r.n]} = <b>f=${r.f}</b>`).join('<br>')
    : '(empty)';
  $('closedbox').textContent = st.closed.size ? [...st.closed].join(', ') : '-';

  const log = $('log');
  if (log.dataset.fresh !== '0') {
    log.innerHTML = '';
    log.dataset.fresh = '0';
  }
  const d = document.createElement('div');
  d.textContent = st.msg;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;

  if (st.done) {
    finished = true;
    stop();
    if (st.path) {
      drawPath(st.path);
      $('result').textContent = 'Shortest path: ' + st.path.join(' > ') + '   (cost ' + st.cost + ')';
    } else {
      $('result').textContent = 'No path from ' + S + ' to ' + T + '.';
    }
  }
}

function step() {
  if (!ready) build();
  if (!ready || finished) return;
  if (!gen) gen = astar();
  const r = gen.next();
  if (!r.done) render(r.value);
}

function tick() {
  step();
  if (timer !== null && !finished) timer = setTimeout(tick, 1700 - $('speed').value * 160);
}

function stop() {
  clearTimeout(timer);
  timer = null;
  $('run').textContent = 'Run';
}

$('run').onclick = () => {
  if (timer !== null) {
    stop();
    return;
  }
  if (!ready || finished) {
    build();
    if (!ready) return;
  }
  $('run').textContent = 'Pause';
  timer = setTimeout(tick, 100);
};

$('stepb').onclick = () => {
  stop();
  step();
};

$('build').onclick = () => {
  $('log').dataset.fresh = '1';
  build();
};

$('reset').onclick = () => {
  $('log').dataset.fresh = '1';
  build();
};

['nodes', 'edges', 'start', 'goal'].forEach(id => {
  $(id).addEventListener('input', () => {
    ready = false;
    stop();
  });
});

initThree();
build();