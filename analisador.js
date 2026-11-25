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
  '.nuxt', 'generated', 'site-packages', 'obj',
]);
const PASTAS_TESTE = new Set(['test', 'tests', 'testing', 'teste', 'testes', 'fixtures', 'androidTest', '__tests__', 'spec']);
const RE_ARQ_TESTE = /^(test_.*\.py|.*_test\.(py|go|dart)|conftest\.py|.*Tests?\.(kt|java|php|cs)|.*\.(test|spec)\.[jt]sx?)$/;
const EXTENSOES = {
  '.py': 'python', '.php': 'php', '.kt': 'jvm', '.java': 'jvm',
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js',
  '.dart': 'dart', '.go': 'go', '.rs': 'rust', '.cs': 'csharp',
  '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.cxx': 'c', '.hh': 'c', '.hpp': 'c', '.hxx': 'c',
};
const NOME_LING = {
  python: 'Python', php: 'PHP', jvm: 'Kotlin/Java', js: 'JS/TS',
  dart: 'Dart', go: 'Go', rust: 'Rust', csharp: 'C#', c: 'C/C++',
};
/** Arquivos de configuração que alguns analisadores leem (nome do pacote, do módulo, do crate). */
G.ehConfig = caminho => /(^|\/)(pubspec\.yaml|go\.mod|Cargo\.toml)$/.test(caminho);

const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const basename = p => p.slice(p.lastIndexOf('/') + 1);
const semExt = p => p.replace(/\.[^./]+$/, '');
const relativo = (c, raiz) => (raiz ? c.slice(raiz.length + 1) : c);
const junta = (d, r) => (d ? d + '/' + r : r);
/** Pasta mais próxima, subindo a partir de `dir`, que contém o arquivo `nome`; null se nenhuma. */
function ancestral(dir, nome, existe) {
  for (let d = dir; ; d = dirname(d)) {
    if (existe(junta(d, nome))) return d;
    if (!d) return null;
  }
}
const prefixoComum = (a, b) => {
  const x = a.split('/'), y = b.split('/');
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return k;
};
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
/* Pasta a partir da qual o nome do módulo é contado. Uma pasta sem __init__.py abaixo de um
   pacote ainda é subpacote (namespace), como flask/sansio. */
function topoPy(dir, existe) {
  let topo = dir;
  for (let d = dir; d; d = dirname(d)) if (existe(d + '/__init__.py')) topo = dirname(d);
  return topo;
}

function nomesPy(c, raiz, existe) {
  const topo = topoPy(dirname(c), existe);
  const pont = base => {
    const ps = semExt(base ? c.slice(base.length + 1) : c).split('/');
    if (ps[ps.length - 1] === '__init__') ps.pop();
    return ps.join('.');
  };
  return [pont(topo), pont(raiz)];
}

/* Marca as linhas "leves": dentro de def/lambda ou de `if TYPE_CHECKING:`.
   Usa a indentação, pulando linhas de continuação (dentro de parênteses). */
function linhasLevesPy(t) {
  const linhas = t.split('\n'), leve = new Uint8Array(linhas.length), pilha = [];
  let abertos = 0;
  for (let k = 0; k < linhas.length; k++) {
    const l = linhas[k], continua = abertos > 0;
    for (const ch of l) { if (ch === '(' || ch === '[' || ch === '{') abertos++; else if ((ch === ')' || ch === ']' || ch === '}') && abertos > 0) abertos--; }
    const m = l.match(/^([ \t]*)(\S.*)$/);
    if (continua || !m) { leve[k] = pilha.length ? 1 : 0; continue; }
    const ind = m[1].replace(/\t/g, '        ').length;
    while (pilha.length && pilha[pilha.length - 1] >= ind) pilha.pop();
    leve[k] = pilha.length ? 1 : 0;
    if (/^(async\s+def|def|lambda)\b|^if\s+(?:\w+\.)?TYPE_CHECKING\s*:/.test(m[2])) pilha.push(ind);
  }
  return leve;
}

