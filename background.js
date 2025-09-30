const browserApi = browser;

const TARGET_DISCORD_URL = "https://discord.com/channels/769966886598737931/1075091413454303272";
const TARGET_LINKEDIN_URL = "https://www.linkedin.com/article/new/";
const SUPPORTED_SOURCE_HOSTNAME = "honzajavorek.cz";
const SUPPORTED_SOURCE_PATH_PREFIX = "/blog/";
const UNSUPPORTED_PAGE_MESSAGE = "POSSE currently supports only articles on https://honzajavorek.cz/blog/.";

function ensureSupportedSourceUrl(urlString) {
  if (!urlString) {
    const error = new Error(UNSUPPORTED_PAGE_MESSAGE);
    error.name = "POSSEUnsupportedSource";
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (parseError) {
    const error = new Error(UNSUPPORTED_PAGE_MESSAGE);
    error.name = "POSSEUnsupportedSource";
    throw error;
  }

  if (parsed.hostname !== SUPPORTED_SOURCE_HOSTNAME || !parsed.pathname.startsWith(SUPPORTED_SOURCE_PATH_PREFIX)) {
    const error = new Error(UNSUPPORTED_PAGE_MESSAGE);
    error.name = "POSSEUnsupportedSource";
    throw error;
  }

  return parsed;
}

async function notifyUnsupportedPage(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await browserApi.tabs.executeScript(tabId, {
      code: `window.alert(${JSON.stringify(UNSUPPORTED_PAGE_MESSAGE)})`
    });
  } catch (scriptError) {
    console.warn("POSSE: Unable to notify user about unsupported page", scriptError);
  }
}

// Map of target tab IDs to the metadata we still need to inject.
const pendingTasks = new Map();

browserApi.browserAction.onClicked.addListener(async (activeTab) => {
  try {
    const tabDetails = activeTab && typeof activeTab.id === "number"
      ? await browserApi.tabs.get(activeTab.id)
      : activeTab;

    try {
      ensureSupportedSourceUrl(tabDetails ? tabDetails.url : undefined);
    } catch (validationError) {
      await notifyUnsupportedPage(tabDetails && typeof tabDetails.id === "number" ? tabDetails.id : undefined);
      throw validationError;
    }

    let scraped = { url: tabDetails ? tabDetails.url : undefined, title: tabDetails ? tabDetails.title : undefined, bodyHtml: "" };

    if (tabDetails && typeof tabDetails.id === "number") {
      try {
        const [result] = await browserApi.tabs.executeScript(tabDetails.id, {
          file: "scrape-article.js"
        });

        if (result && typeof result === "object") {
          scraped = {
            url: typeof result.url === "string" && result.url ? result.url : scraped.url,
            title: typeof result.title === "string" && result.title ? result.title : scraped.title,
            bodyHtml: typeof result.bodyHtml === "string" ? result.bodyHtml : ""
          };
        }
      } catch (scrapeError) {
        console.warn("POSSE: Failed to scrape article content", scrapeError);
      }
    }

    const sourceUrl = scraped.url;
    const sourceTitle = scraped.title;

    if (!sourceUrl || sourceUrl.startsWith("about:")) {
      console.warn("POSSE: No usable URL found on the active tab.");
      return;
    }

    const metadata = {
      sourceUrl,
      sourceTitle: sourceTitle || "",
      bodyHtml: scraped.bodyHtml || ""
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
    if (error && error.name === "POSSEUnsupportedSource") {
      console.warn("POSSE: Unsupported page selected for syndication", error.message);
      return;
    }

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
      sourceUrl: details.payload.sourceUrl || "",
      bodyHtml: details.payload.bodyHtml || ""
    });
  }

  return undefined;
});

browserApi.tabs.onRemoved.addListener((tabId) => {
  if (pendingTasks.has(tabId)) {
    pendingTasks.delete(tabId);
  }
});
