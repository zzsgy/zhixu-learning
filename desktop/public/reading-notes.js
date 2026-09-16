const richTags = new Set([
  'p','div','section','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','pre','code',
  'strong','b','em','i','u','s','mark','small','sub','sup','span','font','br','hr','a','img','figure',
  'figcaption','table','caption','thead','tbody','tfoot','tr','th','td','colgroup','col','details','summary',
]);
const droppedTags = new Set([
  'script','style','noscript','iframe','object','embed','svg','math','form','input','button','textarea',
  'select','option','template','link','meta','base','audio','video','source','canvas',
]);
const styleProperties = new Set([
  'color','background-color','font-family','font-size','font-weight','font-style','text-decoration',
  'text-decoration-line','text-align','line-height','letter-spacing','text-indent','white-space',
  'vertical-align','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top',
  'padding-right','padding-bottom','padding-left','border','border-width','border-style','border-color',
  'border-top','border-right','border-bottom','border-left','border-collapse','border-spacing','width',
  'min-width','max-width','height','max-height','list-style-type',
]);

function safeStyle(value) {
  const declarations=[];
  for(const declaration of String(value||'').split(';')) {
    const separator=declaration.indexOf(':');
    if(separator<1) continue;
    const property=declaration.slice(0,separator).trim().toLowerCase();
    const cssValue=declaration.slice(separator+1).trim();
    if(!styleProperties.has(property)||!cssValue||cssValue.length>240) continue;
    if(/[{}<>\x00-\x1f]/.test(cssValue)||/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(cssValue)) continue;
    declarations.push(`${property}: ${cssValue}`);
  }
  return declarations.join('; ');
}

function safeLink(value) {
  const href=String(value||'').trim();
  return /^(https?:\/\/|mailto:)/i.test(href)?href.slice(0,2000):'';
}

function safeImage(value) {
  const source=String(value||'').trim();
  if(/^\/api\/[a-z0-9_./%?=&+-]+$/i.test(source)) return source.slice(0,4000);
  if(/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(source)) return source;
  try {
    const url=new URL(source);
    if(['127.0.0.1','localhost'].includes(url.hostname.toLowerCase())&&url.pathname.startsWith('/api/')) {
      return `${url.pathname}${url.search}`.slice(0,4000);
    }
  } catch {}
  return '';
}

function positiveInteger(value,maximum=100) {
  const number=Math.round(Number(value));
  return Number.isFinite(number)&&number>0?String(Math.min(maximum,number)):'';
}

