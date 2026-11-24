#!/usr/bin/env python3
"""
grafo_neon.py — desenha as dependências de um repositório no estilo "raio neon".

Versão de linha de comando do site Grafo neon, para pastas no seu computador
(inclusive projetos privados). Lê os arquivos de código (Python, PHP, Kotlin,
Java, JavaScript/TypeScript), descobre quem importa quem e gera UMA página HTML
que funciona offline, com o mesmo desenho do site.

Precisa de render.js e estilo.css na mesma pasta deste arquivo.

Uso:
    python3 grafo_neon.py caminho/do/repo
    python3 grafo_neon.py caminho/do/repo -o meu_grafo.html --titulo "Meu App"
    python3 grafo_neon.py caminho/do/repo --sem-testes --max-nos 300

Só usa a biblioteca padrão do Python (3.8+).
"""

from __future__ import annotations

import argparse
import ast
import html
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

PASTAS_IGNORADAS = {
    ".git", ".github", ".gradle", ".idea", ".vscode", "node_modules", "vendor",
    "build", "dist", "out", "target", "__pycache__", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", "storage", "coverage", ".next",
    ".nuxt", "generated", "site-packages",
}
PASTAS_TESTE = {"test", "tests", "testing", "androidTest", "__tests__", "spec"}
RE_ARQ_TESTE = re.compile(
    r"(test_.*\.py|.*_test\.py|conftest\.py|.*Tests?\.(kt|java|php)|.*\.(test|spec)\.[jt]sx?)$"
)

EXTENSOES = {
    ".py": "python", ".php": "php", ".kt": "jvm", ".java": "jvm",
    ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js",
}
NOME_LING = {"python": "Python", "php": "PHP", "jvm": "Kotlin/Java", "js": "JS/TS"}


# ---------------------------------------------------------------- coleta

def coletar(raiz: Path, sem_testes: bool) -> list[tuple[Path, str]]:
    achados = []
    for pasta, subpastas, nomes in os.walk(raiz):
        subpastas[:] = sorted(
            d for d in subpastas
            if d not in PASTAS_IGNORADAS and not d.startswith(".")
            and not (sem_testes and d in PASTAS_TESTE)
        )
        for nome in sorted(nomes):
            if nome.endswith((".blade.php", ".d.ts", ".min.js")):
                continue
            ling = EXTENSOES.get(os.path.splitext(nome)[1])
            if not ling or (sem_testes and RE_ARQ_TESTE.match(nome)):
                continue
            caminho = Path(pasta) / nome
            try:
                if caminho.stat().st_size > 1_500_000:
                    continue
            except OSError:
                continue
            achados.append((caminho, ling))
    return achados


def ler(caminho: Path) -> str:
    try:
        return caminho.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# ---------------------------------------------------------------- Python

def nomes_modulo_py(arq: Path, raiz: Path) -> tuple[str, str]:
    """Nome pontilhado do módulo: (seguindo os __init__.py, relativo à raiz)."""
    topo = arq.parent
    while (topo / "__init__.py").exists() and topo.parent != topo:
        topo = topo.parent

    def pontilhado(base: Path) -> str:
        partes = list(arq.relative_to(base).with_suffix("").parts)
        if partes and partes[-1] == "__init__":
            partes.pop()
        return ".".join(partes)

    return pontilhado(topo), pontilhado(raiz)


def analisar_python(itens, raiz, nos, arestas):
    mapa, info = {}, {}
    for i, arq, _ in itens:
        pkg, rel = nomes_modulo_py(arq, raiz)
        info[i] = (pkg or rel or arq.stem, arq.name == "__init__.py")
        nos[i]["partes"] = (pkg or rel or raiz.name).split(".")
        nos[i]["sep"] = "."
    for prioridade in (0, 1):  # nome pelo pacote primeiro, depois relativo à raiz
        for i, arq, _ in itens:
            # dentro de um pacote (pasta com __init__.py) só vale o nome completo:
            # assim "import warnings" da biblioteca padrão não cai em _pytest/warnings.py
            if prioridade == 1 and (arq.parent / "__init__.py").exists():
                continue
            nome = nomes_modulo_py(arq, raiz)[prioridade]
            if nome and nome not in mapa:
                mapa[nome] = i

    def resolver(nome: str):
        partes = nome.split(".")
        while partes:
            alvo = mapa.get(".".join(partes))
            if alvo is not None:
                return alvo
            partes.pop()
        return None

    for i, arq, texto in itens:
        try:
            arvore = ast.parse(texto)
        except (SyntaxError, ValueError):
            continue
        pkg, eh_init = info[i]
        for no in ast.walk(arvore):
            alvos = []
            if isinstance(no, ast.Import):
                alvos = [resolver(a.name) for a in no.names]
            elif isinstance(no, ast.ImportFrom):
                if no.level:
                    base = pkg.split(".") if eh_init else pkg.split(".")[:-1]
                    if no.level > 1:
                        base = base[: len(base) - (no.level - 1)]
                    base = ".".join(base + (no.module.split(".") if no.module else []))
                else:
                    base = no.module or ""
                for a in no.names:
                    cheio = f"{base}.{a.name}" if base else a.name
                    alvo = mapa.get(cheio)
                    alvos.append(alvo if alvo is not None else (resolver(base) if base else None))
            for alvo in alvos:
                if alvo is not None and alvo != i:
                    arestas.add((i, alvo))


