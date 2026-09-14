import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { renderStorageDashboard, renderStorageJobOverview, renderStorageBrowserOverview, storageSizeText } from '../public/storage-dashboard.js';
const html = fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const fixture = () => parseHTML(html).document;
const storage = {
  dataDirectory:'D:\\资料 & 论文\\data', databasePath:'D:\\资料\\zhixu.db', attachmentDirectory:'D:\\资料\\attachments', backupDirectory:'D:\\资料\\backups',
  latestDatabaseBackup:{path:'D:\\资料\\backups\\snapshot.db',createdAt:'2026-09-12T08:04:00Z',sizeBytes:79290368},
  latestFullBackup:{path:'D:\\资料\\backups\\'+'很长的目录'.repeat(40),fileCount:1936,totalBytes:1236129504,verifiedAt:'2026-09-12T07:24:00Z'},
};
test('存储页面完整记录按字段展示，路径以纯文本保存且操作入口唯一',()=>{
  const doc=fixture(); renderStorageDashboard(storage,{pendingFileCount:0,pending:[]},doc);
  assert.equal(doc.querySelector('#storage-data-path').textContent,storage.dataDirectory);
  assert.equal(doc.querySelector('#storage-full-path').textContent,storage.latestFullBackup.path);
  assert.equal(doc.querySelector('#storage-full-state').textContent,'已校验');
  assert.match(doc.querySelector('#storage-full-size').textContent,/1,936 个文件 · 1.2 GiB/);
  assert.equal(doc.querySelector('#storage-cleanup-retry').disabled,true);
  assert.equal(doc.querySelector('#storage-last-error').hidden,true);
  for(const id of ['backup-button','full-backup-button','browser-pairing-button','refresh-import-jobs','import-job-filter','show-import-job-history','storage-cleanup-retry']) assert.equal(doc.querySelectorAll('#'+id).length,1);
  assert.equal(doc.querySelectorAll('.storage-dashboard > .storage-panel').length,3);
});
test('缺失、未知和未验证状态不能被渲染为成功或零大小',()=>{
  const doc=fixture(); renderStorageDashboard({}, {pendingFileCount:0},doc);
  assert.equal(doc.querySelector('#storage-full-state').textContent,'尚未创建');
  assert.equal(doc.querySelector('#storage-snapshot-size').textContent,'—');
  renderStorageDashboard(null,null,doc,['状态读取失败']);
  assert.equal(doc.querySelector('#storage-cleanup-state').textContent,'状态未知');
  assert.equal(doc.querySelector('#storage-cleanup-overview').textContent,'读取失败');
  assert.equal(doc.querySelector('#storage-cleanup-retry').disabled,true);
  assert.equal(doc.querySelector('#storage-last-error').hidden,false);
  renderStorageDashboard({...storage,latestFullBackup:{...storage.latestFullBackup,verifiedAt:'invalid'}},{pendingFileCount:0},doc);
  assert.equal(doc.querySelector('#storage-full-state').textContent,'待核验');
  for (const value of [null,undefined,NaN,-1]) assert.equal(storageSizeText(value),'大小未知');
  assert.equal(storageSizeText(0),'0 B');
});
test('备份失败和待清理原因明确显示，不执行清理或创建动作',()=>{
  const doc=fixture(); const malicious='<img src=x onerror=alert(1)>';
  renderStorageDashboard({...storage,lastError:{message:malicious,occurredAt:'2026-09-12T08:00:00Z'}},{pendingFileCount:2,pending:[{lastError:'文件正被占用'}]},doc);
  assert.equal(doc.querySelector('#storage-cleanup-retry').disabled,false);
  assert.match(doc.querySelector('#storage-cleanup-status').textContent,/2 个.*文件正被占用/);
  assert.match(doc.querySelector('#storage-last-error').textContent,/<img/);
  assert.equal(doc.querySelector('#storage-last-error img'),null);
  assert.equal(doc.querySelector('#storage-last-error').hidden,false);
});
test('任务概况区分待确认、失败及活动，撤销的客户端不计入已连接',()=>{
  const doc=fixture(); renderStorageJobOverview([{status:'running'},{status:'failed'},{status:'running',stage:'awaiting_confirmation'},{status:'completed'}],doc);
  assert.equal(doc.querySelector('#storage-jobs-overview').textContent,'2 项需关注');
  assert.match(doc.querySelector('#storage-jobs-detail').textContent,/1 项处理中/);
  renderStorageBrowserOverview([{active:true},{active:false}],doc);
  assert.equal(doc.querySelector('#storage-browser-state').textContent,'已连接 1 个');
  renderStorageJobOverview([],doc); renderStorageBrowserOverview([],doc);
  assert.equal(doc.querySelector('#storage-jobs-overview').textContent,'暂无待办');
  assert.equal(doc.querySelector('#storage-browser-state').textContent,'未配对');
});
