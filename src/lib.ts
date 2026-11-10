import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const configured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = configured ? createClient(supabaseUrl!, supabaseAnonKey!) : null

export type RangeKey = '1h' | '6h' | '24h'
export type Point = { time: number; value: number; name?: string }
export type SeriesPoint = { time: number; series: { name: string; value: number }[] }
export type MonitoringData = {
  generatedAt: string; refreshSeconds: number; cpu: number | null; memory: number | null; disk: number | null
  containers: number | null; network: { time: number; rx: number; tx: number }[]
  cpuByImage: { name: string; value: number }[]; memoryByImage: { name: string; value: number }[]
  table: { name: string; memory: number; cpu: number }[]
  requestsPerSecond: number | null; errorRate: number | null; services: string[]
  requestsByService: SeriesPoint[]; errorsByService: SeriesPoint[]
  latencyP95: SeriesPoint[]; latencyP99: SeriesPoint[]
}
export async function loadMonitoring(filters: { imageFilter?: string; service?: string; range?: RangeKey } = {}): Promise<MonitoringData> {
  if (!supabase) throw new Error('Configure as variáveis do Supabase para habilitar o portal.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
  const { data, error } = await supabase.functions.invoke('monitoring-data', {
    body: filters, headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) throw new Error(error.message || 'Falha ao consultar o monitoramento.')
  if (data?.error) throw new Error(data.error)
  return data as MonitoringData
}
