#!/usr/bin/env python3
"""
grafo_neon.py — desenha as dependências de um repositório no estilo "raio neon".

Versão de linha de comando do site Grafo neon, para pastas no seu computador
(inclusive projetos privados). Lê os arquivos de código (Python, JavaScript/
TypeScript, PHP, Kotlin, Java, Dart, Go, C/C++, C# e Rust), descobre quem importa
quem e gera UMA página HTML que funciona offline, com o mesmo desenho do site.

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
import functools
import html
import json
import os
import posixpath
import re
import sys
from collections import Counter
from pathlib import Path

PASTAS_IGNORADAS = {
    ".git", ".github", ".gradle", ".idea", ".vscode", "node_modules", "vendor",
    "build", "dist", "out", "target", "__pycache__", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", "storage", "coverage", ".next",
    ".nuxt", "generated", "site-packages", "obj",
}
PASTAS_TESTE = {"test", "tests", "testing", "teste", "testes", "fixtures", "androidTest", "__tests__", "spec"}
RE_ARQ_TESTE = re.compile(
    r"(test_.*\.py|.*_test\.(py|go|dart)|conftest\.py|.*Tests?\.(kt|java|php|cs)|.*\.(test|spec)\.[jt]sx?)$"
)

EXTENSOES = {
    ".py": "python", ".php": "php", ".kt": "jvm", ".java": "jvm",
    ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js",
    ".dart": "dart", ".go": "go", ".rs": "rust", ".cs": "csharp",
    ".c": "c", ".h": "c", ".cc": "c", ".cpp": "c", ".cxx": "c", ".hh": "c", ".hpp": "c", ".hxx": "c",
}
NOME_LING = {
    "python": "Python", "php": "PHP", "jvm": "Kotlin/Java", "js": "JS/TS",
    "dart": "Dart", "go": "Go", "rust": "Rust", "csharp": "C#", "c": "C/C++",
}
CONFIGS = {"pubspec.yaml", "go.mod", "Cargo.toml"}  # lidos para achar o nome do pacote, módulo ou crate


# ---------------------------------------------------------------- coleta

def coletar(raiz: Path, sem_testes: bool):
    """Devolve (arquivos de código [(caminho, linguagem)], arquivos de configuração [caminho])."""
    achados, configs = [], []
    for pasta, subpastas, nomes in os.walk(raiz):
        subpastas[:] = sorted(
            d for d in subpastas
            if d not in PASTAS_IGNORADAS and not d.startswith(".")
            and not (sem_testes and d in PASTAS_TESTE)
        )
        for nome in sorted(nomes):
            if nome in CONFIGS:
                configs.append(Path(pasta) / nome)
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
    return achados, configs


def ler(caminho: Path) -> str:
    try:
        return caminho.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# ---------------------------------------------------------------- arestas

def ligar(arestas: dict, a: int, b, leve: bool = False) -> None:
    """Registra "a importa b". leve=True: import que não roda no carregamento
    (só de tipo, dentro de função, ou dinâmico). Um import de carregamento vence um leve."""
    if b is None or a == b:
        return
    atual = arestas.get((a, b))
    arestas[(a, b)] = leve if atual is None else (atual and leve)


# ---------------------------------------------------------------- ajudantes

@functools.lru_cache(maxsize=None)
def ancestral(pasta: Path, nome: str):
    """Pasta mais próxima, subindo a partir de `pasta` (absoluta), que contém o arquivo `nome`."""
    d = pasta
    while True:
        if (d / nome).is_file():
            return d
        if d.parent == d:
            return None
        d = d.parent


@functools.lru_cache(maxsize=None)
def ler_config(caminho: Path) -> str:
    return ler(caminho)


def normalizar(p: str):
    """Resolve . e .. num caminho relativo com /; None se sair da raiz."""
    out = []
    for s in p.split("/"):
        if not s or s == ".":
            continue
        if s == "..":
            if not out:
                return None
            out.pop()
        else:
            out.append(s)
    return "/".join(out)


def prefixo_comum(a: str, b: str) -> int:
    k = 0
    for x, y in zip(a.split("/"), b.split("/")):
        if x != y:
            break
        k += 1
    return k


# ---------------------------------------------------------------- Python

def imports_py(arvore):
    """Percorre a árvore e devolve (nó de import, leve). Leve quando o import fica dentro
    de uma função/lambda ou de um bloco `if TYPE_CHECKING:`; esses não rodam ao importar o módulo."""
    def eh_type_checking(teste):
        return ((isinstance(teste, ast.Name) and teste.id == "TYPE_CHECKING")
                or (isinstance(teste, ast.Attribute) and teste.attr == "TYPE_CHECKING"))

    pilha = [(arvore, False)]
    while pilha:
        no, leve = pilha.pop()
        if isinstance(no, (ast.Import, ast.ImportFrom)):
            yield no, leve
        elif isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            pilha.extend((f, True) for f in ast.iter_child_nodes(no))
        elif isinstance(no, ast.If) and eh_type_checking(no.test):
            pilha.extend((f, True) for f in no.body)
            pilha.extend((f, leve) for f in no.orelse)
        else:
            pilha.extend((f, leve) for f in ast.iter_child_nodes(no))


@functools.lru_cache(maxsize=None)
def topo_pacote(pasta: Path, raiz: Path) -> Path:
    """Pasta a partir da qual o nome do módulo é contado. Dentro da raiz, uma pasta sem __init__.py
    abaixo de um pacote ainda é subpacote (namespace), como flask/sansio. Acima da raiz, só sobe
    enquanto houver __init__.py."""
    topo, d = pasta, pasta
    while True:
        if (d / "__init__.py").exists():
            topo = d.parent
        if d == raiz or d.parent == d:
            break
        d = d.parent
    if topo == raiz.parent:
        while (topo / "__init__.py").exists() and topo.parent != topo:
            topo = topo.parent
    return topo


def nomes_modulo_py(arq: Path, raiz: Path) -> tuple[str, str]:
    """Nome pontilhado do módulo: (pelo pacote, relativo à raiz)."""
    topo = topo_pacote(arq.parent, raiz)

    def pontilhado(base: Path) -> str:
        partes = list(arq.relative_to(base).with_suffix("").parts)
        if partes and partes[-1] == "__init__":
            partes.pop()
        return ".".join(partes)

    return pontilhado(topo), pontilhado(raiz)


def analisar_python(itens, raiz, nos, arestas, ctx=None):
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
            if prioridade == 1 and topo_pacote(arq.parent, raiz) != arq.parent:
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
        for no, leve in imports_py(arvore):
            alvos = []
            if isinstance(no, ast.Import):
                alvos = [resolver(a.name) for a in no.names]
            elif isinstance(no, ast.ImportFrom):
                if no.level:
                    base = pkg.split(".") if eh_init else pkg.split(".")[:-1]
                    if no.level > 1:
                        base = base[: max(0, len(base) - (no.level - 1))]
                    base = ".".join(base + (no.module.split(".") if no.module else []))
                else:
                    base = no.module or ""
                for a in no.names:
                    cheio = f"{base}.{a.name}" if base else a.name
                    alvo = mapa.get(cheio)
                    alvos.append(alvo if alvo is not None else (resolver(base) if base else None))
            for alvo in alvos:
                ligar(arestas, i, alvo, leve)


# ---------------------------------------------------------------- PHP

RE_PHP_NS = re.compile(r"^\s*namespace\s+([\w\\]+)\s*[;{]", re.M)
RE_PHP_TIPO = re.compile(
    r"^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)", re.M
)
RE_PHP_USE = re.compile(r"^\s*use\s+([^;{]+(?:\{[^}]*\})?)\s*;", re.M)
RE_PHP_FQ = re.compile(r"\\?((?:[A-Za-z_]\w*\\)+[A-Za-z_]\w*)")
RE_MAIUSC = re.compile(r"\b([A-Z]\w*)\b")


def analisar_php(itens, raiz, nos, arestas, ctx=None):
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

        def liga(alvo):
            ligar(arestas, i, alvo)

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
                liga(alvo)
        for m in RE_PHP_FQ.finditer(texto):
            liga(fq_map.get(m.group(1)))
        # nome curto do mesmo namespace: referência implícita, não é um "use" (leve)
        for nome in set(RE_MAIUSC.findall(texto)):
            ligar(arestas, i, curto.get((ns, nome)), True)


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


def analisar_jvm(itens, raiz, nos, arestas, ctx=None):
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
                    ligar(arestas, i, alvo)
                    break
                partes.pop()
        limpo = RE_COMENTARIO.sub(" ", texto)
        for fq in set(RE_JVM_FQ.findall(limpo)):
            alvo = fq_map.get(fq)
            ligar(arestas, i, alvo)
        # mesmo pacote: referência implícita, sem import (leve)
        for nome in set(RE_IDENT.findall(limpo)):
            ligar(arestas, i, curto.get((pkg, nome)), True)


# ---------------------------------------------------------------- JS / TS

RE_JS_IMP = re.compile(
    r"""(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]"""
    r"""|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)"""
)
RE_JS_TIPO = re.compile(r"(?:import|export)\s+type\b")
EXT_JS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]


def analisar_js(itens, raiz, nos, arestas, ctx=None):
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
            # "import type" (TypeScript) some na compilação; import() é carregado depois: os dois são leves
            leve = bool(m.group(3)) or bool(RE_JS_TIPO.match(m.group(0)))
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
                    ligar(arestas, i, alvo, leve)
                    break


# ---------------------------------------------------------------- Dart

RE_DART = re.compile(r"""^\s*(import|export|part)\s+['"]([^'"]+)['"]([^;]*);""", re.M)
RE_LINHA_BLOCO = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)


def analisar_dart(itens, raiz, nos, arestas, ctx):
    por_caminho = {arq.resolve(): i for i, arq, _ in itens}
    pacotes = {}  # nome do pacote → pasta do pubspec.yaml
    for cfg in ctx["configs"]:
        if cfg.name == "pubspec.yaml":
            m = re.search(r"""^name:\s*["']?(\w+)""", ler_config(cfg), re.M)
            if m and m.group(1) not in pacotes:
                pacotes[m.group(1)] = cfg.resolve().parent
    for i, arq, _ in itens:
        nos[i]["partes"] = list(arq.relative_to(raiz).with_suffix("").parts)
        nos[i]["sep"] = "/"
    for i, arq, texto in itens:
        for m in RE_DART.finditer(RE_LINHA_BLOCO.sub(" ", texto)):
            spec = m.group(2)
            if spec.startswith("dart:"):
                continue
            if spec.startswith("package:"):
                r = spec[8:]
                k = r.find("/")
                if k < 0 or r[:k] not in pacotes:
                    continue
                alvo = pacotes[r[:k]] / "lib" / r[k + 1:]
            else:
                alvo = arq.resolve().parent / spec
            # "deferred as" carrega a biblioteca só quando é usada: import leve
            ligar(arestas, i, por_caminho.get(Path(os.path.normpath(alvo))), bool(re.search(r"\bdeferred\b", m.group(3))))


