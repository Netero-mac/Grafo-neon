/* Grafo neon — algoritmos de grafo puros (sem DOM), usados pelo desenho e pelos testes.
   Arestas no formato [a, b] ou [a, b, 1]: "a importa b"; o 1 marca um import leve
   (só de tipo, ou dentro de função / import dinâmico), que não roda no carregamento. */
(function (raiz) {
'use strict';
const G = raiz.GrafoNeon = raiz.GrafoNeon || {};

/**
 * Componentes fortemente conexos (Tarjan, iterativo) considerando só os imports de carregamento.
 * Retorna { comp: Int32Array (componente de cada nó), grupos: [{ nos, caminho }] } com grupos de 2+ arquivos,
 * do maior para o menor. `caminho` é um ciclo curto de exemplo que começa e termina no mesmo nó.
 */
G.ciclos = function (N, arestas) {
  const adj = Array.from({ length: N }, () => []);
  for (const [a, b, leve] of arestas) if (!leve && a !== b) adj[a].push(b);
  const indice = new Int32Array(N).fill(-1), baixo = new Int32Array(N), comp = new Int32Array(N).fill(-1);
  const naPilha = new Uint8Array(N), pilha = [];
  let contador = 0, nComp = 0;
  for (let s = 0; s < N; s++) {
    if (indice[s] >= 0) continue;
    const chamadas = [[s, 0]];
    indice[s] = baixo[s] = contador++; pilha.push(s); naPilha[s] = 1;
    while (chamadas.length) {
      const topo = chamadas[chamadas.length - 1], u = topo[0];
      if (topo[1] < adj[u].length) {
        const v = adj[u][topo[1]++];
        if (indice[v] < 0) {
          indice[v] = baixo[v] = contador++; pilha.push(v); naPilha[v] = 1;
          chamadas.push([v, 0]);
        } else if (naPilha[v]) baixo[u] = Math.min(baixo[u], indice[v]);
      } else {
        chamadas.pop();
        if (chamadas.length) { const p = chamadas[chamadas.length - 1][0]; baixo[p] = Math.min(baixo[p], baixo[u]); }
        if (baixo[u] === indice[u]) {
          let v;
          do { v = pilha.pop(); naPilha[v] = 0; comp[v] = nComp; } while (v !== u);
          nComp++;
        }
      }
    }
  }
  const membros = Array.from({ length: nComp }, () => []);
  for (let i = 0; i < N; i++) membros[comp[i]].push(i);
  const grupos = [];
  for (const nos of membros) {
    if (nos.length < 2) continue;
    const c = comp[nos[0]];
    // começa pelo arquivo mais ligado dentro do grupo e acha o menor ciclo que volta a ele (BFS)
    let ini = nos[0], melhor = -1;
    for (const i of nos) {
      let g = 0;
      for (const v of adj[i]) if (comp[v] === c) g++;
      if (g > melhor) { melhor = g; ini = i; }
    }
    const pai = new Map(), fila = [];
    for (const v of adj[ini]) if (comp[v] === c && !pai.has(v)) { pai.set(v, ini); fila.push(v); }
    let fim = pai.has(ini) ? ini : -1;
    for (let k = 0; k < fila.length && fim < 0; k++) {
      const u = fila[k];
      for (const v of adj[u]) {
        if (comp[v] !== c || pai.has(v)) continue;
        pai.set(v, u);
        if (v === ini) { fim = v; break; }
        fila.push(v);
      }
    }
    const caminho = [ini];
    for (let u = pai.get(ini); u !== undefined && u !== ini && caminho.length <= nos.length; u = pai.get(u)) caminho.push(u);
    caminho.push(ini);
    caminho.reverse();
    grupos.push({ nos, caminho });
  }
  grupos.sort((x, y) => y.nos.length - x.nos.length || x.nos[0] - y.nos[0]);
  return { comp, grupos };
};
/**
 * Alcance de cada arquivo, contando todos os imports (leves também):
 * puxa[i] = quantos arquivos i usa, direta ou indiretamente;
 * afeta[i] = quantos arquivos dependem de i, direta ou indiretamente (o que pode quebrar se i mudar).
 */
G.raioX = function (N, arestas) {
  const ida = Array.from({ length: N }, () => []), volta = Array.from({ length: N }, () => []);
  for (const [a, b] of arestas) if (a !== b) { ida[a].push(b); volta[b].push(a); }
  const visto = new Int32Array(N).fill(-1), fila = new Int32Array(N);
  const alcance = (adj, s) => {
    let ini = 0, fim = 0, n = 0;
    visto[s] = s; fila[fim++] = s;
    while (ini < fim) {
      const u = fila[ini++];
      for (const v of adj[u]) if (visto[v] !== s) { visto[v] = s; fila[fim++] = v; n++; }
    }
    return n;
  };
  const puxa = new Int32Array(N), afeta = new Int32Array(N);
  for (let i = 0; i < N; i++) puxa[i] = alcance(ida, i);
  visto.fill(-1);
  for (let i = 0; i < N; i++) afeta[i] = alcance(volta, i);
  return { puxa, afeta };
};
})(typeof window !== 'undefined' ? window : globalThis);
