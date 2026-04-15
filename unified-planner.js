const AUTH_KEY='unified_actor_session_v1'
const DEF_COLOR='#2c6e91'
const FILTERS=['S0','S1','S2','S3','S4','S5','S6','S7']
const st={tasks:[],month:'',search:'',view:'card',sort:'updatedAt',dir:'desc',statusFilters:[...FILTERS],typeFilters:['Checklist'],sel:'',log:'',auth:null,busy:'',editingId:'',editingActorEmail:'',sheetName:'PlannerTasks',liveEdits:{}}
const $=id=>document.getElementById(id)
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
const notice=(el,m,t='info')=>{if(!el)return;el.textContent=m||'';el.classList.remove('notice-success','notice-error');if(t==='success')el.classList.add('notice-success');if(t==='error')el.classList.add('notice-error')}
const api=(u,o={})=>fetch(u,{cache:'no-store',...o}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok||d?.error)throw new Error(d?.error||'Request failed');return d})
const em=v=>String(v||'').trim().toLowerCase()
const col=(v,f=DEF_COLOR)=>/^#[0-9a-fA-F]{6}$/.test(String(v||'').trim())?String(v).trim():f
const dt=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||'').trim())?String(v).trim():''
const thai=v=>{if(!v)return'-';const d=new Date(`${v}T00:00:00Z`);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('th-TH',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}
const thaiDT=v=>{if(!v)return'-';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('th-TH',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
const iso=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))return'';return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}
const syncColor=()=>{const i=$('uniColorInput'),p=$('uniColorPreview');if(!i||!p)return;i.value=col(i.value||DEF_COLOR);p.style.background=i.value}
const getActor=()=>{try{const r=sessionStorage.getItem(AUTH_KEY);if(!r)return null;const p=JSON.parse(r);const e=em(p?.email);return e?{email:e,displayName:String(p?.displayName||''),accountId:String(p?.accountId||'')}:null}catch{return null}}
const setActor=a=>{const e=em(a?.email);if(!e)return;sessionStorage.setItem(AUTH_KEY,JSON.stringify({email:e,displayName:String(a?.displayName||''),accountId:String(a?.accountId||'')}))}
const openAuth=l=>{const s=getActor();$('uniAuthSubtitle').textContent=`Enter your Jira email to ${l}`;$('uniAuthEmail').value=s?.email||'';$('uniAuthRemember').checked=Boolean(s);notice($('uniAuthStatus'),'');$('uniAuthModal').hidden=false;setTimeout(()=>$('uniAuthEmail').focus(),0)}
const openCreateModal=()=>{$('uniCreateModal').hidden=false}
const closeCreateModal=()=>{$('uniCreateModal').hidden=true}
const askAuth=l=>{const s=getActor();if(s)return Promise.resolve(s);return new Promise((res,rej)=>{st.auth={res,rej,l};openAuth(l)})}
const validateJiraEmail=e=>api(`/api/jira?action=validate_email&email=${encodeURIComponent(String(e||'').trim())}`)
const closeAuthModal=()=>{$('uniAuthModal').hidden=true}
const cancelAuthModal=(m='Authentication cancelled')=>{const p=st.auth;st.auth=null;closeAuthModal();if(p?.rej)p.rej(new Error(m))}
const monthRange=()=>{let y,m;if(/^\d{4}-\d{2}$/.test(st.month)){const x=st.month.split('-').map(Number);y=x[0];m=x[1]-1}else{const d=new Date();y=d.getUTCFullYear();m=d.getUTCMonth()}return{start:new Date(Date.UTC(y,m,1)),end:new Date(Date.UTC(y,m+1,0))}}
const durationDays=(s,e)=>{const a=Date.parse(`${s||''}T00:00:00Z`),b=Date.parse(`${e||''}T00:00:00Z`);if(Number.isNaN(a)||Number.isNaN(b))return 0;return Math.floor((b-a)/86400000)+1}
const cmp=(a,b,t='s')=>{if(t==='d'){const x=Date.parse(a||''),y=Date.parse(b||'');if(Number.isNaN(x)&&Number.isNaN(y))return 0;if(Number.isNaN(x))return 1;if(Number.isNaN(y))return -1;return x-y}return String(a||'').localeCompare(String(b||''),'th',{sensitivity:'base'})}
const hexToRgba=(hex,a=.12)=>{const m=String(hex||'').trim().match(/^#?([0-9a-fA-F]{6})$/);if(!m)return `rgba(61,103,169,${a})`;const n=parseInt(m[1],16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return `rgba(${r},${g},${b},${a})`}
const doneInfo=i=>i.isDone&&i.doneAt?`Done ${thaiDT(i.doneAt)}${i.doneByEmail?` - ${i.doneByEmail}`:''}`:'-'
const hasJiraStatus=s=>FILTERS.includes(String(s||'').toUpperCase().trim())
const isJiraTask=t=>{const src=String(t.sourceType||'').toLowerCase(),typ=String(t.taskType||'').toLowerCase();return src==='jira'||typ==='jira'}
const viewStatus=i=>i.isJiraStatus?(i.status||'-'):(i.isDone?'Done':'Pending')
const timelineText=i=>i.start&&i.end?`${thai(i.start)} - ${thai(i.end)}<br/>${durationDays(i.start,i.end)} days`:'No timeline date'
const escAttr=v=>String(v??'').replace(/\\/g,'\\\\').replace(/"/g,'\\"')

function mergeItems(){
  return st.tasks
    .filter(t=>String(t.isDeleted||'').toLowerCase()!=='true')
    .map(t=>{
      const uid=`todo:${t.id}`
      const ov=st.liveEdits[uid]
      const row=ov?{...t,...ov}:t
      const key=String(row.key||'').trim()
      const sourceType=String(row.sourceType||'todo').toLowerCase()
      const taskType=String(row.taskType||'').toLowerCase()|| (sourceType==='planner'?'planner_only':'planner_and_checklist')
      const source=(sourceType==='jira'||taskType==='jira')?'Jira':(taskType==='planner_only'?'Planner':'Checklist')
      const statusDirect=String(row.status||'').toUpperCase().trim()
      const inferredStatus=((`${row.title||''} ${row.note||''} ${key}`.toUpperCase().match(/\bS[0-7]\b/)||[])[0]||'')
      const jiraStatus=hasJiraStatus(statusDirect)?statusDirect:(hasJiraStatus(inferredStatus)?inferredStatus:'')
      const isJiraStatus=isJiraTask({sourceType,taskType})||Boolean(jiraStatus)
      return {
      uid,
      taskId:String(row.id||''),
      source,
      sourceType,
      taskType,
      title:String(row.title||''),
      key,
      owner:String(row.owner||''),
      note:String(row.note||''),
      color:col(row.color||DEF_COLOR),
      start:String(row.start||''),
      end:String(row.end||''),
      logs:Array.isArray(row.logs)?row.logs:[],
      isDone:Boolean(row.isDone),
      doneAt:String(row.doneAt||''),
      doneByEmail:String(row.doneByEmail||''),
      updatedAt:String(row.updatedAt||row.createdAt||''),
      updatedByEmail:String(row.updatedByEmail||row.createdByEmail||''),
      status:jiraStatus,
      isJiraStatus
    }
  })
}

function list(){
  const q=st.search.trim().toLowerCase(),typeAct=new Set(st.typeFilters),statusAct=new Set(st.statusFilters)
  const allowAll=typeAct.has('All')
  let it=mergeItems()
    .filter(i=>allowAll||typeAct.has(i.source))
    .filter(i=>!i.isJiraStatus||!i.status||statusAct.has(i.status))
    .filter(i=>!q||`${i.title} ${i.key} ${i.owner} ${i.note} ${i.source} ${viewStatus(i)}`.toLowerCase().includes(q))
  it.sort((a,b)=>{let r=0
    if(st.sort==='done')r=(a.isDone===b.isDone)?0:(a.isDone?1:-1)
    else if(st.sort==='title')r=cmp(a.title,b.title)
    else if(st.sort==='context')r=cmp(a.key,b.key)
    else if(st.sort==='status')r=cmp(viewStatus(a),viewStatus(b))
    else if(st.sort==='owner')r=cmp(a.owner,b.owner)
    else if(st.sort==='note')r=cmp(a.note,b.note)
    else if(st.sort==='start')r=cmp(a.start,b.start,'d')
    else if(st.sort==='end')r=cmp(a.end,b.end,'d')
    else if(st.sort==='doneInfo')r=cmp(doneInfo(a),doneInfo(b))
    else if(st.sort==='logs')r=(a.logs?.length||0)-(b.logs?.length||0)
    else if(st.sort==='type')r=cmp(a.source,b.source)
    else r=cmp(a.updatedAt,b.updatedAt,'d')
    return st.dir==='asc'?r:-r
  })
  return it
}

function renderSwitch(){
  const o=[['card','Card View'],['table','Table View'],['timeline','Timeline View'],['calendar','Calendar View']]
  $('uniViewSwitch').innerHTML=o.map(([v,l])=>`<button type="button" class="todo-segment-btn ${st.view===v?'active':''}" data-v="${v}">${l}</button>`).join('')
  $('uniViewSwitch').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.view=b.dataset.v;renderSwitch();toggleMonthFilter();render()})
}
function renderFilters(){
  const t=$('uniTypeFilterGrid')
  const opts=['All','Planner','Checklist','Jira']
  t.innerHTML=opts.map(f=>`<label><input type="checkbox" value="${f}" ${st.typeFilters.includes(f)?'checked':''}/><span>${f}</span></label>`).join('')
  t.querySelectorAll('input').forEach(i=>i.onchange=()=>{
    let vals=[...t.querySelectorAll('input:checked')].map(x=>x.value)
    if(vals.includes('All'))vals=['All']
    if(!vals.length)vals=['Checklist']
    st.typeFilters=vals
    syncQuickType()
    render()
  })
  const s=$('uniStatusFilterGrid')
  s.innerHTML=FILTERS.map(f=>`<label><input type="checkbox" value="${f}" ${st.statusFilters.includes(f)?'checked':''}/><span>${f}</span></label>`).join('')
  s.querySelectorAll('input').forEach(i=>i.onchange=()=>{st.statusFilters=[...s.querySelectorAll('input:checked')].map(x=>x.value);render()})
}
function quickTypeLabel(){
  if(st.typeFilters.includes('All'))return 'All Task Types'
  return st.typeFilters.join(', ')
}
function syncQuickType(){
  const btn=$('uniQuickTypeBtn')
  if(btn)btn.textContent=quickTypeLabel()
  const box=$('uniQuickTypeBox')
  if(box){
    box.querySelectorAll('input').forEach(i=>{i.checked=st.typeFilters.includes(i.value)})
  }
}

function cardHTML(items){
  if(!items.length)return '<div class="empty">No items</div>'
  return `<div class="uni-card-list">${items.map(i=>{const ex=st.log===i.uid,logs=Array.isArray(i.logs)?i.logs:[],tt=i.start&&i.end?`${thai(i.start)} - ${thai(i.end)}`:'No timeline date',stTag=viewStatus(i);return `<article class="todo-card ${i.isDone?'is-done':''} todo-card-checklist" data-uid="${esc(i.uid)}" style="--todo-accent:${esc(i.color)}"><div class="todo-card-main"><label class="todo-check"><input type="checkbox" data-role="toggle" ${i.isDone?'checked':''}/><span></span></label><div class="todo-copy"><div class="todo-title-row"><span class="badge ${i.source==='Planner'?'status-manual':'badge-checklist'}">${esc(i.source)}</span><span class="badge status-default">${esc(stTag)}</span><strong>${esc(i.title)}</strong>${i.key?`<span class="todo-context-inlinebar"><span class="todo-context-bartext">${esc(i.key)}</span></span>`:''}</div><div class="todo-meta-line">${esc(tt)}</div><div class="todo-meta-line">Updated ${esc(thaiDT(i.updatedAt))}${i.updatedByEmail?` | By ${esc(i.updatedByEmail)}`:''}</div><div class="todo-note">${esc(i.note||'No note')}</div><div class="todo-log-summary">${logs.length} update logs</div>${ex?`<section class="todo-log-panel"><div class="todo-log-list">${logs.length?logs.map(e=>`<article class="todo-log-entry"><div class="todo-log-time">${esc(thaiDT(e.createdAt))}${e.actorEmail?` | ${esc(e.actorEmail)}`:''}</div><div class="todo-log-message">${esc(e.message)}</div></article>`).join(''):'<div class="mini-empty">No update log yet</div>'}</div><form class="todo-log-form" data-role="log-form"><textarea name="message" placeholder="Add update log"></textarea><div class="todo-log-actions"><button class="btn primary" type="submit">Add update log</button></div></form></section>`:''}</div></div><div class="todo-card-actions"><button class="btn" type="button" data-role="inspect">Inspector</button><button class="btn" type="button" data-role="edit">Edit</button><button class="btn" type="button" data-role="delete">Delete</button><button class="btn" type="button" data-role="log">${ex?'Hide logs':'View logs'}</button></div></article>`}).join('')}</div>`
}
function tableHTML(items){
  if(!items.length)return '<div class="empty">No rows</div>'
  const sh=(label,key)=>{const active=st.sort===key;const icon=active?(st.dir==='asc'?'▲':'▼'):'↕';return `<th data-sort="${key}" class="uni-th-sort ${active?'active':''}"><span class="uni-th-label">${label}</span><span class="uni-th-icon">${icon}</span></th>`}
  return `<div class="uni-table-wrap"><table class="uni-table"><colgroup><col class="col-done"/><col class="col-task"/><col class="col-context"/><col class="col-status"/><col class="col-owner"/><col class="col-note"/><col class="col-start"/><col class="col-end"/><col class="col-updated"/><col class="col-doneinfo"/><col class="col-logs"/><col class="col-actions"/></colgroup><thead><tr>${sh('Done','done')}${sh('Task','title')}${sh('Context','context')}${sh('Status','status')}${sh('Owner','owner')}${sh('Note','note')}${sh('Start','start')}${sh('End','end')}${sh('Updated','updatedAt')}${sh('Done info','doneInfo')}${sh('Logs','logs')}<th>Actions</th></tr></thead><tbody>${items.map(i=>{const ex=st.log===i.uid,done=i.isDone&&i.doneAt?`Done ${thaiDT(i.doneAt)}${i.doneByEmail?` - ${i.doneByEmail}`:''}`:'-';return `<tr data-uid="${esc(i.uid)}" class="uni-data-row" style="--row-accent:${esc(i.color)};--row-soft:${esc(hexToRgba(i.color,.22))};--row-soft-2:${esc(hexToRgba(i.color,.13))};"><td><label class="todo-check todo-check-inline"><input type="checkbox" data-role="toggle" ${i.isDone?'checked':''}/><span></span></label></td><td class="uni-cell-task"><span class="badge ${i.source==='Planner'?'status-manual':(i.source==='Jira'?'status-s6':'badge-checklist')}">${esc(i.source)}</span> <strong>${esc(i.title)}</strong></td><td class="uni-cell-context">${i.key?`<span class="todo-context-inlinebar"><span class="todo-context-bartext">${esc(i.key)}</span></span>`:'-'}</td><td>${esc(viewStatus(i))}</td><td>${esc(i.owner||'-')}</td><td class="uni-cell-note">${esc(i.note||'-')}</td><td>${esc(thai(i.start))}</td><td>${esc(thai(i.end))}</td><td>${esc(thaiDT(i.updatedAt))}${i.updatedByEmail?`<br/><small>${esc(i.updatedByEmail)}</small>`:''}</td><td class="uni-cell-doneinfo">${esc(done)}</td><td>${esc(String((i.logs||[]).length))}</td><td><div class="uni-table-actions"><button class="uni-action-text" type="button" data-role="log">${ex?'Hide logs':'View logs'}</button><button class="uni-action-text" type="button" data-role="edit">Edit</button><button class="uni-action-text" type="button" data-role="delete">Delete</button></div></td></tr>${ex?`<tr class="uni-log-row" data-uid="${esc(i.uid)}"><td colspan="12"><section class="todo-log-panel"><div class="todo-log-list">${(i.logs||[]).length?(i.logs||[]).map(e=>`<article class="todo-log-entry"><div class="todo-log-time">${esc(thaiDT(e.createdAt))}${e.actorEmail?` | ${esc(e.actorEmail)}`:''}</div><div class="todo-log-message">${esc(e.message)}</div></article>`).join(''):'<div class="mini-empty">No update log yet</div>'}</div><form class="todo-log-form" data-role="log-form"><textarea name="message" placeholder="Add update log"></textarea><div class="todo-log-actions"><button class="btn primary" type="submit">Add update log</button></div></form></section></td></tr>`:''}`}).join('')}</tbody></table></div>`
}
function timelineHTML(items){
  const x=items.filter(i=>i.start&&i.end);if(!x.length)return '<div class="empty">No timeline item</div>'
  let y,m;if(/^\d{4}-\d{2}$/.test(st.month)){const p=st.month.split('-').map(Number);y=p[0];m=p[1]-1}else{const d=new Date();y=d.getUTCFullYear();m=d.getUTCMonth()}
  const a=new Date(Date.UTC(y,m,1)),b=new Date(Date.UTC(y,m+2,0)),days=Math.floor((b-a)/86400000)+1
  const todayIso=iso(new Date())
  const todayOffset=Math.floor((Date.parse(`${todayIso}T00:00:00Z`)-a.getTime())/86400000)
  const hasToday=todayOffset>=0&&todayOffset<days
  const todayColInline=hasToday?`<div class="planner-lab-today-column" style="left:calc(${todayOffset} * (100% / var(--lab-days)));width:calc(100% / var(--lab-days));"></div>`:''
  const head=Array.from({length:days},(_,k)=>{const d=new Date(a.getTime());d.setUTCDate(d.getUTCDate()+k);const w=d.getUTCDay()===0||d.getUTCDay()===6;const t=iso(d)===todayIso;const l=d.toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}).slice(0,2);return `<div class="planner-lab-day ${w?'is-weekend':''} ${t?'is-today':''}" style="grid-column:${k+1}"><span>${l}</span><strong>${d.getUTCDate()}</strong></div>`}).join('')
  const dayTracks=Array.from({length:days},()=>'<div class="planner-lab-track-day"></div>').join('')
  const rows=x.map(i=>{const s=new Date(`${i.start}T00:00:00Z`),e=new Date(`${i.end}T00:00:00Z`),cs=s<a?a:s,ce=e>b?b:e;if(ce<cs)return'';const so=Math.floor((cs-a)/86400000),eo=Math.floor((ce-a)/86400000),sp=Math.max(1,eo-so+1);return `<div class="planner-lab-row"><div class="planner-lab-track">${todayColInline}${dayTracks}<button class="planner-lab-bar manual" type="button" data-role="inspect" data-uid="${esc(i.uid)}" style="grid-column:${so+1} / span ${sp};--lab-bar:${esc(i.color)}"><span>${esc(i.key?`${i.title} : ${i.key}`:i.title)}</span></button></div></div>`}).filter(Boolean).join('')
  if(!rows)return '<div class="empty">No timeline item in this range</div>'
  return `<div class="planner-lab-timeline"><div class="planner-lab-timeline-shell" style="--lab-days:${days}"><div class="planner-lab-head">${head}</div><div class="planner-lab-body">${rows}</div></div></div>`
}
function calendarHTML(items){
  const x=items.filter(i=>i.start&&i.end),mr=monthRange(),nm=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const start=new Date(mr.start.getTime());start.setUTCDate(start.getUTCDate()-start.getUTCDay())
  const end=new Date(mr.end.getTime());end.setUTCDate(end.getUTCDate()+(6-end.getUTCDay()))
  const monthStartIso=iso(mr.start),monthEndIso=iso(mr.end)
  const todayIso=iso(new Date())
  const weeks=[]
  let c=new Date(start.getTime())
  while(c<=end){
    const weekStart=new Date(c.getTime()),weekEnd=new Date(c.getTime());weekEnd.setUTCDate(weekEnd.getUTCDate()+6)
    const days=Array.from({length:7},(_,k)=>{const d=new Date(weekStart.getTime());d.setUTCDate(d.getUTCDate()+k);return d})
    const segs=x.map(i=>{const s=new Date(`${i.start}T00:00:00Z`),e=new Date(`${i.end}T00:00:00Z`);if(e<weekStart||s>weekEnd)return null;const ss=s<weekStart?weekStart:s,ee=e>weekEnd?weekEnd:e,si=Math.floor((ss-weekStart)/86400000),ei=Math.floor((ee-weekStart)/86400000);return {i,si,ei,span:Math.max(1,ei-si+1),lane:0}}).filter(Boolean).sort((a,b)=>(a.si-b.si)||(b.span-a.span))
    const laneEnd=[]
    segs.forEach(seg=>{let lane=0;while(lane<laneEnd.length&&laneEnd[lane]>=seg.si)lane+=1;seg.lane=lane;laneEnd[lane]=seg.ei})
    const lanes=Math.max(1,laneEnd.length),bh=20,g=4,h=lanes*bh+(lanes-1)*g+8
    const bars=segs.map(seg=>{const left=(seg.si/7)*100,width=(seg.span/7)*100,top=seg.lane*(bh+g)+4,label=seg.i.key?`${seg.i.title} : ${seg.i.key}`:seg.i.title;return `<button class="uni-cal-bar" type="button" data-role="inspect" data-uid="${esc(seg.i.uid)}" style="left:${left}%;width:${width}%;top:${top}px;background:${esc(seg.i.color)};" title="${esc(label)}">${esc(label)}</button>`}).join('')
    const cells=days.map(d=>{const dIso=iso(d),off=dIso<monthStartIso||dIso>monthEndIso,current=dIso===todayIso,count=x.filter(i=>i.start<=dIso&&i.end>=dIso).length;return `<div class="uni-cal-day ${off?'off':''} ${current?'current':''}"><strong>${d.getUTCDate()}</strong>${count?`<div class="uni-cal-count">${count} item${count>1?'s':''}</div>`:''}</div>`}).join('')
    weeks.push(`<div class="uni-cal-week" style="--bar-zone:${h}px"><div class="uni-cal-days">${cells}</div><div class="uni-cal-bars">${bars}</div></div>`)
    c.setUTCDate(c.getUTCDate()+7)
  }
  return `<div class="uni-calendar"><div class="uni-cal-head">${nm.map(n=>`<div>${n}</div>`).join('')}</div>${weeks.join('')}</div>`
}

