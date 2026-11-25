/* Grafo neon — desenho do grafo de dependências em Canvas, no estilo raio neon.
   Usado pelo site (index.html) e pelas páginas geradas pelo grafo_neon.py.
   API: GrafoNeon.montar(D) → { destruir() }, com D = { titulo, nos:[{n,c,l}], arestas:[[a,b]], ling, url?, blob? }
   (a → b quer dizer "a importa b"). A página precisa ter os elementos com os ids usados abaixo. */
(function () {
'use strict';
const G = window.GrafoNeon = window.GrafoNeon || {};
const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
G.esc = esc;

const rng = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

G.montar = function (D) {
  const fig = $('fig'), cv = $('cv'), ctx = cv.getContext('2d');
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ac = new AbortController();
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  let vivo = true, rafId = 0, ro = null;
  const destruir = () => { vivo = false; ac.abort(); if (ro) ro.disconnect(); cancelAnimationFrame(rafId); };
  const N = D.nos.length, A = D.arestas, E = A.length;

  // estado da página
  fig.querySelectorAll('.vazio-fig').forEach(n => n.remove());
  $('ficha').hidden = true; $('limpar').hidden = true; $('busca').value = '';
  $('titulo').textContent = D.titulo;
  document.title = D.titulo + ' · Grafo neon';
  $('meta').textContent = N + ' arquivos · ' + E + ' dependências' +
    Object.entries(D.ling || {}).map(([k, v]) => ' · ' + k + ' ' + v).join('');
  const origem = $('origem');
  if (origem) { origem.hidden = !D.url; if (D.url) origem.href = D.url; }

  if (!E) {
    const m = document.createElement('div');
    m.className = 'vazio-fig';
    m.textContent = 'Não encontrei imports entre os arquivos deste projeto.';
    fig.appendChild(m);
    fig.style.height = '';
    cv.hidden = true;
    $('formBusca').hidden = true;
    $('cadeia').textContent = '';
    return { destruir };
  }
  cv.hidden = false;
  $('formBusca').hidden = false;

  /* ---------- estrutura do grafo (não depende da semente) ---------- */
  const out = [], inn = [], outE = [];
  for (let i = 0; i < N; i++) { out.push([]); inn.push([]); outE.push([]); }
  A.forEach(([a, b], e) => { out[a].push(b); inn[b].push(a); outE[a].push(e); });
  const grau = i => out[i].length + inn[i].length;

  // quebra ciclos com DFS: arestas de volta ficam fora do "dag"
  const dag = new Uint8Array(E).fill(1), cor = new Uint8Array(N);
  const ordem = [...Array(N).keys()].sort((a, b) => inn[a].length - inn[b].length || out[b].length - out[a].length);
  for (const s of ordem) {
    if (cor[s]) continue;
    cor[s] = 1;
    const pilha = [[s, 0]];
    while (pilha.length) {
      const t = pilha[pilha.length - 1], u = t[0];
      if (t[1] < outE[u].length) {
        const e = outE[u][t[1]++], v = A[e][1];
        if (cor[v] === 1) dag[e] = 0;
        else if (!cor[v]) { cor[v] = 1; pilha.push([v, 0]); }
      } else { cor[u] = 2; pilha.pop(); }
    }
  }
  // ordem topológica, camada (de cima) e altura (até a base)
  const gIn = new Int32Array(N);
  for (let e = 0; e < E; e++) if (dag[e]) gIn[A[e][1]]++;
  const topo = [];
  for (let i = 0; i < N; i++) if (!gIn[i]) topo.push(i);
  for (let k = 0; k < topo.length; k++)
    for (const e of outE[topo[k]]) if (dag[e] && --gIn[A[e][1]] === 0) topo.push(A[e][1]);
  const L = new Int32Array(N), h = new Int32Array(N);
  for (const u of topo) for (const e of outE[u]) if (dag[e]) { const v = A[e][1]; if (L[u] + 1 > L[v]) L[v] = L[u] + 1; }
  for (let k = topo.length - 1; k >= 0; k--) {
    const u = topo[k];
    for (const e of outE[u]) if (dag[e]) { const v = A[e][1]; if (h[v] + 1 > h[u]) h[u] = h[v] + 1; }
  }
  // tronco = maior cadeia de imports
  let raiz = 0;
  for (let i = 1; i < N; i++) if (h[i] > h[raiz] || (h[i] === h[raiz] && grau(i) > grau(raiz))) raiz = i;
  const tronco = [raiz], tpos = new Int32Array(N).fill(-1);
  tpos[raiz] = 0;
  for (let u = raiz; h[u] > 0;) {
    let m = -1;
    for (const e of outE[u]) if (dag[e]) { const v = A[e][1]; if (h[v] === h[u] - 1 && (m < 0 || grau(v) > grau(m))) m = v; }
    if (m < 0) break;
    tpos[m] = tronco.length; tronco.push(m); u = m;
  }
  // arquivos que ninguém importa descem para perto do que importam
  const temPai = new Uint8Array(N);
  for (let e = 0; e < E; e++) if (dag[e]) temPai[A[e][1]] = 1;
  for (let i = 0; i < N; i++) if (!temPai[i] && tpos[i] < 0) {
    let m = Infinity;
    for (const e of outE[i]) if (dag[e]) m = Math.min(m, L[A[e][1]]);
    if (m < Infinity) L[i] = Math.max(0, m - 1);
  }
  const nL = Math.max(2, tronco.length);

  // imports circulares (só os que rodam no carregamento)
  const cic = G.ciclos(N, A), tamComp = new Int32Array(N);
  for (let i = 0; i < N; i++) tamComp[cic.comp[i]]++;
  const cicloE = new Uint8Array(E);
  for (let e = 0; e < E; e++) { const [a, b, leve] = A[e]; if (!leve && cic.comp[a] === cic.comp[b] && tamComp[cic.comp[a]] > 1) cicloE[e] = 1; }
  const grupoDe = new Map();
  cic.grupos.forEach(gr => { for (const i of gr.nos) grupoDe.set(i, gr); });
  let modoCiclos = false;
  const nomeBtn = i => '<button type="button" class="chip mini" data-i="' + i + '">' + esc(D.nos[i].n) + '</button>';
  const secC = $('ciclos');
  if (secC) {
    const tot = cic.grupos.reduce((s, gr) => s + gr.nos.length, 0);
    $('ciclosResumo').textContent = cic.grupos.length
      ? cic.grupos.length + (cic.grupos.length > 1 ? ' grupos de arquivos se importam' : ' grupo de arquivos se importa') + ' em círculo (' + tot + ' arquivos, fios vermelhos). Em Python e JS isso pode quebrar a importação conforme a ordem; em qualquer linguagem, indica acoplamento forte.'
      : 'Nenhum import circular: nenhum grupo de arquivos se importa em círculo no carregamento.';
    $('ciclosLista').innerHTML = cic.grupos.slice(0, 6).map(gr =>
      '<li><b>' + gr.nos.length + ' arquivos:</b> ' + gr.caminho.map(nomeBtn).join(' <span class="seta">→</span> ') + '</li>').join('') +
      (cic.grupos.length > 6 ? '<li class="vazio">e mais ' + (cic.grupos.length - 6) + ' grupos</li>' : '');
    const bc = $('btnCiclos');
    bc.hidden = !cic.grupos.length; bc.setAttribute('aria-pressed', 'false'); bc.textContent = 'Destacar ciclos';
  }
  $('cadeia').innerHTML = '<b>Maior cadeia (' + tronco.length + ' arquivos):</b> ' + tronco.map(i => esc(D.nos[i].n)).join(' → ');
  $('lista').innerHTML = D.nos.map(n => '<option value="' + esc(n.n) + '">').join('');

  /* ---------- posições (dependem da semente) ---------- */
  let semente = 1 + Math.floor(Math.random() * 1e6);
  const X = new Float64Array(N), Y = new Float64Array(N);

  function posicionar() {
    const R = rng(semente);
    const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * R()); };
    const fase = R() * 6.28, fase2 = R() * 6.28, inclina = (R() - 0.5) * 0.14, tl = tronco.length;
    const jit = 0.42 / (nL - 1);
    for (let i = 0; i < N; i++) {
      if (tpos[i] >= 0) {
        const t = tl > 1 ? tpos[i] / (tl - 1) : 0;
        Y[i] = t;
        X[i] = 0.5 + inclina * (t - 0.35) + 0.04 * Math.sin(t * 4.5 + fase) + 0.018 * Math.sin(t * 11 + fase2);
      } else {
        Y[i] = Math.min(0.99, Math.max(0.03, L[i] / (nL - 1) + (R() * 2 - 1) * jit));
        X[i] = 0.5 + gauss() * 0.2;
      }
    }
    for (let it = 0; it < 30; it++) {
      for (let i = 0; i < N; i++) {
        if (tpos[i] >= 0) continue;
        let s = 0, c = 0;
        for (const v of out[i]) { s += X[v]; c++; }
        for (const v of inn[i]) { s += X[v]; c++; }
        X[i] = X[i] * 0.65 + (s / c) * 0.35 + gauss() * 0.02;
      }
      let m = 0, c = 0, q = 0;
      for (let i = 0; i < N; i++) if (tpos[i] < 0) { m += X[i]; c++; }
      if (!c) break;
      m /= c;
      for (let i = 0; i < N; i++) if (tpos[i] < 0) q += (X[i] - m) ** 2;
      const k = q > 1e-9 ? 0.24 / Math.sqrt(q / c) : 1;
      for (let i = 0; i < N; i++) if (tpos[i] < 0) X[i] = 0.5 + (X[i] - m) * k;
    }
    for (let i = 0; i < N; i++) {
      if (tpos[i] >= 0) continue;
      const y = Math.min(1, Y[i] / 0.3), cone = 0.3 + 0.7 * y * y * (3 - 2 * y);
      X[i] = 0.5 + 0.4 * Math.tanh((X[i] - 0.5) * cone / 0.4);
    }
  }

  /* ---------- desenho ---------- */
  const base = document.createElement('canvas'), brilho = document.createElement('canvas');
  let W = 0, H = 0, dpr = 1, s = 1, PX = null, PY = null, sel = -1, foco = null, rotulos = [];

  function tamanho() {
    W = fig.clientWidth;
    H = Math.round(Math.max(480, W * 1.3));
    fig.style.height = H + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cv, base, brilho]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    s = Math.max(0.5, W / 850);
  }

  function calcFoco(i) {
    const desc = new Set([i]), q = [i];
    while (q.length) { const u = q.pop(); for (const v of out[u]) if (!desc.has(v)) { desc.add(v); q.push(v); } }
    const ar = new Uint8Array(E);
    for (let e = 0; e < E; e++) { const [a, b] = A[e]; if ((desc.has(a) && desc.has(b)) || b === i) ar[e] = 1; }
    return { desc, ar };
  }

  function linha(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
    g.stroke();
  }

  function desenhar() {
    const t = H * 0.045, b = H * 0.04;
    PX = new Float64Array(N); PY = new Float64Array(N);
    for (let i = 0; i < N; i++) { PX[i] = X[i] * W; PY[i] = t + Y[i] * (H - t - b); }
    const R = rng(semente * 7 + 13);
    const g = base.getContext('2d'), gb = brilho.getContext('2d');
    for (const c of [g, gb]) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1; c.shadowBlur = 0;
      c.globalCompositeOperation = 'source-over'; c.lineCap = 'round'; c.lineJoin = 'round';
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    gb.clearRect(0, 0, W, H);
    const alfa = e => (foco ? (foco.ar[e] ? 1 : 0.22) : modoCiclos ? (cicloE[e] ? 1 : 0.12) : 1);

    // poeira de fundo
    const nb = Math.round(170 * W * H / (850 * 1100));
    g.lineWidth = 1; g.strokeStyle = 'rgba(120,90,155,0.24)';
    for (let i = 0; i < nb; i++) {
      const x = R() * W, y = R() * H, a = R() * 6.28, l = (8 + R() * 22) * Math.max(s, 0.7);
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 1) * l * 0.6, y + Math.sin(a + 1) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }

    // geometria dos fios (vários filamentos por import quando o projeto é pequeno)
    const F = Math.max(1, Math.min(4, Math.round(900 / E)));
    const geo = new Float32Array(E * F * 8), j = 3 * s;
    for (let e = 0; e < E; e++) {
      const [a, bb] = A[e], x0 = PX[a], y0 = PY[a], x3 = PX[bb], y3 = PY[bb];
      const dy = y3 - y0, ady = Math.abs(dy), raso = ady < 12 ? 28 * s : 0;
      const amp = W * (0.06 + 0.3 * Math.min(1, ady / (H * 0.45))) * (dag[e] ? 1 : 1.4);
      for (let f = 0; f < F; f++) {
        const k = (e * F + f) * 8;
        geo[k] = x0 + (R() - 0.5) * j; geo[k + 1] = y0 + (R() - 0.5) * j;
        geo[k + 2] = x0 + (R() * 2 - 1) * amp; geo[k + 3] = y0 + dy * (0.25 + R() * 0.2) - raso;
        geo[k + 4] = x3 + (R() * 2 - 1) * amp; geo[k + 5] = y3 - dy * (0.25 + R() * 0.2) - raso;
        geo[k + 6] = x3 + (R() - 0.5) * j; geo[k + 7] = y3 + (R() - 0.5) * j;
      }
    }
    const curva = k => {
      g.beginPath(); g.moveTo(geo[k], geo[k + 1]);
      g.bezierCurveTo(geo[k + 2], geo[k + 3], geo[k + 4], geo[k + 5], geo[k + 6], geo[k + 7]); g.stroke();
    };
    const ponto = (k, tt) => {
      const u = 1 - tt;
      return [u * u * u * geo[k] + 3 * u * u * tt * geo[k + 2] + 3 * u * tt * tt * geo[k + 4] + tt * tt * tt * geo[k + 6],
              u * u * u * geo[k + 1] + 3 * u * u * tt * geo[k + 3] + 3 * u * tt * tt * geo[k + 5] + tt * tt * tt * geo[k + 7]];
    };

    // ganchos grossos e pelos finos na borda da nuvem
    const ganchos = [], pelos = [];
    for (let i = 0; i < N; i++) {
      const dx = X[i] - 0.5, r1 = R(), r2 = R(), r3 = R();
      if (Math.abs(dx) > 0.08 && r1 < 0.7) {
        const sx = Math.sign(dx) || 1, l = (20 + r2 * 50) * s * 1.3, vy = r3 < 0.5 ? -1 : 1, x0 = PX[i], y0 = PY[i];
        ganchos.push([i, x0, y0, x0 + sx * l * 0.9, y0 + vy * l * 0.1, x0 + sx * l * 1.15, y0 + vy * l * 0.7, x0 + sx * l * 0.6, y0 + vy * l * 0.95]);
      }
    }
    function galho(x, y, ang, len, prof, dono) {
      const pts = [[x, y]];
      let a = ang;
      for (let k = 0; k < 4; k++) { a += (R() - 0.5) * 0.7; x += Math.cos(a) * len / 4; y += Math.sin(a) * len / 4; pts.push([x, y]); }
      pelos.push([dono, pts]);
      if (prof > 0) { const n = R() < 0.6 ? 2 : 1; for (let f = 0; f < n; f++) galho(x, y, a + (R() - 0.5) * 1.8, len * (0.45 + R() * 0.3), prof - 1, dono); }
    }
    for (const gc of ganchos) {
      const sx = Math.sign(gc[7] - gc[1]) || 1;
      galho(gc[7], gc[8], sx > 0 ? (R() - 0.5) : Math.PI + (R() - 0.5), (14 + R() * 26) * s * 1.4, 2, gc[0]);
    }
    for (let e = 0; e < E; e++) {
      const r = R(), tt = 0.35 + R() * 0.3, ang = R();
      if (r < 0.6) {
        const [x, y] = ponto(e * F * 8, tt);
        const dx = x - W / 2;
        if (Math.abs(dx) > W * 0.16) galho(x, y, (dx > 0 ? 0 : Math.PI) + (ang - 0.5) * 1.4, (12 + R() * 28) * s * 1.4, 2, -1 - e);
      }
    }

    // 1) tubos largos
    g.strokeStyle = 'rgba(140,92,200,0.15)'; g.lineWidth = Math.max(5, 11 * s);
    for (let e = 0; e < E; e++) { g.globalAlpha = alfa(e); curva(e * F * 8); }
    g.strokeStyle = 'rgba(150,104,212,0.34)'; g.lineWidth = Math.max(4, 9 * s);
    for (const gc of ganchos) {
      g.globalAlpha = foco ? (foco.desc.has(gc[0]) ? 1 : 0.22) : modoCiclos ? 0.15 : 1;
      g.beginPath(); g.moveTo(gc[1], gc[2]); g.bezierCurveTo(gc[3], gc[4], gc[5], gc[6], gc[7], gc[8]); g.stroke();
    }
    g.globalAlpha = 1;
    const rg = g.createRadialGradient(PX[raiz], PY[raiz], 0, PX[raiz], PY[raiz], 26 * s + 8);
    rg.addColorStop(0, 'rgba(205,160,255,0.75)'); rg.addColorStop(1, 'rgba(205,160,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(PX[raiz], PY[raiz], 26 * s + 8, 0, 6.2832); g.fill();

    // 2) brilho médio, 3) filamentos finos e um leve acúmulo de luz
    g.strokeStyle = 'rgba(175,105,230,0.07)'; g.lineWidth = Math.max(2, 4 * s);
    for (let e = 0; e < E; e++) { g.globalAlpha = alfa(e); for (let f = 0; f < F; f++) curva((e * F + f) * 8); }
    g.strokeStyle = 'rgba(226,112,255,0.5)'; g.lineWidth = Math.max(0.6, 1.0 * s);
    for (let e = 0; e < E; e++) { g.globalAlpha = alfa(e) * (A[e][2] ? 0.55 : 1); for (let f = 0; f < F; f++) curva((e * F + f) * 8); }
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,150,255,0.035)'; g.lineWidth = Math.max(0.6, 1.0 * s);
    for (let e = 0; e < E; e++) { g.globalAlpha = alfa(e); for (let f = 0; f < F; f++) curva((e * F + f) * 8); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(210,165,245,0.6)'; g.lineWidth = 0.7;
    for (const [dono, pts] of pelos) {
      g.globalAlpha = foco ? (dono >= 0 ? (foco.desc.has(dono) ? 1 : 0.2) : (foco.ar[-1 - dono] ? 1 : 0.2)) : modoCiclos ? 0.15 : 1;
      linha(g, pts);
    }
    g.globalAlpha = 1;

    // imports circulares em vermelho
    if (cic.grupos.length) {
      // traço escuro embaixo e vermelho por cima, sem soma de luz, para não virar rosa no meio do roxo
      for (const [cor, larg, sombra] of [['rgba(20,0,8,0.55)', 3.2, 0], ['#ff3b5c', modoCiclos ? 1.8 : 1.3, modoCiclos ? 10 : 6]]) {
        g.strokeStyle = cor; g.lineWidth = Math.max(0.9, larg * s);
        g.shadowColor = '#ff2d55'; g.shadowBlur = sombra;
        for (let e = 0; e < E; e++) if (cicloE[e]) { g.globalAlpha = foco && !foco.ar[e] ? 0.25 : 1; curva(e * F * 8); }
      }
      g.shadowBlur = 0; g.globalAlpha = 1;
    }

    // 4) tronco em raio
    const base0 = tronco.map(i => [PX[i], PY[i]]);
    if (base0.length < 2) base0.push([base0[0][0], base0[0][1] + H * 0.25]);
    const suave = [base0[0]];
    for (let k = 0; k < base0.length - 1; k++) {
      const p0 = base0[Math.max(0, k - 1)], p1 = base0[k], p2 = base0[k + 1], p3 = base0[Math.min(base0.length - 1, k + 2)];
      for (let q = 1; q <= 6; q++) {
        const t2 = q / 6, t3 = t2 * t2, t4 = t3 * t2;
        suave.push([0, 1].map(c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t2 + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t3 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t4)));
      }
    }
    // reamostra a curva em passos largos para o raio ter zigue-zague visível
    const passo = Math.max(22, H / 34), grosso = [suave[0]];
    let acum = 0;
    for (let k = 1; k < suave.length; k++) {
      acum += Math.hypot(suave[k][0] - suave[k - 1][0], suave[k][1] - suave[k - 1][1]);
      if (acum >= passo || k === suave.length - 1) { grosso.push(suave[k]); acum = 0; }
    }
    const raio = (pts, d, min) => {
      const res = [pts[0]];
      const sub = (a, c, n) => {
        const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy);
        if (l < min || n > 12) { res.push(c); return; }
        const off = (R() - 0.5) * l * d;
        const m = [(a[0] + c[0]) / 2 - dy / l * off, (a[1] + c[1]) / 2 + dx / l * off];
        sub(a, m, n + 1); sub(m, c, n + 1);
      };
      for (let k = 1; k < pts.length; k++) sub(pts[k - 1], pts[k], 0);
      return res;
    };
    const principal = raio(grosso, 0.5, 2.5 * Math.max(s, 0.6));
    const trancas = [0, 1, 2].map(() => raio(grosso, 0.75, 3));
    const forks = [];
    for (let k = 6; k < principal.length - 4; k += 9) {
      if (R() < 0.45) {
        const p = principal[k], ang = Math.PI / 2 + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.8), l = (12 + R() * 40) * s * 1.3;
        forks.push(raio([p, [p[0] + Math.cos(ang) * l, p[1] + Math.sin(ang) * l]], 0.6, 2));
      }
    }
    const aT = foco ? (tronco.some(i => foco.desc.has(i)) ? 1 : 0.35) : modoCiclos ? 0.12 : 1;
    for (const c of [g, gb]) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = c === g ? aT : 1;
      c.shadowColor = '#ff5cf4'; c.shadowBlur = 16 * s + 4;
      c.strokeStyle = 'rgba(255,110,245,0.5)'; c.lineWidth = 2.6 * s + 1; linha(c, principal);
      c.shadowBlur = 6 * s + 2;
      c.strokeStyle = 'rgba(255,150,250,0.55)'; c.lineWidth = 0.9;
      for (const tp of trancas) linha(c, tp);
      for (const fk of forks) linha(c, fk);
      c.strokeStyle = 'rgba(255,215,255,0.95)'; c.lineWidth = 1.5 * s + 0.6; linha(c, principal);
      c.shadowBlur = 0; c.strokeStyle = '#fff'; c.lineWidth = 0.8; linha(c, principal);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }

    // 5) destaque do arquivo escolhido
    if (foco) {
      g.globalCompositeOperation = 'lighter';
      g.shadowColor = '#ff5cf4'; g.shadowBlur = 8;
      g.strokeStyle = 'rgba(255,175,255,0.85)'; g.lineWidth = Math.max(1, 1.5 * s);
      for (let e = 0; e < E; e++) if (foco.ar[e]) curva(e * F * 8);
      g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';
      for (const i of foco.desc) {
        g.fillStyle = i === sel ? '#ff5cf4' : '#fff';
        g.beginPath(); g.arc(PX[i], PY[i], (i === sel ? 4 : 2.2) * Math.max(s, 0.8), 0, 6.2832); g.fill();
      }
      g.fillStyle = '#c9a6ff';
      for (const i of inn[sel]) { g.beginPath(); g.arc(PX[i], PY[i], 2.2 * Math.max(s, 0.8), 0, 6.2832); g.fill(); }
    }

    rotular(g);
  }

  function rotular(g) {
    const fs = Math.max(10, Math.min(12, W / 70)), gap = fs * 1.55, mg = 8;
    const max = Math.max(6, Math.min(26, Math.floor(H / (gap * 1.15))));
    let lista;
    if (foco) {
      const viz = [...out[sel], ...inn[sel]].sort((a, b) => grau(b) - grau(a));
      lista = [sel, ...viz.filter((v, k) => viz.indexOf(v) === k && v !== sel)].slice(0, max);
    } else if (modoCiclos) {
      lista = [...grupoDe.keys()].sort((a, b) => grau(b) - grau(a)).slice(0, max);
    } else {
      const fixos = [...new Set([raiz, tronco[tronco.length - 1]])];
      const resto = [...Array(N).keys()].filter(i => !fixos.includes(i)).sort((a, b) => grau(b) - grau(a));
      lista = fixos.concat(resto).slice(0, max);
    }
    g.font = fs + 'px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    const maxc = Math.max(10, Math.floor(W * 0.36 / (fs * 0.62)));
    const lados = [[], []];
    for (const i of lista) {
      const dx = X[i] - 0.5;
      const lado = Math.abs(dx) < 0.05 ? (lados[0].length <= lados[1].length ? 0 : 1) : (dx < 0 ? 0 : 1);
      lados[lado].push({ i, y: PY[i] });
    }
    rotulos = [];
    lados.forEach((ls, lado) => {
      ls.sort((a, b) => a.y - b.y);
      for (let k = 0; k < ls.length; k++) ls[k].ly = Math.max(ls[k].y, k ? ls[k - 1].ly + gap : fs);
      let lim = H - fs;
      for (let k = ls.length - 1; k >= 0; k--) { if (ls[k].ly > lim) ls[k].ly = lim; lim = ls[k].ly - gap; }
      for (const r of ls) {
        let t = D.nos[r.i].n;
        if (t.length > maxc) t = t.slice(0, maxc - 1) + '…';
        const tw = g.measureText(t).width, tx = lado ? W - mg - tw : mg, lx = lado ? tx - 5 : tx + tw + 5;
        g.strokeStyle = 'rgba(225,215,240,0.32)'; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(lx, r.ly); g.lineTo(PX[r.i], PY[r.i]); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath(); g.arc(PX[r.i], PY[r.i], 1.6, 0, 6.2832); g.fill();
        g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, tx, r.ly);
        g.fillStyle = r.i === sel ? '#ff8cf7' : modoCiclos ? '#ff9db0' : '#efe8f6'; g.fillText(t, tx, r.ly);
        rotulos.push({ i: r.i, x0: tx - 8, x1: tx + tw + 8, y0: r.ly - gap / 2, y1: r.ly + gap / 2 });
      }
    });
  }

  /* ---------- animação: revelação de cima para baixo e tremor do raio ---------- */
  let revela = 1, t0 = 0, ultimo = 0;
  function estatico() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3; ctx.drawImage(brilho, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function quadro(t) {
    if (!vivo) return;
    rafId = requestAnimationFrame(quadro);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (revela < 1) {
      if (!t0) t0 = t;
      revela = Math.min(1, (t - t0) / 1500);
      const e = 1 - (1 - revela) ** 3, hh = Math.max(1, Math.round(cv.height * e)), faixa = 46 * dpr;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(base, 0, 0, cv.width, hh, 0, 0, cv.width, hh);
      const gr = ctx.createLinearGradient(0, hh - faixa, 0, hh);
      gr.addColorStop(0, 'rgba(255,120,250,0)'); gr.addColorStop(1, 'rgba(255,170,255,0.3)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(0, hh - faixa, cv.width, faixa);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (t - ultimo < 70) return;
    ultimo = t;
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.random() < 0.04 ? 0.95 : 0.08 + Math.random() * 0.3;
    ctx.drawImage(brilho, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function mostrar(animado) {
    if (reduz) { estatico(); return; }
    if (animado) { revela = 0; t0 = 0; }
    ultimo = 0;
  }

  /* ---------- interação ---------- */
  function selecionar(i) {
    sel = i; foco = i >= 0 ? calcFoco(i) : null;
    if (i >= 0 && modoCiclos) { modoCiclos = false; const bc = $('btnCiclos'); bc.setAttribute('aria-pressed', 'false'); bc.textContent = 'Destacar ciclos'; }
    desenhar(); mostrar(false);
    $('limpar').hidden = i < 0;
    const f = $('ficha');
    if (i < 0) { f.hidden = true; return; }
    f.hidden = false;
    const no = D.nos[i], cam = $('fCam');
    $('fNome').textContent = no.n;
    cam.textContent = '';
    if (D.blob) {
      const a = document.createElement('a');
      a.href = D.blob + no.c.split('/').map(encodeURIComponent).join('/');
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = no.c + ' ↗';
      cam.appendChild(a);
    } else cam.textContent = no.c;
    $('fNum').textContent = 'importa ' + out[i].length + ' direto · puxa ' + (foco.desc.size - 1) + ' no total · usado por ' + inn[i].length;
    const fc = $('fCiclo');
    if (fc) {
      const gr = grupoDe.get(i);
      fc.hidden = !gr;
      if (gr) fc.innerHTML = 'Está num ciclo de ' + gr.nos.length + ' arquivos: ' + gr.caminho.map(nomeBtn).join(' <span class="seta">→</span> ');
    }
    const chips = ids => ids.slice().sort((a, b) => grau(b) - grau(a))
      .map(k => '<button type="button" class="chip" data-i="' + k + '">' + esc(D.nos[k].n) + '</button>').join('')
      || '<span class="vazio">nenhum</span>';
    $('fDeps').innerHTML = chips(out[i]);
    $('fUsos').innerHTML = chips(inn[i]);
  }
  on(cv, 'click', ev => {
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    for (const b of rotulos) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return selecionar(b.i);
    let m = -1, md = 26 * 26;
    for (let i = 0; i < N; i++) { const d = (PX[i] - x) ** 2 + (PY[i] - y) ** 2; if (d < md) { md = d; m = i; } }
    selecionar(m === sel ? -1 : m);
  });
  on($('ficha'), 'click', ev => { const b = ev.target.closest('.chip'); if (b) selecionar(+b.dataset.i); });
  on($('limpar'), 'click', () => selecionar(-1));
  if (secC) {
    on(secC, 'click', ev => {
      const b = ev.target.closest('.chip');
      if (b) { selecionar(+b.dataset.i); fig.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); return; }
      if (ev.target.closest('#btnCiclos')) {
        modoCiclos = !modoCiclos;
        const bc = $('btnCiclos');
        bc.setAttribute('aria-pressed', String(modoCiclos)); bc.textContent = modoCiclos ? 'Mostrar tudo' : 'Destacar ciclos';
        if (modoCiclos) { selecionar(-1); fig.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); } else { desenhar(); mostrar(false); }
      }
    });
  }
  on($('semente'), 'click', () => { semente = 1 + Math.floor(Math.random() * 1e6); posicionar(); desenhar(); mostrar(true); });
  const buscar = () => {
    const v = $('busca').value.trim().toLowerCase();
    if (!v) return;
    let i = D.nos.findIndex(n => n.n.toLowerCase() === v);
    if (i < 0) i = D.nos.findIndex(n => n.n.toLowerCase().includes(v) || n.c.toLowerCase().includes(v));
    if (i >= 0) { selecionar(i); fig.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth', block: 'start' }); }
  };
  on($('formBusca'), 'submit', ev => { ev.preventDefault(); buscar(); });
  on($('busca'), 'change', buscar);

  let largura = 0, primeira = true;
  ro = new ResizeObserver(() => {
    if (!vivo) return;
    const w = fig.clientWidth;
    if (Math.abs(w - largura) < 2) return;
    largura = w; tamanho(); desenhar(); mostrar(primeira); primeira = false;
  });
  posicionar();
  ro.observe(fig);
  if (!reduz) rafId = requestAnimationFrame(quadro);
  if (document.fonts) document.fonts.ready.then(() => { if (vivo && W) { desenhar(); mostrar(false); } });

  return { destruir };
};
})();
