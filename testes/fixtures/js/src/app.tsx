import type { Cfg } from './config'
import api from '@/servicos/api'
import React from 'react'

export async function App(c: Cfg) {
  const pesado = await import('./pesado')
  return api(pesado, React)
}