function ensureTask(item,actor){
  if(item.taskId)return Promise.resolve(item.taskId)
  return Promise.reject(new Error('Task ID not found'))
}
async function setDone(uid,val){
  const it=list().find(x=>x.uid===uid);if(!it)return false
  try{const a=await askAuth(val?'change done status':'undo done status'),e=em(a?.email);if(!e)throw new Error('Jira email is required');const id=await ensureTask(it,e);await api('/api/todo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,isDone:val,doneAt:val?new Date().toISOString():'',doneByEmail:val?e:'',actorEmail:e})});await load();render();if(st.sel===uid)inspect(uid);return true}catch(err){notice($('uniSync'),err.message||'Unable to update done','error');return false}
}
async function addLog(uid,msg){
  const it=list().find(x=>x.uid===uid);if(!it)return
  try{const a=await askAuth('add update log'),e=em(a?.email);if(!e)throw new Error('Jira email is required');const id=await ensureTask(it,e);const logs=Array.isArray(it.logs)?it.logs:[];await api('/api/todo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,logs:[...logs,{id:`log_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,message:msg,createdAt:new Date().toISOString(),actorEmail:e}],actorEmail:e})});await load();st.log=uid;render();if(st.sel===uid)inspect(uid);notice($('uniSync'),'Update log saved','success')}catch(err){notice($('uniSync'),err.message||'Unable to save log','error')}
}
async function editItem(uid){
  const it=list().find(x=>x.uid===uid);if(!it)return
  try{const a=await askAuth('open edit mode'),e=em(a?.email);if(!e)throw new Error('Jira email is required');st.editingId=it.taskId;st.editingActorEmail=e;const f=$('uniCreateForm');f.title.value=it.title||'';f.key.value=it.key||'';f.start.value=it.start||'';f.end.value=it.end||'';f.owner.value=it.owner||'';f.note.value=it.note||'';f.color.value=col(it.color||DEF_COLOR);f.createMode.value=it.taskType==='planner_only'?'plan_only':'checklist_and_plan';syncColor();$('uniSaveBtn').textContent='Update item';$('uniCancelEditBtn').style.display='';notice($('uniCreateStatus'),`Editing item as ${e}...`);openCreateModal()}catch(err){notice($('uniCreateStatus'),err.message||'Unable to edit','error')}
}
async function deleteItem(uid){
  const it=list().find(x=>x.uid===uid);if(!it)return
  try{const a=await askAuth('delete item'),e=em(a?.email);if(!e)throw new Error('Jira email is required');await api('/api/todo',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.taskId,actorEmail:e})});if(st.editingId===it.taskId)resetForm();if(st.sel===uid){const p=$('uniInspectorPop');p.classList.remove('open');p.innerHTML=''}await load();render();notice($('uniSync'),'Item deleted (soft delete)','success')}catch(err){notice($('uniSync'),err.message||'Unable to delete','error')}
}
function inspect(uid,anchor){
  const it=list().find(x=>x.uid===uid),pop=$('uniInspectorPop')
  if(!it){pop.classList.remove('open');pop.innerHTML='';return}
  st.sel=uid
  let editing=false
  let editActorEmail=''
  const isJiraEditable=Boolean(it.isJiraStatus)
  const accent=col(it.color||DEF_COLOR)
  const accentSoft=hexToRgba(accent,.14)
  const accentBorder=hexToRgba(accent,.42)
  const place=()=>{
    const r=anchor?.getBoundingClientRect()
    const w=pop.offsetWidth||430
    const h=pop.offsetHeight||520
    const prefLeft=(r?.right??window.innerWidth*0.5)+10
    const prefTop=(r?.top??80)-10
    const left=Math.max(8,Math.min(window.innerWidth-w-8,prefLeft))
    const top=Math.max(8,Math.min(window.innerHeight-h-8,prefTop))
    pop.style.left=`${left}px`
    pop.style.top=`${top}px`
  }
  const paintEditedItemNow=(itemUid,colorHex)=>{
    const safe=`[data-uid="${escAttr(itemUid)}"]`
    document.querySelectorAll(`.planner-lab-bar${safe}`).forEach(el=>{
      el.style.setProperty('--lab-bar',colorHex)
    })
    document.querySelectorAll(`.uni-cal-bar${safe}`).forEach(el=>{
      el.style.background=colorHex
    })
  }
  const applyLocalPatch=payload=>{
    const targetId=String(it.taskId||uid.replace(/^todo:/,'')||'').trim()
    const idxById=st.tasks.findIndex(t=>String(t.id||'').trim()===targetId)
    const idxByShape=idxById>=0?idxById:st.tasks.findIndex(t=>
      String(t.title||'')===String(it.title||'') &&
      String(t.key||'')===String(it.key||'') &&
      String(t.start||'')===String(it.start||'') &&
      String(t.end||'')===String(it.end||'')
    )
    const idx=idxByShape
    if(idx<0)return false
    st.tasks[idx]={
      ...st.tasks[idx],
      sourceType:payload.taskType==='planner_only'?'planner':'todo',
      taskType:payload.taskType,
      title:payload.title,
      key:payload.key,
      owner:payload.owner,
      note:payload.note,
      color:col(payload.color||DEF_COLOR),
      start:payload.start,
      end:payload.end,
      status:payload.status,
      updatedAt:new Date().toISOString(),
      updatedByEmail:payload.actorEmail
    }
    return true
  }
  const render=()=>{
    pop.innerHTML=editing?`
    <div class="uni-pop-card" style="--uni-accent:${esc(accent)};--uni-accent-soft:${esc(accentSoft)};--uni-accent-border:${esc(accentBorder)};">
      <header class="uni-pop-head">
        <div>
          <h3 class="uni-pop-title">Edit ${esc(it.title)}</h3>
          <div class="uni-pop-key">${esc(it.key||'-')}</div>
        </div>
        <button class="btn uni-inspector-close" id="uniInspectorClose" type="button">Close</button>
      </header>
      <form id="uniInspectorEditForm" class="uni-pop-edit-grid">
        <label class="uni-pop-field full"><span>Task Title</span><input name="title" value="${esc(it.title||'')}" required /></label>
        <label class="uni-pop-field full"><span>Key</span><input name="key" value="${esc(it.key||'')}" /></label>
        <label class="uni-pop-field"><span>Start Date</span><input type="date" name="start" value="${esc(it.start||'')}" required /></label>
        <label class="uni-pop-field"><span>End Date</span><input type="date" name="end" value="${esc(it.end||'')}" required /></label>
        <label class="uni-pop-field"><span>Task Type</span><select name="taskType"><option value="planner_only" ${it.taskType==='planner_only'?'selected':''}>Planner</option><option value="planner_and_checklist" ${it.taskType==='planner_and_checklist'?'selected':''}>Checklist</option></select></label>
        <label class="uni-pop-field"><span>Status (Jira)</span><select name="status" ${isJiraEditable?'':'disabled'}><option value="">-</option>${FILTERS.map(s=>`<option value="${s}" ${it.status===s?'selected':''}>${s}</option>`).join('')}</select></label>
        <label class="uni-pop-field"><span>Owner</span><input name="owner" value="${esc(it.owner||'')}" /></label>
        <label class="uni-pop-field uni-pop-color-field"><span>Color</span><input type="color" name="color" value="${esc(col(it.color||DEF_COLOR))}" /></label>
        <label class="uni-pop-field full"><span>Note</span><textarea name="note">${esc(it.note||'')}</textarea></label>
        <div class="uni-pop-edit-actions full">
          <button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" id="uniInspectorCancelEdit">Cancel</button>
          <span id="uniInspectorStatus" class="notice"></span>
        </div>
      </form>
      <div class="uni-pop-loader">Updating...</div>
    </div>`:`
    <div class="uni-pop-card" style="--uni-accent:${esc(accent)};--uni-accent-soft:${esc(accentSoft)};--uni-accent-border:${esc(accentBorder)};">
      <header class="uni-pop-head">
        <div>
          <h3 class="uni-pop-title">${esc(it.title)}</h3>
          <div class="uni-pop-key">${esc(it.key||'-')}</div>
        </div>
        <button class="btn uni-inspector-close" id="uniInspectorClose" type="button">Close</button>
      </header>
      <section class="uni-pop-meta-grid">
        <p class="uni-pop-meta">${timelineText(it)}</p>
        <article class="uni-pop-meta-card"><span>Task Type</span><strong>${esc(it.source)}</strong></article>
      </section>
      <section class="uni-pop-grid">
        <article><span>Status</span><strong>${esc(viewStatus(it))}</strong></article>
        <article><span>Owner</span><strong>${esc(it.owner||'-')}</strong></article>
      </section>
      <p class="uni-pop-note">${esc(it.note||'No note')}</p>
      <article class="uni-pop-done"><span>Done Info</span><strong>${esc(doneInfo(it))}</strong></article>
      <div class="uni-pop-actions">
        <button class="btn ${it.isDone?'':'primary'}" type="button" id="uniInspectorDoneBtn">${it.isDone?'Undo Done':'Done'}</button>
        <button class="btn" type="button" id="uniInspectorEditBtn">Edit</button>
        <button class="btn" type="button" id="uniInspectorDeleteBtn">Delete</button>
        <span id="uniInspectorStatus" class="notice"></span>
      </div>
      <form id="uniInspectorLogForm" class="uni-pop-log">
        <textarea name="message" placeholder="Add update log"></textarea>
        <div class="todo-log-actions"><button class="btn primary" type="submit">Add update log</button></div>
      </form>
    </div>`
    $('uniInspectorClose').onclick=()=>pop.classList.remove('open')
    if(editing){
      $('uniInspectorCancelEdit').onclick=e=>{e.preventDefault();e.stopPropagation();editing=false;render()}
      $('uniInspectorEditForm').onsubmit=async e=>{
        e.preventDefault()
        e.stopPropagation()
        const s=$('uniInspectorStatus')
        const f=e.currentTarget
        const payload={
          title:String(f.title.value||'').trim(),
          key:String(f.key.value||'').trim(),
          start:dt(f.start.value||''),
          end:dt(f.end.value||''),
          owner:String(f.owner.value||'').trim(),
          note:String(f.note.value||'').trim(),
          color:col(f.color.value||DEF_COLOR),
          taskType:String(f.taskType.value||'planner_only'),
          status:isJiraEditable?String(f.status.value||'').toUpperCase().trim():''
        }
        if(!payload.title){notice(s,'Task title is required','error');return}
        if(!payload.start||!payload.end){notice(s,'Start and End are required','error');return}
        if(payload.end<payload.start){notice(s,'End date must be on or after Start date','error');return}
        if(payload.status&&!FILTERS.includes(payload.status)){notice(s,'Invalid Jira status','error');return}
        const card=pop.querySelector('.uni-pop-card')
        const controls=[...e.currentTarget.querySelectorAll('input,select,textarea,button')]
        const submitBtn=e.currentTarget.querySelector('button[type="submit"]')
        const setSaving=v=>{
          card?.classList.toggle('is-saving',v)
          controls.forEach(el=>{el.disabled=v})
          if(submitBtn)submitBtn.textContent=v?'Saving...':'Save'
        }
        try{
          notice(s,'Saving and syncing...')
          setSaving(true)
          const eMail=editActorEmail||em((await askAuth('update item'))?.email)
          if(!eMail)throw new Error('Jira email is required')
          await api('/api/todo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            id:it.taskId,
            sourceType:payload.taskType==='planner_only'?'planner':'todo',
            taskType:payload.taskType,
            title:payload.title,
            key:payload.key,
            owner:payload.owner,
            note:payload.note,
            color:payload.color,
            start:payload.start,
            end:payload.end,
            status:payload.status,
            actorEmail:eMail
          })})
          const livePatch={
            sourceType:payload.taskType==='planner_only'?'planner':'todo',
            taskType:payload.taskType,
            title:payload.title,
            key:payload.key,
            owner:payload.owner,
            note:payload.note,
            color:payload.color,
            start:payload.start,
            end:payload.end,
            status:payload.status,
            updatedAt:new Date().toISOString(),
            updatedByEmail:eMail
          }
          st.liveEdits[uid]=livePatch
          const patched=applyLocalPatch({...payload,actorEmail:eMail})
          if(!patched){
            notice(s,'Saved, but local item not found. Reloading...','info')
            await load()
          }
          render()
          if(st.view==='timeline'||st.view==='calendar'){render()}
          inspect(uid,anchor)
          paintEditedItemNow(uid,payload.color)
          notice($('uniSync'),'Saved','success')
          render()
          inspect(uid,anchor)
        }catch(err){notice(s,err.message||'Unable to save item','error')}
        finally{setSaving(false)}
      }
      requestAnimationFrame(place)
      return
    }
    $('uniInspectorDoneBtn').onclick=async e=>{e.preventDefault();e.stopPropagation();const s=$('uniInspectorStatus');notice(s,it.isDone?'Updating...':'Marking...');const ok=await setDone(it.uid,!it.isDone);if(!ok)notice(s,'Unable','error')}
    $('uniInspectorEditBtn').onclick=async e=>{
      e.preventDefault()
      e.stopPropagation()
      editing=true
      pop.classList.add('open')
      render()
      try{
        const a=await askAuth('open edit mode')
        editActorEmail=em(a?.email)
        const s=$('uniInspectorStatus')
        if(!editActorEmail){notice(s,'Jira email is required','error');return}
        notice(s,`Authenticated as ${editActorEmail}`,'success')
      }catch(err){
        const s=$('uniInspectorStatus')
        notice(s,err.message||'Auth is required before save','error')
      }
    }
    $('uniInspectorDeleteBtn').onclick=async e=>{e.preventDefault();e.stopPropagation();await deleteItem(it.uid)}
    $('uniInspectorLogForm').onsubmit=async e=>{e.preventDefault();e.stopPropagation();const m=String(e.currentTarget.message.value||'').trim();if(!m)return;await addLog(it.uid,m)}
    requestAnimationFrame(place)
  }
  render()
  pop.classList.add('open')
  requestAnimationFrame(place)
}

