const browserApi = browser;

const TARGET_DISCORD_URL = "https://discord.com/channels/769966886598737931/1075091413454303272";

// Map of Discord tab IDs to the URL we want to paste.
const pendingPosts = new Map();

browserApi.browserAction.onClicked.addListener(async (activeTab) => {
  try {
    const sourceUrl = activeTab && activeTab.url;

    if (!sourceUrl || sourceUrl.startsWith("about:")) {
      console.warn("POSSE: No usable URL found on the active tab.");
      return;
    }

    const discordTab = await browserApi.tabs.create({
      url: TARGET_DISCORD_URL,
      active: true
    });

    pendingPosts.set(discordTab.id, {
      sourceUrl,
      createdAt: Date.now()
    });
  } catch (error) {
    console.error("POSSE: Failed to open Discord tab", error);
  }
});

browserApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!pendingPosts.has(tabId)) {
    return;
  }

  const hasFinishedLoading = changeInfo.status === "complete";
  const isTargetUrl = tab && typeof tab.url === "string" && tab.url.startsWith(TARGET_DISCORD_URL);

  if (hasFinishedLoading && isTargetUrl) {
    browserApi.tabs.executeScript(tabId, {
      file: "discord-inject.js",
      runAt: "document_idle"
    });
  }
});

browserApi.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "POSSE_REQUEST_URL" && sender.tab) {
    const details = pendingPosts.get(sender.tab.id);

    if (!details) {
      return Promise.resolve({ success: false });
    }

    pendingPosts.delete(sender.tab.id);

    return Promise.resolve({
      success: true,
      postUrl: details.sourceUrl
    });
  }

  return undefined;
});

browserApi.tabs.onRemoved.addListener((tabId) => {
  if (pendingPosts.has(tabId)) {
    pendingPosts.delete(tabId);
  }
});
