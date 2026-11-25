"""Núcleo. Este texto cita import os e from .fake import x, mas é docstring."""
from typing import TYPE_CHECKING

from .modelos import Pedido

if TYPE_CHECKING:
    from .servicos.pagamento import Gateway

TEXTO = "from .util import nada"  # string: não é import


class Motor:
    pedido: Pedido


def criar(
    a,
    b,
):
    from . import util
    return util
