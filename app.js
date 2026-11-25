/* Grafo neon — site: lê um repositório público do GitHub direto do navegador.
   1) lista os arquivos pela API do GitHub (2 consultas); se o limite estourar, usa o jsDelivr;
   2) baixa os arquivos de código do raw.githubusercontent.com (ou do jsDelivr);
   3) liga os imports com analisador.js e desenha com render.js. */
(function () {
'use strict';
const G = window.GrafoNeon;
const $ = id => document.getElementById(id);
const LIMITE_ARQUIVOS = 1500, TAMANHO_MAX = 1500000, PARALELO = 10;
let atual = null, ocupado = false;

class Aviso extends Error {}   // erro com mensagem pronta para a pessoa
class Limite extends Error {}  // a API do GitHub recusou (normalmente limite por hora)

const enc = c => c.split('/').map(encodeURIComponent).join('/');
function status(txt, tipo) { const s = $('status'); s.textContent = txt; s.className = 'status' + (tipo ? ' ' + tipo : ''); }
function barra(frac) {
  const b = $('barra');
  if (frac == null) { b.hidden = true; return; }
  b.hidden = false; $('barraFill').style.width = Math.round(frac * 100) + '%';
}

/** Aceita github.com/dono/repo, https://…, …/tree/ramo/pasta, git@github.com:dono/repo.git ou dono/repo. */
function lerLink(txt) {
  const t = String(txt).trim().replace(/^git@github\.com:/i, 'github.com/').replace(/[?#].*$/, '')
    .replace(/\.git(?=$|\/)/, '').replace(/\/+$/, '');
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?$/i)
    || t.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/.*)?$/i)
    || t.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  const dec = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
  return { dono: m[1], repo: m[2], ramo: m[3] ? dec(m[3]) : '', pasta: m[4] ? dec(m[4]).replace(/^\/+|\/+$/g, '') : '' };
}

async function pedir(url, comoJson) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return { r, dados: r.ok ? (comoJson ? await r.json() : await r.text()) : null };
  } finally { clearTimeout(tm); }
}

/* ---------- 1) lista de arquivos ---------- */
async function listarPelaApi(ref) {
  const api = 'https://api.github.com/repos/' + ref.dono + '/' + ref.repo;
  let ramo = ref.ramo;
  if (!ramo) {
    const { r, dados } = await pedir(api, true);
    if (r.status === 404) throw new Aviso('Não achei esse repositório. Confira o nome e se ele é público.');
    if (!r.ok) throw new Limite(String(r.status));
    ramo = dados.default_branch; ref.dono = dados.owner.login; ref.repo = dados.name;
  }
  const { r, dados } = await pedir(api + '/git/trees/' + encodeURIComponent(ramo) + '?recursive=1', true);
  if (r.status === 404 || r.status === 422) {
    throw new Aviso(ref.ramo ? 'Não achei o ramo "' + ramo + '" nesse repositório.' : 'Não achei esse repositório. Confira o nome e se ele é público.');
  }
  if (r.status === 409) throw new Aviso('Esse repositório ainda está vazio.');
  if (!r.ok) throw new Limite(String(r.status));
  return {
    ramo, truncado: !!dados.truncated,
    arquivos: dados.tree.filter(x => x.type === 'blob').map(x => ({ caminho: x.path, tamanho: x.size || 0 })),
  };
}

