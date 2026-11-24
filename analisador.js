/* Grafo neon — leitura de imports no navegador.
   Mesma lógica do grafo_neon.py, para Python, PHP, Kotlin/Java e JS/TS.
   Entrada: lista de { caminho, texto }. Saída: { titulo, nos, arestas, ling, lidos }. */
(function () {
'use strict';
const G = window.GrafoNeon = window.GrafoNeon || {};

const PASTAS_IGNORADAS = new Set([
  '.git', '.github', '.gradle', '.idea', '.vscode', 'node_modules', 'vendor',
  'build', 'dist', 'out', 'target', '__pycache__', '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.pytest_cache', 'storage', 'coverage', '.next',
  '.nuxt', 'generated', 'site-packages',
]);
const PASTAS_TESTE = new Set(['test', 'tests', 'testing', 'androidTest', '__tests__', 'spec']);
const RE_ARQ_TESTE = /^(test_.*\.py|.*_test\.py|conftest\.py|.*Tests?\.(kt|java|php)|.*\.(test|spec)\.[jt]sx?)$/;
const EXTENSOES = {
  '.py': 'python', '.php': 'php', '.kt': 'jvm', '.java': 'jvm',
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js',
};
const NOME_LING = { python: 'Python', php: 'PHP', jvm: 'Kotlin/Java', js: 'JS/TS' };

const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const basename = p => p.slice(p.lastIndexOf('/') + 1);
const semExt = p => p.replace(/\.[^./]+$/, '');
const relativo = (c, raiz) => (raiz ? c.slice(raiz.length + 1) : c);
function normalizar(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s);
  }
  return out.join('/');
}

/** Linguagem do arquivo, ou null se ele deve ser ignorado. `caminho` é relativo à pasta analisada. */
G.linguagem = function (caminho, semTestes) {
  const partes = caminho.split('/'), nome = partes.pop();
  for (const d of partes) {
    if (PASTAS_IGNORADAS.has(d) || d.startsWith('.') || (semTestes && PASTAS_TESTE.has(d))) return null;
  }
  if (/\.(blade\.php|d\.ts|min\.js)$/.test(nome)) return null;
  const m = nome.match(/\.[^.]+$/), ling = m && EXTENSOES[m[0]];
  if (!ling || (semTestes && RE_ARQ_TESTE.test(nome))) return null;
  return ling;
};

/* ------------------------------------------------------------ Python */
function nomesPy(c, raiz, existe) {
  let topo = dirname(c);
  while (topo && existe(topo + '/__init__.py')) topo = dirname(topo);
  const pont = base => {
    const ps = semExt(base ? c.slice(base.length + 1) : c).split('/');
    if (ps[ps.length - 1] === '__init__') ps.pop();
    return ps.join('.');
  };
  return [pont(topo), pont(raiz)];
}