# ---------------------------------------------------------------- Go

RE_GO_PKG = re.compile(r"^package\s+(\w+)", re.M)
RE_GO_BLOCO = re.compile(r"^import\s*\(([\s\S]*?)\)", re.M)
RE_GO_IMP = re.compile(r'^import\s+(?:[\w.]+\s+)?"([^"]+)"', re.M)
RE_GO_DECL = re.compile(r"^(?:func\s+(\w+)\s*[(\[]|type\s+(\w+)|var\s+(\w+)|const\s+(\w+))", re.M)
RE_GO_GRUPO = re.compile(r"^(?:var|const|type)\s*\(([\s\S]*?)^\)", re.M)
RE_GO_STR = re.compile(r'"(?:\\.|[^"\\\n])*"|`[^`]*`')
GO_IGNORAR = {"init", "main", "_"}


def analisar_go(itens, raiz, nos, arestas, ctx):
    por_dir, declarados, info = {}, {}, {}
    for i, arq, texto in itens:
        d = arq.resolve().parent
        lista_dir = por_dir.setdefault(d, [])
        if not arq.name.endswith("_test.go"):  # um import chega ao pacote, não aos testes dele
            lista_dir.append(i)
        nos[i]["partes"] = list(arq.relative_to(raiz).with_suffix("").parts)
        nos[i]["sep"] = "/"
        t = RE_LINHA_BLOCO.sub(" ", texto)
        m = RE_GO_PKG.search(t)
        chave = (d, m.group(1) if m else "")
        decl = declarados.setdefault(chave, {})
        nomes = [next(g for g in x.groups() if g) for x in RE_GO_DECL.finditer(t)]
        for g in RE_GO_GRUPO.finditer(t):
            nomes += re.findall(r"^[ \t]+(\w+)", g.group(1), re.M)
        for n in nomes:
            if n not in GO_IGNORAR and n not in decl:
                decl[n] = i
        info[i] = (t, chave)
    for i, arq, _ in itens:
        t, chave = info[i]
        raiz_mod = ancestral(arq.resolve().parent, "go.mod")
        m = re.search(r"^module\s+(\S+)", ler_config(raiz_mod / "go.mod"), re.M) if raiz_mod else None
        if m:
            mod = m.group(1)
            caminhos = [s for b in RE_GO_BLOCO.finditer(t) for s in re.findall(r'"([^"]+)"', b.group(1))]
            caminhos += RE_GO_IMP.findall(t)
            for c in caminhos:
                if c != mod and not c.startswith(mod + "/"):
                    continue
                dir_alvo = raiz_mod if c == mod else Path(os.path.normpath(raiz_mod / c[len(mod) + 1:]))
                for j in por_dir.get(dir_alvo, []):
                    ligar(arestas, i, j)
        # mesmo pacote: os arquivos da pasta se enxergam sem import (leve; Go nem permite ciclo de import)
        decl = declarados[chave]
        for nome in set(RE_IDENT.findall(RE_GO_STR.sub(" ", t))):
            ligar(arestas, i, decl.get(nome), True)