# ---------------------------------------------------------------- PHP

RE_PHP_NS = re.compile(r"^\s*namespace\s+([\w\\]+)\s*[;{]", re.M)
RE_PHP_TIPO = re.compile(
    r"^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)", re.M
)
RE_PHP_USE = re.compile(r"^\s*use\s+([^;{]+(?:\{[^}]*\})?)\s*;", re.M)
RE_PHP_FQ = re.compile(r"\\?((?:[A-Za-z_]\w*\\)+[A-Za-z_]\w*)")
RE_MAIUSC = re.compile(r"\b([A-Z]\w*)\b")


def analisar_php(itens, raiz, nos, arestas):
    fq_map, curto, ns_de = {}, {}, {}
    for i, arq, texto in itens:
        m = RE_PHP_NS.search(texto)
        ns = m.group(1) if m else ""
        ns_de[i] = ns
        tipos = RE_PHP_TIPO.findall(texto)
        for t in tipos:
            fq_map.setdefault(f"{ns}\\{t}" if ns else t, i)
            curto.setdefault((ns, t), i)
        if tipos:
            nos[i]["partes"] = (ns.split("\\") if ns else []) + [tipos[0]]
        else:
            nos[i]["partes"] = list(arq.relative_to(raiz).with_suffix("").parts)
        nos[i]["sep"] = "/"

    for i, arq, texto in itens:
        ns, apelidos = ns_de[i], {}

        def ligar(alvo):
            if alvo is not None and alvo != i:
                arestas.add((i, alvo))

        for m in RE_PHP_USE.finditer(texto):
            trecho = re.sub(r"^(function|const)\s+", "", m.group(1).strip())
            if "{" in trecho:
                prefixo, dentro = trecho.split("{", 1)
                prefixo = prefixo.strip().rstrip("\\")
                itens_use = [f"{prefixo}\\{x.strip()}" for x in dentro.rstrip("}").split(",") if x.strip()]
            else:
                itens_use = trecho.split(",")
            for item in itens_use:
                partes = re.split(r"\s+as\s+", item.strip(), flags=re.I)
                fq = partes[0].strip().lstrip("\\")
                apelido = partes[1].strip() if len(partes) > 1 else fq.split("\\")[-1]
                if "\\" in fq:
                    alvo = fq_map.get(fq)
                    apelidos[apelido] = alvo
                else:  # "use Trait;" dentro da classe
                    alvo = apelidos.get(fq, curto.get((ns, fq)))
                ligar(alvo)
        for m in RE_PHP_FQ.finditer(texto):
            ligar(fq_map.get(m.group(1)))
        for nome in set(RE_MAIUSC.findall(texto)):
            ligar(curto.get((ns, nome)))


# ---------------------------------------------------------------- Kotlin / Java

RE_JVM_PKG = re.compile(r"^\s*package\s+([\w.]+)", re.M)
RE_JVM_TIPO = re.compile(
    r"^\s*(?:@\w+(?:\([^)]*\))?\s*)*"
    r"(?:(?:public|private|protected|internal|abstract|final|open|sealed|data|enum|"
    r"annotation|inner|value|static|fun)\s+)*"
    r"(?:class|interface|object|enum|record|@interface)\s+(\w+)",
    re.M,
)
RE_KT_FUN = re.compile(
    r"^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|inline|suspend|tailrec|operator|infix)\s+)*"
    r"fun\s+(?:<[^>]*>\s*)?(?:[\w.]+(?:<[^>]*>)?\??\.)?(\w+)\s*\(",
    re.M,
)
RE_KT_VAL = re.compile(r"^(?:(?:public|internal|private|const)\s+)*va[lr]\s+(\w+)", re.M)
RE_JVM_IMPORT = re.compile(r"^\s*import\s+(?:static\s+)?([\w.]+)", re.M)
RE_COMENTARIO = re.compile(r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"", re.S)
RE_IDENT = re.compile(r"\b([A-Za-z_]\w*)\b")
RE_JVM_FQ = re.compile(r"\b((?:[a-z_]\w*\.)+[A-Za-z_]\w*)")