function importsPy(texto) {
  const t = texto.replace(/("""|''')[\s\S]*?\1/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/#[^\n]*/g, '');
  const leve = linhasLevesPy(t), quebras = [];
  for (let k = t.indexOf('\n'); k >= 0; k = t.indexOf('\n', k + 1)) quebras.push(k);
  const linhaDe = pos => { let lo = 0, hi = quebras.length; while (lo < hi) { const md = (lo + hi) >> 1; if (quebras[md] < pos) lo = md + 1; else hi = md; } return lo; };
  const res = [];
  for (const m of t.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm)) {
    const lv = !!leve[linhaDe(m.index)];
    for (const parte of m[1].split(',')) {
      const n = parte.trim().split(/\s+as\s+/)[0].trim();
      if (/^[\w.]+$/.test(n)) res.push({ abs: n, leve: lv });
    }
  }
  for (const m of t.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]*)/gm)) {
    const nomes = m[3].replace(/[()\\]/g, ' ').split(',')
      .map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(x => /^(\w+|\*)$/.test(x));
    res.push({ nivel: m[1].length, modulo: m[2], nomes, leve: !!leve[linhaDe(m.index)] });
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
      if (prioridade === 1 && topoPy(d, ctx.existe) !== d) continue;
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
      if (imp.abs) { ligar(it.i, resolver(imp.abs), imp.leve); continue; }
      let base;
      if (imp.nivel) {
        let b = ehInit ? pkg.split('.') : pkg.split('.').slice(0, -1);
        if (imp.nivel > 1) b = b.slice(0, Math.max(0, b.length - (imp.nivel - 1)));
        base = b.concat(imp.modulo ? imp.modulo.split('.') : []).filter(Boolean).join('.');
      } else base = imp.modulo;
      for (const n of imp.nomes) {
        const cheio = base ? base + '.' + n : n;
        const alvo = mapa.get(cheio);
        ligar(it.i, alvo !== undefined ? alvo : (base ? resolver(base) : undefined), imp.leve);
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
    // nome curto do mesmo namespace: referência implícita, não é um "use" (leve)
    for (const nome of new Set([...it.texto.matchAll(RE_MAIUSC)].map(x => x[1]))) ligar(it.i, curto.get(ns + '|' + nome), true);
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
    // mesmo pacote: referência implícita, sem import (leve)
    for (const nome of new Set([...limpo.matchAll(RE_IDENT)].map(x => x[1]))) ligar(it.i, curto.get(pkg + '|' + nome), true);
  }
}

/* ------------------------------------------------------------ JS / TS */
const RE_JS_IMP = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_JS_TIPO = /^(?:import|export)\s+type\b/;
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
      // "import type" (TypeScript) some na compilação; import() é carregado depois: os dois são leves
      const leve = !!m[3] || RE_JS_TIPO.test(m[0]);
      let base;
      if (spec.startsWith('.')) base = normalizar(dirname(it.caminho) + '/' + spec);
      else if (spec.startsWith('@/') || spec.startsWith('~/')) base = normalizar((ctx.raiz ? ctx.raiz + '/' : '') + 'src/' + spec.slice(2));
      else continue;
      if (!base) continue;
      const cand = EXT_JS.map(e => base + e).concat(EXT_JS.slice(1).map(e => base + '/index' + e));
      for (const c of cand) {
        const alvo = porCaminho.get(c);
        if (alvo !== undefined) { ligar(it.i, alvo, leve); break; }
      }
    }
  }
}

/* ------------------------------------------------------------ Dart */
const RE_DART = /^\s*(import|export|part)\s+['"]([^'"]+)['"]([^;]*);/gm;

function analisarDart(itens, ctx, nos, ligar) {
  const porCaminho = new Map(itens.map(it => [it.caminho, it.i]));
  const pacotes = new Map();   // nome do pacote → pasta do pubspec.yaml
  for (const [c, texto] of ctx.textos) {
    if (basename(c) !== 'pubspec.yaml') continue;
    const m = texto.match(/^name:\s*["']?(\w+)/m);
    if (m && !pacotes.has(m[1])) pacotes.set(m[1], dirname(c));
  }
  for (const it of itens) { nos[it.i].partes = semExt(relativo(it.caminho, ctx.raiz)).split('/'); nos[it.i].sep = '/'; }
  for (const it of itens) {
    const t = it.texto.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    for (const m of t.matchAll(RE_DART)) {
      const spec = m[2];
      let alvo = null;
      if (spec.startsWith('dart:')) continue;
      if (spec.startsWith('package:')) {
        const r = spec.slice(8), k = r.indexOf('/');
        if (k < 0 || !pacotes.has(r.slice(0, k))) continue;
        alvo = normalizar(junta(pacotes.get(r.slice(0, k)), 'lib/' + r.slice(k + 1)));
      } else alvo = normalizar(junta(dirname(it.caminho), spec));
      // "deferred as" carrega a biblioteca só quando é usada: import leve
      if (alvo) ligar(it.i, porCaminho.get(alvo), /\bdeferred\b/.test(m[3]));
    }
  }
}

/* ------------------------------------------------------------ Go */
const RE_GO_PKG = /^package\s+(\w+)/m;
const RE_GO_BLOCO = /^import\s*\(([\s\S]*?)\)/gm;
const RE_GO_IMP = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
const RE_GO_DECL = /^(?:func\s+(\w+)\s*[([]|type\s+(\w+)|var\s+(\w+)|const\s+(\w+))/gm;
const RE_GO_GRUPO = /^(?:var|const|type)\s*\(([\s\S]*?)^\)/gm;
const GO_IGNORAR = new Set(['init', 'main', '_']);

function analisarGo(itens, ctx, nos, ligar) {
  const modulos = new Map();   // pasta do go.mod → caminho do módulo
  for (const [c, texto] of ctx.textos) {
    if (basename(c) !== 'go.mod') continue;
    const m = texto.match(/^module\s+(\S+)/m);
    if (m) modulos.set(dirname(c), m[1]);
  }
  const porDir = new Map(), declarados = new Map(), info = new Map();
  for (const it of itens) {
    const d = dirname(it.caminho);
    if (!porDir.has(d)) porDir.set(d, []);
    if (!it.caminho.endsWith('_test.go')) porDir.get(d).push(it.i);   // um import chega ao pacote, não aos testes dele
    nos[it.i].partes = semExt(relativo(it.caminho, ctx.raiz)).split('/'); nos[it.i].sep = '/';
    const t = it.texto.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    const m = t.match(RE_GO_PKG), chave = d + '|' + (m ? m[1] : '');
    if (!declarados.has(chave)) declarados.set(chave, new Map());
    const nomes = [...t.matchAll(RE_GO_DECL)].map(x => x[1] || x[2] || x[3] || x[4]);
    for (const g of t.matchAll(RE_GO_GRUPO)) for (const l of g[1].matchAll(/^[ \t]+(\w+)/gm)) nomes.push(l[1]);
    for (const n of nomes) if (!GO_IGNORAR.has(n) && !declarados.get(chave).has(n)) declarados.get(chave).set(n, it.i);
    info.set(it.i, { t, chave });
  }
  for (const it of itens) {
    const { t, chave } = info.get(it.i);
    const raizMod = ancestral(dirname(it.caminho), 'go.mod', ctx.existe), mod = raizMod === null ? undefined : modulos.get(raizMod);
    if (mod) {
      const caminhos = [];
      for (const b of t.matchAll(RE_GO_BLOCO)) for (const s of b[1].matchAll(/"([^"]+)"/g)) caminhos.push(s[1]);
      for (const s of t.matchAll(RE_GO_IMP)) caminhos.push(s[1]);
      for (const c of caminhos) {
        if (c !== mod && !c.startsWith(mod + '/')) continue;
        const dirAlvo = c === mod ? raizMod : junta(raizMod, c.slice(mod.length + 1));
        for (const j of porDir.get(dirAlvo) || []) ligar(it.i, j);
      }
    }
    // mesmo pacote: os arquivos da pasta se enxergam sem import (leve; Go nem permite ciclo de import)
    const decl = declarados.get(chave), semStr = t.replace(/"(?:\\.|[^"\\\n])*"|`[^`]*`/g, ' ');
    for (const nome of new Set([...semStr.matchAll(RE_IDENT)].map(x => x[1]))) ligar(it.i, decl.get(nome), true);
  }
}

/* ------------------------------------------------------------ C / C++ */
const RE_C_INC = /^[ \t]*#[ \t]*include[ \t]*([<"])([^">\n]+)[">]/gm;

function analisarC(itens, ctx, nos, ligar) {
  const porCaminho = new Map(), porNome = new Map();
  for (const it of itens) {
    porCaminho.set(it.caminho, it.i);
    const b = basename(it.caminho);
    if (!porNome.has(b)) porNome.set(b, []);
    porNome.get(b).push(it);
    nos[it.i].partes = relativo(it.caminho, ctx.raiz).split('/'); nos[it.i].sep = '/';
  }
  for (const it of itens) {
    const t = it.texto.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of t.matchAll(RE_C_INC)) {
      const spec = m[2].trim();
      let alvo;
      if (m[1] === '"') { const rel = normalizar(junta(dirname(it.caminho), spec)); if (rel) alvo = porCaminho.get(rel); }
      // senão procura pelo fim do caminho (pastas de include); <...> só quando tem pasta, para não pegar <string.h>
      if (alvo === undefined && (m[1] === '"' || spec.includes('/'))) {
        let melhor = null, pm = -1;
        for (const c of porNome.get(basename(spec)) || []) {
          if (c.caminho !== spec && !c.caminho.endsWith('/' + spec)) continue;
          const pc = prefixoComum(c.caminho, it.caminho);
          if (pc > pm) { pm = pc; melhor = c; }
        }
        if (melhor) alvo = melhor.i;
      }
      ligar(it.i, alvo);
    }
  }
}

/* ------------------------------------------------------------ C# */
const RE_CS_NS = /^\s*namespace\s+([\w.]+)/m;
const RE_CS_TIPO = /\b(?:class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+(\w+)/g;
const RE_CS_USING = /^\s*(global\s+)?using\s+(?:static\s+)?(?:(\w+)\s*=\s*)?([\w.]+)\s*;/gm;
const RE_FQ = /\b((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*)/g;

function analisarCs(itens, ctx, nos, ligar) {
  const porNs = new Map(), fq = new Map(), info = new Map(), globais = new Set();
  for (const it of itens) {
    const t = it.texto.replace(RE_COMENTARIO, ' ');
    const m = t.match(RE_CS_NS), ns = m ? m[1] : '';
    const usings = [], apelidos = [];
    for (const u of t.matchAll(RE_CS_USING)) {
      if (u[2]) apelidos.push(u[3]); else if (u[1]) globais.add(u[3]); else usings.push(u[3]);
    }
    info.set(it.i, { t, ns, usings, apelidos });
    if (!porNs.has(ns)) porNs.set(ns, new Map());
    for (const x of t.matchAll(RE_CS_TIPO)) {
      if (!porNs.get(ns).has(x[1])) porNs.get(ns).set(x[1], it.i);
      const k = ns ? ns + '.' + x[1] : x[1];
      if (!fq.has(k)) fq.set(k, it.i);
    }
    nos[it.i].partes = (ns ? ns.split('.') : []).concat(semExt(basename(it.caminho))); nos[it.i].sep = '.';
  }
  for (const it of itens) {
    const { t, ns, usings, apelidos } = info.get(it.i);
    // via using/global using conta como import; o próprio namespace, os de cima e o global são implícitos (leve)
    const comUsing = [...new Set(usings.concat([...globais]))].map(v => porNs.get(v)).filter(Boolean);
    const implicitos = new Set(['']);
    for (let p = ns; p; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') implicitos.add(p);
    const semUsing = [...implicitos].map(v => porNs.get(v)).filter(Boolean);
    for (const a of apelidos) ligar(it.i, fq.get(a));
    for (const nome of new Set([...t.matchAll(RE_IDENT)].map(x => x[1]))) {
      for (const mp of comUsing) ligar(it.i, mp.get(nome));
      for (const mp of semUsing) ligar(it.i, mp.get(nome), true);
    }
    for (const nome of new Set([...t.matchAll(RE_FQ)].map(x => x[1]))) ligar(it.i, fq.get(nome));
  }
}

/* ------------------------------------------------------------ Rust */
const RE_RS_MOD = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
const RE_RS_USE = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm;
const RE_RS_CAMINHO = /\b(crate|self|super)((?:::\w+)+)/g;
const RE_RS_RELATIVO = /(?<![\w:])([a-z_]\w*)((?:::\w+)+)/g;

/** "crate::a::{b, c::{d, e as f}}" → ["crate::a::b", "crate::a::c::d", "crate::a::c::e"] */
function expandirUse(s) {
  s = s.replace(/\s+as\s+\w+/g, '').replace(/\s+/g, '');
  const k = s.indexOf('{');
  if (k < 0) return [s];
  const pre = s.slice(0, k), partes = [];
  let prof = 0, ini = k + 1;
  for (let j = k + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === '{') prof++;
    else if (ch === '}') { if (prof === 0) { partes.push(s.slice(ini, j)); break; } prof--; }
    else if (ch === ',' && prof === 0) { partes.push(s.slice(ini, j)); ini = j + 1; }
  }
  return partes.filter(Boolean).flatMap(p => (p === 'self' ? [pre.replace(/::$/, '')] : expandirUse(pre + p)));
}

function analisarRust(itens, ctx, nos, ligar) {
  const crates = new Map();   // pasta do Cargo.toml → nome do crate (com _ no lugar de -)
  for (const [c, texto] of ctx.textos) {
    if (basename(c) !== 'Cargo.toml') continue;
    const m = texto.match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m);
    crates.set(dirname(c), m ? m[1].replace(/-/g, '_') : '');
  }
  const mods = new Map(), info = new Map();
  for (const it of itens) {
    const dCargo = ancestral(dirname(it.caminho), 'Cargo.toml', ctx.existe);
    const src = dCargo === null ? null : junta(dCargo, 'src');
    let mp = null;
    if (src !== null && it.caminho.startsWith(src + '/')) {
      mp = semExt(it.caminho.slice(src.length + 1)).split('/');
      if (mp.length === 1 && (mp[0] === 'lib' || mp[0] === 'main')) mp = [];
      else if (mp[mp.length - 1] === 'mod') mp.pop();
      const k = dCargo + '::' + mp.join('::');
      if (!mods.has(k)) mods.set(k, it.i);
    }
    info.set(it.i, { dCargo, mp });
    const ps = semExt(relativo(it.caminho, ctx.raiz)).split('/');
    if (ps.length > 1 && ps[ps.length - 1] === 'mod') ps.pop();
    nos[it.i].partes = ps; nos[it.i].sep = '/';
  }
  for (const it of itens) {
    const { dCargo, mp } = info.get(it.i);
    if (!mp) continue;
    const nomeCrate = crates.get(dCargo);
    const t = it.texto.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g, ' ');
    // liga ao módulo mais longo que existe; não desce abaixo de `minimo` segmentos
    const ligarCaminho = (segs, minimo) => {
      for (let k = segs.length; k >= minimo; k--) {
        const j = mods.get(dCargo + '::' + segs.slice(0, k).join('::'));
        if (j !== undefined) { ligar(it.i, j); return true; }
      }
      return false;
    };
    // "mod x;" só monta a árvore de módulos (leve); o uso real vem pelos caminhos
    for (const m of t.matchAll(RE_RS_MOD)) ligar(it.i, mods.get(dCargo + '::' + mp.concat(m[1]).join('::')), true);
    // caminho sem prefixo no meio do código (config::carregar()): só vale para módulos filhos
    for (const m of t.matchAll(RE_RS_RELATIVO)) {
      if (m[1] === 'crate' || m[1] === 'self' || m[1] === 'super' || m[1] === nomeCrate) continue;
      ligarCaminho(mp.concat(m[1], m[2].split('::').filter(Boolean)), mp.length + 1);
    }
    const usados = [];
    for (const m of t.matchAll(RE_RS_USE)) usados.push(...expandirUse(m[1]));
    for (const m of t.matchAll(RE_RS_CAMINHO)) usados.push(m[1] + m[2]);
    if (nomeCrate) for (const m of t.matchAll(new RegExp('\\b' + nomeCrate + '((?:::\\w+)+)', 'g'))) usados.push(nomeCrate + m[1]);
    for (const u of new Set(usados)) {
      let segs = u.split('::').filter(x => x && x !== '*');
      if (!segs.length) continue;
      const cab = segs[0];
      if (cab === 'crate' || cab === nomeCrate) ligarCaminho(segs.slice(1), 0);
      else if (cab === 'self') ligarCaminho(mp.concat(segs.slice(1)), mp.length);
      else if (cab === 'super') {
        let b = mp.slice(0, -1);
        segs = segs.slice(1);
        while (segs[0] === 'super') { b = b.slice(0, -1); segs = segs.slice(1); }
        ligarCaminho(b.concat(segs), b.length);
      } else if (!ligarCaminho(mp.concat(segs), mp.length + 1)) ligarCaminho(segs, 1);   // caminho sem prefixo (edição 2018)
    }
  }
}

const ANALISADORES = {
  python: analisarPython, php: analisarPhp, jvm: analisarJvm, js: analisarJs,
  dart: analisarDart, go: analisarGo, c: analisarC, csharp: analisarCs, rust: analisarRust,
};

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
  const lista = arquivos.slice().sort((a, b) => (a.caminho < b.caminho ? -1 : 1));
  const ctx = {
    raiz, titulo: opcoes.titulo || 'projeto', existe: opcoes.existe || (() => false),
    textos: new Map(lista.map(a => [a.caminho, a.texto || ''])),   // inclui pubspec.yaml, go.mod, Cargo.toml
  };
  const nos = [], porLing = {};
  lista.forEach((a, i) => {
    const ling = G.linguagem(relativo(a.caminho, raiz), false);
    nos.push({ caminho: a.caminho, ling, partes: [semExt(basename(a.caminho))], sep: '/' });
    if (ling) (porLing[ling] = porLing[ling] || []).push({ i, caminho: a.caminho, texto: a.texto || '' });
  });
  // chave a*1e6+b → leve? (um import de carregamento vence um leve)
  const arestas = new Map();
  const ligar = (a, b, leve) => {
    if (b === undefined || b === null || a === b) return;
    const k = a * 1e6 + b, atual = arestas.get(k);
    arestas.set(k, atual === undefined ? !!leve : atual && !!leve);
  };
  for (const ling of Object.keys(porLing)) ANALISADORES[ling](porLing[ling], ctx, nos, ligar);

  const pares = [...arestas].map(([x, leve]) => [Math.floor(x / 1e6), x % 1e6, leve]);
  const grau = new Map();
  for (const [a, b] of pares) { grau.set(a, (grau.get(a) || 0) + 1); grau.set(b, (grau.get(b) || 0) + 1); }
  let manter = [...grau.keys()].sort((a, b) => a - b);   // ordem por caminho: desempate igual ao script
  const soltos = lista.map((a, i) => (nos[i].ling && !grau.has(i) ? a.caminho : null)).filter(Boolean);
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
    .map(([a, b, leve]) => (leve ? [novo.get(a), novo.get(b), 1] : [novo.get(a), novo.get(b)]))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const contLing = {};
  for (const n of nosF) contLing[NOME_LING[n.ling]] = (contLing[NOME_LING[n.ling]] || 0) + 1;
  return {
    titulo: ctx.titulo,
    nos: nosF.map((n, j) => ({ n: rotulos[j], c: n.caminho, l: n.ling })),
    arestas: arestasF,
    ling: Object.fromEntries(Object.entries(contLing).sort((a, b) => b[1] - a[1])),
    lidos: lista.filter((a, i) => nos[i].ling).length,
    soltos: soltos.sort().slice(0, 300),
    nSoltos: soltos.length,
  };
};
})();
