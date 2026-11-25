package estoque

import "github.com/marco/loja/internal/banco"

// Total soma o estoque; "versao" aqui é só texto
func Total() int { return banco.Contar() + itensPadrao }
