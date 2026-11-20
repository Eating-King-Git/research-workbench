'use strict';
window.Annotations=(()=>{
  let A={doc:null,rows:[],selection:null,editing:null,dirty:false,positions:new Map(),showArchived:false};
  const all=()=>S.data.records.filter(r=>r.kind==='annotation');
  const link=r=>(r.data.paper_id?'#/paper/'+r.data.paper_id:'#/doc/'+r.data.doc_id)+'?annotation='+r.id;
  const q=s=>document.querySelector(s);
  function toolbar(){return `<section class="annotation-toolbar" aria-label="原文批注工具"><span>选中正文中的一句话，记下具体困惑</span><div class="row"><button type="button" data-ann="new" id="ann-new" disabled>给所选原文批注</button><button type="button" class="secondary" data-ann="show">本页批注 <span id="ann-count">0</span></button><button type="button" class="secondary" data-ann="discuss">读完，讨论疑问</button><a href="#/notebook">我的笔记</a></div><div id="selection-hint" class="meta" role="status">也支持用键盘选择文字。</div></section>`;}
  function panel(){return `<section id="annotation-panel"><h2>本页批注与疑问</h2><div id="annotation-editor"></div><label class="row ann-archive-toggle"><input type="checkbox" id="ann-archived">显示已收起</label><div id="annotation-list"></div><div id="annotation-status" role="status"></div></section>`;}
  function reset(){A={doc:null,rows:[],selection:null,editing:null,dirty:false,positions:new Map(),showArchived:false};q('#selection-popover')?.remove();q('#discussion-dialog')?.remove();}
  function textMap(){const root=q('#annotation-content');if(!root)return {text:'',nodes:[]};const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,text='',nodes=[];while((node=walker.nextNode())){nodes.push({node,start:text.length,end:text.length+node.data.length});text+=node.data;}return {text,nodes};}
  function unmark(){q('#annotation-content')?.querySelectorAll('mark[data-ann-ids]').forEach(m=>m.replaceWith(...m.childNodes));q('#annotation-content')?.normalize();}
  function highlights(){
    unmark();A.positions.clear();const {text,nodes}=textMap();const ranges=[];
    A.rows.filter(r=>!r.data.archived).forEach(r=>{const pos=QuoteAnchor.locate(text,r.data);A.positions.set(r.id,pos);if(pos)ranges.push({...pos,r});});
    for(const item of nodes){const active=ranges.filter(r=>r.start<item.end&&r.end>item.start);if(!active.length)continue;
      const cuts=[...new Set([item.start,item.end,...active.flatMap(r=>[Math.max(item.start,r.start),Math.min(item.end,r.end)])])].sort((a,b)=>a-b);const fragment=document.createDocumentFragment();
      for(let i=0;i<cuts.length-1;i++){const begin=cuts[i],end=cuts[i+1],covered=active.filter(r=>r.start<=begin&&r.end>=end),value=item.node.data.slice(begin-item.start,end-item.start);
        if(!covered.length){fragment.append(document.createTextNode(value));continue;}
        const mark=document.createElement('mark');mark.className='quote-highlight'+(covered.every(r=>r.r.data.status==='已理解')?' understood':'');mark.dataset.annIds=covered.map(r=>r.r.id).join(' ');mark.tabIndex=0;mark.setAttribute('role','button');mark.setAttribute('aria-label','查看批注：'+covered.map(r=>r.r.data.question).join('；').slice(0,160));mark.title=covered.map(r=>r.r.data.question).join('\n');mark.textContent=value;fragment.append(mark);
      }item.node.replaceWith(fragment);
    }
  }
  function cards(){
    const visible=A.rows.filter(r=>A.showArchived||!r.data.archived);const count=A.rows.filter(r=>!r.data.archived).length;q('#ann-count').textContent=String(count);
    q('#annotation-list').innerHTML=visible.length?visible.map(r=>{const d=r.data;const missing=!d.archived&&!A.positions.get(r.id);return `<article class="annotation-card" id="ann-card-${r.id}" tabindex="-1"><div class="row between"><span class="badge">${esc(d.archived?'已收起':d.status)}</span><small>${fmt(r.updated_at)}</small></div><p class="meta">${esc(d.section_title||'概览')}</p><blockquote>${esc(d.quote)}</blockquote><p class="annotation-question">${esc(d.question)}</p>${d.understanding?`<p><strong>我的理解：</strong>${esc(d.understanding)}</p>`:''}${d.answer?`<details><summary>讨论摘录</summary><p class="snippet">${esc(d.answer)}</p></details>`:''}${missing?'<p class="notice warning">原句位置待确认。内容已保留，可选中正确原文后重新关联。</p>':''}${d.source_hash!==A.doc.source_hash?'<p class="meta">原文已有更新，请核对引用。</p>':''}<div class="row"><button type="button" class="secondary" data-ann="edit" data-id="${r.id}">编辑批注</button>${!d.archived?`<button type="button" class="secondary" data-ann="locate" data-id="${r.id}" ${missing?'disabled':''}>回到原文</button>`:''}<button type="button" class="text-button" data-ann="archive" data-id="${r.id}">${d.archived?'恢复批注':'收起批注'}</button></div></article>`;}).join(''):'<p class="empty">还没有批注。选中左侧原文，再点击“给所选原文批注”。</p>';
  }
  async function mount(doc,annotationId){
    if(!doc)return;A.doc=doc;
    if(S.online){try{const rows=await api('/annotations?doc_id='+doc.id);if(A.doc?.id!==doc.id)return;rows.forEach(updateRecord);}catch(e){q('#annotation-status').textContent='批注未能刷新：'+e.message;}}
    if(A.doc?.id!==doc.id||!q('#annotation-content'))return;
    A.rows=all().filter(r=>r.data.doc_id===doc.id);highlights();cards();
    if(annotationId){const r=A.rows.find(r=>r.id===annotationId);if(r){if(r.data.archived){A.showArchived=true;q('#ann-archived').checked=true;cards();}showPanel();q('#ann-card-'+r.id)?.scrollIntoView({block:'center'});q('#ann-card-'+r.id)?.focus();}}
  }
  function selection(){
    const root=q('#annotation-content'),sel=window.getSelection();if(!root||!A.doc||!sel?.rangeCount||sel.isCollapsed)return;
    const range=sel.getRangeAt(0);if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return;
    const quote=range.toString();if(!quote.trim()||quote.length>5000){q('#selection-hint').textContent='请选择1至5000字符的原文。';q('#ann-new').disabled=true;A.selection=null;q('#selection-popover')?.remove();return;}
    const before=range.cloneRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length,{text}=textMap();const end=start+quote.length;
    if(text.slice(start,end)!==quote)return;
    let heading=null;for(const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){if(h.contains(range.startContainer)||(h.compareDocumentPosition(range.startContainer)&Node.DOCUMENT_POSITION_FOLLOWING))heading=h;}
    A.selection={quote,start,end,prefix:text.slice(Math.max(0,start-48),start),suffix:text.slice(end,end+48),section_id:heading?.id||'top',section_title:heading?.textContent||'概览',source_hash:A.doc.source_hash};
    q('#ann-new').disabled=!S.online;q('#selection-hint').textContent='已选中 '+quote.length+' 个字符，可添加批注。';
    if(!S.online)return;let pop=q('#selection-popover');if(!pop){pop=document.createElement('button');pop.id='selection-popover';pop.type='button';pop.dataset.ann='new';pop.textContent='添加批注';document.body.append(pop);}const rect=range.getBoundingClientRect();pop.style.left=Math.max(12,Math.min(window.innerWidth-130,rect.right-70))+'px';pop.style.top=Math.max(12,Math.min(window.innerHeight-60,rect.bottom+8))+'px';
  }
  function showPanel(){const reader=q('.reader');if(reader)reader.dataset.tab='notes';document.querySelectorAll('[data-reader-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.readerTab==='notes'));q('#annotation-panel')?.scrollIntoView({block:'start'});}
  async function canDiscard(){return !A.dirty||await confirmDiscard('这条批注还没有保存。可以留下继续编辑，或放弃当前草稿。');}
  async function edit(r,isNew=false){
    if(!await canDiscard())return;A.editing=r;A.anchor={...r.data};A.dirty=isNew;A.conflict=null;showPanel();q('#selection-popover')?.remove();
    const d=r.data;q('#annotation-editor').innerHTML=`<form id="annotation-form" class="annotation-form"><h3>${isNew?'给这段原文写批注':'编辑这条批注'}</h3><blockquote id="annotation-quote">${esc(d.quote)}</blockquote><label class="field">我的批注 / 困惑<textarea name="question" required maxlength="30000" placeholder="具体哪里不理解？">${esc(d.question)}</textarea></label><label class="field">讨论摘录（可粘贴 AI 回答）<textarea name="answer" placeholder="讨论后，把有用的解释记在这里。">${esc(d.answer)}</textarea></label><label class="field">讨论后，我的理解<textarea name="understanding" placeholder="用自己的话写下来。">${esc(d.understanding)}</textarea></label><label class="field">疑问状态<select name="status">${['待讨论','仍有疑问','已理解'].map(x=>option(x,x,d.status||'待讨论')).join('')}</select></label><div class="actions"><button id="annotation-save" ${!S.online?'disabled':''}>保存批注</button><button type="button" class="secondary" data-ann="draft">导出批注草稿</button><button type="button" class="text-button" data-ann="cancel">取消编辑</button></div>${!isNew?'<button type="button" class="secondary gap" data-ann="reattach">用新选中的原文重新关联</button>':''}<div id="annotation-save-state" role="status">${isNew?'未保存':('已保存 '+fmt(r.updated_at))}</div><div id="annotation-error" role="alert"></div></form>`;
    q('#annotation-form textarea').focus();
  }
  function formData(){const f=q('#annotation-form');return {...A.anchor,question:f.elements.question.value,answer:f.elements.answer.value,understanding:f.elements.understanding.value,status:f.elements.status.value};}
  async function persist(r,data){const result=await api('/annotations/'+r.id,{method:'PUT',body:JSON.stringify({data,expected_revision:r.revision,expected_hash:r.hash})});updateRecord(result);A.rows=all().filter(x=>x.data.doc_id===A.doc.id);return result;}
  async function save(){
    const button=q('#annotation-save');button.disabled=true;q('#annotation-save-state').textContent='正在保存…';
    try{const r=await persist(A.editing,formData());A.editing=r;A.anchor={...r.data};A.dirty=false;q('#annotation-save-state').textContent='已保存 '+fmt(r.updated_at);q('#annotation-error').innerHTML='';highlights();cards();toast('批注已保存');}
    catch(e){q('#annotation-save-state').textContent='未保存 · 草稿仍保留';q('#annotation-error').innerHTML=`<p class="notice error">${esc(e.message)}</p><button type="button" class="secondary" data-ann="reconnect">重新连接，保留草稿</button>`;if(e.status===409&&e.current?.data){A.conflict=e.current;q('#annotation-error').innerHTML+=`<details open><summary>另一个页面保存的批注</summary><p>${esc(e.current.data.question)}</p><p>讨论摘录：${esc(e.current.data.answer)}</p><p>我的理解：${esc(e.current.data.understanding)}</p><p>状态：${esc(e.current.data.status)}</p></details><button type="button" data-ann="merge">已比较，按最新版本继续保存</button>`;}}
    finally{button.disabled=!S.online;}
  }
  function discussion(){
    if(!S.online){toast('请在可记录工作台中汇总已保存的疑问');return;}
    if(A.dirty||S.dirty){toast('请先保存当前批注和阅读笔记，再汇总讨论');return;}
    const rows=A.rows.filter(r=>!r.data.archived);let dialog=q('#discussion-dialog');dialog?.remove();dialog=document.createElement('dialog');dialog.id='discussion-dialog';
    dialog.innerHTML=`<div class="row between"><h2>与 AI 讨论本页疑问</h2><button type="button" class="secondary" data-ann="close-discussion">关闭</button></div><p>${esc(A.doc.title)}</p><p class="muted">选择要讨论的问题，生成材料后复制到当前对话。我会结合原文逐条解释。这里不会自动发送资料。</p><div class="discussion-choices">${rows.map(r=>`<label class="discussion-choice"><input type="checkbox" data-discuss-id="${r.id}" ${r.data.status!=='已理解'?'checked':''}><span>${badge(r.data.status)} ${esc(r.data.question)}</span></label>`).join('')||'<p>本页还没有原文批注。</p>'}</div>${A.doc.paper_id?'<label class="row"><input type="checkbox" id="discuss-notes" checked>同时带上已保存的整篇阅读笔记</label>':''}<button type="button" class="gap" data-ann="prepare-discussion">生成讨论材料</button><div id="discussion-feedback" role="status"></div><div id="discussion-output"></div>`;
    document.body.append(dialog);dialog.showModal();
  }
  async function prepareDiscussion(){
    const ids=[...document.querySelectorAll('[data-discuss-id]:checked')].map(x=>x.dataset.discussId);const result=await api('/discussion/'+A.doc.id+'?ids='+encodeURIComponent(ids.join(','))+'&include_notes='+(q('#discuss-notes')?.checked?'true':'false'));A.discussion=result.text;
    q('#discussion-feedback').textContent=`已整理 ${result.count} 条批注。复制后，在当前对话粘贴发送即可开始讨论。`;
    q('#discussion-output').innerHTML=`<label class="field gap">本页讨论材料<textarea id="discussion-text" readonly>${esc(result.text)}</textarea></label><div class="actions"><button type="button" data-ann="copy-discussion">复制讨论材料</button><button type="button" class="secondary" data-ann="download-discussion">下载讨论材料</button></div><p class="meta">也可以在当前对话说“读取《${esc(A.doc.title)}》的已保存批注，帮我逐条讲解”。讨论结束后，把结论记回批注，由你确认是否理解。</p>`;
  }
  function notebook(){
    const annotations=all(),notes=S.data.records.filter(r=>r.kind==='reading'&&['understanding','questions','next_step','location'].some(k=>r.data[k]));
    return `<h1>我的笔记与批注</h1><p class="subtitle">整篇的理解、具体句段的困惑，都能回到原文继续。</p><section class="panel"><div class="row"><label class="field notebook-query">搜索我的记录<input id="notebook-query" placeholder="搜索原句、困惑、讨论摘录或理解"></label><label class="field">记录类型<select id="notebook-kind">${option('','全部记录')}${option('annotation','原文批注')}${option('reading','整篇笔记')}</select></label><label class="field">批注状态<select id="notebook-status">${option('','全部状态')}${['待讨论','仍有疑问','已理解','已收起'].map(x=>option(x)).join('')}</select></label></div><p class="meta">${annotations.filter(r=>!r.data.archived).length} 条原文批注 · ${notes.length} 篇阅读笔记。到论文卡或报告正文选中文字即可添加批注。</p><div id="notebook-results"></div></section>`;
  }
  function filterNotebook(){
    const query=(q('#notebook-query')?.value||'').toLowerCase(),kind=q('#notebook-kind')?.value,status=q('#notebook-status')?.value;
    const records=S.data.records.filter(r=>r.kind==='annotation'||r.kind==='reading'&&['understanding','questions','next_step','location'].some(k=>r.data[k])).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
    const rows=records.filter(r=>{const d=r.data;if(kind&&r.kind!==kind)return false;if(status&&(r.kind!=='annotation'||(status==='已收起'?!d.archived:d.archived||d.status!==status)))return false;if(!status&&d.archived)return false;const p=S.data.papers.find(p=>p.id===r.id);return !query||JSON.stringify([d,p?.name]).toLowerCase().includes(query);});
    q('#notebook-results').innerHTML=rows.length?rows.map(r=>{const d=r.data,isAnn=r.kind==='annotation',title=isAnn?d.doc_title:S.data.papers.find(p=>p.id===r.id)?.name||r.id,url=isAnn?link(r):'#/paper/'+r.id+'?section=notes';return `<article class="searchresult"><div class="row">${badge(isAnn?(d.archived?'已收起':d.status):'整篇笔记')}<small>${fmt(r.updated_at)}</small></div><h3><a href="${esc(url)}">${esc(title)}</a></h3>${isAnn?`<blockquote>${esc(d.quote)}</blockquote><p class="snippet">${esc(d.question)}</p>`:`<p class="snippet">${esc(d.understanding||d.questions||d.next_step||d.location)}</p>`}<a href="${esc(url)}">${isAnn?'查看原文与批注':'打开阅读笔记'}</a></article>`;}).join(''):'<p class="empty">暂无匹配记录。保存的批注和论文阅读笔记会出现在这里。</p>';
  }
  document.addEventListener('selectionchange',selection);
  document.addEventListener('scroll',()=>q('#selection-popover')?.remove(),true);
  document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-ann="new"]'))e.preventDefault();});
  document.addEventListener('input',e=>{if(e.target.closest('#annotation-form')){A.dirty=true;q('#annotation-save-state').textContent='未保存';}if(e.target.id==='notebook-query')filterNotebook();});
  document.addEventListener('change',e=>{if(e.target.closest('#annotation-form')){A.dirty=true;q('#annotation-save-state').textContent='未保存';}if(e.target.id==='ann-archived'){A.showArchived=e.target.checked;cards();}if(e.target.id.startsWith('notebook-'))filterNotebook();});
  document.addEventListener('submit',e=>{if(e.target.id==='annotation-form'){e.preventDefault();save();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('mark[data-ann-ids]')){e.preventDefault();e.target.click();}});
  document.addEventListener('click',async e=>{
    const mark=e.target.closest('mark[data-ann-ids]');if(mark&&window.getSelection()?.isCollapsed){e.preventDefault();showPanel();const card=q('#ann-card-'+mark.dataset.annIds.split(' ')[0]);card?.scrollIntoView({block:'center'});card?.focus();return;}
    const b=e.target.closest('[data-ann]');if(!b)return;e.preventDefault();
    try{const r=A.rows.find(r=>r.id===b.dataset.id);
      switch(b.dataset.ann){
        case 'new':if(!A.selection){toast('请先选中正文');break;}edit({id:'ann-'+crypto.randomUUID(),kind:'annotation',revision:0,hash:'',data:{...A.selection,doc_id:A.doc.id,doc_title:A.doc.title,doc_path:A.doc.path,paper_id:A.doc.paper_id||'',question:'',answer:'',understanding:'',status:'待讨论',archived:false}},true);break;
        case 'show':showPanel();break;
        case 'edit':edit(r);break;
        case 'cancel':if(await canDiscard()){A.dirty=false;A.editing=null;q('#annotation-editor').innerHTML='';}break;
        case 'draft':download('批注草稿.txt',JSON.stringify(formData(),null,2),'text/plain');break;
        case 'reattach':if(!A.selection)throw new Error('请先在正文中选中正确原句');A.anchor={...A.anchor,...A.selection};q('#annotation-quote').textContent=A.anchor.quote;A.dirty=true;q('#annotation-save-state').textContent='原句已重新关联，尚未保存';break;
        case 'merge':A.editing=A.conflict;q('#annotation-error').innerHTML='<p class="notice">草稿保留。请确认合并后的内容，再次保存。</p>';break;
        case 'reconnect':{const data=await api('/bootstrap');S.token=data.token;q('#annotation-error').innerHTML='<p class="notice">已重新连接，草稿保留，请再次保存。</p>';break;}
        case 'archive':if(A.dirty)throw new Error('请先保存或取消正在编辑的批注');await persist(r,{...r.data,archived:!r.data.archived});highlights();cards();if(A.editing?.id===r.id){A.editing=null;q('#annotation-editor').innerHTML='';}toast(r.data.archived?'批注已恢复':'批注已收起，可在“显示已收起”中恢复');break;
        case 'locate':{const reader=q('.reader');if(reader)reader.dataset.tab='article';document.querySelectorAll('[data-reader-tab]').forEach(x=>x.classList.toggle('selected',x.dataset.readerTab==='article'));const mark=[...document.querySelectorAll('mark[data-ann-ids]')].find(m=>m.dataset.annIds.split(' ').includes(r.id));mark?.scrollIntoView({block:'center',behavior:'smooth'});mark?.focus({preventScroll:true});break;}
        case 'discuss':discussion();break;
        case 'close-discussion':q('#discussion-dialog').close();break;
        case 'prepare-discussion':await prepareDiscussion();break;
        case 'copy-discussion':try{await navigator.clipboard.writeText(A.discussion);q('#discussion-feedback').textContent='已复制。请粘贴到当前对话，发送后开始讨论。';}catch(error){q('#discussion-text').focus();q('#discussion-text').select();q('#discussion-feedback').textContent='浏览器未允许自动复制，已选中文本，请按 Ctrl+C 或下载材料。';}break;
        case 'download-discussion':download('本页疑问讨论材料.txt',A.discussion,'text/plain');break;
      }
    }catch(error){const target=q('#discussion-dialog[open] #discussion-feedback')||q('#annotation-status');if(target)target.textContent=error.message;else toast(error.message);}
  });
  return {toolbar,panel,mount,reset,notebook,filterNotebook,link,isDirty:()=>A.dirty};
})();
