import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
const cwd=path.resolve(import.meta.dirname,'..');
test('local paper assets appear in Chinese export and cannot expose unrelated paths', {timeout:20000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhixu-paper-assets-http-'));
 const env={...process.env,ZHIXU_DATA_DIR:dir,ZHIXU_ENV_FILE:path.join(dir,'absent.env'),ZHIXU_PORT:'47849',ZHIXU_DISABLE_CODEX_WORKER:'1',ZHIXU_NO_BROWSER:'1'};
 const fixture=spawnSync(process.execPath,['--input-type=module','-e',`import * as db from './lib/database.mjs'; db.upsertImportedPaper({id:'paper_asset_fixture',externalId:'asset_fixture',title:'Local figure',category:'人工智能',sourceUrl:'https://example.com/paper'}); db.updatePaperFullTranslation('paper_asset_fixture','<img src="/api/papers/paper_asset_fixture/assets/figure-01.png"><img src="/api/storage/secret.png">'+'<p>中文正文</p>'.repeat(90));`],{cwd,env,encoding:'utf8'});
 assert.equal(fixture.status,0,fixture.stderr);
 const assetDir=path.join(dir,'papers','assets','paper_asset_fixture');fs.mkdirSync(assetDir,{recursive:true});
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');fs.writeFileSync(path.join(assetDir,'figure-01.png'),bytes);
 const server=spawn(process.execPath,['server.mjs'],{cwd,env,stdio:'ignore'});const base='http://127.0.0.1:47849';
 try {
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'test server starts');
  const response=await fetch(base+'/api/papers/paper_asset_fixture/assets/figure-01.png');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const html=await (await fetch(base+'/api/papers/paper_asset_fixture/chinese-export')).text();assert(html.includes(base+'/api/papers/paper_asset_fixture/assets/figure-01.png'));assert(!html.includes('/api/storage/secret.png'));
  assert.equal((await fetch(base+'/api/papers/missing/assets/figure-01.png')).status,404);
  assert.equal((await fetch(base+'/api/papers/paper_asset_fixture/assets/absent.png')).status,404);
 } finally {server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