# ---------------------------------------------------------------- C / C++

RE_C_INC = re.compile(r'^[ \t]*#[ \t]*include[ \t]*([<"])([^">\n]+)[">]', re.M)
RE_BLOCO = re.compile(r"/\*.*?\*/", re.S)


def analisar_c(itens, raiz, nos, arestas, ctx):
    por_caminho, por_nome, rel = {}, {}, {}
    for i, arq, _ in itens:
        r = arq.relative_to(raiz).as_posix()
        rel[i] = r
        por_caminho[r] = i
        por_nome.setdefault(arq.name, []).append(i)
        nos[i]["partes"] = r.split("/")
        nos[i]["sep"] = "/"
    for i, arq, texto in itens:
        for m in RE_C_INC.finditer(RE_BLOCO.sub(" ", texto)):
            spec = m.group(2).strip()
            alvo = None
            if m.group(1) == '"':
                n = normalizar(posixpath.join(posixpath.dirname(rel[i]), spec))
                if n is not None:
                    alvo = por_caminho.get(n)
            # senão procura pelo fim do caminho (pastas de include); <...> só quando tem pasta
            if alvo is None and (m.group(1) == '"' or "/" in spec):
                melhor, pm = None, -1
                for j in por_nome.get(posixpath.basename(spec), []):
                    c = rel[j]
                    if c != spec and not c.endswith("/" + spec):
                        continue
                    pc = prefixo_comum(c, rel[i])
                    if pc > pm:
                        pm, melhor = pc, j
                alvo = melhor
            ligar(arestas, i, alvo)


