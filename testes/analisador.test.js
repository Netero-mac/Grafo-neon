/* Testes do analisador do site e dos algoritmos de grafo. Rode com: node --test testes/analisador.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { lerPasta, G } = require('./ferramentas/analisar.js');

const ESPERADO = require('./esperado.json');
const FIXTURES = path.join(__dirname, 'fixtures');
const texto = D => D.arestas.map(([a, b, l]) => D.nos[a].c + ' -> ' + D.nos[b].c + (l ? ' (leve)' : '')).sort();
const analisar = (nome, opcoes = {}) => {
  const { arquivos, existe } = lerPasta(path.join(FIXTURES, nome), false);
  return G.analisar(arquivos, { titulo: nome, raiz: '', existe, ...opcoes });
};

for (const nome of Object.keys(ESPERADO).filter(k => !k.startsWith('_'))) {
  test(`imports de ${nome}`, () => {
    assert.deepEqual(texto(analisar(nome)), ESPERADO[nome].arestas);
  });
  test(`ciclos de ${nome}`, () => {
    const D = analisar(nome);
    const grupos = G.ciclos(D.nos.length, D.arestas).grupos.map(g => g.nos.map(i => D.nos[i].c).sort());
    assert.deepEqual(grupos, ESPERADO[nome].ciclos);
  });
  test(`arquivos soltos em ${nome}`, () => {
    const D = analisar(nome);
    assert.deepEqual(D.soltos, ESPERADO[nome].soltos);
    assert.equal(D.nSoltos, ESPERADO[nome].soltos.length);
  });
  test(`nomes curtos únicos em ${nome}`, () => {
    const nomes = analisar(nome).nos.map(n => n.n);
    assert.equal(new Set(nomes).size, nomes.length);
  });
}

test('limite de arquivos mantém só os mais ligados e suas arestas', () => {
  const D = analisar('python', { maxNos: 3 });
  assert.ok(D.nos.length <= 3);
  for (const [a, b] of D.arestas) assert.ok(a < D.nos.length && b < D.nos.length);
});

test('ciclos: acha o grupo, ignora imports leves e devolve um ciclo válido', () => {
  // 0→1→2→0 é ciclo; 2→3 e 3→2 leve não formam ciclo; 4 sozinho
  const arestas = [[0, 1], [1, 2], [2, 0], [2, 3], [3, 2, 1], [4, 4]];
  const { grupos, comp } = G.ciclos(5, arestas);
  assert.equal(grupos.length, 1);
  assert.deepEqual([...grupos[0].nos].sort(), [0, 1, 2]);
  assert.notEqual(comp[3], comp[2]);
  const c = grupos[0].caminho;
  assert.equal(c[0], c[c.length - 1]);
  const existe = new Set(arestas.filter(e => !e[2]).map(([a, b]) => a + '>' + b));
  for (let k = 1; k < c.length; k++) assert.ok(existe.has(c[k - 1] + '>' + c[k]), 'passo ' + c[k - 1] + '→' + c[k]);
});

test('ciclos: o exemplo é o menor ciclo pelo arquivo mais ligado', () => {
  // 0↔1 direto, e também 0→2→3→0
  const { grupos } = G.ciclos(4, [[0, 1], [1, 0], [0, 2], [2, 3], [3, 0]]);
  assert.deepEqual(grupos[0].caminho, [0, 1, 0]);
});

test('raio-X: quanto cada arquivo puxa e quantos dependem dele', () => {
  // 0→1→2 e 3→1; o leve 2→0 também conta para o alcance
  const { puxa, afeta } = G.raioX(5, [[0, 1], [1, 2], [3, 1]]);
  assert.deepEqual([...puxa], [2, 1, 0, 2, 0]);
  assert.deepEqual([...afeta], [0, 2, 3, 0, 0]);
  const comLeve = G.raioX(3, [[0, 1], [1, 2], [2, 0, 1]]);
  assert.deepEqual([...comLeve.puxa], [2, 2, 2]);
});

test('linguagem: ignora pastas de dependências, gerados e testes', () => {
  assert.equal(G.linguagem('src/app.py', false), 'python');
  assert.equal(G.linguagem('node_modules/x/index.js', false), null);
  assert.equal(G.linguagem('src/tipos.d.ts', false), null);
  assert.equal(G.linguagem('resources/views/home.blade.php', false), null);
  assert.equal(G.linguagem('tests/test_app.py', true), null);
  assert.equal(G.linguagem('testes/caso.py', true), null);
  assert.equal(G.linguagem('src/AppTest.kt', true), null);
  assert.equal(G.linguagem('src/AppTest.kt', false), 'jvm');
  assert.equal(G.linguagem('README.md', false), null);
});
