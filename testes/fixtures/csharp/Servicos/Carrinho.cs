using Loja.Modelos;

namespace Loja.Servicos
{
    public class Carrinho
    {
        // "Relatorio" aqui no comentário não conta
        public decimal Total() => new Produto().Preco;
    }
}
