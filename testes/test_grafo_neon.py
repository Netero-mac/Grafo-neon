"""Testes do grafo_neon.py (linha de comando). Rode com: python -m unittest discover -s testes -v"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import grafo_neon  # noqa: E402

FIXTURES = RAIZ / "testes" / "fixtures"
ESPERADO = json.loads((RAIZ / "testes" / "esperado.json").read_text(encoding="utf-8"))
PROJETOS = [k for k in ESPERADO if not k.startswith("_")]


def texto(d):
    return sorted(f"{d['nos'][e[0]]['c']} -> {d['nos'][e[1]]['c']}" + (" (leve)" if len(e) > 2 else "") for e in d["arestas"])


class TestAnalisador(unittest.TestCase):
    def test_imports_esperados(self):
        for nome in PROJETOS:
            with self.subTest(projeto=nome):
                d = grafo_neon.montar_grafo(FIXTURES / nome, False, 600, None)
                self.assertEqual(texto(d), ESPERADO[nome]["arestas"])

    def test_arquivos_soltos(self):
        for nome in PROJETOS:
            with self.subTest(projeto=nome):
                d = grafo_neon.montar_grafo(FIXTURES / nome, False, 600, None)
                self.assertEqual(d["soltos"], ESPERADO[nome]["soltos"])
                self.assertEqual(d["nSoltos"], len(ESPERADO[nome]["soltos"]))

    def test_nomes_unicos(self):
        for nome in PROJETOS:
            with self.subTest(projeto=nome):
                nomes = [n["n"] for n in grafo_neon.montar_grafo(FIXTURES / nome, False, 600, None)["nos"]]
                self.assertEqual(len(set(nomes)), len(nomes))

    def test_sem_testes_ignora_pastas_de_teste(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "app").mkdir()
            (base / "testes").mkdir()
            (base / "app" / "a.py").write_text("from app import b\n")
            (base / "app" / "b.py").write_text("x = 1\n")
            (base / "testes" / "caso.py").write_text("from app import a\n")
            com = grafo_neon.montar_grafo(base, False, 600, None)
            sem = grafo_neon.montar_grafo(base, True, 600, None)
            self.assertEqual(len(com["arestas"]), 2)
            self.assertEqual(len(sem["arestas"]), 1)


class TestPagina(unittest.TestCase):
    def test_gera_html_completo(self):
        with tempfile.TemporaryDirectory() as tmp:
            saida = Path(tmp) / "g.html"
            r = subprocess.run([sys.executable, str(RAIZ / "grafo_neon.py"), str(FIXTURES / "python"),
                                "-o", str(saida), "--json", "--titulo", "Teste </script>"],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            html = saida.read_text(encoding="utf-8")
            self.assertNotIn("/*__", html, "sobrou marcador do modelo")
            self.assertIn("GrafoNeon.montar(", html)
            self.assertIn("G.ciclos", html)
            self.assertEqual(html.count("</script>"), 3, "o título não pode fechar a tag script")
            dados = json.loads(saida.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertEqual(texto(dados), ESPERADO["python"]["arestas"])


@unittest.skipUnless(shutil.which("node"), "precisa do Node.js")
class TestParidadeComOSite(unittest.TestCase):
    """O site (analisador.js) e o script precisam achar exatamente os mesmos imports."""

    def test_mesmas_arestas_e_nomes(self):
        for nome in PROJETOS:
            with self.subTest(projeto=nome):
                r = subprocess.run(["node", str(RAIZ / "testes" / "ferramentas" / "analisar.js"), str(FIXTURES / nome)],
                                   capture_output=True, text=True, check=True)
                js = json.loads(r.stdout)
                py = grafo_neon.montar_grafo(FIXTURES / nome, False, 600, None)
                self.assertEqual(texto(js), texto(py))
                self.assertEqual(sorted((n["c"], n["n"]) for n in js["nos"]), sorted((n["c"], n["n"]) for n in py["nos"]))

    def test_mesmo_corte_quando_passa_do_limite(self):
        # com empate de grau, os dois precisam cortar os mesmos arquivos
        for nome in PROJETOS:
            for limite in (2, 3, 4):
                with self.subTest(projeto=nome, limite=limite):
                    r = subprocess.run(["node", str(RAIZ / "testes" / "ferramentas" / "analisar.js"), str(FIXTURES / nome),
                                        "--max-nos", str(limite)], capture_output=True, text=True, check=True)
                    js = json.loads(r.stdout)
                    py = grafo_neon.montar_grafo(FIXTURES / nome, False, limite, None)
                    self.assertEqual(texto(js), texto(py))


if __name__ == "__main__":
    unittest.main()
