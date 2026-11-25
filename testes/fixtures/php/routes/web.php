<?php
use App\Http\Controllers\ProdutoController;
Route::get('/', [ProdutoController::class, 'index']);
