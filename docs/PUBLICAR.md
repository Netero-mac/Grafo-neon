# Publicar uma versão no PyPI

O workflow `.github/workflows/publicar.yml` publica o pacote sempre que um release é criado no GitHub. Ele usa *trusted publishing*: o PyPI confia neste repositório e não precisa de senha nem token guardado.

## Uma vez só: ligar o PyPI ao repositório

1. Crie uma conta em https://pypi.org e ative a verificação em duas etapas, que o PyPI exige.
2. Abra **Your account → Publishing → Add a new pending publisher → GitHub** e preencha:

   | Campo | Valor |
   |---|---|
   | PyPI Project Name | `grafo-neon` |
   | Owner | `Netero-mac` |
   | Repository name | `Grafo-neon` |
   | Workflow name | `publicar.yml` |
   | Environment name | `pypi` |

   Se o nome `grafo-neon` já existir no PyPI, escolha outro e troque o `name` no `pyproject.toml`.

## A cada versão

1. Troque `__version__` em `grafo_neon/__init__.py` (por exemplo, `0.1.0` → `0.2.0`) e envie para o `main`.
2. No GitHub, abra **Releases → Draft a new release**, crie a tag `v0.2.0` (com `v` e o mesmo número) e publique.
3. Acompanhe em **Actions → publicar no PyPI**. Se a tag não bater com o `__version__`, o workflow para antes de publicar.

Depois disso, qualquer pessoa instala com `pip install grafo-neon` e roda `grafo-neon .` na pasta de um projeto.
