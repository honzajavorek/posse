const browserApi = browser;

const TARGET_DISCORD_URL = "https://discord.com/channels/769966886598737931/1075091413454303272";
const TARGET_LINKEDIN_URL = "https://www.linkedin.com/article/new/";

// Map of target tab IDs to the metadata we still need to inject.
const pendingTasks = new Map();

browserApi.browserAction.onClicked.addListener(async (activeTab) => {
  try {
    const tabDetails = activeTab && typeof activeTab.id === "number"
      ? await browserApi.tabs.get(activeTab.id)
      : activeTab;

    const sourceUrl = tabDetails && tabDetails.url;
    const sourceTitle = tabDetails && tabDetails.title;

    if (!sourceUrl || sourceUrl.startsWith("about:")) {
      console.warn("POSSE: No usable URL found on the active tab.");
      return;
    }

    const metadata = {
      sourceUrl,
      sourceTitle: sourceTitle || ""
    };

    const discordTab = await browserApi.tabs.create({
      url: TARGET_DISCORD_URL,
      active: true
    });

    pendingTasks.set(discordTab.id, {
      type: "discord",
      payload: metadata,
      createdAt: Date.now()
    });

    const linkedinTab = await browserApi.tabs.create({
      url: TARGET_LINKEDIN_URL,
      active: false
    });

    pendingTasks.set(linkedinTab.id, {
      type: "linkedin",
      payload: metadata,
      createdAt: Date.now()
    });
  } catch (error) {
    console.error("POSSE: Failed to open target tabs", error);
  }
});

browserApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!pendingTasks.has(tabId)) {
    return;
  }

  const hasFinishedLoading = changeInfo.status === "complete";
  const pendingTask = pendingTasks.get(tabId);
  const tabUrl = tab && typeof tab.url === "string" ? tab.url : "";

  if (!pendingTask) {
    return;
  }

  if (!hasFinishedLoading) {
    return;
  }

  if (pendingTask.type === "discord" && tabUrl.startsWith(TARGET_DISCORD_URL)) {
    browserApi.tabs.executeScript(tabId, {
      file: "discord-inject.js",
      runAt: "document_idle"
    });
  }

  if (pendingTask.type === "linkedin" && tabUrl.startsWith(TARGET_LINKEDIN_URL)) {
    browserApi.tabs.executeScript(tabId, {
      file: "linkedin-inject.js",
      runAt: "document_idle"
    });
  }
});

browserApi.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "POSSE_REQUEST_URL" && sender.tab) {
    const details = pendingTasks.get(sender.tab.id);

    if (!details || details.type !== "discord") {
      return Promise.resolve({ success: false });
    }

    pendingTasks.delete(sender.tab.id);

    return Promise.resolve({
      success: true,
      postUrl: details.payload.sourceUrl
    });
  }

  if (message && message.type === "POSSE_REQUEST_LINKEDIN_METADATA" && sender.tab) {
    const details = pendingTasks.get(sender.tab.id);

    if (!details || details.type !== "linkedin") {
      return Promise.resolve({ success: false });
    }

    pendingTasks.delete(sender.tab.id);

    return Promise.resolve({
      success: true,
      title: details.payload.sourceTitle || "",
      sourceUrl: details.payload.sourceUrl || ""
    });
  }

  return undefined;
});

browserApi.tabs.onRemoved.addListener((tabId) => {
  if (pendingTasks.has(tabId)) {
    pendingTasks.delete(tabId);
  }
});