async function listarPeloJsdelivr(ref) {
  for (const ramo of ref.ramo ? [ref.ramo] : ['main', 'master']) {
    try {
      const url = 'https://data.jsdelivr.com/v1/packages/gh/' + ref.dono + '/' + ref.repo + '@' + encodeURIComponent(ramo) + '?structure=flat';
      const { r, dados } = await pedir(url, true);
      if (r.ok && dados && Array.isArray(dados.files)) {
        return { ramo, arquivos: dados.files.map(f => ({ caminho: f.name.replace(/^\//, ''), tamanho: f.size || 0 })) };
      }
    } catch (e) { /* tenta o próximo ramo */ }
  }
  return null;
}

async function listar(ref) {
  try { return await listarPelaApi(ref); } catch (e) {
    if (e instanceof Aviso) throw e;
    status('A API do GitHub não respondeu (talvez o limite de 60 consultas por hora). Tentando pelo jsDelivr…');
    const via = await listarPeloJsdelivr(ref);
    if (via) return via;
    throw new Aviso('O GitHub limitou as consultas por agora (60 por hora sem login) e o jsDelivr também não respondeu. Tente de novo daqui a pouco.');
  }
}

/* ---------- 2) conteúdo dos arquivos ---------- */
async function baixar(ref, ramo, lista, aoAvancar) {
  const urlRaw = c => 'https://raw.githubusercontent.com/' + ref.dono + '/' + ref.repo + '/' + enc(ramo) + '/' + enc(c);
  const urlCdn = c => 'https://cdn.jsdelivr.net/gh/' + ref.dono + '/' + ref.repo + '@' + enc(ramo) + '/' + enc(c);
  const fila = lista.slice(), res = [];
  let preferirCdn = false, feitos = 0, falhas = 0;
  async function trabalhador() {
    while (fila.length) {
      const a = fila.shift();
      let texto = null;
      for (const cdn of preferirCdn ? [true] : [false, true]) {
        try {
          const { r, dados } = await pedir(cdn ? urlCdn(a.caminho) : urlRaw(a.caminho), false);
          if (r.ok) { texto = dados; break; }
          if (r.status === 404) break;
        } catch (e) { /* falha de rede: tenta o espelho */ }
        if (!cdn) preferirCdn = true;
      }
      if (texto === null) falhas++; else res.push({ caminho: a.caminho, texto });
      aoAvancar(++feitos, lista.length);
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));
  return { arquivos: res, falhas };
}

/* ---------- 3) tudo junto ---------- */
async function desenhar(ref) {
  if (ocupado) return;
  ocupado = true; $('ir').disabled = true; barra(0);
  const semTestes = $('semTestes').checked;
  try {
    status('Lendo a lista de arquivos de ' + ref.dono + '/' + ref.repo + '…');
    const lista = await listar(ref);
    const raiz = ref.pasta;
    const todos = new Set(lista.arquivos.map(a => a.caminho));
    let codigo = lista.arquivos.filter(a => (!raiz || a.caminho.startsWith(raiz + '/')) && a.tamanho <= TAMANHO_MAX &&
      G.linguagem(raiz ? a.caminho.slice(raiz.length + 1) : a.caminho, semTestes));
    if (!codigo.length) {
      throw new Aviso('Não achei arquivos Python, PHP, Kotlin, Java ou JS/TS ' + (raiz ? 'em "' + raiz + '".' : 'nesse repositório.'));
    }
    const avisos = [];
    if (lista.truncado) avisos.push('o GitHub cortou a lista de arquivos por ser grande demais');
    if (codigo.length > LIMITE_ARQUIVOS) {
      avisos.push('li ' + LIMITE_ARQUIVOS + ' de ' + codigo.length + ' arquivos; aponte para uma pasta, como …/tree/main/src');
      codigo = codigo.slice(0, LIMITE_ARQUIVOS);
    }
    const { arquivos, falhas } = await baixar(ref, lista.ramo, codigo, (k, n) => { barra(k / n); status('Baixando arquivos… ' + k + ' de ' + n); });
    if (falhas) avisos.push(falhas + ' arquivo(s) não baixaram');
    status('Ligando os imports…');
    await new Promise(r => setTimeout(r, 0));
    const titulo = ref.dono + '/' + ref.repo + (raiz ? '/' + raiz : '');
    const D = G.analisar(arquivos, { titulo, raiz, existe: c => todos.has(c), maxNos: 600 });
    const site = 'https://github.com/' + ref.dono + '/' + ref.repo;
    D.url = ref.ramo || raiz ? site + '/tree/' + enc(lista.ramo) + (raiz ? '/' + enc(raiz) : '') : site;
    D.blob = site + '/blob/' + enc(lista.ramo) + '/';
    if (atual) atual.destruir();
    atual = G.montar(D);
    barra(null);
    status((D.arestas.length ? 'Pronto: ' + D.nos.length + ' arquivos ligados por ' + D.arestas.length + ' imports.'
      : 'Li ' + arquivos.length + ' arquivos, mas não achei imports entre eles.') + (avisos.length ? ' Obs.: ' + avisos.join('; ') + '.' : ''), 'ok');
    const q = new URLSearchParams({ repo: ref.dono + '/' + ref.repo });
    if (ref.ramo) q.set('ramo', ref.ramo);
    if (raiz) q.set('pasta', raiz);
    if (!semTestes) q.set('testes', '1');
    const cor = new URLSearchParams(location.search).get('cor');
    if (cor) q.set('cor', cor);
    try { history.replaceState(null, '', '?' + q.toString().replace(/%2F/gi, '/')); } catch (e) { /* página aberta como arquivo */ }
    $('link').value = 'github.com/' + ref.dono + '/' + ref.repo + (ref.ramo ? '/tree/' + ref.ramo + (raiz ? '/' + raiz : '') : '');
  } catch (e) {
    barra(null);
    status(e instanceof Aviso ? e.message : 'Algo deu errado ao ler o repositório (' + ((e && e.message) || e) + ').', 'erro');
    if (!atual) exemplo(false);  // nada desenhado ainda: mostra o exemplo embaixo do erro
  } finally {
    ocupado = false; $('ir').disabled = false;
  }
}

function vazio(msg) {
  const m = document.createElement('div');
  m.className = 'vazio-fig'; m.textContent = msg;
  $('fig').appendChild(m);
  $('cv').hidden = true;
}

async function exemplo(avisar) {
  try {
    const r = await fetch('exemplo.json');
    if (!r.ok) throw new Error(String(r.status));
    const D = await r.json();
    if (atual) return;
    atual = G.montar(D);
    if (avisar !== false) status('Exemplo: o núcleo do pytest. Cole um link acima para desenhar outro projeto.');
  } catch (e) {
    vazio('Cole o link de um repositório público para começar.');
  }
}

$('formRepo').addEventListener('submit', ev => {
  ev.preventDefault();
  const ref = lerLink($('link').value);
  if (!ref) { status('Cole um link como github.com/dono/repositorio, ou só dono/repositorio.', 'erro'); return; }
  desenhar(ref);
});
document.querySelectorAll('.ex').forEach(b => b.addEventListener('click', () => {
  $('link').value = 'github.com/' + b.dataset.r;
  desenhar(lerLink(b.dataset.r));
}));

const q = new URLSearchParams(location.search), ref = q.get('repo') && lerLink(q.get('repo'));
if (ref) {
  if (q.get('ramo')) ref.ramo = q.get('ramo');
  if (q.get('pasta')) ref.pasta = q.get('pasta').replace(/^\/+|\/+$/g, '');
  if (q.get('testes') === '1') $('semTestes').checked = false;
  $('link').value = 'github.com/' + ref.dono + '/' + ref.repo;
  desenhar(ref);
} else exemplo();
})();
