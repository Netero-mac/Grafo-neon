<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Produto extends Model { use HasPreco; public function categoria(){ return $this->belongsTo(Categoria::class); } }
