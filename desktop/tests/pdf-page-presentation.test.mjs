import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfPageFacsimileRegion,
  shouldUsePdfPageFacsimile,
} from "../lib/pdf-page-presentation.mjs";

function createLayout({ regularLines = 0, tinyLines = 0 } = {}) {
  const lines = [
    ...Array.from({ length: regularLines }, (_value, index) => ({ text: `正文 ${index}`, fontSize: 9 })),
    ...Array.from({ length: tinyLines }, (_value, index) => ({ text: `图内标签 ${index}`, fontSize: 4.4 })),
  ];
  return {
    pageWidth: 612,
    pageHeight: 792,
    structuredText: { header: [], columns: { left: lines, right: [] }, footer: [] },
  };
}

test("大量小字号图内标签使用整页保真显示", () => {
  const layout = createLayout({ regularLines: 55, tinyLines: 65 });
  assert.equal(shouldUsePdfPageFacsimile(layout, Array.from({ length: 4 }, () => ({}))), true);
  assert.deepEqual(createPdfPageFacsimileRegion(layout), [{
    regionIndex: 0,
    column: "both",
    caption: "",
    x: 0,
    y: 0,
    width: 612,
    height: 792,
  }]);
});

test("大量图片碎片使用整页保真显示", () => {
  const layout = createLayout({ regularLines: 50 });
  assert.equal(shouldUsePdfPageFacsimile(layout, Array.from({ length: 12 }, () => ({}))), true);
});

test("普通多栏信号不会把整页强制转换成图片", () => {
  const layout = {
    ...createLayout({ regularLines: 24 }),
    multiColumn: true,
    splitRowCount: 7,
  };
  assert.equal(shouldUsePdfPageFacsimile(layout), false);
  assert.equal(shouldUsePdfPageFacsimile(layout, [], [{ regionIndex: 0 }]), false);
});

test("正常正文页和可靠局部图框保持原有重排路径", () => {
  const normalLayout = createLayout({ regularLines: 80 });
  assert.equal(shouldUsePdfPageFacsimile(normalLayout, [{}, {}]), false);

  const diagramLayout = createLayout({ regularLines: 55, tinyLines: 65 });
  assert.equal(shouldUsePdfPageFacsimile(diagramLayout, [], [{ regionIndex: 0 }]), false);
});
