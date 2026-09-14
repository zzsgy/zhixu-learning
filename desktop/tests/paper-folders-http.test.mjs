import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
const cwd=path.resolve(import.meta.dirname,'..');
test('论文目录 HTTP 归档、分页、删除保护与无效导入目录校验', {timeout:25000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhixu-paper-folders-'));
  const env={...process.env,ZHIXU_DATA_DIR:dir,ZHIXU_ENV_FILE:path.join(dir,'absent.env'),ZHIXU_PORT:'47856',ZHIXU_DISABLE_CODEX_WORKER:'1',ZHIXU_NO_BROWSER:'1',DEEPSEEK_API_KEY:''};
  const seed=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import * as db from './lib/database.mjs'; for(let i=0;i<30;i++)db.upsertImportedPaper({id:'fixture_'+i,externalId:'folder_fixture_'+i,title:'Paper '+i,category:'AI',sourceUrl:'https://example.com/papers/'+i});const a=db.paperFolders.create({name:'导入原位'}),b=db.paperFolders.create({name:'不应被移入'});const initial=db.enqueuePaperImport({inputUrl:'https://arxiv.org/abs/2512.08296',paperFolderId:a.id});const again=db.enqueuePaperImport({inputUrl:'https://arxiv.org/abs/2512.08296',paperFolderId:b.id});assert.equal(initial.paper.id,again.paper.id);assert.equal(db.getPaperLibraryPage({folder:a.id}).total,1);assert.equal(db.getPaperLibraryPage({folder:b.id}).total,0);assert.throws(()=>db.enqueuePaperImport({inputUrl:'https://arxiv.org/abs/2601.01234',paperFolderId:'missing'}));assert.equal(db.listPapers().length,31);db.deleteKnowledgeTarget('paper',initial.paper.id);db.paperFolders.remove(a.id);db.paperFolders.remove(b.id);db.closeDatabase();`],{cwd,env,encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  const server=spawn(process.execPath,['server.mjs'],{cwd,env,stdio:'ignore'}),base='http://127.0.0.1:47856';
  const json=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}); const data=await response.json();return {response,data};};
  try {
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
    let result=await json('/api/papers?page=1'); assert.equal(result.response.status,200);assert.equal(result.data.total,30);assert.equal(result.data.papers.length,24);assert.equal(result.data.unfiledCount,30);assert(!Object.hasOwn(result.data.papers[0],'fullTranslationHtml'));
    const a=(await json('/api/paper-folders','POST',{name:'研究方向'})).data.folder;
    const b=(await json('/api/paper-folders','POST',{name:'子目录',parentId:a.id})).data.folder;
    assert((await json('/api/paper-folder-items','PATCH',{paperIds:['fixture_0','fixture_1'],folderId:b.id})).response.ok);
    result=await json('/api/papers?page=1&folder='+a.id);assert.equal(result.data.total,2);assert.equal(result.data.folders.find(f=>f.id===a.id).count,2);
    assert(!(await json('/api/paper-folders/'+a.id,'PATCH',{parentId:b.id})).response.ok);
    assert(!(await json('/api/paper-folders/'+a.id,'DELETE')).response.ok);
    assert(!(await json('/api/paper-folder-items','PATCH',{paperIds:['fixture_0','missing'],folderId:a.id})).response.ok);
    assert.equal((await json('/api/papers?page=1&folder='+b.id)).data.total,2);
    assert(!(await json('/api/papers/import/url','POST',{url:'https://arxiv.org/abs/2512.08296',paperFolderId:'missing'})).response.ok);
    assert.equal((await json('/api/papers?page=1')).data.libraryTotal,30);
    assert.equal((await json('/api/paper-folders/'+b.id,'DELETE')).data.released,2);
    assert.equal((await json('/api/papers?page=1&folder=unfiled')).data.total,30);
    assert.equal((await json('/api/papers')).data.papers.length,30,'legacy API remains compatible');
  } finally { server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
