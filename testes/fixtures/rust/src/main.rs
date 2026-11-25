mod config;
mod modelos;

use modelos::{carrinho::Carrinho, item::Item};
use std::io;

fn main() {
    let _c = config::carregar();
    let _i: Item = Item::novo(); // crate::nada::x em comentário não conta
}
