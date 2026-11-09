import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('PORTAL_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function escapePromRegex(value: string) {
  return value.replace(/[\\.*+?^${}()|[\]]/g, '\\$&')
}

type Frame = { schema?: { fields?: { name: string; labels?: Record<string,string>; type?: string }[] }; data?: { values?: unknown[][] } }
type QueryResult = { results?: Record<string, { frames?: Frame[]; error?: string }> }

function framesFor(result: QueryResult, refId: string): Frame[] { return result.results?.[refId]?.frames ?? [] }
function points(frames: Frame[], valueField?: string) {
  const out: { time: number; value: number; name?: string }[] = []
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? []; const values = frame.data?.values ?? []
    const ti = fields.findIndex(f => f.name.toLowerCase() === 'time')
    let vi = valueField ? fields.findIndex(f => f.name.toLowerCase() === valueField.toLowerCase()) : -1
    if (vi < 0) vi = fields.findIndex((f,i) => i !== ti && (f.name === 'Value' || f.type === 'number'))
    if (vi < 0) vi = fields.length - 1
    const name = fields.find((f,i)=>i!==ti&&i!==vi)?.labels?.image || fields.find((f,i)=>i!==ti&&i!==vi)?.labels?.instance
    const ts = values[ti] ?? []; const vs = values[vi] ?? []
    for (let i=0;i<vs.length;i++) { const n=Number(vs[i]); if(Number.isFinite(n)) out.push({time: Number(ts[i] ?? Date.now()), value:n, ...(name?{name}:{})}) }
  }
  return out
}
function lastValue(frames: Frame[]): number | null {
  const p = points(frames); return p.length ? p[p.length-1].value : null
}
function seriesByName(frames: Frame[]) {
  return frames.map(frame=>{
    const fields=frame.schema?.fields??[];const values=frame.data?.values??[]
    const ti=fields.findIndex(f=>f.name.toLowerCase()==='time');let vi=fields.findIndex((f,i)=>i!==ti&&(f.name==='Value'||f.type==='number'));if(vi<0)vi=fields.length-1
    const label=fields.find(f=>f.labels && Object.keys(f.labels).length>0) || fields.find((f,i)=>i!==ti&&i!==vi)
    const name=label?.labels?.app || label?.labels?.image?.split('/').pop()?.replace(/:.*/, '') || label?.labels?.container || label?.name || 'série'
    const n=Number((values[vi]??[]).at(-1));return {name,value:Number.isFinite(n)?n:0}
  }).sort((a,b)=>b.value-a.value).slice(0,10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Autenticação necessária.' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Sessão inválida ou expirada.' }, 401)
    const { data: access, error: accessError } = await userClient.from('portal_access').select('enabled').eq('user_id', userData.user.id).maybeSingle()
    if (accessError || access?.enabled !== true) return json({ error: 'Seu usuário ainda não está autorizado a consultar o EBC Monitor.' }, 403)

    const grafanaUrl = Deno.env.get('GRAFANA_URL')
    const grafanaToken = Deno.env.get('GRAFANA_SERVICE_ACCOUNT_TOKEN')
    const datasourceUid = Deno.env.get('GRAFANA_DATASOURCE_UID') ?? 'prometheus'
    if (!grafanaUrl || !grafanaToken) return json({ error: 'Integração Grafana ainda não configurada no backend.' }, 503)

    const body = await req.json().catch(()=>({}))
    const rawFilter = typeof body.imageFilter === 'string' ? body.imageFilter.trim().slice(0,80) : ''
    const filter = rawFilter ? `.*${escapePromRegex(rawFilter)}.*` : '.*'
    const common = (expr:string, refId:string, instant=true) => ({ refId, datasource:{type:'prometheus',uid:datasourceUid}, expr, instant, range:!instant, format:'time_series', intervalMs:60000, maxDataPoints:300 })
    const queries = [
      common('100 - (avg by (instance) (rate(node_cpu_seconds_total{job="node-exporter", mode="idle"}[5m])) * 100)','A'),
      common('(1 - (node_memory_MemAvailable_bytes{job="node-exporter"} / node_memory_MemTotal_bytes{job="node-exporter"})) * 100','B'),
      common('(1 - (node_filesystem_avail_bytes{job="node-exporter", mountpoint="/"} / node_filesystem_size_bytes{job="node-exporter", mountpoint="/"})) * 100','C'),
      common(`count(count by (id) (container_last_seen{job="cadvisor", image=~"${filter}"}))`,'D'),
      common('rate(node_network_receive_bytes_total{job="node-exporter", device!="lo"}[5m])','E',false),
      common('rate(node_network_transmit_bytes_total{job="node-exporter", device!="lo"}[5m])','F',false),
      common(`topk(10, label_replace(sum by (image) (rate(container_cpu_usage_seconds_total{job="cadvisor", image=~"${filter}"}[5m])) * 100, "app", "$1", "image", ".*/([^/:]+):.*"))`,'G'),
      common(`topk(10, label_replace(sum by (image) (container_memory_usage_bytes{job="cadvisor", image=~"${filter}"}), "app", "$1", "image", ".*/([^/:]+):.*"))`,'H'),
      common(`label_replace(sum by (image) (container_memory_usage_bytes{job="cadvisor", image=~"${filter}"}), "app", "$1", "image", ".*/([^/:]+):.*")`,'I'),
      common(`label_replace(sum by (image) (rate(container_cpu_usage_seconds_total{job="cadvisor", image=~"${filter}"}[5m])) * 100, "app", "$1", "image", ".*/([^/:]+):.*")`,'J'),
    ]
    const now=Date.now(); const from=now-60*60*1000
    const response=await fetch(`${grafanaUrl.replace(/\/$/,'')}/api/ds/query`,{
      method:'POST',headers:{'Authorization':`Bearer ${grafanaToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:String(from),to:String(now),queries})
    })
    if(!response.ok){const detail=await response.text();console.error('Grafana query failed',response.status,detail.slice(0,500));return json({error:`Grafana não autorizou a consulta (HTTP ${response.status}). Verifique a conta técnica e a permissão da fonte Prometheus.`},502)}
    const result=await response.json() as QueryResult
    for(const ref of Object.keys(result.results??{})){if(result.results?.[ref]?.error)console.error(`Grafana ${ref}:`,result.results[ref].error)}
    const networkRx=points(framesFor(result,'E'));const networkTx=points(framesFor(result,'F'))
    const rxMap=new Map(networkRx.map(p=>[p.time,p.value]));const txMap=new Map(networkTx.map(p=>[p.time,p.value]));const times=[...new Set([...rxMap.keys(),...txMap.keys()])].sort((a,b)=>a-b)
    const network=times.map(time=>({time,rx:[...networkRx.filter(p=>p.time===time)].reduce((s,p)=>s+p.value,0),tx:[...networkTx.filter(p=>p.time===time)].reduce((s,p)=>s+p.value,0)}))
    const memoryFrames=framesFor(result,'I');const cpuFrames=framesFor(result,'J')
    const memoryByImage=seriesByName(framesFor(result,'H')).map(x=>({...x,value:x.value/1024/1024}))
    const cpuByImage=seriesByName(framesFor(result,'G'))
    const memoryMap=new Map(seriesByName(memoryFrames).map(x=>[x.name,x.value]));const cpuMap=new Map(seriesByName(cpuFrames).map(x=>[x.name,x.value]))
    const names=[...new Set([...memoryMap.keys(),...cpuMap.keys()])]
    return json({generatedAt:new Date().toISOString(),refreshSeconds:60,cpu:lastValue(framesFor(result,'A')),memory:lastValue(framesFor(result,'B')),disk:lastValue(framesFor(result,'C')),containers:lastValue(framesFor(result,'D')),network,cpuByImage,memoryByImage,table:names.map(name=>({name,memory:memoryMap.get(name)??0,cpu:cpuMap.get(name)??0})).sort((a,b)=>b.memory-a.memory)})
  } catch (error) {
    console.error(error)
    return json({ error: 'Erro interno ao consultar o monitoramento.' }, 500)
  }
})
