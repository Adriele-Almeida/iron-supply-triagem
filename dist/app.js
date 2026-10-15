'use strict';
const $ = s => document.querySelector(s);
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:'<rect x="3" y="4" width="5" height="6" rx="1"/><path d="M12 5h9M12 9h9"/><rect x="3" y="14" width="5" height="6" rx="1"/><path d="M12 15h9M12 19h9"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  cross:'<path d="m6 6 12 12M18 6 6 18"/>',
  note:'<path d="M20 11v9H4V4h10M16 3v6h6M8 13h8M8 17h6"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS = {pendente:'Pendente',aprovado:'Aprovado',ajuste:'Ajustar',descartado:'Descartar'};
const PLURAL = {todos:'Todos',pendente:'Pendentes',aprovado:'Aprovados',ajuste:'Ajustes',descartado:'Descartados'};
const TYPE = {todos:'Todas',produto:'Produtos',arte:'Artes',classificar:'A classificar'};
const RELATION = {todos:'Todos',unique:'Únicas',duplicate:'Duplicatas',similar:'Semelhantes'};
const REASONS = {ajuste:['Logomarca','Ajustes Finos'],descartado:['Duplicado','Fora de Padrão']};
const storageKey='iron-prototipo-v01';
let items=[], records={}, filters={status:[],type:[],relation:[],group:[]};
let visible=[], view='grid', columns=innerWidth<650?1:innerWidth<1050?2:3, currentId=null, zoom=1;
let pending={}, sending=false, retry=null, serial=0, noteTimers=new Map(), noteOpen=new Set();
try { const old=JSON.parse(localStorage.getItem(storageKey)||'{}'); pending=old.pending||{}; if(old.view==='list')view='list'; if(Number.isInteger(old.columns))columns=Math.max(1,Math.min(30,old.columns)); } catch {}
const record = id => ({status:'pendente',reasons:[],observation:'',...(records[id]||{})});
function remember(){try{localStorage.setItem(storageKey,JSON.stringify({pending,view,columns}));}catch{}}
function syncLabel(text,error=false){$('#sync-state').textContent=text;$('#sync-state').classList.toggle('error',error);}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3000);}
function groupText(group){return `Grupo ${String(Number(group.slice(1))).padStart(2,'0')}`;}
function relationMatch(item,value){return value==='todos'||value==='unique'&&!item.duplicate&&!item.similar||value==='duplicate'&&!!item.duplicate||value==='similar'&&!!item.similar;}
function hasFilter(kind){return filters[kind].length>0;}
function matchesValues(kind,value){return !hasFilter(kind)||filters[kind].includes(value);}
function matches(item,skip){return (skip==='status'||matchesValues('status',record(item.id).status))&&(skip==='type'||matchesValues('type',item.type))&&(skip==='relation'||!hasFilter('relation')||filters.relation.some(value=>relationMatch(item,value)))&&(skip==='group'||!hasFilter('group')||filters.group.some(value=>item.duplicate===value||item.similar===value));}
function relationLabels(item){
  const labels=[];
  if(item.similar)labels.push(`Semelhantes · ${groupText(item.similar)}`);
  if(item.duplicate)labels.push(`Duplicatas · ${groupText(item.duplicate)}`);
  if(!labels.length)labels.push('Únicas');
  return labels;
}
function reviewHtml(item,modal=false){
  const r=record(item.id), open=noteOpen.has(item.id), prefix=modal?'modal':'card';
  return `<div class="card-meta"><span class="relation-label">${relationLabels(item).map(esc).join('</span><span class="dot">/</span><span class="relation-label">')}</span><span class="dot">·</span><span class="category-pill category-${item.type}">${esc(TYPE[item.type])}</span></div>
  <div class="name-line"><div class="name-main"><h2 class="image-name">${item.id}</h2><span class="dimensions">${item.width}x${item.height}px</span></div><span class="status-pill ${r.status}">${r.status==='ajuste'?'Ajuste':r.status==='descartado'?'Descartado':STATUS[r.status]}</span></div>
  <div class="actions" aria-label="Decisão para ${item.id}">${[['aprovado','check'],['ajuste','edit'],['descartado','cross']].map(([status,icon])=>`<button class="decision ${status}${r.status===status?' selected':''}" data-action="status" data-id="${item.id}" data-value="${status}" aria-label="${STATUS[status]} ${item.id}" aria-pressed="${r.status===status}" title="${STATUS[status]}">${svg(icon)}<span class="action-text">${STATUS[status]}</span></button>`).join('')}</div>
  ${REASONS[r.status]?`<div class="reasons" aria-label="Motivo opcional">${REASONS[r.status].map(reason=>`<button class="reason-button${r.reasons.includes(reason)?' selected':''}" data-action="reason" data-id="${item.id}" data-value="${reason}" aria-pressed="${r.reasons.includes(reason)}">${reason}</button>`).join('')}</div>`:''}
  <button class="note-toggle" data-action="note" data-id="${item.id}" aria-expanded="${open}" aria-controls="${prefix}-note-${item.id}">${svg('note')}${r.observation?'Observação adicionada':'Adicionar observação'}</button>
  <div class="note-wrap" id="${prefix}-note-${item.id}"${open?'':' hidden'}><label class="note-label" for="${prefix}-text-${item.id}">Observação</label><textarea class="note-field" id="${prefix}-text-${item.id}" data-id="${item.id}" aria-label="Observação de ${item.id}" maxlength="4000" placeholder="Escreva sua observação…">${esc(r.observation)}</textarea></div>`;
}
function cardHtml(item){return `<article class="card" data-card-id="${item.id}" data-status="${record(item.id).status}"><button class="image-button" data-action="open" data-id="${item.id}" aria-label="Abrir ${item.id} em tela cheia"><img src="${item.src}" alt="${item.id}" loading="lazy" decoding="async" width="${item.width}" height="${item.height}"></button><div class="card-body">${reviewHtml(item)}</div></article>`;}
function renderGallery(){
  visible=items.filter(i=>matches(i));
  $('#gallery').innerHTML=visible.map(cardHtml).join('');$('#empty').hidden=visible.length>0;
  $('#gallery').setAttribute('aria-busy','false');
  $('#gallery').classList.toggle('list',view==='list');
  document.documentElement.style.setProperty('--cols',columns);
  $('#column-count').value=columns;$('#column-count').textContent=columns;
  $('#fewer-columns').disabled=columns<=1;$('#more-columns').disabled=columns>=items.length;
  $('#density').hidden=view==='list';
  for(const mode of ['grid','list']){$(`#${mode}-view`).classList.toggle('selected',view===mode);$(`#${mode}-view`).setAttribute('aria-pressed',String(view===mode));}
}
function optionHtml(kind,value,label,count){const active=value==='todos'?!hasFilter(kind):filters[kind].includes(value);return `<button class="filter-option${active?' active':''}" data-filter="${kind}" data-value="${value}" aria-pressed="${active}"><span>${esc(label)}</span><span class="number">${count}</span></button>`;}
function renderFilters(){
  $('#status-options').innerHTML=Object.entries(PLURAL).map(([value,label])=>optionHtml('status',value,label,items.filter(i=>value==='todos'||record(i.id).status===value).length)).join('');
  $('#type-options').innerHTML=Object.entries(TYPE).map(([value,label])=>optionHtml('type',value,label,items.filter(i=>value==='todos'||i.type===value).length)).join('');
  $('#relation-options').innerHTML=Object.entries(RELATION).map(([value,label])=>optionHtml('relation',value,label,items.filter(i=>relationMatch(i,value)&&(!hasFilter('type')||filters.type.includes(i.type))).length)).join('');
  const groups=new Map();
  items.filter(i=>(!hasFilter('type')||filters.type.includes(i.type))&&(!hasFilter('relation')||filters.relation.some(value=>relationMatch(i,value)))).forEach(i=>{for(const g of [i.similar,i.duplicate].filter(Boolean)){groups.set(g,(groups.get(g)||0)+1);}});
  filters.group=filters.group.filter(g=>groups.has(g));
  $('#group-options').innerHTML=optionHtml('group','todos','Todos os grupos',items.filter(i=>(!hasFilter('type')||filters.type.includes(i.type))&&(!hasFilter('relation')||filters.relation.some(value=>relationMatch(i,value)))).length)+[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([g,n])=>optionHtml('group',g,`${g[0]==='S'?'Semelhantes':'Duplicatas'} · ${groupText(g)}`,n)).join('');
  $('#status-value').textContent=filters.status.length?filters.status.map(v=>PLURAL[v]).join(', '):'Todos';
  $('#category-value').textContent=[...filters.type.map(v=>TYPE[v]),...filters.relation.map(v=>RELATION[v])].join(' · ')||'Todas';
  $('#group-value').textContent=filters.group.length?filters.group.map(groupText).join(', '):'Todos';
  $('#status-filter').classList.toggle('has-filter',hasFilter('status'));
  $('#category-filter').classList.toggle('has-filter',hasFilter('type')||hasFilter('relation'));
  $('#group-filter').classList.toggle('has-filter',hasFilter('group'));
  $('#clear-filters').hidden=Object.values(filters).every(v=>v.length===0);
}
function renderReview(id){
  const item=items.find(i=>i.id===id);if(!item)return;
  const card=$(`[data-card-id="${id}"]`);
  if(card){card.dataset.status=record(id).status;card.querySelector('.card-body').innerHTML=reviewHtml(item);}
  if(currentId===id)$('#viewer-review').innerHTML=reviewHtml(item,true);
}
function update(id,patch){
  records[id]={...record(id),...patch};
  const previous=pending[id]?.patch||{};pending[id]={patch:{...previous,...patch},version:++serial};remember();syncLabel('Salvando…');flush();
}
async function flush(){
  if(sending||!Object.keys(pending).length)return;
  sending=true;clearTimeout(retry);
  try{
    while(Object.keys(pending).length){
      const id=Object.keys(pending)[0], entry=pending[id];
      const response=await fetch('/api/marcacoes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,patch:entry.patch})});
      if(!response.ok)throw new Error('save failed');
      const data=await response.json();
      if(pending[id]?.version===entry.version){delete pending[id];records[id]=data.record;}
      remember();
    }
    syncLabel('Salvo');
  }catch{syncLabel('Sem conexão',true);retry=setTimeout(flush,4000);}
  finally{sending=false;}
}
function flushNotes(id){if(noteTimers.has(id)){clearTimeout(noteTimers.get(id));noteTimers.delete(id);update(id,{observation:record(id).observation});}}
function closeFilters(){document.querySelectorAll('.filter[open]').forEach(d=>d.open=false);}
function resetFilters(){filters={status:[],type:[],relation:[],group:[]};closeFilters();renderFilters();renderGallery();}
function toggleStatus(id,status){
  flushNotes(id);const next=record(id).status===status?'pendente':status;
  update(id,{status:next,reasons:[]});renderFilters();
  if(hasFilter('status')){renderGallery();if(currentId===id)renderReview(id);}else renderReview(id);
}
function resetZoom(){zoom=1;$('#image-scroll').classList.remove('zoomed');$('#image-scroll').scrollTop=0;$('#image-scroll').scrollLeft=0;$('#zoom-out').disabled=true;}
function showViewer(id){
  currentId=id;const item=items.find(i=>i.id===id);if(!item)return;
  $('#viewer-id').textContent=id;$('#viewer-position').textContent=`${Math.max(0,visible.findIndex(i=>i.id===id))+1} / ${visible.length}`;
  $('#viewer-image').src=item.src;$('#viewer-image').alt=id;$('#viewer-review').innerHTML=reviewHtml(item,true);
  resetZoom();if(!$('#viewer').open){$('#viewer').showModal();document.body.style.overflow='hidden';}
}
function navigateViewer(direction){
  if(!visible.length)return;flushNotes(currentId);const at=visible.findIndex(i=>i.id===currentId);showViewer(visible[(at+direction+visible.length)%visible.length].id);
}
function closeViewer(){if(currentId)flushNotes(currentId);$('#viewer').close();document.body.style.overflow='';currentId=null;}
function handleReviewClick(event){
  const button=event.target.closest('button[data-action]');if(!button)return;
  const {action,id,value}=button.dataset;
  if(action==='open')showViewer(id);
  if(action==='status')toggleStatus(id,value);
  if(action==='reason'){
    const reasons=[...record(id).reasons], index=reasons.indexOf(value);if(index<0)reasons.push(value);else reasons.splice(index,1);
    update(id,{reasons});renderReview(id);
  }
  if(action==='note'){
    if(noteOpen.has(id)){flushNotes(id);noteOpen.delete(id);}else noteOpen.add(id);
    const inModal=!!button.closest('#viewer-review');renderReview(id);
    if(noteOpen.has(id))(inModal?$('#viewer-review'):$(`[data-card-id="${id}"]`)).querySelector('textarea').focus({preventScroll:true});
  }
}
function noteInput(event){
  if(!event.target.matches('.note-field'))return;
  const id=event.target.dataset.id;
  records[id]={...record(id),observation:event.target.value};
  clearTimeout(noteTimers.get(id));syncLabel('Salvando…');noteTimers.set(id,setTimeout(()=>{noteTimers.delete(id);update(id,{observation:record(id).observation});},450));
}
async function pull(){
  if(sending||Object.keys(pending).length||noteTimers.size||document.activeElement?.matches('textarea'))return;
  try{const response=await fetch('/api/marcacoes',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();
    if(JSON.stringify(records)!==JSON.stringify(data.records)){records=data.records;renderFilters();renderGallery();if(currentId)renderReview(currentId);}
    syncLabel('Salvo');
  }catch{syncLabel('Sem conexão',true);}
}
$('#grid-view').innerHTML=svg('grid');$('#list-view').innerHTML=svg('list');
$('#gallery').addEventListener('click',handleReviewClick);$('#viewer-review').addEventListener('click',handleReviewClick);
for(const target of [$('#gallery'),$('#viewer-review')]){
  target.addEventListener('input',noteInput);
  target.addEventListener('focusout',event=>{if(event.target.matches('.note-field'))flushNotes(event.target.dataset.id);});
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-filter]');
  if(button){
    const kind=button.dataset.filter,value=button.dataset.value;
    if(value==='todos') filters[kind]=[];
    else {const selected=filters[kind], index=selected.indexOf(value);if(index>=0)selected.splice(index,1);else selected.push(value);}
    if(['type','relation'].includes(kind))filters.group=[];
    renderFilters();renderGallery();closeFilters();
  }
  else if(!event.target.closest('.filter'))closeFilters();
});
document.querySelectorAll('.filter').forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open)document.querySelectorAll('.filter').forEach(other=>{if(other!==detail)other.open=false;});}));
for(const mode of ['grid','list'])$(`#${mode}-view`).addEventListener('click',()=>{view=mode;remember();renderGallery();});
$('#fewer-columns').addEventListener('click',()=>{columns=Math.max(1,columns-1);remember();renderGallery();});
$('#more-columns').addEventListener('click',()=>{columns=Math.min(items.length,columns+1);remember();renderGallery();});
$('#clear-filters').addEventListener('click',resetFilters);$('#empty-clear').addEventListener('click',resetFilters);
$('#close-viewer').addEventListener('click',closeViewer);$('#previous-image').addEventListener('click',()=>navigateViewer(-1));$('#next-image').addEventListener('click',()=>navigateViewer(1));
$('#viewer').addEventListener('cancel',event=>{event.preventDefault();closeViewer();});
$('#viewer').addEventListener('keydown',event=>{if(event.target.matches('textarea'))return;if(event.key==='ArrowRight')navigateViewer(1);if(event.key==='ArrowLeft')navigateViewer(-1);});
function setZoom(delta){zoom=Math.max(1,Math.min(4,zoom+delta));const area=$('#image-scroll');area.classList.toggle('zoomed',zoom>1);area.style.setProperty('--zoom-width',`${Math.round(area.clientWidth*zoom)}px`);$('#zoom-out').disabled=zoom===1;if(zoom===1)resetZoom();}
$('#zoom-in').addEventListener('click',()=>setZoom(.5));$('#zoom-out').addEventListener('click',()=>setZoom(-.5));
let touchStart=null;
$('#image-scroll').addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};else touchStart=null;},{passive:true});
$('#image-scroll').addEventListener('touchend',e=>{if(!touchStart||zoom!==1)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)navigateViewer(dx<0?1:-1);touchStart=null;},{passive:true});
addEventListener('online',()=>{flush();pull();});document.addEventListener('visibilitychange',()=>{if(!document.hidden){flush();pull();}});
addEventListener('pagehide',()=>{for(const id of noteTimers.keys()){clearTimeout(noteTimers.get(id));pending[id]={patch:{...(pending[id]?.patch||{}),observation:record(id).observation},version:++serial};}remember();if(Object.keys(pending).length)fetch('/api/marcacoes/lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({updates:Object.entries(pending).map(([id,entry])=>({id,patch:entry.patch}))}),keepalive:true}).catch(()=>{});});
(async()=>{
  try{
    const [imageResponse,stateResponse]=await Promise.all([fetch('/imagens.json'),fetch('/api/marcacoes',{cache:'no-store'})]);
    if(!imageResponse.ok||!stateResponse.ok)throw new Error();
    items=await imageResponse.json();records=(await stateResponse.json()).records;
    for(const [id,entry] of Object.entries(pending)){if(items.some(i=>i.id===id)){records[id]={...record(id),...entry.patch};serial=Math.max(serial,entry.version||0);}else delete pending[id];}
    renderFilters();renderGallery();syncLabel(Object.keys(pending).length?'Salvando…':'Salvo');flush();setInterval(pull,5000);
  }catch{$('#fatal').hidden=false;$('#gallery').setAttribute('aria-busy','false');syncLabel('Sem conexão',true);}
})();
