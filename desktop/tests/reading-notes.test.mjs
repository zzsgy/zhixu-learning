import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {mountReadingNotes,sanitizeReadingNotePasteHtml} from '../public/reading-notes.js';

function fixture({text='旧笔记内容',html=''}={}) {
 const {document,Event}=parseHTML('<html><body><div id="reading-tools-panel"><div>阅读设置</div><section class="reading-notes-section"><header><span>03</span><h3>我的笔记</h3></header><div id="reading-note-input" contenteditable="true"></div><small id="reading-note-status">已保存</small></section></div></body></html>');
 const create=document.createElement.bind(document);
 document.createElement=(tag)=>{const el=create(tag);if(tag==='dialog'){el.showModal=()=>{el.open=true;};el.close=()=>{el.open=false;el.dispatchEvent(new Event('close'));};}return el;};
 let title='论文 A';const editor=mountReadingNotes({document,getTitle:()=>title});
 editor.setContent(html,text);editor.refresh();
 return {document,Event,input:document.getElementById('reading-note-input'),editor,setTitle(value){title=value;}};
}

test('伴读富文本编辑器置顶，展开与收起共用原节点及保存状态',()=>{
 const f=fixture();let inputs=0;f.input.addEventListener('input',()=>inputs++);
 assert.equal(f.document.getElementById('reading-tools-panel').firstElementChild.classList.contains('note-companion'),true);
 assert.equal(f.input.getAttribute('contenteditable'),'true');
 f.editor.open();assert(f.input.closest('dialog'));
 f.input.innerHTML='<p><strong>编辑后的笔记</strong></p>';f.input.dispatchEvent(new f.Event('input'));f.editor.close();
 assert(!f.input.closest('dialog'));assert.match(f.editor.getContent().noteHtml,/<strong>编辑后的笔记<\/strong>/);
 assert.equal(f.editor.getContent().noteText,'编辑后的笔记');assert.equal(inputs,1);
 assert.equal(f.document.querySelectorAll('#reading-note-input').length,1);
 assert.equal(f.document.getElementById('reading-note-status').textContent,'已保存');
});

test('已有富文本不被模板覆盖，空笔记插入真正的标题结构',()=>{
 const f=fixture({html:'<p style="color: red"><strong>旧笔记内容</strong></p>'});
 const template=[...f.document.querySelectorAll('button')].find((button)=>button.textContent==='插入整理提纲');
 assert(template.hidden);template.click();assert.match(f.editor.getContent().noteHtml,/color: red/);
 f.editor.clear();f.editor.refresh();let inputs=0;f.input.addEventListener('input',()=>inputs++);template.click();
 assert.equal(f.input.querySelectorAll('h2').length,4);assert.equal(inputs,1);assert(template.hidden);
 assert.equal(f.document.querySelectorAll('.note-outline button').length,4);
});

test('富文本大纲按纯文本渲染，收起及切换资料后返回原位',()=>{
 const f=fixture({html:'<h2><img src=x onerror=alert(1)>安全标题</h2>'});
 f.editor.open();assert.equal(f.document.querySelector('.note-outline img'),null);
 f.document.querySelector('dialog').close();assert(!f.input.closest('dialog'));
 f.editor.open();f.editor.close();f.editor.setContent('<p>另一篇笔记</p>','');f.setTitle('文章 B');f.editor.refresh();
 assert.match(f.document.querySelector('.note-source').textContent,/文章 B/);assert.equal(f.editor.getContent().noteText,'另一篇笔记');
});

test('粘贴清洗保留允许的字体、图片和表格结构',()=>{
 const {document}=parseHTML('<html><body></body></html>');
 const html=sanitizeReadingNotePasteHtml(document,'<div style="font-family: SimSun; color: #345; position:fixed"><table><tr><td colspan="2">数据</td></tr></table><img src="http://localhost:47821/api/article-images/a.png" onerror="x"><img src="https://example.com/tracker.png" alt="远程图"><script>x</script></div>');
 assert.match(html,/font-family: SimSun/);assert.match(html,/color: #345/);
 assert.match(html,/<table>/);assert.match(html,/colspan="2"/);assert.match(html,/<img[^>]*src="\/api\/article-images\/a.png"/);
 assert.match(html,/远程图/);assert.doesNotMatch(html,/position:|onerror|<script|example\.com\/tracker/i);
 const index=fs.readFileSync(path.resolve(import.meta.dirname,'../public/index.html'),'utf8');
 const app=fs.readFileSync(path.resolve(import.meta.dirname,'../public/app.js'),'utf8');
 assert.match(index,/id="reading-note-input"\s+contenteditable="true"/s);
 assert.match(app,/payload\.workspace\.state\.noteHtml/);
 assert.match(app,/readingNotesEditor\.getContent\(\)/);
});
