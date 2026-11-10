import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('PORTAL_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
function escapePromRegex(value: string) { return value.replace(/[\\.*+?^${}()|[\]]/g, '\\$&') }
type Field = { name: string; labels?: Record<string,string>; type?: string }
type Frame = { schema?: { fields?: Field[] }; data?: { values?: unknown[][] } }
type QueryResult = { results?: Record<string, { frames?: Frame[]; error?: string }> }
function framesFor(result: QueryResult, refId: string): Frame[] { return result.results?.[refId]?.frames ?? [] }
function values(frame: Frame) {
  const fields=frame.schema?.fields??[], data=frame.data?.values??[]
  const ti=fields.findIndex(f=>f.name.toLowerCase()==='time')
  let vi=fields.findIndex((f,i)=>i!==ti&&(f.name==='Value'||f.type==='number'))
  if(vi<0)vi=fields.length-1
  return { fields, times:data[ti]??[], nums:data[vi]??[], vi, ti }
}
function lastValue(frames: Frame[]): number | null {
  for(const frame of frames){const v=values(frame).nums;for(let i=v.length-1;i>=0;i--){const n=Number(v[i]);if(Number.isFinite(n))return n}}
  return null
}
function points(frames: Frame[]) {
  const out:{time:number;value:number}[]=[]
  for(const frame of frames){const v=values(frame);v.nums.forEach((x,i)=>{const n=Number(x);if(Number.isFinite(n))out.push({time:Number(v.times[i]??Date.now()),value:n})})}
  return out
}
function seriesByName(frames: Frame[]) {
  return frames.map(frame=>{
    const v=values(frame)
    const label=v.fields.find(f=>f.labels&&Object.keys(f.labels).length>0)
    const name=label?.labels?.job || label?.labels?.app || label?.labels?.image?.split('/').pop()?.replace(/:.*/,'') || label?.labels?.container || label?.name || 'serviço'
    const n=Number(v.nums.at(-1))
    return {name,value:Number.isFinite(n)?n:0}
  }).sort((a,b)=>b.value-a.value)
}
function timeSeries(frames: Frame[]) {
  const map=new Map<number,Map<string,number>>()
  for(const frame of frames){
    const v=values(frame)
    const label=v.fields.find(f=>f.labels&&Object.keys(f.labels).length>0)
    const name=label?.labels?.job || label?.labels?.app || label?.name || 'serviço'
    v.nums.forEach((x,i)=>{const n=Number(x),t=Number(v.times[i]);if(Number.isFinite(n)&&Number.isFinite(t)){if(!map.has(t))map.set(t,new Map());map.get(t)!.set(name,n)}})
  }
  return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([time,m])=>({time,series:[...m.entries()].map(([name,value])=>({name,value}))}))
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  try {
    const authHeader=req.headers.get('Authorization')
    if(!authHeader?.startsWith('Bearer '))return json({error:'Autenticação necessária.'},401)
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!,anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authHeader}}})
    const {data:userData,error:userError}=await userClient.auth.getUser()
    if(userError||!userData.user)return json({error:'Sessão inválida ou expirada.'},401)
    const {data:access,error:accessError}=await userClient.from('portal_access').select('enabled').eq('user_id',userData.user.id).maybeSingle()
    if(accessError||access?.enabled!==true)return json({error:'Seu usuário ainda não está autorizado a consultar o monitoramento.'},403)
    const grafanaUrl=Deno.env.get('GRAFANA_URL'),grafanaToken=Deno.env.get('GRAFANA_SERVICE_ACCOUNT_TOKEN'),datasourceUid=Deno.env.get('GRAFANA_DATASOURCE_UID')??'prometheus'
    if(!grafanaUrl||!grafanaToken)return json({error:'Integração Grafana ainda não configurada no backend.'},503)
    const body=await req.json().catch(()=>({}))
    const rawImage=typeof body.imageFilter==='string'?body.imageFilter.trim().slice(0,80):''
    const rawService=typeof body.service==='string'?body.service.trim().slice(0,100):''
    const imageRegex=rawImage?`.*${escapePromRegex(rawImage)}.*`:'.*'
    const serviceRegex=rawService?escapePromRegex(rawService):'.+'
    const range=body.range==='6h'?'6h':body.range==='24h'?'24h':'1h'
    const duration=range==='24h'?24:range==='6h'?6:1
    const now=Date.now(),from=now-duration*60*60*1000,step=range==='24h'?300000:range==='6h'?60000:15000
    const common=(expr:string,refId:string,instant=true)=>({refId,datasource:{type:'prometheus',uid:datasourceUid},expr,instant,range:!instant,format:'time_series',intervalMs:step,maxDataPoints:500})
    const reqExpr='(sum by (job) (rate(http_server_duration_milliseconds_count{job=~"'+serviceRegex+'"}[5m]))) or (sum by (job) (rate(http_server_request_duration_seconds_count{job=~"'+serviceRegex+'"}[5m])))'
    const errExpr='100 * ((sum by (job) (rate(http_server_duration_milliseconds_count{job=~"'+serviceRegex+'",http_status_code=~"5.."}[5m]))) or (sum by (job) (rate(http_server_request_duration_seconds_count{job=~"'+serviceRegex+'",http_response_status_code=~"5.."}[5m])))) / ((sum by (job) (rate(http_server_duration_milliseconds_count{job=~"'+serviceRegex+'"}[5m]))) or (sum by (job) (rate(http_server_request_duration_seconds_count{job=~"'+serviceRegex+'"}[5m]))))'
    const p95='(histogram_quantile(0.95, sum by (job, le) (rate(http_server_duration_milliseconds_bucket{job=~"'+serviceRegex+'"}[5m])))) or (1000 * histogram_quantile(0.95, sum by (job, le) (rate(http_server_request_duration_seconds_bucket{job=~"'+serviceRegex+'"}[5m]))))'
    const p99='(histogram_quantile(0.99, sum by (job, le) (rate(http_server_duration_milliseconds_bucket{job=~"'+serviceRegex+'"}[5m])))) or (1000 * histogram_quantile(0.99, sum by (job, le) (rate(http_server_request_duration_seconds_bucket{job=~"'+serviceRegex+'"}[5m]))))'
    const queries=[
      common('100 - (avg by (instance) (rate(node_cpu_seconds_total{job="node-exporter",mode="idle"}[5m])) * 100)','A'),
      common('(1 - (node_memory_MemAvailable_bytes{job="node-exporter"} / node_memory_MemTotal_bytes{job="node-exporter"})) * 100','B'),
      common('(1 - (node_filesystem_avail_bytes{job="node-exporter",mountpoint="/"} / node_filesystem_size_bytes{job="node-exporter",mountpoint="/"})) * 100','C'),
      common(`count(count by (id) (container_last_seen{job="cadvisor",image=~"${imageRegex}"}))`,'D'),
      common('rate(node_network_receive_bytes_total{job="node-exporter",device!="lo"}[5m])','E',false),
      common('rate(node_network_transmit_bytes_total{job="node-exporter",device!="lo"}[5m])','F',false),
      common(`topk(10,label_replace(sum by (image) (rate(container_cpu_usage_seconds_total{job="cadvisor",image=~"${imageRegex}"}[5m]))*100,"app","$1","image",".*/([^/:]+):.*"))`,'G'),
      common(`topk(10,label_replace(sum by (image) (container_memory_usage_bytes{job="cadvisor",image=~"${imageRegex}"}),"app","$1","image",".*/([^/:]+):.*"))`,'H'),
      common(`label_replace(sum by (image) (container_memory_usage_bytes{job="cadvisor",image=~"${imageRegex}"}),"app","$1","image",".*/([^/:]+):.*")`,'I'),
      common(`label_replace(sum by (image) (rate(container_cpu_usage_seconds_total{job="cadvisor",image=~"${imageRegex}"}[5m]))*100,"app","$1","image",".*/([^/:]+):.*")`,'J'),
      common(`sum(${reqExpr})`,'K'),
      common(`100 * sum((sum by (job) (rate(http_server_duration_milliseconds_count{job=~"${serviceRegex}",http_status_code=~"5.."}[5m]))) or (sum by (job) (rate(http_server_request_duration_seconds_count{job=~"${serviceRegex}",http_response_status_code=~"5.."}[5m])))) / sum((sum by (job) (rate(http_server_duration_milliseconds_count{job=~"${serviceRegex}"}[5m]))) or (sum by (job) (rate(http_server_request_duration_seconds_count{job=~"${serviceRegex}"}[5m]))))`,'L'),
      common(reqExpr,'M',false),common(errExpr,'N',false),common(p95,'O',false),common(p99,'P',false)
    ]
    const response=await fetch(`${grafanaUrl.replace(/\/$/,'')}/api/ds/query`,{method:'POST',headers:{Authorization:`Bearer ${grafanaToken}`,'Content-Type':'application/json'},body:JSON.stringify({from:String(from),to:String(now),queries})})
    if(!response.ok){const detail=await response.text();console.error('Grafana query failed',response.status,detail.slice(0,500));return json({error:`Grafana não autorizou a consulta (HTTP ${response.status}). Verifique a conta técnica e a permissão da fonte Prometheus.`},502)}
    const result=await response.json() as QueryResult
    for(const ref of Object.keys(result.results??{}))if(result.results?.[ref]?.error)console.error(`Grafana ${ref}:`,result.results[ref].error)
    const rx=points(framesFor(result,'E')),tx=points(framesFor(result,'F')),rxMap=new Map(rx.map(p=>[p.time,p.value])),txMap=new Map(tx.map(p=>[p.time,p.value]))
    const times=[...new Set([...rxMap.keys(),...txMap.keys()])].sort((a,b)=>a-b)
    const memoryMap=new Map(seriesByName(framesFor(result,'I')).map(x=>[x.name,x.value])),cpuMap=new Map(seriesByName(framesFor(result,'J')).map(x=>[x.name,x.value]))
    const names=[...new Set([...memoryMap.keys(),...cpuMap.keys()])]
    const serviceNames=[...new Set(['M','N','O','P'].flatMap(ref=>seriesByName(framesFor(result,ref)).map(x=>x.name)))].sort()
    return json({
      generatedAt:new Date().toISOString(),refreshSeconds:60,cpu:lastValue(framesFor(result,'A')),memory:lastValue(framesFor(result,'B')),disk:lastValue(framesFor(result,'C')),containers:lastValue(framesFor(result,'D')),
      network:times.map(time=>({time,rx:rxMap.get(time)??0,tx:txMap.get(time)??0})),
      cpuByImage:seriesByName(framesFor(result,'G')),memoryByImage:seriesByName(framesFor(result,'H')).map(x=>({...x,value:x.value/1024/1024})),
      table:names.map(name=>({name,memory:memoryMap.get(name)??0,cpu:cpuMap.get(name)??0})).sort((a,b)=>b.memory-a.memory),
      requestsPerSecond:lastValue(framesFor(result,'K')),errorRate:lastValue(framesFor(result,'L')),services:serviceNames,
      requestsByService:timeSeries(framesFor(result,'M')),errorsByService:timeSeries(framesFor(result,'N')),latencyP95:timeSeries(framesFor(result,'O')),latencyP99:timeSeries(framesFor(result,'P'))
    })
  } catch(error) { console.error(error); return json({error:'Erro interno ao consultar o monitoramento.'},500) }
})