# ---------------------------------------------------------------- C#

RE_CS_NS = re.compile(r"^\s*namespace\s+([\w.]+)", re.M)
RE_CS_TIPO = re.compile(r"\b(?:class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+(\w+)")
RE_CS_USING = re.compile(r"^\s*(global\s+)?using\s+(?:static\s+)?(?:(\w+)\s*=\s*)?([\w.]+)\s*;", re.M)
RE_FQ = re.compile(r"\b((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*)")


def analisar_cs(itens, raiz, nos, arestas, ctx):
    por_ns, fq, info, globais = {}, {}, {}, set()
    for i, arq, texto in itens:
        t = RE_COMENTARIO.sub(" ", texto)
        m = RE_CS_NS.search(t)
        ns = m.group(1) if m else ""
        usings, apelidos = [], []
        for u in RE_CS_USING.finditer(t):
            if u.group(2):
                apelidos.append(u.group(3))
            elif u.group(1):
                globais.add(u.group(3))
            else:
                usings.append(u.group(3))
        info[i] = (t, ns, usings, apelidos)
        mapa = por_ns.setdefault(ns, {})
        for nome in RE_CS_TIPO.findall(t):
            mapa.setdefault(nome, i)
            fq.setdefault(f"{ns}.{nome}" if ns else nome, i)
        nos[i]["partes"] = (ns.split(".") if ns else []) + [arq.stem]
        nos[i]["sep"] = "."
    for i, arq, _ in itens:
        t, ns, usings, apelidos = info[i]
        # via using/global using conta como import; o próprio namespace, os de cima e o global são implícitos (leve)
        com_using = [por_ns[v] for v in set(usings) | globais if v in por_ns]
        implicitos, p = {""}, ns
        while p:
            implicitos.add(p)
            p = p.rsplit(".", 1)[0] if "." in p else ""
        sem_using = [por_ns[v] for v in implicitos if v in por_ns]
        for a in apelidos:
            ligar(arestas, i, fq.get(a))
        for nome in set(RE_IDENT.findall(t)):
            for mp in com_using:
                ligar(arestas, i, mp.get(nome))
            for mp in sem_using:
                ligar(arestas, i, mp.get(nome), True)
        for nome in set(RE_FQ.findall(t)):
            ligar(arestas, i, fq.get(nome))