def analisar_jvm(itens, raiz, nos, arestas):
    fq_map, curto, pkg_de = {}, {}, {}
    for i, arq, texto in itens:
        m = RE_JVM_PKG.search(texto)
        pkg = m.group(1) if m else ""
        pkg_de[i] = pkg
        nomes = [arq.stem] + RE_JVM_TIPO.findall(texto)
        if arq.suffix == ".kt":
            nomes += RE_KT_FUN.findall(texto) + RE_KT_VAL.findall(texto)
        for n in nomes:
            fq_map.setdefault(f"{pkg}.{n}" if pkg else n, i)
            curto.setdefault((pkg, n), i)
        nos[i]["partes"] = (pkg.split(".") if pkg else []) + [arq.stem]
        nos[i]["sep"] = "."

    for i, arq, texto in itens:
        pkg = pkg_de[i]
        for m in RE_JVM_IMPORT.finditer(texto):
            partes = m.group(1).rstrip(".").split(".")
            while partes:
                alvo = fq_map.get(".".join(partes))
                if alvo is not None:
                    if alvo != i:
                        arestas.add((i, alvo))
                    break
                partes.pop()
        limpo = RE_COMENTARIO.sub(" ", texto)
        for fq in set(RE_JVM_FQ.findall(limpo)):
            alvo = fq_map.get(fq)
            if alvo is not None and alvo != i:
                arestas.add((i, alvo))
        for nome in set(RE_IDENT.findall(limpo)):
            alvo = curto.get((pkg, nome))
            if alvo is not None and alvo != i:
                arestas.add((i, alvo))


# ---------------------------------------------------------------- JS / TS

RE_JS_IMP = re.compile(
    r"""(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]"""
    r"""|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)"""
)
EXT_JS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]


def analisar_js(itens, raiz, nos, arestas):
    por_caminho = {}
    for i, arq, _ in itens:
        por_caminho[os.path.normpath(str(arq))] = i
        partes = list(arq.relative_to(raiz).with_suffix("").parts)
        if len(partes) > 1 and partes[-1] == "index":
            partes.pop()
        nos[i]["partes"] = partes
        nos[i]["sep"] = "/"

    for i, arq, texto in itens:
        for m in RE_JS_IMP.finditer(texto):
            spec = next(g for g in m.groups() if g)
            if spec.startswith("."):
                base = arq.parent / spec
            elif spec.startswith(("@/", "~/")):
                base = raiz / "src" / spec[2:]
            else:
                continue
            base = os.path.normpath(str(base))
            candidatos = [base + e for e in EXT_JS] + [os.path.join(base, "index" + e) for e in EXT_JS[1:]]
            for c in candidatos:
                alvo = por_caminho.get(c)
                if alvo is not None:
                    if alvo != i:
                        arestas.add((i, alvo))
                    break


ANALISADORES = {"python": analisar_python, "php": analisar_php, "jvm": analisar_jvm, "js": analisar_js}


# ---------------------------------------------------------------- montagem

def nomes_curtos(nos):
    """Menor sufixo do caminho que deixa cada nome único (como 'config' ou 'ui/Theme')."""
    k = [1] * len(nos)
    while True:
        rot = [n["sep"].join(n["partes"][-k[i]:]) or n["caminho"] for i, n in enumerate(nos)]
        cont = Counter(rot)
        mudou = False
        for i, r in enumerate(rot):
            if cont[r] > 1 and k[i] < len(nos[i]["partes"]):
                k[i] += 1
                mudou = True
        if not mudou:
            break
    vistos = Counter()
    for i, r in enumerate(rot):  # garante unicidade mesmo no pior caso
        vistos[r] += 1
        if cont[r] > 1 and vistos[r] > 1:
            rot[i] = f"{r} ({nos[i]['caminho']})"
    return rot


