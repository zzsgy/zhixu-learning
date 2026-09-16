import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const controller = fs
  .readFileSync(new URL('../public/paper-library.js', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

test('所有导入入口在切换页面前统一刷新论文目录，保留来源页面上下文', () => {
  const body = app.slice(app.indexOf('function showView(viewName)'), app.indexOf('function showView(viewName)') + 700);
  assert(body.indexOf('prepareImport(applicationState.activeView === "papers")') < body.indexOf('applicationState.activeView = viewName'));
  assert.match(body, /if \(viewName === "upload"\)/);
  assert.equal((app.match(/paperLibrary\.prepareImport\(/g) || []).length, 1);
  assert.match(app, /"X-Paper-Folder-Id": paperLibrary\.importFolderId\(\)/);
  assert.match(app, /paperFolderId: paperLibrary\.importFolderId\(\)/);
});

function fixture(request, folder = '') {
  const messages = [], state = {folder,folders:[]};
  const importSelect = {value:'', disabled:false, children:[], replaceChildren(...children) { this.children=children; }};
  const context = vm.createContext({state, importSelect, request, notify:message=>messages.push(message), folderSelect:(_,id) => {
    const children = [{value:'',text:'未归档'},...state.folders.map(f=>({value:f.id,text:f.path.map(p=>p.name).join(' / ')}))];
    return {children,value:children.some(c=>c.value===id)?id:''};
  }});
  const start = controller.indexOf('  let importRequestSequence');
  const end = controller.indexOf('\n  return {', start);
  assert.ok(start >= 0 && end > start, '论文目录控制器测试片段定位失败');
  vm.runInContext(controller.slice(start,end)+'\nglobalThis.prepare = prepareImport; globalThis.ready = () => importDestinationReady;',context);
  return {context,state,importSelect,messages};
}
const directories = [
  {id:'parent',path:[{name:'研究'}]},
  {id:'child-a',path:[{name:'研究'},{name:'同名目录'}]},
  {id:'child-b',path:[{name:'其他研究'},{name:'同名目录'}]},
];
test('侧栏首次进入就加载全部目录，按稳定 ID 区分同名子目录', async()=>{
  const f=fixture(async()=>({folders:directories}));
  await f.context.prepare(false);
  assert.equal(f.importSelect.children.length,4);
  assert.equal(f.importSelect.value,'');
  assert.equal(f.context.ready(),true);
  f.state.folder='child-b';
  await f.context.prepare(true);
  assert.equal(f.importSelect.value,'child-b');
  assert.equal(f.importSelect.children[3].text,'其他研究 / 同名目录');
});
test('目录载入失败不允许默默导入未归档，重新进入后可以恢复',async()=>{
  let fail=true;
  const f=fixture(async()=>{if(fail)throw new Error('offline');return {folders:directories};});
  await f.context.prepare(false);
  assert.equal(f.importSelect.disabled,true);
  assert.equal(f.context.ready(),false);
  assert.match(f.messages[0],/加载失败/);
  fail=false; await f.context.prepare(false);
  assert.equal(f.importSelect.disabled,false);
});
test('快速切换入口时迟到响应不能覆盖最新目标目录',async()=>{
  const pending=[];
  const f=fixture(()=>new Promise(resolve=>pending.push(resolve)),'child-a');
  const first=f.context.prepare(true);
  f.state.folder='child-b';
  const second=f.context.prepare(true);
  pending[1]({folders:directories});await second;
  pending[0]({folders:[]});await first;
  assert.equal(f.importSelect.value,'child-b');
  assert.equal(f.context.ready(),true);
});
