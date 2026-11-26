# Grafo neon

[![testes](https://github.com/Netero-mac/Grafo-neon/actions/workflows/testes.yml/badge.svg)](https://github.com/Netero-mac/Grafo-neon/actions/workflows/testes.yml)

**Português** · [English](README.en.md)

Cole o link de um repositório público do GitHub e veja as dependências entre os arquivos desenhadas como um raio neon.

**Site:** https://netero-mac.github.io/Grafo-neon/

![Animação do Grafo neon desenhando o werkzeug: o raio aparece de cima para baixo, troca de paleta e destaca os imports circulares em vermelho](https://raw.githubusercontent.com/Netero-mac/Grafo-neon/main/docs/demo.gif)

Cada fio é um import entre dois arquivos do projeto: quem importa fica em cima, o que é importado fica embaixo. O raio branco no meio é a **maior cadeia de imports** do projeto. Toque num rótulo para acender tudo o que aquele arquivo puxa e ver a lista do que ele importa e de quem o importa.

## Como usar

### No site

Cole qualquer um destes formatos e toque em **Desenhar**:

| Formato | Exemplo |
|---|---|
| dono/repositório | `pallets/flask` |
| link do repositório | `https://github.com/psf/requests` |
| link de um ramo ou pasta | `https://github.com/pytest-dev/pytest/tree/main/src` |

Depois de desenhar, o endereço da página vira um link que você pode compartilhar, por exemplo `…/Grafo-neon/?repo=pallets/flask`.

Os testes ficam de fora por padrão. Desmarque **Ignorar testes** para incluí-los.

### Cores e imagens

Abaixo do desenho dá para escolher a paleta (**Neon**, **Ouro**, **Gelo** ou **Brasa**) e baixar um PNG:

| Formato | Tamanho |
|---|---|
| Como está na tela | o tamanho do desenho, com a densidade da sua tela |
| Papel de parede | 1080 × 2340, com espaço para o relógio e os ícones |
| Post | 1080 × 1350, com o nome do projeto e os números embaixo |
| Prévia do GitHub | 1280 × 640: suba em **Settings → Social preview** do repositório, e o link do projeto passa a mostrar o grafo quando for compartilhado |

A cor escolhida fica salva no navegador e vai junto no link (`&cor=ouro`).

### No terminal (pastas locais e projetos privados)

```bash
pip install git+https://github.com/Netero-mac/Grafo-neon   # instala direto do GitHub
grafo-neon caminho/do/projeto
grafo-neon caminho/do/projeto -o meu_grafo.html --titulo "Meu App"
grafo-neon caminho/do/projeto --sem-testes --max-nos 300 --json
```

Quando o pacote estiver no PyPI, a instalação vira `pip install grafo-neon`. Sem instalar nada, dá para rodar `python3 -m grafo_neon caminho/do/projeto` na pasta deste repositório.

O comando só usa a biblioteca padrão do Python (3.10+) e gera uma página HTML única que funciona offline.

## Linguagens

| Linguagem | O que conta como dependência |
|---|---|
| Python | `import` e `from … import`, inclusive relativos (`from . import x`). O script lê com `ast`; o site lê com expressões regulares e os dois batem com o gabarito dos testes. |
| PHP / Laravel | `use App\…`, nomes completos (`\App\Models\User`) e classes do mesmo namespace usadas pelo nome curto |
| Kotlin / Java | `import`, nomes completos no código e classes, funções e `val` de nível superior do mesmo pacote (comum no Jetpack Compose) |
| JavaScript / TypeScript | `import … from './x'`, `export … from`, `require()` e `import()` com caminho relativo ou `@/` |
| Dart / Flutter | `import`, `export` e `part`, inclusive `package:nome/…` resolvido pelo `pubspec.yaml` |
| Go | `import` de pacotes do próprio módulo (pelo `go.mod`) liga a todos os arquivos do pacote, menos os de teste. Também conta o uso de nomes declarados em outro arquivo do mesmo pacote |
| C / C++ | `#include "…"` relativo ao arquivo, ou pelo fim do caminho. `#include <pasta/x.h>` só quando tem pasta, para não confundir com a biblioteca do sistema |
| C# | tipos de namespaces trazidos por `using` e `global using`, do próprio namespace e dos de cima, e nomes completos |
| Rust | `use crate::`, `super::`, `self::` e `nome_do_crate::` (com chaves), `mod x;` e caminhos para módulos filhos |

Para projetos com mais de 2.000 imports, o desenho junta os fios em lotes e limita os enfeites das bordas. Assim, até a biblioteca padrão do Go (cerca de 19 mil ligações) redesenha em menos de um décimo de segundo.

Só entram ligações **entre arquivos do próprio projeto**. Bibliotecas externas ficam de fora, e arquivos sem nenhuma ligação também.

## Imports circulares

Quando um grupo de arquivos se importa em círculo (A importa B, que importa C, que importa A), os fios desse grupo ficam **vermelhos**. O painel lista cada grupo com um ciclo de exemplo, e o botão **Destacar ciclos** apaga o resto do desenho.

Só contam os imports que rodam no carregamento. Ficam de fora:

- em Python, imports dentro de funções e dentro de `if TYPE_CHECKING:`;
- em JS/TS, `import type` e `import()` dinâmico.

Também não contam as referências implícitas, que ligam arquivos sem ser um import de verdade:

- nomes usados dentro do mesmo pacote (Go, Kotlin/Java) ou namespace (C#, PHP);
- as declarações `mod x;` do Rust, que só montam a árvore de módulos.

Essas ligações aparecem mais apagadas no desenho. Em Python e JS, um ciclo pode quebrar a importação conforme a ordem em que os arquivos carregam. Em Kotlin, Java e PHP ele não dá erro, mas indica acoplamento forte.

## Raio-X

O painel **Raio-X** mostra:

- **Mais críticos:** os arquivos dos quais mais arquivos dependem, direta ou indiretamente. São os que mais podem quebrar o projeto se mudarem.
- **Mais dependentes:** os arquivos que puxam mais coisa.
- **Resumo:** a maior cadeia, a média de imports por arquivo e quantos arquivos ficaram de fora do desenho por não ter nenhuma ligação. Toque no resumo para ver a lista desses arquivos.

A ficha de cada arquivo também mostra esses números: quantos ele importa e por quantos é importado, direto e no total.

## Como funciona

1. **Lista de arquivos:** o site pede a árvore do repositório à API do GitHub (2 consultas). Se o limite estourar, ele usa o espelho do [jsDelivr](https://www.jsdelivr.com/).
2. **Conteúdo:** baixa os arquivos de código do `raw.githubusercontent.com`, 10 de cada vez, e passa para o jsDelivr se o GitHub recusar.
3. **Análise** (`analisador.js`): acha os imports de cada arquivo e os transforma em arestas `a → b` ("a importa b").
4. **Ciclos e raio-X** (`grafo.js`): componentes fortemente conexos (Tarjan), com um ciclo curto de exemplo por grupo achado com busca em largura, e o alcance de cada arquivo para frente e para trás.
5. **Desenho** (`render.js`):
   - quebra os ciclos com uma busca em profundidade;
   - organiza os arquivos em camadas;
   - acha a maior cadeia e a desenha como um raio, com deslocamento de ponto médio;
   - posiciona o resto aproximando cada arquivo dos vizinhos (média dos vizinhos);
   - desenha cada import como uma curva de Bézier em várias passadas de brilho, num Canvas.

Tudo roda no navegador. Não existe servidor, e nada é enviado para lugar nenhum além dos pedidos ao GitHub e ao jsDelivr.

## Limites

- Sem login, a API do GitHub permite **60 consultas por hora** por endereço IP, e cada repositório gasta 2.
- O site lê até 1.500 arquivos de código e desenha até 600. Em repositórios enormes, aponte para uma pasta (`…/tree/main/src`).
- Imports montados em tempo de execução (`importlib`, `require(variavel)`, rotas do Laravel em texto) não aparecem.
- Em Go, Kotlin/Java, C# e PHP, nomes do mesmo pacote ou namespace são reconhecidos por texto, então pode haver alguma ligação a mais. Essas ligações são leves e não entram nos ciclos.

## Testes

```bash
node --test testes/analisador.test.js        # analisador do site e algoritmos de grafo
python -m unittest discover -s testes -v     # comando, página gerada e paridade com o site
```

Os projetos em `testes/fixtures` (um por linguagem) cobrem os casos difíceis:

- imports dentro de funções e de `if TYPE_CHECKING:`;
- assinaturas de função em várias linhas;
- subpacotes sem `__init__.py`;
- um `json.py` do projeto com o mesmo nome da biblioteca padrão;
- imports citados em docstrings e strings;
- `import type`, `import()` e `require`;
- `package:` do Dart, `go.mod` e arquivos de teste do Go, include por pasta no C, `global using` no C#, e `use` com chaves e `super::` no Rust.

`testes/esperado.json` tem, escritos à mão, os imports e ciclos certos de cada projeto. Os dois analisadores são conferidos contra esse gabarito e um contra o outro. O GitHub Actions roda tudo a cada envio, com Python 3.10 e 3.13, e também constrói, instala e roda o pacote.

## Estrutura

```
index.html      página do site
app.js          busca o repositório no GitHub e mostra o progresso
analisador.js   acha os imports (Python, JS/TS, PHP, Kotlin/Java, Dart, Go, C/C++, C#, Rust)
exemplo.json    grafo de exemplo mostrado na abertura (núcleo do pytest)
grafo_neon/     pacote Python (comando grafo-neon) e os arquivos que o site também usa:
  __init__.py     analisadores em Python e geração da página
  grafo.js        algoritmos de grafo sem tela (ciclos, raio-X)
  render.js       desenho neon em Canvas
  estilo.css      estilos
pyproject.toml  configuração do pacote para o PyPI (como publicar: docs/PUBLICAR.md)
testes/         testes, projetos de exemplo e gabarito
```

Para rodar o site no seu computador: `python3 -m http.server` na pasta do projeto, depois abra `http://localhost:8000`.

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