def montar_grafo(raiz: Path, sem_testes: bool, max_nos: int, titulo: str | None):
    arquivos = coletar(raiz, sem_testes)
    nos = [{"caminho": a.relative_to(raiz).as_posix(), "ling": l, "partes": [a.stem], "sep": "/"}
           for a, l in arquivos]
    arestas: set[tuple[int, int]] = set()
    por_ling: dict[str, list] = {}
    for i, (arq, ling) in enumerate(arquivos):
        por_ling.setdefault(ling, []).append((i, arq, ler(arq)))
    for ling, itens in por_ling.items():
        ANALISADORES[ling](itens, raiz, nos, arestas)

    grau = Counter()
    for a, b in arestas:
        grau[a] += 1
        grau[b] += 1
    manter = [i for i in range(len(nos)) if grau[i] > 0]
    if len(manter) > max_nos:
        manter = sorted(manter, key=lambda i: -grau[i])[:max_nos]
        conj = set(manter)
        grau2 = Counter()
        for a, b in arestas:
            if a in conj and b in conj:
                grau2[a] += 1
                grau2[b] += 1
        manter = [i for i in manter if grau2[i] > 0]
    manter.sort()
    novo = {velho: j for j, velho in enumerate(manter)}
    nos_f = [nos[i] for i in manter]
    rotulos = nomes_curtos(nos_f)
    arestas_f = sorted((novo[a], novo[b]) for a, b in arestas if a in novo and b in novo)

    return {
        "titulo": titulo or raiz.resolve().name,
        "nos": [{"n": r, "c": n["caminho"], "l": n["ling"]} for r, n in zip(rotulos, nos_f)],
        "arestas": [list(e) for e in arestas_f],
        "ling": {NOME_LING[l]: c for l, c in Counter(n["ling"] for n in nos_f).most_common()},
        "lidos": len(arquivos),
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="Desenha as dependências de um repositório no estilo raio neon.")
    p.add_argument("repo", help="pasta do repositório")
    p.add_argument("-o", "--saida", default="grafo_neon.html", help="arquivo HTML de saída")
    p.add_argument("--titulo", help="título mostrado na página (padrão: nome da pasta)")
    p.add_argument("--max-nos", type=int, default=600, help="limite de arquivos no desenho (padrão 600)")
    p.add_argument("--sem-testes", action="store_true", help="ignora pastas e arquivos de teste")
    p.add_argument("--json", action="store_true", help="também salva o grafo em .json")
    a = p.parse_args(argv)

    raiz = Path(a.repo).expanduser()
    if not raiz.is_dir():
        sys.exit(f"Pasta não encontrada: {raiz}")
    dados = montar_grafo(raiz, a.sem_testes, a.max_nos, a.titulo)
    if not dados["arestas"]:
        print(f"Aviso: li {dados['lidos']} arquivos, mas não achei imports entre eles.", file=sys.stderr)
    Path(a.saida).write_text(gerar_html(dados), encoding="utf-8")
    if a.json:
        Path(a.saida).with_suffix(".json").write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    ling = ", ".join(f"{k} {v}" for k, v in dados["ling"].items())
    print(f"{len(dados['nos'])} arquivos ({ling}), {len(dados['arestas'])} dependências -> {a.saida}")


# ---------------------------------------------------------------- página

PASTA = Path(__file__).resolve().parent

MODELO_HTML = r"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITULO__ · Grafo neon</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
/*__CSS__*/
</style>
</head>
<body>
<main>
  <div class="fig" id="fig"><canvas id="cv" role="img" aria-label="Grafo de dependências do projeto"></canvas></div>
  <section class="painel">
    <h1 class="titulo" id="titulo"></h1>
    <p class="meta"><span id="meta"></span> <a id="origem" href="#" target="_blank" rel="noopener" hidden>ver no GitHub ↗</a></p>
    <p class="leg">Cada fio é um import entre dois arquivos do projeto: quem importa fica acima, o que é importado fica abaixo. O raio branco é a maior cadeia de dependências.</p>
    <p class="cadeia" id="cadeia"></p>
    <form id="formBusca" autocomplete="off">
      <input id="busca" list="lista" placeholder="Buscar arquivo…" aria-label="Buscar arquivo no grafo">
      <datalist id="lista"></datalist>
      <button type="button" id="semente">Nova semente</button>
      <button type="button" id="limpar" hidden>Limpar seleção</button>
    </form>
    <div class="ficha" id="ficha" hidden>
      <h3 id="fNome"></h3>
      <p class="cam" id="fCam"></p>
      <p class="num" id="fNum"></p>
      <h4>Importa</h4><div class="chips" id="fDeps"></div>
      <h4>É importado por</h4><div class="chips" id="fUsos"></div>
    </div>
    <p class="nota">Toque num rótulo ou perto de um fio para acender o que aquele arquivo puxa. Gerado por grafo_neon.py.</p>
  </section>
</main>
<script>
/*__RENDER__*/
</script>
<script>GrafoNeon.montar(/*__DADOS__*/null);</script>
</body>
</html>
"""


def gerar_html(dados: dict) -> str:
    try:
        css = (PASTA / "estilo.css").read_text(encoding="utf-8")
        render = (PASTA / "render.js").read_text(encoding="utf-8")
    except OSError:
        sys.exit("Não achei estilo.css e render.js ao lado do grafo_neon.py. Baixe o repositório inteiro.")
    js = json.dumps(dados, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return (MODELO_HTML
            .replace("__TITULO__", html.escape(dados["titulo"]))
            .replace("/*__CSS__*/", css)
            .replace("/*__RENDER__*/", render.replace("</script", "<\\/script"))
            .replace("/*__DADOS__*/null", js))


if __name__ == "__main__":
    main()
