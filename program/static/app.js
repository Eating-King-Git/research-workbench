'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATES=['待本人确认','待读','在读','已读','需要复读'];
const RECORD_NAMES={reading:'阅读记录',task:'当前产物',settings:'收藏与筛选',paper:'新增文献',annotation:'原文批注'};
const S={data:null,online:location.protocol!=='file:',token:'',dirty:false,filters:{q:'',direction:'',year:'',status:'',depth:'',favorite:''},preview:null,routeSerial:0};
const rec=(kind,id='main')=>S.data.records.find(r=>r.kind===kind&&r.id===id)||{kind,id,revision:0,hash:'',data:{}};
const reading=id=>rec('reading',id).data;
const option=(value,label,selected)=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label??value)}</option>`;
const badge=(text)=>`<span class="badge ${/当前|在读|已读/.test(text)?'current':/历史|停止|未立项/.test(text)?'history':''}">${esc(text)}</span>`;
const fmt=x=>x?new Date(x).toLocaleString('zh-CN',{hour12:false}):'';
function siteUrl(path){return location.protocol==='file:'?new URL(path,new URL('../../site/',location.href)).href:'/site/'+path.split('/').map(encodeURIComponent).join('/');}
function docLink(path){const d=S.data.docs.find(d=>d.path===path.replace(/\.html$/,'.md'));return d?'#/doc/'+d.id:siteUrl(path);}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>$('#toast').style.display='none',4000);}
function confirmDiscard(message){
  return new Promise(resolve=>{
    if($('#draft-guard')){resolve(false);return;}
    const dialog=document.createElement('dialog');dialog.id='draft-guard';dialog.setAttribute('aria-labelledby','draft-guard-title');
    dialog.innerHTML=`<h2 id="draft-guard-title">还有未保存的内容</h2><p>${esc(message)}</p><div class="actions"><button type="button" data-keep>留下继续编辑</button><button type="button" class="secondary" data-discard>放弃草稿并继续</button></div>`;
    let discard=false;dialog.addEventListener('close',()=>{dialog.remove();resolve(discard);},{once:true});
    $('[data-keep]',dialog).onclick=()=>dialog.close();$('[data-discard]',dialog).onclick=()=>{discard=true;dialog.close();};
    document.body.append(dialog);dialog.showModal();
  });
}
async function api(path,opts={}){
  if(!S.online)throw new Error('当前为静态阅读版。请启动本机工作台后保存。');
  let response;
  try{response=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(opts.method&&opts.method!=='GET'?{'X-Workbench-Token':S.token}:{}),...opts.headers}});}catch(e){throw new Error('连接中断，内容未保存。请保留草稿，启动工作台后重新连接。');}
  let result;try{result=await response.json();}catch(e){throw new Error('服务返回异常，内容未确认保存。');}
  if(!response.ok){const error=new Error(result.error||result.detail||'操作失败');error.status=response.status;error.current=result.current;error.payload=result;throw error;}
  return result;
}
async function bootstrap(){
  if(S.online){const data=await api('/bootstrap');S.token=data.token;S.data=data;}
  else {const off=window.WORKBENCH_SNAPSHOT;if(!off)throw new Error('静态资料快照缺失，请启动本机工作台。');S.data={...off,docs:Object.values(off.docs),records:[],version:off.version};}
  $('#connection').textContent=S.online?'本机服务已连接':'静态阅读版';
  $('#version').textContent='工作台 '+S.data.version;
  $('#mode-banner').innerHTML=S.online?(S.data.test_mode?'<span class="qa">测试环境</span> · 所有测试记录与正式个人记录分开保存。':''):'当前为静态阅读版。可阅读已有资料；记录和恢复需先运行“启动工作台.cmd”，然后 <a href="http://127.0.0.1:8767/app/">打开可记录工作台</a>。';
}
function updateRecord(item){const index=S.data.records.findIndex(r=>r.kind===item.kind&&r.id===item.id);if(index<0)S.data.records.push(item);else S.data.records[index]=item;}
async function saveRecord(kind,id,data,base){const r=await api(`/records/${kind}/${id}`,{method:'PUT',body:JSON.stringify({data,expected_revision:base.revision,expected_hash:base.hash})});updateRecord(r);return r;}
function markDirty(){S.dirty=true;const state=$('#save-state');if(state){state.textContent='未保存';state.className='save-state bad';}}
function download(name,text,type='application/json'){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function sourceLinks(){return `<div class="linklist"><a href="${docLink('06_方法与工具/使用指南.md')}">通用使用指南</a><a href="${docLink('01_工作接续/当前状态.md')}">示例任务</a><a href="#/history">全部本地资料</a></div>`;}
function home(){
  const task=rec('task'),t=task.data;
  S.taskBase=task;
  const readingRecords=S.data.records.filter(r=>r.kind==='reading').sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  const recent=readingRecords.filter(r=>['在读','已读','需要复读'].includes(r.data.status)||['understanding','questions','next_step','location'].some(k=>r.data[k])).slice(0,3),confirmed=readingRecords.filter(r=>r.data.status&&r.data.status!=='待本人确认').length;
  return `<div class="eyebrow">我的研究与学习</div><h1>从上次的理解继续</h1><p class="subtitle">找一份资料，弄清一个问题，留下下一步。</p>
  <form class="searchform panel" id="home-search"><input aria-label="全站搜索" name="q" placeholder="搜索论文、报告或自己的记录，例如：示例、比较"><button>搜索资料</button></form>
  <section class="panel hero"><div class="row between"><h2>当前阶段</h2>${badge('当前有效')}</div><p>${esc(S.data.state.stage)}</p><p class="muted">${esc(S.data.state.next_step)}</p><div class="row"><a class="button secondary" href="${docLink('01_工作接续/当前状态.html')}">查看当前任务</a><span class="meta">研究证据日期 ${esc(S.data.state.research_evidence_as_of||S.data.state.updated)}</span></div></section>
  <div class="grid two"><section class="panel"><div class="row between"><h2>当前主要产物</h2>${t.title?badge(t.status||'待办'):badge('尚未设置')}</div>${t.title?`<h3>${esc(t.title)}</h3><p>${esc(t.reason)}</p><p><strong>完成标准：</strong>${esc(t.criteria||'尚未填写')}</p>${t.link?`<a href="${esc(t.link)}">打开产物</a>`:''}`:`<p class="muted">选择一件这次最想完成的事。现有研究建议不会自动变成你的待办。</p><div class="notice">建议：先打开虚构示例阅读卡，试着保存一条笔记。你可以按自己的进度设置。</div>`}
  <details class="details"><summary>${t.title?'编辑当前产物':'设置一个当前产物'}</summary><form id="task-form" class="taskform gap"><label class="field">这次完成什么<input name="title" value="${esc(t.title)}" maxlength="500" required></label><label class="field">为什么做<textarea name="reason">${esc(t.reason)}</textarea></label><label class="field">怎样算完成<textarea name="criteria">${esc(t.criteria)}</textarea></label><label class="field">状态<select name="status">${['待办','进行中','完成','暂停'].map(x=>option(x,x,t.status||'待办')).join('')}</select></label><label class="field">产物链接（选填）<input name="link" value="${esc(t.link)}" placeholder="https://… 或 #/paper/…"></label><button ${!S.online?'disabled':''}>保存当前产物</button><div id="task-feedback" role="status"></div></form></details></section>
  <section class="panel"><div class="row between"><h2>继续阅读</h2><a href="#/library">打开文献库</a></div>${recent.length?recent.map(r=>{const p=S.data.papers.find(p=>p.id===r.id);return p?`<div class="searchresult"><a class="papername" href="#/paper/${p.id}">${esc(p.name)}</a> ${badge(r.data.status||'待本人确认')}<p class="muted">${esc(r.data.next_step||r.data.questions||r.data.location||'继续查看这篇论文的个人记录')}</p><small class="meta">上次保存 ${fmt(r.updated_at)}</small></div>`:''}).join(''):'<div class="empty">还没有个人阅读记录。<br>在论文卡里保存理解、疑问或阅读位置后，会显示在这里。</div>'}</section></div>
  <div class="grid two"><section class="panel"><h2>文献与个人进度</h2><div class="stats"><div><b>${S.data.papers.length}</b><span>篇已收录论文</span></div><div><b>${S.data.papers.length-confirmed}</b><span>篇个人状态待确认</span></div><div><b>${readingRecords.filter(r=>r.data.status==='在读').length}</b><span>篇在读</span></div></div><p class="meta">个人状态由你确认，助手核读深度单独记录。</p><a class="button secondary" href="#/library">查找论文</a></section><section class="panel"><h2>常用资料</h2>${sourceLinks()}</section></div>
  <section class="panel"><h2>最近记录</h2><p><a href="#/notebook">打开我的笔记与批注</a></p>${readingRecords.length?readingRecords.slice(0,5).map(r=>`<p><a href="#/paper/${r.id}">${esc(S.data.papers.find(p=>p.id===r.id)?.name||r.id)}</a><span class="meta"> · ${fmt(r.updated_at)} · ${esc(r.data.status||'待本人确认')}</span></p>`).join(''):'<p class="muted">保存笔记或更新阅读状态后，这里会显示最近记录。</p>'}</section>`;
}
function library(){
  const f=S.filters,views=rec('settings').data.views||[];
  return `<div class="row between"><div><h1>文献库</h1><p class="subtitle">按问题找论文，把自己的理解留在阅读卡里。</p></div><button class="secondary" data-action="new-paper">收录论文</button></div>
  <section class="panel"><div class="filters"><label>标题与列表关键词<input id="lib-q" value="${esc(f.q)}" placeholder="例如 示例、阅读"></label><label>研究方向<select id="lib-direction">${option('','全部方向',f.direction)}${S.data.directions.map(x=>option(x,x,f.direction)).join('')}</select></label><label>年份<select id="lib-year">${option('','全部年份',f.year)}${[...new Set(S.data.papers.map(p=>String(p.year)).filter(Boolean))].sort().reverse().map(x=>option(x,x,f.year)).join('')}</select></label><label>我的阅读状态<select id="lib-status">${option('','全部状态',f.status)}${STATES.map(x=>option(x,x,f.status)).join('')}</select></label></div>
  <div class="tabs"><button data-view="all" class="${!f.status&&!f.favorite?'selected':''}">全部</button><button data-view="reading" class="${f.status==='在读'?'selected':''}">在读</button><button data-view="favorite" class="${f.favorite==='yes'?'selected':''}">我的收藏</button><button data-view="unknown" class="${f.status==='待本人确认'?'selected':''}">待本人确认</button><button data-action="clear-filters">清空筛选</button></div>
  <details class="details"><summary>助手核读与保存的筛选</summary><div class="subgrid gap"><label class="field">助手核读深度<select id="lib-depth">${option('','全部',f.depth)}${[...new Set(S.data.papers.map(p=>p.depth))].map(x=>option(x,x,f.depth)).join('')}</select></label><label class="field">已保存筛选<select id="saved-view">${option('','选择一个筛选')} ${views.map((v,i)=>option(i,v.name)).join('')}</select></label></div><div class="row gap"><input id="view-name" placeholder="筛选名称，例如本周阅读" aria-label="筛选名称" style="max-width:300px"><button class="secondary" data-action="save-view" ${!S.online?'disabled':''}>保存当前筛选</button></div></details></section>
  <section class="panel"><div class="row between"><span id="library-count" class="count"></span><a href="#/search">需要查正文？打开全文搜索</a></div><div class="tablewrap"><table><thead><tr><th>收藏</th><th>论文与版本</th><th>方向</th><th>发表位置</th><th>我的状态</th></tr></thead><tbody id="paper-rows"></tbody></table></div><div id="library-empty"></div></section><div id="new-paper-panel"></div>`;
}
function filterLibrary(){
  const f=S.filters;const papers=S.data.papers.filter(p=>{const r=reading(p.id);return (!f.q||[p.name,p.title,p.problem,p.venue,p.data,...p.directions].join(' ').toLowerCase().includes(f.q.toLowerCase()))&&(!f.direction||p.directions.includes(f.direction))&&(!f.year||String(p.year)===f.year)&&(!f.status||(r.status||'待本人确认')===f.status)&&(!f.depth||p.depth===f.depth)&&(!f.favorite||r.favorite);});
  $('#library-count').textContent=`显示 ${papers.length} / ${S.data.papers.length} 篇 · ${S.online?'个人记录已连接':'个人状态在静态版中不展示'}`;
  $('#paper-rows').innerHTML=papers.map(p=>{const r=reading(p.id);return `<tr><td><button class="star" data-favorite="${p.id}" aria-label="${r.favorite?'取消收藏':'收藏'} ${esc(p.name)}" ${!S.online?'disabled':''}>${r.favorite?'★':'☆'}</button></td><td><a class="papername" href="#/paper/${p.id}">${esc(p.name||p.title)}</a><small>${esc(p.version||'版本待核实')} · 助手：${esc(p.depth)}</small>${r.next_step?`<small>下次：${esc(r.next_step.slice(0,90))}</small>`:''}</td><td>${p.directions.map(esc).join('<br>')}</td><td>${esc(p.venue||'待核实')}<small>${esc(p.year)}</small></td><td>${badge(r.status||'待本人确认')}</td></tr>`;}).join('');
  $('#library-empty').innerHTML=papers.length?'':'<div class="empty">没有匹配论文。可以清空筛选，或用全文搜索查找卡片中的内容。</div>';
}
function newPaper(){return `<section class="panel" id="new-paper"><h2>收录一篇论文</h2><p class="muted">先保存原文和版本，其余信息可保持待核实。</p><form id="paper-form" class="taskform"><label class="field">完整题名<input name="title" required maxlength="500"></label><label class="field">原文网址<input name="url" type="url" placeholder="https://arxiv.org/…" required></label><div class="subgrid"><label class="field">所读版本<input name="version" placeholder="例如 arXiv v2"></label><label class="field">年份<input name="year" inputmode="numeric" maxlength="4"></label></div><label class="field">研究方向<select name="direction">${option('','暂不分类')}${S.data.directions.map(x=>option(x)).join('')}</select></label><label class="field">关注它的原因<textarea name="problem"></textarea></label><button ${!S.online?'disabled':''}>保存论文</button><div id="paper-feedback" role="status"></div></form></section>`;}
async function getDoc(key){if(S.online)return api('/docs/'+key);return window.WORKBENCH_SNAPSHOT.docs[key];}
function notesPanel(p,record){const d=record.data;return `<aside class="panel notes" id="notes">${S.currentDoc?Annotations.panel()+'<hr>':''}<h2>我的阅读记录</h2><p class="meta">助手核读：${esc(p.depth)}<br>你的阅读状态由你确认。</p><form id="notes-form"><label class="field">我的状态<select name="status">${STATES.map(x=>option(x,x,d.status||'待本人确认')).join('')}</select></label><label class="row"><input name="favorite" type="checkbox" ${d.favorite?'checked':''}> 收藏这篇论文</label><label class="field">我的理解<textarea name="understanding" placeholder="试着用自己的话解释…">${esc(d.understanding)}</textarea></label><label class="field">没懂的问题<textarea name="questions" placeholder="具体卡在哪一句、哪个图或步骤？">${esc(d.questions)}</textarea></label><label class="field">下次继续<textarea name="next_step" placeholder="下一次先做哪一件事？">${esc(d.next_step)}</textarea></label><label class="field">阅读位置<input name="location" value="${esc(d.location)}" placeholder="例如 §3.2 / PDF第5页"></label><div class="actions"><button id="save-notes" ${!S.online?'disabled':''}>保存记录</button><button type="button" class="secondary" data-action="export-draft">导出草稿</button></div><div id="save-state" class="save-state" role="status">${record.revision?'已保存 '+fmt(record.updated_at):'尚未保存个人记录'}</div><div id="save-error" role="alert"></div><div id="conflict-panel"></div></form></aside>`;}
async function paperPage(key,section){
  const p=S.data.papers.find(p=>p.id===key);if(!p)throw new Error('这篇论文尚未收录。');S.currentPaper=p;S.noteBase=rec('reading',key);
  const doc=p.doc_id?await getDoc(p.doc_id):null;S.currentDoc=doc;
  return `<div class="row between"><a href="#/library">返回文献库</a><span class="meta">${esc(p.venue||'发表位置待核实')} · ${esc(p.version||'版本待核实')}</span></div><div class="row gap"><h1>${esc(p.name||p.title)}</h1>${badge(reading(key).status||'待本人确认')}</div><div class="row gap"><a class="button secondary" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">打开原文</a>${typeof p.code==='string'&&/^https?:/.test(p.code)?`<a href="${esc(p.code)}" target="_blank" rel="noopener noreferrer">官方代码入口</a>`:''}<span class="meta">${p.directions.map(esc).join(' / ')}</span></div>${doc?Annotations.toolbar():''}<div class="tabs mobile-switch"><button data-reader-tab="article" class="selected">阅读卡</button><button data-reader-tab="notes">我的记录</button></div><div class="reader gap" data-tab="${section==='notes'?'notes':'article'}"><article class="article" id="article"><details class="toc"><summary>本页目录</summary>${doc?doc.headings.filter(h=>h.level>1).map(h=>`<a href="#${h.id}" data-section="${h.id}">${esc(h.text)}</a>`).join(''):''}</details>${doc?`<div id="annotation-content">${doc.html}</div>`:`<h2>已收录，等待补充阅读卡</h2><p>${esc(p.problem||'先读原文，再记录你的理解与疑问。')}</p><p class="muted">来源、方法与实验尚待核查。</p>`}</article>${notesPanel(p,S.noteBase)}</div>`;
}
function noteData(){const f=$('#notes-form');return {status:f.elements.status.value,favorite:f.elements.favorite.checked,understanding:f.elements.understanding.value,questions:f.elements.questions.value,next_step:f.elements.next_step.value,location:f.elements.location.value,paper_version:String(S.currentPaper.version||'')};}
async function saveNotes(){
  const button=$('#save-notes');button.disabled=true;$('#save-state').textContent='正在保存…';$('#save-error').innerHTML='';
  try{const r=await saveRecord('reading',S.currentPaper.id,noteData(),S.noteBase);S.noteBase=r;S.dirty=false;$('#save-state').textContent='已保存 '+fmt(r.updated_at);$('#save-state').className='save-state';$('#conflict-panel').innerHTML='';toast('阅读记录已保存');}
  catch(e){$('#save-state').textContent='未保存 · 草稿仍保留';$('#save-state').className='save-state bad';$('#save-error').innerHTML=`<p class="notice error">${esc(e.message)}</p><button type="button" class="secondary" data-action="reconnect">重新连接（保留草稿）</button>`;if(e.status===409&&e.current?.data){S.conflict=e.current;$('#conflict-panel').innerHTML=`<div class="notice warning conflict"><strong>另一个页面的新版本</strong><pre>${esc(JSON.stringify(e.current.data,null,2))}</pre><p>先在上方草稿中合并想保留的内容，然后使用新版本继续保存。</p><button type="button" class="secondary" data-action="adopt-base">已比较，使用新版本继续编辑</button></div>`;}}
  finally{button.disabled=!S.online;}
}
function searchPage(q='',scope='curated'){return `<h1>搜索资料与记录</h1><p class="subtitle">查论文卡与报告正文，直接定位到相关段落。</p><section class="panel"><form id="search-form" class="searchform"><input name="q" aria-label="搜索关键词" value="${esc(q)}" placeholder="例如：示例、比较、动作多解性" maxlength="160"><select name="scope" aria-label="搜索范围" style="max-width:220px">${option('curated','报告、论文与个人记录',scope)}${option('archive','历史材料文件清单',scope)}</select><button>搜索</button></form><p class="meta">${scope==='archive'?'历史材料范围：文件名、路径与分类快照；不含所有文件正文。':'正文范围：研究报告、当前任务、论文卡、决策、实验摘要与已保存个人笔记；不含全部PDF及原始日志。'}</p><div id="search-summary" class="count">${q?'正在搜索…':'输入关键词开始查找。'}</div><div id="search-results"></div></section>`;}
async function runSearch(q,scope){
  if(!q)return;
  const serial=S.routeSerial;
  let result;
  if(S.online)result=await api('/search?q='+encodeURIComponent(q)+'&scope='+scope);
  else {
    if(scope==='archive'){$('#search-results').innerHTML=`<p class="notice">请打开 <a href="${docLink('06_方法与工具/使用指南.md')}">使用指南</a>，或启动工作台。</p>`;$('#search-summary').textContent='静态正文搜索不包含材料文件清单';return;}
    const terms=q.toLowerCase().split(/\s+/);const matches=window.WORKBENCH_SNAPSHOT.chunks.filter(c=>terms.every(t=>(c.title+' '+c.heading+' '+c.text).toLowerCase().includes(t)));result={results:matches.slice(0,80).map(c=>({...c,snippet:c.text.slice(0,240)})),total:matches.length,indexed_at:S.data.indexed_at};
  }
  if(!$('#search-results'))return;
  if(serial!==S.routeSerial)return;
  $('#search-summary').textContent=`找到 ${result.total} 个相关段落${result.total>80?'，先显示前80个':''} · 索引更新 ${result.indexed_at}${result.elapsed_ms!==undefined?' · 查询 '+result.elapsed_ms+' ms':''}`;
  $('#search-results').innerHTML=result.results.length?result.results.map(c=>{const link=c.url||(c.paper_id?'#/paper/'+c.paper_id+'?section='+c.anchor:'#/doc/'+c.id+'?section='+c.anchor);return `<article class="searchresult"><div class="row">${badge(c.status)}<span class="meta">${esc(c.kind)} · ${esc(c.updated)}</span></div><h3><a href="${esc(link||'#/history')}">${esc(c.title)}</a></h3><div class="meta">${esc(c.heading)}</div><p class="snippet">${esc(c.snippet)}</p><a href="${esc(link||'#/history')}">查看对应内容</a></article>`;}).join(''):'<div class="empty">没有找到匹配内容。可以缩短关键词，或切换到历史材料文件清单。</div>';
}
function learning(){const questions=S.data.records.filter(r=>r.kind==='reading'&&r.data.questions);return `<h1>问题与学习</h1><p class="subtitle">把没懂的问题留在资料旁，下一次有明确起点。</p><section class="panel"><h2>我的阅读疑问</h2><p><a href="#/notebook">查看全部笔记与原文批注</a></p>${questions.length?questions.map(r=>`<article class="searchresult"><h3><a href="#/paper/${r.id}?section=notes">${esc(S.data.papers.find(p=>p.id===r.id)?.name||r.id)}</a></h3><p class="snippet">${esc(r.data.questions)}</p><p class="meta">下一步：${esc(r.data.next_step||'尚未填写')}</p></article>`).join(''):'<div class="empty">在论文卡的“没懂的问题”里保存内容后，这里会自动汇总。</div>'}</section><section class="panel"><h2>当前学习资料</h2>${sourceLinks()}<a href="${docLink('06_方法与工具/使用指南.md')}">查看使用指南</a></section>`;}
function evidence(){return `<h1>实验与证据</h1><p class="subtitle">这里用于整理自己的实验摘要；分享版没有真实研究结果。</p><section class="panel">${S.data.activities.length?S.data.activities.map(a=>`<h2>${esc(a.name)}</h2><p>${esc(a.result)}</p><p>${esc(a.boundary)}</p>${a.report?`<a href="${docLink(a.report)}">结果报告</a>`:''}`).join(''):'<p>尚无实验记录。可在 site/01_工作接续/实验索引.json 中添加摘要，在本地 Markdown 中记录结果。</p>'}</section>`;}
function historyPage(){return `<h1>资料与历史</h1><p class="subtitle">分享版只附通用说明与虚构示例。</p><section class="panel"><div class="row between"><h2>本地资料索引</h2><button class="secondary" data-action="reindex" ${!S.online?'disabled':''}>更新资料索引</button></div><div class="linklist">${S.data.docs.map(d=>`<a href="#/doc/${d.id}">${esc(d.title)}</a>`).join('')}</div><p><a href="#/search?scope=archive">材料文件清单</a>（初始为空）</p></section>`;}
function backup(){return `<h1>备份与恢复</h1><p class="subtitle">导出原文批注、阅读笔记、任务、收藏与新增文献，换电脑或恢复时可以导入。</p><section class="panel"><h2>导出个人记录</h2><p>此导出包包含个人记录，不包含原有论文全文和研究证据。完整迁移请停止服务后复制整个文件夹，并在新位置重新运行首次安装。</p><a class="button" href="/api/export" download="科研个人记录.json" ${!S.online?'aria-disabled="true"':''}>下载个人记录备份</a><p class="meta">记录保存在解压目录的“site/07_个人记录”。</p></section><section class="panel"><h2>预览并恢复记录</h2><p class="muted">先显示新增、相同和冲突项。你选择要导入的记录后，才会写入，并自动备份当前内容。</p><label class="field">选择工作台导出的 JSON 备份<input type="file" id="import-file" accept=".json,application/json" ${!S.online?'disabled':''}></label><details class="details"><summary>也可以粘贴备份内容</summary><textarea class="backuptext gap" id="import-text" aria-label="备份JSON内容" placeholder="粘贴完整 JSON 备份"></textarea></details><button class="secondary gap" data-action="preview-import" ${!S.online?'disabled':''}>预览导入</button><div id="import-feedback" class="gap" role="status"></div><div id="import-preview"></div></section>`;}
function help(){return `<h1>使用说明</h1><p class="subtitle">选中原文写批注，读完一页集中讨论，下次回到原文继续。</p><section class="panel"><h2>原文旁批注怎么用</h2><ol><li>打开系统内的论文卡或报告，鼠标拖选一段原文，点击“添加批注”。</li><li>写下困惑并保存。点击高亮可回看批注，也可从“我的笔记”集中查看。</li><li>读完后点“读完，讨论疑问”，选择问题，生成并复制讨论材料，粘贴到当前AI对话。</li><li>讨论结束，把摘录和自己的理解填回批注，由你选择“已理解”或“仍有疑问”。</li></ol><p>适用于系统内部正文；外部网站与PDF尚不提供划词批注。讨论材料由已保存记录生成，网页不会自动调用模型。</p><h2>整篇阅读笔记怎么用</h2><ol><li>在首页确认当前主要产物，或直接继续上次阅读。</li><li>在文献库筛选论文；需要查某句话时使用全文搜索。</li><li>打开论文卡，记录理解、疑问和下一步，点击“保存记录”。</li><li>看到“已保存”及时间后，可以关闭。下次从首页继续。</li></ol><h2>打开和关闭</h2><p>运行解压目录中的“启动工作台.cmd”，再打开 <a href="http://127.0.0.1:8767/app/">本机工作台</a>。运行“停止工作台.cmd”可关闭本机服务。直接打开HTML时是静态阅读版。</p><h2>数据与备份</h2><p>个人记录在“07_个人记录”，原始研究报告和证据保持各自来源。备份与恢复页可以导出个人记录。导入前会显示冲突，服务器会先保存当前记录备份。</p><h2>保存出现问题</h2><p>保留当前页面，先导出草稿；重新启动服务后点击“重新连接”。发生版本冲突时，比较两份内容，在编辑框合并后再保存。</p><h2>当前搜索范围</h2><p>报告、当前状态、论文卡、决策与实验摘要及自己的笔记。原始材料提供文件清单搜索；尚不扫描全部PDF、图片和大型日志。</p><h2>阅读状态怎么记</h2><p>“待本人确认”表示还不知道你读到哪。助手核读不等于你读过；“已读”也不等于复现了作者实现。</p></section>`;}
async function documentPage(key){const d=await getDoc(key);if(!d)throw new Error('资料不在当前索引中。');S.currentDoc=d;return `<div class="row between"><a href="#/history">资料索引</a>${badge(d.status)}</div><p class="meta">${esc(d.kind)} · 文件更新 ${esc(d.updated)}</p>${Annotations.toolbar()}<div class="tabs mobile-switch"><button data-reader-tab="article" class="selected">正文</button><button data-reader-tab="notes">本页批注</button></div><div class="reader gap" data-tab="article"><article class="article"><details class="toc"><summary>本页目录</summary>${d.headings.map(h=>`<a href="#${h.id}" data-section="${h.id}">${esc(h.text)}</a>`).join('')}</details><div id="annotation-content">${d.html}</div></article><aside class="panel notes">${Annotations.panel()}</aside></div>`;}
function fixOfflineLinks(){if(location.protocol!=='file:')return;$$('a[href^="/site/"]').forEach(a=>a.href=siteUrl(decodeURIComponent(a.getAttribute('href').slice(6))));$$('img[src^="/site/"]').forEach(a=>a.src=siteUrl(decodeURIComponent(a.getAttribute('src').slice(6))));}
function linkInternalReaders(){
  $$('#annotation-content a[href^="/site/"]').forEach(a=>{
    const url=new URL(a.getAttribute('href'),location.href);let path;
    try{path=decodeURIComponent(url.pathname.slice(6)).replace(/\.html$/,'.md');}catch(e){return;}
    const doc=S.data.docs.find(d=>d.path===path);if(!doc||url.hash)return;
    a.href=doc.paper_id?'#/paper/'+doc.paper_id:'#/doc/'+doc.id;a.target='_self';
  });
}
async function route(){
  const serial=++S.routeSerial;const raw=location.hash.slice(1)||'/home';const [path,query='']=raw.split('?');const params=new URLSearchParams(query);const [page='home',id]=path.replace(/^\//,'').split('/');
  const nav=['home','library','learning','evidence','history','notebook'].includes(page)?page:page==='paper'?'library':page==='doc'?'history':'';$$('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===nav));$('#crumb').textContent=({home:'工作台',library:'文献库',paper:'论文阅读',learning:'问题与学习',evidence:'实验与证据',history:'资料与历史',search:'全文搜索',backup:'备份与恢复',help:'使用说明',doc:'资料阅读',notebook:'我的笔记'})[page]||'个人科研记录';
  try{
    let html;Annotations.reset();S.currentDoc=null;if(page==='notebook'&&S.online){await bootstrap();}if(page==='paper')html=await paperPage(id,params.get('section'));else if(page==='doc')html=await documentPage(id);else html=({home,library,learning,evidence,history:historyPage,backup,help,notebook:()=>Annotations.notebook(),search:()=>searchPage(params.get('q')||'',params.get('scope')||'curated')})[page]?.()||home();
    if(serial!==S.routeSerial)return;$('#app').innerHTML=html;linkInternalReaders();fixOfflineLinks();window.scrollTo(0,0);S.lastHash=location.hash;
    if(page==='library')filterLibrary();
    if(page==='notebook')Annotations.filterNotebook();
    if(S.currentDoc)await Annotations.mount(S.currentDoc,params.get('annotation'));
    if(page==='search')await runSearch(params.get('q')||'',params.get('scope')||'curated');
    const section=params.get('section');if(section){const target=document.getElementById(section);if(target)target.scrollIntoView({block:'start'});}
  }catch(e){if(serial===S.routeSerial)$('#app').innerHTML=`<section class="panel"><h1>暂时无法打开</h1><p class="notice error">${esc(e.message)}</p><a href="#/home">返回工作台</a></section>`;}
}
$('#app').addEventListener('input',e=>{if(e.target.closest('#notes-form,#task-form,#paper-form'))markDirty();if(e.target.id==='lib-q'){S.filters.q=e.target.value;filterLibrary();}});
$('#app').addEventListener('change',async e=>{
  const id=e.target.id;
  if(id.startsWith('lib-')){S.filters[id.slice(4)]=e.target.value;filterLibrary();}
  if(id==='saved-view'&&e.target.value!==''){S.filters={...S.filters,...rec('settings').data.views[Number(e.target.value)].filters};await route();}
  if(e.target.closest('#notes-form,#task-form,#paper-form'))markDirty();
  if(id==='import-file'&&e.target.files[0]){if(e.target.files[0].size>10_000_000){toast('备份文件过大');return;}$('#import-text').value=await e.target.files[0].text();toast('文件已读取，请预览导入');}
});
$('#app').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;
  try{
    if(f.id==='home-search'||f.id==='search-form'){const q=f.elements.q.value.trim(),scope=f.elements.scope?.value||'curated';location.hash='/search?q='+encodeURIComponent(q)+'&scope='+scope;if(S.lastHash===location.hash)await route();}
    if(f.id==='notes-form')await saveNotes();
    if(f.id==='task-form'){const data=Object.fromEntries(new FormData(f));await saveRecord('task','main',data,S.taskBase);S.dirty=false;toast('当前产物已保存');await route();}
    if(f.id==='paper-form'){const d=Object.fromEntries(new FormData(f));const data={title:d.title.trim(),name:d.title.trim(),url:d.url.trim(),version:d.version.trim(),year:d.year.trim(),directions:d.direction?[d.direction]:[],venue:'待核实',problem:d.problem};const r=await api('/papers',{method:'POST',body:JSON.stringify(data)});S.dirty=false;await bootstrap();location.hash='/paper/'+r.id;toast('论文已收录，个人阅读状态待确认');}
  }catch(error){const target=f.id==='task-form'?$('#task-feedback'):$('#paper-feedback');if(target){target.innerHTML=`<p class="notice error">${esc(error.message)}</p>${error.payload?.paper_id?`<a href="#/paper/${esc(error.payload.paper_id)}">打开已收录论文</a>`:''}`;if(f.id==='task-form'){target.innerHTML+='<button type="button" class="secondary" data-action="export-task-draft">导出当前产物草稿</button><button type="button" class="secondary" data-action="reconnect">重新连接（保留草稿）</button>';if(error.status===409&&error.current?.data){S.taskConflict=error.current;target.innerHTML+=`<div class="notice warning"><strong>另一个页面的新版本</strong><pre>${esc(JSON.stringify(error.current.data,null,2))}</pre><p>先在上方合并内容，再继续保存。</p><button type="button" data-action="adopt-task-base">已比较，使用新版本继续编辑</button></div>`;}}}else toast(error.message);}
});
document.addEventListener('click',async e=>{
  if(e.target.closest('[aria-disabled="true"]')){e.preventDefault();toast('请启动本机工作台后操作');return;}
  const section=e.target.closest('[data-section]');if(section){e.preventDefault();document.getElementById(section.dataset.section)?.scrollIntoView({behavior:'smooth'});return;}
  const b=e.target.closest('button');if(!b)return;
  try{
    if(b.dataset.view){const v=b.dataset.view;S.filters.status=v==='reading'?'在读':v==='unknown'?'待本人确认':'';S.filters.favorite=v==='favorite'?'yes':'';await route();}
    if(b.dataset.favorite){const id=b.dataset.favorite,base=rec('reading',id);await saveRecord('reading',id,{...base.data,status:base.data.status||'待本人确认',favorite:!base.data.favorite},base);filterLibrary();toast(base.data.favorite?'已取消收藏':'已收藏，阅读状态未改变');}
    if(b.dataset.readerTab){$('.reader').dataset.tab=b.dataset.readerTab;$$('[data-reader-tab]').forEach(x=>x.classList.toggle('selected',x===b));}
    switch(b.dataset.action){
      case 'clear-filters': S.filters={q:'',direction:'',year:'',status:'',depth:'',favorite:''};await route();break;
      case 'save-view':{const name=$('#view-name').value.trim();if(!name)throw new Error('请填写筛选名称');const base=rec('settings');const views=[...(base.data.views||[]).filter(v=>v.name!==name),{name,filters:{...S.filters}}];await saveRecord('settings','main',{views},base);toast('筛选已保存');await route();break;}
      case 'new-paper': $('#new-paper-panel').innerHTML=newPaper();$('#new-paper').scrollIntoView({behavior:'smooth'});break;
      case 'export-draft': download('阅读草稿.txt',JSON.stringify({paper:S.currentPaper.title,version:S.currentPaper.version,...noteData()},null,2),'text/plain');break;
      case 'export-task-draft': download('当前产物草稿.txt',JSON.stringify(Object.fromEntries(new FormData($('#task-form'))),null,2),'text/plain');break;
      case 'adopt-task-base': S.taskBase=S.taskConflict;$('#task-feedback').innerHTML='<p class="notice">已切换到最新修订基准。请确认合并后的内容，再次保存。</p>';break;
      case 'adopt-base': S.noteBase=S.conflict;$('#conflict-panel').innerHTML='<p class="notice">已切换到最新修订基准。请确认上方合并后的草稿，然后再次保存。</p>';break;
      case 'reconnect':{const data=await api('/bootstrap');S.token=data.token;const target=$('#save-error')||$('#task-feedback');target.innerHTML='<p class="notice">已重新连接，草稿保留。请再次保存。</p>';break;}
      case 'reindex': await api('/reindex',{method:'POST',body:'{}'});await bootstrap();toast('资料索引已更新');await route();break;
      case 'preview-import':{const text=$('#import-text').value.trim();if(!text)throw new Error('请先选择或粘贴备份文件');let data;try{data=JSON.parse(text);}catch(e){throw new Error('备份不是有效的 JSON');}S.preview=await api('/import/preview',{method:'POST',body:JSON.stringify(data)});$('#import-feedback').innerHTML='<p class="notice">'+esc(S.preview.message)+'</p>';$('#import-preview').innerHTML=S.preview.rows.map(r=>`<div class="importrow"><label class="row"><input type="checkbox" data-import-key="${esc(r.key)}" ${r.state==='新增'?'checked':''} ${r.state==='相同'?'disabled':''}>${badge(r.state)} ${esc(RECORD_NAMES[r.kind]||r.kind)} · ${esc(S.data.papers.find(p=>p.id===r.id)?.name||(r.id==='main'?'当前记录':r.id))}</label><details><summary>查看内容差异</summary><div class="subgrid"><div>当前内容<pre>${esc(JSON.stringify(r.current,null,2))}</pre></div><div>备份内容<pre>${esc(JSON.stringify(r.incoming,null,2))}</pre></div></div></details></div>`).join('')+`<button class="gap" data-action="apply-import">导入选中的记录</button>`;break;}
      case 'apply-import':{const selected=$$('[data-import-key]:checked').map(x=>x.dataset.importKey);const result=await api('/import/apply',{method:'POST',body:JSON.stringify({preview_id:S.preview.preview_id,selected})});await bootstrap();$('#import-feedback').innerHTML=`<p class="notice">已导入 ${result.imported} 条记录。导入前记录已备份。</p>`;$('#import-preview').innerHTML='';toast('恢复完成');break;}
    }
  }catch(error){const target=b.dataset.action?.includes('import')?$('#import-feedback'):null;if(target)target.innerHTML='<p class="notice error">'+esc(error.message)+'</p>';else toast(error.message);}
});
window.addEventListener('beforeunload',e=>{if(S.dirty||Annotations.isDirty()){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',async()=>{if(S.dirty||Annotations.isDirty()){const target=location.hash;window.history.replaceState(null,'',S.lastHash||'#/home');if(!await confirmDiscard('建议先保存或导出草稿，再离开当前页面。'))return;window.history.replaceState(null,'',target);S.dirty=false;}route();});
(async()=>{try{await bootstrap();await route();}catch(e){$('#connection').textContent='未连接';$('#app').innerHTML=`<section class="panel"><h1>工作台暂时无法连接</h1><p>${esc(e.message)}</p><p>请运行“启动工作台.cmd”，然后刷新页面。</p><p>可在解压目录中查看“先看这里.txt”。</p></section>`;}})();
