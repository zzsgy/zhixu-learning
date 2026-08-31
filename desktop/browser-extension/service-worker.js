const defaultServiceUrl = "http://127.0.0.1:47821";

async function getConnection() {
  const stored = await chrome.storage.local.get(["serviceUrl", "token", "client"]);
  return {
    serviceUrl: String(stored.serviceUrl || defaultServiceUrl).replace(/\/$/, ""),
    token: String(stored.token || ""),
    client: stored.client || null,
  };
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function requestCaptureStatus(serviceUrl, token, jobId) {
  const response = await fetch(
    `${serviceUrl}/api/browser/captures/${encodeURIComponent(jobId)}`,
    { headers: { "X-Zhixu-Capture-Token": token }, cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `查询失败：${response.status}`);
  return payload.job;
}

async function waitForCapture(serviceUrl, token, jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await requestCaptureStatus(serviceUrl, token, jobId);
    await chrome.storage.local.set({ lastJob: job });
    if (job.status === "completed") {
      await setBadge("✓", "#167447");
      return job;
    }
    if (job.status === "failed") {
      await setBadge("!", "#b42318");
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await setBadge("…", "#8a5a00");
  return null;
}

async function capturePage(input) {
  const connection = await getConnection();
  if (!connection.token) throw new Error("请先打开扩展并输入知序配对码。");
  const response = await fetch(`${connection.serviceUrl}/api/browser/captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Zhixu-Capture-Token": connection.token,
    },
    body: JSON.stringify({
      url: input.url,
      title: input.title || "",
      selectedText: input.selectedText || "",
      sourceHtml: input.sourceHtml || "",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `收藏失败：${response.status}`);
  await chrome.storage.local.set({ lastJob: payload.job });
  await setBadge("…", "#165dff");
  void waitForCapture(connection.serviceUrl, connection.token, payload.job.id);
  return payload.job;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "zhixu-save-page",
    title: "保存当前网页到知序",
    contexts: ["page", "link"],
  });
  chrome.contextMenus.create({
    id: "zhixu-save-selection",
    title: "保存选中文字到知序",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || tab?.url || info.pageUrl || "";
  if (!url) return;
  void (async () => {
    /** 只有收藏当前页或当前选区时才提交 DOM；右键其他链接仍走普通后台抓取。 */
    let sourceHtml = "";
    if (tab?.id && !info.linkUrl) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement?.outerHTML || "",
      });
      sourceHtml = String(results?.[0]?.result || "");
    }
    await capturePage({
      url,
      title: tab?.title || "",
      selectedText: info.selectionText || "",
      sourceHtml,
    });
  })().catch(async (error) => {
    await chrome.storage.local.set({ lastError: error.message });
    await setBadge("!", "#b42318");
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-page") return false;
  capturePage(message.payload || {})
    .then((job) => sendResponse({ ok: true, job }))
    .catch((error) => sendResponse({ ok: false, message: error.message }));
  return true;
});
