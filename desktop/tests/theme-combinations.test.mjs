import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const initialization=fs.readFileSync(new URL('../public/theme-init.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
function initialize(theme,reading,blocked=false) {
  const document={documentElement:{dataset:{}}};
  vm.runInNewContext(initialization,{document,window:{localStorage:{getItem(key){if(blocked)throw Error('blocked');return key==='zhixu-theme'?theme:reading;}},matchMedia:()=>({matches:true})}});
  return document.documentElement.dataset;
}
test('深浅色与三种阅读样式独立恢复，六种组合不互相覆盖',()=>{
  for(const theme of ['light','dark'])for(const reading of ['classic','immersive','paper']){
    const state=initialize(theme,reading);
    assert.equal(state.theme,theme);assert.equal(state.readingTheme,reading);
  }
});
test('旧偏好名称保持兼容，非法值和存储禁用均安全回退',()=>{
  assert.equal(initialize('invalid','unknown').theme,'dark');
  assert.equal(initialize('invalid','unknown').readingTheme,'classic');
  assert.equal(initialize(null,null,true).readingTheme,'classic');
});
test('阅读配色必须同时受全局主题和阅读页面约束，退出阅读不污染其他页面',()=>{
  const blocks=[...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for(const [,selector,body] of blocks){
    if(selector.includes('data-reading-theme') && /--(?:ink|paper):/.test(body)){
      assert.match(selector,/data-theme="(?:light|dark)"/);
      assert.match(selector,/body\.is-reading-page/);
    }
    if(selector.includes('data-reading-theme') && /color-scheme:\s*dark/.test(body))assert.match(selector,/data-theme="dark"/);
  }
  for(const theme of ['light','dark'])for(const reading of ['immersive','paper'])assert(styles.includes(`:root[data-theme="${theme}"][data-reading-theme="${reading}"] body.is-reading-page`));
});