function safeFontFace(value) {
  const face=String(value||'').trim();
  return face&&face.length<=200&&/^[\p{L}\p{N}\s,"'._-]+$/u.test(face)?face:'';
}

function safeFontColor(value) {
  const color=String(value||'').trim();
  return /^(?:#[0-9a-f]{3,8}|[a-z]{1,30}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%a-z]+\))$/i.test(color)?color:'';
}

/** 粘贴进入编辑器前的浏览器端清洗；服务端保存时还会再次清洗。 */
export function sanitizeReadingNotePasteHtml(doc,value) {
  const root=doc.createElement('div');root.innerHTML=String(value||'');
  for(const element of [...root.querySelectorAll('*')].reverse()) {
    const tag=element.tagName.toLowerCase();
    if(!richTags.has(tag)) {
      if(droppedTags.has(tag)) element.remove();
      else element.replaceWith(...element.childNodes);
      continue;
    }
    const attributes={
      style:safeStyle(element.getAttribute('style')),
      href:tag==='a'?safeLink(element.getAttribute('href')):'',
      src:tag==='img'?safeImage(element.getAttribute('src')):'',
      alt:tag==='img'?String(element.getAttribute('alt')||'').slice(0,500):'',
      title:['a','img'].includes(tag)?String(element.getAttribute('title')||'').slice(0,500):'',
      width:['img','table','col','th','td'].includes(tag)?positiveInteger(element.getAttribute('width'),4000):'',
      height:tag==='img'?positiveInteger(element.getAttribute('height'),4000):'',
      colspan:['th','td'].includes(tag)?positiveInteger(element.getAttribute('colspan'),50):'',
      rowspan:['th','td'].includes(tag)?positiveInteger(element.getAttribute('rowspan'),100):'',
      face:tag==='font'?safeFontFace(element.getAttribute('face')):'',
      color:tag==='font'?safeFontColor(element.getAttribute('color')):'',
      size:tag==='font'?positiveInteger(element.getAttribute('size'),7):'',
    };
    for(const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if(attributes.style) element.setAttribute('style',attributes.style);
    if(tag==='a'&&attributes.href) {element.href=attributes.href;element.target='_blank';element.rel='noopener noreferrer';}
    if(tag==='img') {
      if(!attributes.src) {element.replaceWith(doc.createTextNode(attributes.alt||'[图片已移除]'));continue;}
      element.src=attributes.src;element.loading='lazy';
      if(attributes.alt) element.alt=attributes.alt;
      if(attributes.title) element.title=attributes.title;
    }
    for(const name of ['width','height','colspan','rowspan']) if(attributes[name]) element.setAttribute(name,attributes[name]);
    for(const name of ['face','color','size']) if(attributes[name]) element.setAttribute(name,attributes[name]);
  }
  return root.innerHTML;
}

function plainTextHtml(doc,value) {
  const root=doc.createElement('div');
  for(const line of String(value||'').split(/\r?\n/)) {
    const heading=line.match(/^(#{1,3})\s+(.+)/);
    const element=doc.createElement(heading?`h${heading[1].length}`:'p');
    if(heading) element.textContent=heading[2];
    else if(line) element.textContent=line;
    else element.append(doc.createElement('br'));
    root.append(element);
  }
  return root.innerHTML;
}

function editorText(input) {
  const clone=input.cloneNode(true);
  for(const image of clone.querySelectorAll('img')) image.replaceWith(`[图片${image.alt?`：${image.alt}`:''}]`);
  return String(clone.innerText||clone.textContent||'').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function insertHtml(doc,input,html) {
  input.focus();
  if(doc.execCommand?.('insertHTML',false,html)) return;
  const selection=doc.getSelection?.();
  if(selection?.rangeCount) {
    const range=selection.getRangeAt(0);range.deleteContents();
    const fragment=range.createContextualFragment(html);range.insertNode(fragment);range.collapse(false);
    selection.removeAllRanges();selection.addRange(range);return;
  }
  input.insertAdjacentHTML('beforeend',html);
}

function readImage(view,file) {
  return new Promise((resolve,reject)=>{
    const reader=new view.FileReader();reader.addEventListener('load',()=>resolve(String(reader.result||'')));
    reader.addEventListener('error',()=>reject(reader.error||new Error('图片读取失败')));reader.readAsDataURL(file);
  });
}

function imageCount(doc,html) {
  const root=doc.createElement('div');root.innerHTML=String(html||'');return root.querySelectorAll('img').length;
}

/** 同一个富文本笔记节点在伴读侧栏与宽幅编辑区之间移动，不复制正文或保存状态。 */
export function mountReadingNotes({document:doc,getTitle}) {
  const view=doc.defaultView||globalThis.window;
  const input=doc.getElementById('reading-note-input');
  const section=input.closest('.reading-notes-section');
  const panel=doc.getElementById('reading-tools-panel');
  const make=(tag,className,text)=>{const el=doc.createElement(tag);el.className=className;el.textContent=text||'';return el;};
  const button=(text,action)=>{const el=make('button','note-action',text);el.type='button';el.addEventListener('click',action);return el;};
  const getContent=()=>({noteHtml:input.innerHTML,noteText:editorText(input)});
  const setContent=(noteHtml,noteText)=>{input.innerHTML=noteHtml?sanitizeReadingNotePasteHtml(doc,noteHtml):plainTextHtml(doc,noteText);};
  const clear=()=>{input.replaceChildren();};
  panel.prepend(section);section.classList.add('note-companion');section.querySelector('header > span')?.remove();
  const source=make('p','note-source');section.querySelector('header').after(source);
  input.setAttribute('aria-label','当前资料的富文本笔记');
  input.dataset.placeholder='记录你的理解、疑问和下一步行动；可直接粘贴带格式的文字、图片和表格。';
  const anchor=doc.createComment('note-sidebar-position');section.before(anchor);
  const dialog=make('dialog','note-studio');dialog.setAttribute('aria-label','展开研究笔记');
  const top=make('header','note-studio-header');top.append(make('strong','','研究笔记'),button('收起，继续阅读',close));
  const layout=make('div','note-studio-layout');const outline=make('nav','note-outline');outline.setAttribute('aria-label','笔记大纲');
  const editor=make('div','note-studio-editor');layout.append(outline,editor);dialog.append(top,layout);doc.body.append(dialog);
  const expand=button('展开整理 ↗',open);section.querySelector('header').append(expand);
  const pasteHint=make('span','note-paste-hint','保留格式粘贴 · 支持字体、图片和表格');
  const template=button('插入整理提纲',()=>{
    if(getContent().noteText||input.querySelector('img,table')) return;
    input.innerHTML='<h2>核心问题</h2><p><br></p><h2>我的理解</h2><p><br></p><h2>证据与局限</h2><p><br></p><h2>下一步行动</h2><p><br></p>';
    input.dispatchEvent(new view.Event('input',{bubbles:true}));input.focus();
  });
  input.before(pasteHint,template);
  function focusHeading(heading) {
    input.focus();heading.scrollIntoView?.({block:'center'});
    const selection=doc.getSelection?.();if(!selection||!doc.createRange)return;
    const range=doc.createRange();range.selectNodeContents(heading);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
  }
  function renderOutline() {
    const hasContent=Boolean(getContent().noteText||input.querySelector('img,table'));
    template.hidden=hasContent;outline.replaceChildren(make('strong','','本文大纲'));
    const headings=[...input.querySelectorAll('h1,h2,h3')].filter((heading)=>heading.textContent.trim());
    for(const heading of headings) outline.append(button(heading.textContent.trim(),()=>focusHeading(heading)));
    if(!headings.length) outline.append(make('p','','粘贴或设置标题后会在这里生成大纲。'));
  }
  function refresh(){source.textContent=`当前资料 · ${getTitle()||'阅读内容'}`;renderOutline();}
  function open(){if(dialog.open)return;refresh();editor.append(section);expand.hidden=true;dialog.showModal();input.focus();}
  function restore(){anchor.after(section);expand.hidden=false;}
  function close(){if(dialog.open)dialog.close();restore();}
  dialog.addEventListener('close',restore);input.addEventListener('input',renderOutline);
  input.addEventListener('paste',(event)=>{
    const clipboard=event.clipboardData;if(!clipboard)return;
    const html=clipboard.getData('text/html');
    const safeHtml=html?sanitizeReadingNotePasteHtml(doc,html):'';
    const sourceImageCount=imageCount(doc,html);const safeImageCount=imageCount(doc,safeHtml);
    const imageFiles=[...clipboard.items].filter((item)=>item.kind==='file'&&item.type.startsWith('image/')).map((item)=>item.getAsFile()).filter(Boolean);
    const files=safeImageCount<sourceImageCount||!html?imageFiles:[];
    if(!html&&!files.length)return;
    event.preventDefault();
    if(html) insertHtml(doc,input,safeHtml);
    if(files.length) {
      void Promise.all(files.map((file)=>readImage(view,file))).then((sources)=>{
        for(const source of sources) insertHtml(doc,input,`<img src="${source}" alt="粘贴图片">`);
        input.dispatchEvent(new view.Event('input',{bubbles:true}));
      }).catch(()=>{
        const status=doc.getElementById('reading-note-status');
        if(status) status.textContent='图片粘贴失败，文字内容仍保留。';
      });
    } else if(html) {
      input.dispatchEvent(new view.Event('input',{bubbles:true}));
      if(sourceImageCount>safeImageCount) {
        const status=doc.getElementById('reading-note-status');
        if(status) status.textContent='外部图片未随剪贴板提供，已保留图片说明。';
      }
    }
  });
  refresh();
  return {open,close,refresh,getContent,setContent,clear};
}