# ---------------------------------------------------------------- Rust

RE_RS_MOD = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;", re.M)
RE_RS_USE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);", re.M)
RE_RS_CAMINHO = re.compile(r"\b(crate|self|super)((?:::\w+)+)")
RE_RS_RELATIVO = re.compile(r"(?<![\w:])([a-z_]\w*)((?:::\w+)+)")
RE_RS_LIMPA = re.compile(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"', re.S)


def expandir_use(s: str) -> list:
    """'crate::a::{b, c::{d, e as f}}' → ['crate::a::b', 'crate::a::c::d', 'crate::a::c::e']"""
    s = re.sub(r"\s+", "", re.sub(r"\s+as\s+\w+", "", s))
    k = s.find("{")
    if k < 0:
        return [s]
    pre, partes, prof, ini = s[:k], [], 0, k + 1
    for j in range(k + 1, len(s)):
        ch = s[j]
        if ch == "{":
            prof += 1
        elif ch == "}":
            if prof == 0:
                partes.append(s[ini:j])
                break
            prof -= 1
        elif ch == "," and prof == 0:
            partes.append(s[ini:j])
            ini = j + 1
    res = []
    for p in partes:
        if p:
            res += [re.sub(r"::$", "", pre)] if p == "self" else expandir_use(pre + p)
    return res


def analisar_rust(itens, raiz, nos, arestas, ctx):
    mods, info = {}, {}
    for i, arq, _ in itens:
        a = arq.resolve()
        d_cargo = ancestral(a.parent, "Cargo.toml")
        mp = None
        if d_cargo is not None:
            try:
                r = a.relative_to(d_cargo / "src")
            except ValueError:
                r = None
            if r is not None:
                mp = list(r.with_suffix("").parts)
                if len(mp) == 1 and mp[0] in ("lib", "main"):
                    mp = []
                elif mp[-1] == "mod":
                    mp.pop()
                mods.setdefault((d_cargo, "::".join(mp)), i)
        info[i] = (d_cargo, mp)
        ps = list(arq.relative_to(raiz).with_suffix("").parts)
        if len(ps) > 1 and ps[-1] == "mod":
            ps.pop()
        nos[i]["partes"] = ps
        nos[i]["sep"] = "/"
    for i, arq, texto in itens:
        d_cargo, mp = info[i]
        if mp is None:
            continue
        m = re.search(r'^\[package\][^\[]*?^name\s*=\s*"([^"]+)"', ler_config(d_cargo / "Cargo.toml"), re.M)
        nome_crate = m.group(1).replace("-", "_") if m else ""
        t = RE_RS_LIMPA.sub(" ", texto)

        def ligar_caminho(segs, minimo):
            for k in range(len(segs), minimo - 1, -1):
                j = mods.get((d_cargo, "::".join(segs[:k])))
                if j is not None:
                    ligar(arestas, i, j)
                    return True
            return False

        # "mod x;" só monta a árvore de módulos (leve); o uso real vem pelos caminhos
        for m in RE_RS_MOD.finditer(t):
            ligar(arestas, i, mods.get((d_cargo, "::".join(mp + [m.group(1)]))), True)
        # caminho sem prefixo no meio do código (config::carregar()): só vale para módulos filhos
        for m in RE_RS_RELATIVO.finditer(t):
            if m.group(1) in ("crate", "self", "super", nome_crate):
                continue
            ligar_caminho(mp + [m.group(1)] + [x for x in m.group(2).split("::") if x], len(mp) + 1)
        usados = [p for m in RE_RS_USE.finditer(t) for p in expandir_use(m.group(1))]
        usados += [m.group(1) + m.group(2) for m in RE_RS_CAMINHO.finditer(t)]
        if nome_crate:
            usados += [nome_crate + m.group(1) for m in re.finditer(r"\b" + nome_crate + r"((?:::\w+)+)", t)]
        for u in set(usados):
            segs = [x for x in u.split("::") if x and x != "*"]
            if not segs:
                continue
            cab = segs[0]
            if cab in ("crate", nome_crate):
                ligar_caminho(segs[1:], 0)
            elif cab == "self":
                ligar_caminho(mp + segs[1:], len(mp))
            elif cab == "super":
                b, segs = mp[:-1], segs[1:]
                while segs and segs[0] == "super":
                    b, segs = b[:-1], segs[1:]
                ligar_caminho(b + segs, len(b))
            elif not ligar_caminho(mp + segs, len(mp) + 1):
                ligar_caminho(segs, 1)  # caminho sem prefixo (edição 2018)


ANALISADORES = {
    "python": analisar_python, "php": analisar_php, "jvm": analisar_jvm, "js": analisar_js,
    "dart": analisar_dart, "go": analisar_go, "c": analisar_c, "csharp": analisar_cs, "rust": analisar_rust,
}


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
    arquivos, configs = coletar(raiz, sem_testes)
    # mesma ordem do site (por caminho), para os empates "o primeiro vence" darem o mesmo resultado
    arquivos.sort(key=lambda x: x[0].relative_to(raiz).as_posix())
    configs.sort(key=lambda c: c.relative_to(raiz).as_posix())
    ctx = {"configs": configs}
    nos = [{"caminho": a.relative_to(raiz).as_posix(), "ling": l, "partes": [a.stem], "sep": "/"}
           for a, l in arquivos]
    arestas: dict[tuple[int, int], bool] = {}
    por_ling: dict[str, list] = {}
    for i, (arq, ling) in enumerate(arquivos):
        por_ling.setdefault(ling, []).append((i, arq, ler(arq)))
    for ling, itens in por_ling.items():
        ANALISADORES[ling](itens, raiz, nos, arestas, ctx)

    grau = Counter()
    for a, b in arestas:
        grau[a] += 1
        grau[b] += 1
    manter = [i for i in range(len(nos)) if grau[i] > 0]
    soltos = [n["caminho"] for i, n in enumerate(nos) if grau[i] == 0]
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
    arestas_f = sorted((novo[a], novo[b], leve) for (a, b), leve in arestas.items() if a in novo and b in novo)

    return {
        "titulo": titulo or raiz.resolve().name,
        "nos": [{"n": r, "c": n["caminho"], "l": n["ling"]} for r, n in zip(rotulos, nos_f)],
        "arestas": [[a, b, 1] if leve else [a, b] for a, b, leve in arestas_f],
        "ling": {NOME_LING[l]: c for l, c in Counter(n["ling"] for n in nos_f).most_common()},
        "lidos": len(arquivos),
        "soltos": sorted(soltos)[:300],
        "nSoltos": len(soltos),
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
    <form id="formBusca" autocomplete="off">
      <input id="busca" list="lista" placeholder="Buscar arquivo…" aria-label="Buscar arquivo no grafo">
      <datalist id="lista"></datalist>
      <button type="button" id="semente">Nova semente</button>
      <button type="button" id="limpar" hidden>Limpar seleção</button>
    </form>
    <div class="acoes" id="acoes">
      <div class="cores" role="group" aria-label="Cor do desenho">
        <button type="button" class="cor" data-cor="neon" aria-pressed="true"><i></i>Neon</button>
        <button type="button" class="cor" data-cor="ouro" aria-pressed="false"><i></i>Ouro</button>
        <button type="button" class="cor" data-cor="gelo" aria-pressed="false"><i></i>Gelo</button>
        <button type="button" class="cor" data-cor="brasa" aria-pressed="false"><i></i>Brasa</button>
      </div>
      <details class="baixar">
        <summary>Baixar imagem</summary>
        <div class="menu">
          <button type="button" data-exp="tela">Como está na tela</button>
          <button type="button" data-exp="parede">Papel de parede · 1080×2340</button>
          <button type="button" data-exp="post">Post · 1080×1350</button>
          <button type="button" data-exp="social">Prévia do GitHub · 1280×640</button>
        </div>
      </details>
      <p class="aviso-img" id="avisoImagem" role="status" aria-live="polite"></p>
    </div>
    <div class="ficha" id="ficha" hidden>
      <h3 id="fNome"></h3>
      <p class="cam" id="fCam"></p>
      <p class="num" id="fNum"></p>
      <p class="fciclo" id="fCiclo" hidden></p>
      <h4>Importa</h4><div class="chips" id="fDeps"></div>
      <h4>É importado por</h4><div class="chips" id="fUsos"></div>
    </div>
    <p class="leg">Cada fio é um import entre dois arquivos do projeto: quem importa fica acima, o que é importado fica abaixo. O raio branco é a maior cadeia de dependências. Fios <span class="nome-cor-ciclo">vermelhos</span> são imports circulares.</p>
    <p class="cadeia" id="cadeia"></p>
    <section class="ciclos" id="ciclos" aria-labelledby="ciclosTitulo">
      <h3 id="ciclosTitulo">Imports circulares</h3>
      <p id="ciclosResumo"></p>
      <ol id="ciclosLista"></ol>
      <button type="button" id="btnCiclos" aria-pressed="false" hidden>Destacar ciclos</button>
    </section>
    <section class="raiox" id="raiox" aria-labelledby="raioxTitulo">
      <h3 id="raioxTitulo">Raio-X</h3>
      <p id="rxResumo"></p>
      <div class="rx-cols">
        <div><h4>Mais críticos</h4><p class="rx-sub">quantos arquivos dependem dele, direta ou indiretamente</p><div id="rxCriticos"></div></div>
        <div><h4>Mais dependentes</h4><p class="rx-sub">quantos arquivos ele puxa, direta ou indiretamente</p><div id="rxPesados"></div></div>
      </div>
      <details class="rx-soltos" id="rxSoltos" hidden><summary></summary><p></p></details>
    </section>
    <p class="nota">Toque num rótulo ou perto de um fio para acender o que aquele arquivo puxa. Gerado por grafo_neon.py.</p>
  </section>
</main>
<script>
/*__GRAFO__*/
</script>
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
        grafo = (PASTA / "grafo.js").read_text(encoding="utf-8")
    except OSError:
        sys.exit("Não achei estilo.css, grafo.js e render.js ao lado do grafo_neon.py. Baixe o repositório inteiro.")
    js = json.dumps(dados, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return (MODELO_HTML
            .replace("__TITULO__", html.escape(dados["titulo"]))
            .replace("/*__CSS__*/", css)
            .replace("/*__GRAFO__*/", grafo.replace("</script", "<\\/script"))
            .replace("/*__RENDER__*/", render.replace("</script", "<\\/script"))
            .replace("/*__DADOS__*/null", js))


if __name__ == "__main__":
    main()