function importsPy(texto) {
  const t = texto.replace(/("""|''')[\s\S]*?\1/g, '""').replace(/#[^\n]*/g, '');
  const res = [];
  for (const m of t.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm)) {
    for (const parte of m[1].split(',')) {
      const n = parte.trim().split(/\s+as\s+/)[0].trim();
      if (/^[\w.]+$/.test(n)) res.push({ abs: n });
    }
  }
  for (const m of t.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]*)/gm)) {
    const nomes = m[3].replace(/[()\\]/g, ' ').split(',')
      .map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(x => /^(\w+|\*)$/.test(x));
    res.push({ nivel: m[1].length, modulo: m[2], nomes });
  }
  return res;
}

function analisarPython(itens, ctx, nos, ligar) {
  const mapa = new Map(), info = new Map();
  for (const it of itens) {
    const [pkg, rel] = nomesPy(it.caminho, ctx.raiz, ctx.existe);
    info.set(it.i, [pkg || rel || semExt(basename(it.caminho)), basename(it.caminho) === '__init__.py']);
    nos[it.i].partes = (pkg || rel || ctx.titulo).split('.');
    nos[it.i].sep = '.';
  }
  for (const prioridade of [0, 1]) {
    for (const it of itens) {
      // dentro de um pacote (pasta com __init__.py) só vale o nome completo:
      // assim "import warnings" da biblioteca padrão não cai em _pytest/warnings.py
      const d = dirname(it.caminho);
      if (prioridade === 1 && ctx.existe((d ? d + '/' : '') + '__init__.py')) continue;
      const nome = nomesPy(it.caminho, ctx.raiz, ctx.existe)[prioridade];
      if (nome && !mapa.has(nome)) mapa.set(nome, it.i);
    }
  }
  const resolver = nome => {
    const partes = nome.split('.');
    while (partes.length) {
      const alvo = mapa.get(partes.join('.'));
      if (alvo !== undefined) return alvo;
      partes.pop();
    }
    return undefined;
  };
  for (const it of itens) {
    const [pkg, ehInit] = info.get(it.i);
    for (const imp of importsPy(it.texto)) {
      if (imp.abs) { ligar(it.i, resolver(imp.abs)); continue; }
      let base;
      if (imp.nivel) {
        let b = ehInit ? pkg.split('.') : pkg.split('.').slice(0, -1);
        if (imp.nivel > 1) b = b.slice(0, Math.max(0, b.length - (imp.nivel - 1)));
        base = b.concat(imp.modulo ? imp.modulo.split('.') : []).filter(Boolean).join('.');
      } else base = imp.modulo;
      for (const n of imp.nomes) {
        const cheio = base ? base + '.' + n : n;
        const alvo = mapa.get(cheio);
        ligar(it.i, alvo !== undefined ? alvo : (base ? resolver(base) : undefined));
      }
    }
  }
}

/* ------------------------------------------------------------ PHP */
const RE_PHP_NS = /^\s*namespace\s+([\w\\]+)\s*[;{]/m;
const RE_PHP_TIPO = /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm;
const RE_PHP_USE = /^\s*use\s+([^;{]+(?:\{[^}]*\})?)\s*;/gm;
const RE_PHP_FQ = /\\?((?:[A-Za-z_]\w*\\)+[A-Za-z_]\w*)/g;
const RE_MAIUSC = /\b([A-Z]\w*)\b/g;

function analisarPhp(itens, ctx, nos, ligar) {
  const fq = new Map(), curto = new Map(), nsDe = new Map();
  for (const it of itens) {
    const m = it.texto.match(RE_PHP_NS), ns = m ? m[1] : '';
    nsDe.set(it.i, ns);
    const tipos = [...it.texto.matchAll(RE_PHP_TIPO)].map(x => x[1]);
    for (const t of tipos) {
      const k = ns ? ns + '\\' + t : t;
      if (!fq.has(k)) fq.set(k, it.i);
      if (!curto.has(ns + '|' + t)) curto.set(ns + '|' + t, it.i);
    }
    nos[it.i].partes = tipos.length ? (ns ? ns.split('\\') : []).concat(tipos[0])
      : semExt(relativo(it.caminho, ctx.raiz)).split('/');
    nos[it.i].sep = '/';
  }
  for (const it of itens) {
    const ns = nsDe.get(it.i), apelidos = new Map();
    for (const m of it.texto.matchAll(RE_PHP_USE)) {
      const trecho = m[1].trim().replace(/^(function|const)\s+/, '');
      let lista;
      if (trecho.includes('{')) {
        const [pre, dentro] = trecho.split('{');
        const prefixo = pre.trim().replace(/\\+$/, '');
        lista = dentro.replace(/\}$/, '').split(',').map(x => x.trim()).filter(Boolean).map(x => prefixo + '\\' + x);
      } else lista = trecho.split(',');
      for (const item of lista) {
        const partes = item.trim().split(/\s+as\s+/i);
        const nome = partes[0].trim().replace(/^\\/, '');
        const apelido = partes.length > 1 ? partes[1].trim() : nome.split('\\').pop();
        let alvo;
        if (nome.includes('\\')) { alvo = fq.get(nome); apelidos.set(apelido, alvo); }
        else alvo = apelidos.has(nome) ? apelidos.get(nome) : curto.get(ns + '|' + nome);
        ligar(it.i, alvo);
      }
    }
    for (const m of it.texto.matchAll(RE_PHP_FQ)) ligar(it.i, fq.get(m[1]));
    for (const nome of new Set([...it.texto.matchAll(RE_MAIUSC)].map(x => x[1]))) ligar(it.i, curto.get(ns + '|' + nome));
  }
}

/* ------------------------------------------------------------ Kotlin / Java */
const RE_JVM_PKG = /^\s*package\s+([\w.]+)/m;
const RE_JVM_TIPO = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|internal|abstract|final|open|sealed|data|enum|annotation|inner|value|static|fun)\s+)*(?:class|interface|object|enum|record|@interface)\s+(\w+)/gm;
const RE_KT_FUN = /^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|inline|suspend|tailrec|operator|infix)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+(?:<[^>]*>)?\??\.)?(\w+)\s*\(/gm;
const RE_KT_VAL = /^(?:(?:public|internal|private|const)\s+)*va[lr]\s+(\w+)/gm;
const RE_JVM_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+)/gm;
const RE_COMENTARIO = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"/g;
const RE_IDENT = /\b([A-Za-z_]\w*)\b/g;
const RE_JVM_FQ = /\b((?:[a-z_]\w*\.)+[A-Za-z_]\w*)/g;

function analisarJvm(itens, ctx, nos, ligar) {
  const fq = new Map(), curto = new Map(), pkgDe = new Map();
  for (const it of itens) {
    const m = it.texto.match(RE_JVM_PKG), pkg = m ? m[1] : '';
    pkgDe.set(it.i, pkg);
    const stem = semExt(basename(it.caminho));
    let nomes = [stem, ...[...it.texto.matchAll(RE_JVM_TIPO)].map(x => x[1])];
    if (it.caminho.endsWith('.kt')) {
      nomes = nomes.concat([...it.texto.matchAll(RE_KT_FUN)].map(x => x[1]), [...it.texto.matchAll(RE_KT_VAL)].map(x => x[1]));
    }
    for (const n of nomes) {
      const k = pkg ? pkg + '.' + n : n;
      if (!fq.has(k)) fq.set(k, it.i);
      if (!curto.has(pkg + '|' + n)) curto.set(pkg + '|' + n, it.i);
    }
    nos[it.i].partes = (pkg ? pkg.split('.') : []).concat(stem);
    nos[it.i].sep = '.';
  }
  for (const it of itens) {
    const pkg = pkgDe.get(it.i);
    for (const m of it.texto.matchAll(RE_JVM_IMPORT)) {
      const partes = m[1].replace(/\.$/, '').split('.');
      while (partes.length) {
        const alvo = fq.get(partes.join('.'));
        if (alvo !== undefined) { ligar(it.i, alvo); break; }
        partes.pop();
      }
    }
    const limpo = it.texto.replace(RE_COMENTARIO, ' ');
    for (const nome of new Set([...limpo.matchAll(RE_JVM_FQ)].map(x => x[1]))) ligar(it.i, fq.get(nome));
    for (const nome of new Set([...limpo.matchAll(RE_IDENT)].map(x => x[1]))) ligar(it.i, curto.get(pkg + '|' + nome));
  }
}

/* ------------------------------------------------------------ JS / TS */
const RE_JS_IMP = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXT_JS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function analisarJs(itens, ctx, nos, ligar) {
  const porCaminho = new Map();
  for (const it of itens) {
    porCaminho.set(it.caminho, it.i);
    const partes = semExt(relativo(it.caminho, ctx.raiz)).split('/');
    if (partes.length > 1 && partes[partes.length - 1] === 'index') partes.pop();
    nos[it.i].partes = partes;
    nos[it.i].sep = '/';
  }
  for (const it of itens) {
    for (const m of it.texto.matchAll(RE_JS_IMP)) {
      const spec = m[1] || m[2] || m[3];
      let base;
      if (spec.startsWith('.')) base = normalizar(dirname(it.caminho) + '/' + spec);
      else if (spec.startsWith('@/') || spec.startsWith('~/')) base = normalizar((ctx.raiz ? ctx.raiz + '/' : '') + 'src/' + spec.slice(2));
      else continue;
      if (!base) continue;
      const cand = EXT_JS.map(e => base + e).concat(EXT_JS.slice(1).map(e => base + '/index' + e));
      for (const c of cand) {
        const alvo = porCaminho.get(c);
        if (alvo !== undefined) { ligar(it.i, alvo); break; }
      }
    }
  }
}

const ANALISADORES = { python: analisarPython, php: analisarPhp, jvm: analisarJvm, js: analisarJs };

/* ------------------------------------------------------------ montagem */
function nomesCurtos(nos) {
  const k = nos.map(() => 1);
  let rot, cont;
  for (;;) {
    rot = nos.map((n, i) => n.partes.slice(-k[i]).join(n.sep) || n.caminho);
    cont = new Map();
    for (const r of rot) cont.set(r, (cont.get(r) || 0) + 1);
    let mudou = false;
    rot.forEach((r, i) => { if (cont.get(r) > 1 && k[i] < nos[i].partes.length) { k[i]++; mudou = true; } });
    if (!mudou) break;
  }
  const vistos = new Map();
  return rot.map((r, i) => {
    vistos.set(r, (vistos.get(r) || 0) + 1);
    return cont.get(r) > 1 && vistos.get(r) > 1 ? r + ' (' + nos[i].caminho + ')' : r;
  });
}

/**
 * arquivos: [{ caminho, texto }] com caminho relativo à raiz do repositório.
 * opcoes: { titulo, raiz (subpasta analisada, '' para o repo todo), existe(caminho) → bool, maxNos }
 */
G.analisar = function (arquivos, opcoes) {
  const raiz = (opcoes.raiz || '').replace(/^\/+|\/+$/g, '');
  const ctx = { raiz, titulo: opcoes.titulo || 'projeto', existe: opcoes.existe || (() => false) };
  const lista = arquivos.slice().sort((a, b) => (a.caminho < b.caminho ? -1 : 1));
  const nos = [], porLing = {};
  lista.forEach((a, i) => {
    const ling = G.linguagem(relativo(a.caminho, raiz), false);
    nos.push({ caminho: a.caminho, ling, partes: [semExt(basename(a.caminho))], sep: '/' });
    if (ling) (porLing[ling] = porLing[ling] || []).push({ i, caminho: a.caminho, texto: a.texto || '' });
  });
  const arestas = new Set();
  const ligar = (a, b) => { if (b !== undefined && b !== null && a !== b) arestas.add(a * 1e6 + b); };
  for (const ling of Object.keys(porLing)) ANALISADORES[ling](porLing[ling], ctx, nos, ligar);

  const pares = [...arestas].map(x => [Math.floor(x / 1e6), x % 1e6]);
  const grau = new Map();
  for (const [a, b] of pares) { grau.set(a, (grau.get(a) || 0) + 1); grau.set(b, (grau.get(b) || 0) + 1); }
  let manter = [...grau.keys()];
  const maxNos = opcoes.maxNos || 600;
  if (manter.length > maxNos) {
    manter = manter.sort((a, b) => grau.get(b) - grau.get(a)).slice(0, maxNos);
    const conj = new Set(manter), g2 = new Map();
    for (const [a, b] of pares) if (conj.has(a) && conj.has(b)) { g2.set(a, (g2.get(a) || 0) + 1); g2.set(b, (g2.get(b) || 0) + 1); }
    manter = manter.filter(i => g2.has(i));
  }
  manter.sort((a, b) => a - b);
  const novo = new Map(manter.map((v, j) => [v, j]));
  const nosF = manter.map(i => nos[i]);
  const rotulos = nomesCurtos(nosF);
  const arestasF = pares.filter(([a, b]) => novo.has(a) && novo.has(b))
    .map(([a, b]) => [novo.get(a), novo.get(b)]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const contLing = {};
  for (const n of nosF) contLing[NOME_LING[n.ling]] = (contLing[NOME_LING[n.ling]] || 0) + 1;
  return {
    titulo: ctx.titulo,
    nos: nosF.map((n, j) => ({ n: rotulos[j], c: n.caminho, l: n.ling })),
    arestas: arestasF,
    ling: Object.fromEntries(Object.entries(contLing).sort((a, b) => b[1] - a[1])),
    lidos: lista.length,
  };
};
})();