function bindHost(items){const h=$('uniViewHost');h.querySelectorAll('[data-role="inspect"]').forEach(n=>n.onclick=()=>{const uid=n.getAttribute('data-uid')||n.closest('[data-uid]')?.getAttribute('data-uid')||'';inspect(uid,n)});h.querySelectorAll('[data-role="toggle"]').forEach(n=>n.onchange=async e=>{const uid=e.target.closest('[data-uid]')?.getAttribute('data-uid')||'';const ok=await setDone(uid,Boolean(e.target.checked));if(!ok)e.target.checked=!e.target.checked});h.querySelectorAll('[data-role="edit"]').forEach(n=>n.onclick=async()=>{const uid=n.closest('[data-uid]')?.getAttribute('data-uid')||'';await editItem(uid)});h.querySelectorAll('[data-role="delete"]').forEach(n=>n.onclick=async()=>{const uid=n.closest('[data-uid]')?.getAttribute('data-uid')||'';await deleteItem(uid)});h.querySelectorAll('[data-role="log"]').forEach(n=>n.onclick=()=>{const uid=n.closest('[data-uid]')?.getAttribute('data-uid')||'';st.log=st.log===uid?'':uid;render()});h.querySelectorAll('[data-role="log-form"]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const uid=f.closest('[data-uid]')?.getAttribute('data-uid')||'',m=String(f.message.value||'').trim();if(!uid||!m)return;await addLog(uid,m)});h.querySelectorAll('th[data-sort]').forEach(th=>th.onclick=()=>{const k=th.getAttribute('data-sort');if(!k)return;if(st.sort===k)st.dir=st.dir==='asc'?'desc':'asc';else{st.sort=k;st.dir='asc'};if($('uniSortField'))$('uniSortField').value=(k==='context'?'title':(k==='doneInfo'||k==='done'||k==='logs'?'updatedAt':k));if($('uniSortDir'))$('uniSortDir').value=st.dir;render()})}

function render(){toggleMonthFilter();const items=list(),done=items.filter(i=>i.isDone).length,planner=items.filter(i=>i.source==='Planner').length,checklist=items.filter(i=>i.source==='Checklist').length;notice($('uniSummary'),`${items.length} items | done ${done} | planner ${planner} | checklist ${checklist} | view ${st.view.toUpperCase()}`);let html='';if(st.view==='table')html=tableHTML(items);else if(st.view==='timeline')html=timelineHTML(items);else if(st.view==='calendar')html=calendarHTML(items);else html=cardHTML(items);$('uniViewHost').innerHTML=html;bindHost(items)}
function toggleMonthFilter(){const w=$('uniMonthWrap'),q=$('uniQuickTypeWrap'),qb=$('uniQuickTypeBox');const monthView=st.view==='timeline'||st.view==='calendar';if(w)w.hidden=!monthView;if(q)q.hidden=false;if(qb&&q?.hidden)qb.hidden=true}

function resetForm(){st.editingId='';st.editingActorEmail='';const f=$('uniCreateForm');if(!f)return;f.reset();f.color.value=DEF_COLOR;f.createMode.value='plan_only';syncColor();$('uniSaveBtn').textContent='Create item';$('uniCancelEditBtn').style.display='none';notice($('uniCreateStatus'),'')}
async function createFromForm(f){const p={title:String(f.title.value||'').trim(),key:String(f.key.value||'').trim(),start:dt(f.start.value||''),end:dt(f.end.value||''),owner:String(f.owner.value||'').trim(),note:String(f.note.value||'').trim(),color:col(f.color.value||DEF_COLOR),mode:String(f.createMode.value||'plan_only')};if(!p.title)throw new Error('Task title is required');if(!p.start||!p.end)throw new Error('Start and End are required');if(p.end<p.start)throw new Error('End date must be on or after Start date');const a=st.editingId&&st.editingActorEmail?{email:st.editingActorEmail}:await askAuth(st.editingId?'update item':'create item'),e=em(a?.email);if(!e)throw new Error('Jira email is required');const payload={sourceType:p.mode==='checklist_and_plan'?'todo':'planner',taskType:p.mode==='checklist_and_plan'?'planner_and_checklist':'planner_only',title:p.title,key:p.key,owner:p.owner,note:p.note,color:p.color,start:p.start,end:p.end,actorEmail:e};if(st.editingId)await api('/api/todo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,id:st.editingId})});else await api('/api/todo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}

async function load(apply=true){
  if(apply)notice($('uniSync'),'Loading unified planner from PlannerTasks...')
  const t=await api(`/api/todo?_ts=${Date.now()}`)
  if(apply){
    st.tasks=Array.isArray(t.items)?t.items:[]
    st.liveEdits={}
    st.sheetName=String(t.sheetName||'PlannerTasks')
    if($('uniSheetTag'))$('uniSheetTag').textContent=`Sheet: ${st.sheetName}`
    notice($('uniSync'),`Loaded ${st.tasks.length} items from ${st.sheetName}`,'success')
  }
  return {items:Array.isArray(t.items)?t.items:[],sheetName:String(t.sheetName||'PlannerTasks')}
}

function bind(){const d=new Date();st.month=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;$('uniMonthPicker').value=st.month;renderSwitch();renderFilters();toggleMonthFilter();$('uniMonthPicker').onchange=e=>{st.month=e.target.value||st.month;render()};$('uniSearch').oninput=e=>{st.search=String(e.target.value||'');render()};$('uniSortField').onchange=e=>{st.sort=e.target.value||'updatedAt';render()};$('uniSortDir').onchange=e=>{st.dir=e.target.value||'desc';render()};$('uniRefreshBtn').onclick=async()=>{await load();render()};$('uniOpenCreateBtn').onclick=()=>{resetForm();openCreateModal()};$('uniCloseCreateBtn').onclick=()=>{closeCreateModal();resetForm()};$('uniCreateBackdrop').onclick=()=>{closeCreateModal();resetForm()};const quickBtn=$('uniQuickTypeBtn'),quickBox=$('uniQuickTypeBox');if(quickBtn&&quickBox){const closeQuick=()=>{quickBox.hidden=true;quickBtn.setAttribute('aria-expanded','false')};quickBtn.onclick=e=>{e.stopPropagation();const show=quickBox.hidden;quickBox.hidden=!show;quickBtn.setAttribute('aria-expanded',show?'true':'false')};quickBox.onclick=e=>e.stopPropagation();quickBox.querySelectorAll('input').forEach(i=>i.onchange=()=>{let vals=[...quickBox.querySelectorAll('input:checked')].map(x=>x.value);if(vals.includes('All'))vals=['All'];if(!vals.length)vals=['Checklist'];st.typeFilters=vals;syncQuickType();renderFilters();render();setTimeout(closeQuick,0)});document.addEventListener('click',e=>{if(e.target.closest('#uniQuickTypeWrap'))return;closeQuick()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeQuick()});window.addEventListener('blur',closeQuick);window.addEventListener('scroll',closeQuick,true)}syncQuickType();$('uniColorPreview').onclick=()=>$('uniColorInput').click();$('uniColorInput').oninput=syncColor;syncColor();$('uniCreateForm').onsubmit=async e=>{e.preventDefault();const s=$('uniCreateStatus');notice(s,st.editingId?'Updating item...':'Creating item...');try{await createFromForm(e.currentTarget);await load();render();resetForm();closeCreateModal();notice($('uniSync'),'Saved successfully','success')}catch(err){notice(s,err.message||'Unable to save item','error')}};$('uniCancelEditBtn').onclick=resetForm;$('uniAuthCancel').onclick=()=>cancelAuthModal();$('uniAuthBackdrop').onclick=()=>cancelAuthModal();$('uniAuthForm').onsubmit=async e=>{e.preventDefault();const p=st.auth;if(!p)return;const email=em($('uniAuthEmail').value),remember=Boolean($('uniAuthRemember').checked),s=$('uniAuthStatus'),b=$('uniAuthConfirm');if(!email){notice(s,'Jira email is required','error');return}try{b.disabled=true;notice(s,'Validating Jira email...');const r=await validateJiraEmail(email);if(!r?.valid)throw new Error(r?.reason||'Jira email not found');const actor={email:em(r?.user?.email||email),displayName:String(r?.user?.displayName||''),accountId:String(r?.user?.accountId||'')};if(remember)setActor(actor);else sessionStorage.removeItem(AUTH_KEY);st.auth=null;closeAuthModal();p.res(actor)}catch(err){notice(s,err.message||'Auth failed','error')}finally{b.disabled=false}};document.addEventListener('click',e=>{if(!$('uniAuthModal').hidden)return;const pop=$('uniInspectorPop');if(!pop.classList.contains('open'))return;if(e.target.closest('#uniInspectorPop'))return;if(e.target.closest('[data-role="inspect"]'))return;pop.classList.remove('open')})}

bind();load().then(()=>render()).catch(err=>notice($('uniSync'),err.message||'Unable to load unified planner','error'))
