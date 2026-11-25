#!/usr/bin/env node
/* Roda o analisador do site (analisador.js + grafo.js) numa pasta local e imprime o grafo em JSON.
   Uso: node testes/ferramentas/analisar.js <pasta> [--sem-testes]
   Serve para os testes compararem o site com o grafo_neon.py. */
'use strict';
const fs = require('fs'), path = require('path');
globalThis.window = globalThis;
require('../../analisador.js');
require('../../grafo.js');
const G = globalThis.GrafoNeon;

function lerPasta(pasta, semTestes) {
  const todos = [];
  (function andar(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p); else todos.push(path.relative(pasta, p).split(path.sep).join('/'));
    }
  })(pasta);
  const existe = new Set(todos);
  const arquivos = todos.filter(c => G.linguagem(c, semTestes))
    .map(c => ({ caminho: c, texto: fs.readFileSync(path.join(pasta, c), 'utf8') }));
  return { arquivos, existe: c => existe.has(c) };
}
module.exports = { lerPasta, G };

if (require.main === module) {
  const pasta = path.resolve(process.argv[2] || '.');
  const { arquivos, existe } = lerPasta(pasta, process.argv.includes('--sem-testes'));
  const D = G.analisar(arquivos, { titulo: path.basename(pasta), raiz: '', existe });
  process.stdout.write(JSON.stringify(D));
}
