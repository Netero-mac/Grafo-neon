package main

import (
	"fmt"

	db "github.com/marco/loja/internal/banco"
	"github.com/marco/loja/internal/estoque"
)

func main() { fmt.Println(estoque.Total(), db.Abrir(), versao()) }
