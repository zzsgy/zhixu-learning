import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePaperAssetUrl } from "../public/paper-assets.js";
import { resolvePaperAsset } from "../lib/paper-assets.mjs";
import { normalizePaperTranslationHtml } from "../lib/paper-structure.mjs";
test("paper assets accept only exact owned raster routes", () => {
  const url="/api/papers/paper_abc/assets/figure-01.png";
  assert.deepEqual(parsePaperAssetUrl(url),{paperId:"paper_abc",fileName:"figure-01.png"});
  for (const invalid of ["/etc/passwd","/api/papers/../assets/x.png",url+"?x=1",url+"/../a.png",url.replace("figure-01", "%2e%2e%2fsecret"),url.replace(".png", ".svg"),"https://evil.test"+url]) assert.equal(parsePaperAssetUrl(invalid),null);
  const html=normalizePaperTranslationHtml(`<img src="${url}"><img src="file:///secret.png"><img src="/api/storage/secrets.png">`);
  assert.match(html,/figure-01.png/);assert.doesNotMatch(html,/secret/);
});
test("paper assets resolve existing files within their dedicated directory",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"zhixu-paper-assets-"));
  try { fs.mkdirSync(path.join(dir,"assets","paper_abc"),{recursive:true});
    fs.writeFileSync(path.join(dir,"assets","paper_abc","fig.png"),"fixture");
    assert.equal(resolvePaperAsset(dir,"/api/papers/paper_abc/assets/fig.png").contentType,"image/png");
    assert.equal(resolvePaperAsset(dir,"/api/papers/paper_abc/assets/absent.png"),null);
    assert.equal(resolvePaperAsset(dir,"/api/papers/paper_abc/assets/../fig.png"),null);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
