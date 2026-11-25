using Loja.Servicos;

namespace Loja;

class Program
{
    static void Main() => System.Console.WriteLine(Formatador.Preco(new Carrinho().Total()));
}
