const serviceUrl = "http://127.0.0.1:47821";
const pairingPanel = document.querySelector("#pairing-panel");
const pairingForm = document.querySelector("#pairing-form");
const pairingCode = document.querySelector("#pairing-code");
const capturePanel = document.querySelector("#capture-panel");
const connectionLabel = document.querySelector("#connection-label");
const capturePageButton = document.querySelector("#capture-page");
const captureSelectionButton = document.querySelector("#capture-selection");
const disconnectButton = document.querySelector("#disconnect");
const statusLabel = document.querySelector("#status");

function showStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.style.color = isError ? "#b42318" : "#57625d";
}

async function loadConnection() {
  const stored = await chrome.storage.local.get(["token", "client", "lastJob", "lastError"]);
  const connected = Boolean(stored.token);
  pairingPanel.hidden = connected;
  capturePanel.hidden = !connected;
  connectionLabel.textContent = connected
    ? `已连接：${stored.client?.name || "本机知序"}`
    : "尚未连接";
  if (stored.lastError) showStatus(stored.lastError, true);
  else if (stored.lastJob?.status === "completed") showStatus(`已收藏：${stored.lastJob.result?.title || "网页"}`);
  else if (stored.lastJob?.status === "failed") showStatus(stored.lastJob.errorMessage || "上次收藏失败。", true);
  else if (stored.lastJob) showStatus(`后台处理中：${stored.lastJob.stage}`);
  else showStatus(connected ? "可以收藏当前网页或选区。" : "输入知序页面显示的六位配对码。");
}

pairingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = pairingForm.querySelector("button");
  submitButton.disabled = true;
  try {
    const response = await fetch(`${serviceUrl}/api/browser/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairingCode.value, name: `Chrome/Edge 扩展` }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `配对失败：${response.status}`);
    await chrome.storage.local.set({
      serviceUrl,
      token: payload.token,
      client: payload.client,
      lastError: "",
    });
    pairingCode.value = "";
    await loadConnection();
    showStatus("配对成功，可以快速收藏网页。 ");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

async function getCurrentPage(includeSelection) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("无法读取当前页面地址。");
  let selectedText = "";
  if (includeSelection && tab.id) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || "",
    });
    selectedText = String(results?.[0]?.result || "").trim();
    if (!selectedText) throw new Error("请先在网页中选中文字。");
  }
  return { url: tab.url, title: tab.title || "", selectedText };
}

async function captureCurrentPage(includeSelection) {
  capturePageButton.disabled = true;
  captureSelectionButton.disabled = true;
  try {
    const payload = await getCurrentPage(includeSelection);
    const result = await chrome.runtime.sendMessage({ type: "capture-page", payload });
    if (!result?.ok) throw new Error(result?.message || "收藏请求未能发送。");
    showStatus("已加入知序后台任务，可以关闭此窗口。 ");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    capturePageButton.disabled = false;
    captureSelectionButton.disabled = false;
  }
}

capturePageButton.addEventListener("click", () => void captureCurrentPage(false));
captureSelectionButton.addEventListener("click", () => void captureCurrentPage(true));
disconnectButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "client", "lastJob", "lastError"]);
  await loadConnection();
});

void loadConnection();
