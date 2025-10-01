const browserApi = typeof browser !== "undefined" ? browser : chrome;

(async () => {
  try {
    const response = await browserApi.runtime.sendMessage({ type: "POSSE_REQUEST_LINKEDIN_METADATA" });

    if (!response || !response.success) {
      console.warn("POSSE: Missing article metadata, aborting LinkedIn injection.");
      return;
    }

    const titleField = await waitForTitleField();

    if (!titleField) {
      console.error("POSSE: Could not locate LinkedIn article title input.");
      return;
    }

    const preferredTitle = response.title || response.sourceUrl || "";
    const preparedBodyHtml = resolveBodyHtml(response.bodyHtml || "", response.sourceUrl || "");
    const preparedBodyText = extractPlainText(preparedBodyHtml);

    stageTitle(titleField, preferredTitle);

    await stageCoverImage(response.coverImage || null);

    if (!preparedBodyHtml) {
      console.warn("POSSE: No body content available, skipping body injection.");
      return;
    }

    const hydratedBodyField = await waitForHydratedBodyField();

    if (!hydratedBodyField) {
      console.error("POSSE: Could not locate a stable LinkedIn article body editor.");
      return;
    }

    const injected = stageBody(hydratedBodyField, preparedBodyHtml, preparedBodyText, true);

    if (!injected) {
      console.warn("POSSE: LinkedIn body editor rejected injected content.");
      return;
    }

    maintainBodyContent(preparedBodyHtml, preparedBodyText);
  } catch (error) {
    console.error("POSSE: Failed to inject LinkedIn content", error);
  }
})();

function waitForTitleField(maxAttempts = 40, delayMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;

    const lookup = () => {
      const candidate = document.querySelector("#article-editor-headline__textarea");

      if (candidate instanceof HTMLTextAreaElement) {
        resolve(candidate);
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        resolve(null);
        return;
      }

      setTimeout(lookup, delayMs);
    };

    lookup();
  });
}

function waitForBodyField(maxAttempts = 40, delayMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;

    const lookup = () => {
      const candidate = document.querySelector('[data-test-article-editor-content-textbox]');

      if (candidate && candidate instanceof HTMLElement && candidate.isContentEditable) {
        resolve(candidate);
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        resolve(null);
        return;
      }

      setTimeout(lookup, delayMs);
    };

    lookup();
  });
}

function stageTitle(element, title) {
  const finalTitle = typeof title === "string" ? title.trim() : "";
  focusTitle(element);
  writeTitle(element, finalTitle);
  dispatchTitleEvents(element, finalTitle);
}

function focusTitle(element) {
  element.focus({ preventScroll: false });
  element.dispatchEvent(new Event("focus", { bubbles: true }));
}

function writeTitle(element, title) {
  element.value = title;
}

function dispatchTitleEvents(element, title) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: title,
      inputType: "insertText"
    }));
  } catch (error) {
    // Some browsers may not support constructing InputEvent.
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function stageCoverImage(coverImage) {
  if (!coverImage || typeof coverImage !== "object" || !coverImage.url) {
    return;
  }

  try {
    const container = await waitForCoverMediaContainer();
    if (!container) {
      console.warn("POSSE: Could not find LinkedIn cover media container.");
      return;
    }

    const file = await resolveCoverImageFile(coverImage);
    if (!file) {
      console.warn("POSSE: Unable to prepare cover image file for upload.");
      return;
    }

    const input = await waitForCoverFileInput();
    if (input) {
      if (injectFileIntoInput(input, file)) {
        return;
      }
    }

    if (!simulateCoverDrop(container, file)) {
      console.warn("POSSE: Unable to inject cover image via simulated drop.");
    }
  } catch (error) {
    console.error("POSSE: Failed to stage cover image", error);
  }
}

function waitForCoverMediaContainer(maxAttempts = 40, delayMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;

    const lookup = () => {
      const candidate = document.querySelector('.article-editor-cover-media');
      if (candidate && candidate instanceof HTMLElement) {
        resolve(candidate);
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        resolve(null);
        return;
      }

      setTimeout(lookup, delayMs);
    };

    lookup();
  });
}

function waitForCoverFileInput(maxAttempts = 40, delayMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;

    const lookup = () => {
      const candidate = document.querySelector('.article-editor-cover-media input[type="file"]');
      if (candidate instanceof HTMLInputElement) {
        resolve(candidate);
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        resolve(null);
        return;
      }

      setTimeout(lookup, delayMs);
    };

    lookup();
  });
}

async function resolveCoverImageFile(coverImage) {
  const fileName = deriveCoverFileName(coverImage);
  const mimeFallback = guessMimeTypeFromFileName(fileName);

  let blob = null;

  if (coverImage.url) {
    try {
      const response = await fetch(coverImage.url, { mode: "cors", credentials: "omit" });
      if (response.ok) {
        blob = await response.blob();
      } else {
        console.warn("POSSE: Cover image fetch returned status", response.status);
      }
    } catch (error) {
      console.warn("POSSE: Unable to fetch cover image directly", error);
    }
  }

  if (!blob && coverImage.dataUrl) {
    blob = dataUrlToBlob(coverImage.dataUrl);
  }

  if (!blob) {
    return null;
  }

  const type = blob.type || mimeFallback;
  try {
    return new File([blob], fileName, { type });
  } catch (error) {
    console.warn("POSSE: File constructor not supported for cover image", error);
    return null;
  }
}

function deriveCoverFileName(coverImage) {
  if (coverImage && typeof coverImage === "object" && coverImage.url) {
    try {
      const url = new URL(coverImage.url, window.location.href);
      const pathname = url.pathname || "";
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length) {
        return segments[segments.length - 1];
      }
    } catch (error) {
      // Ignore URL parsing issues and fall back to default.
    }
  }
  return "cover-image.jpg";
}

function guessMimeTypeFromFileName(fileName) {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "image/jpeg";
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }

  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) {
      return null;
    }
    const header = parts[0];
    const base64 = parts.slice(1).join(',');
    const match = header.match(/data:([^;]+)(;base64)?/i);
    const mime = match && match[1] ? match[1] : "application/octet-stream";
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  } catch (error) {
    console.warn("POSSE: Failed to convert data URL to blob", error);
    return null;
  }
}

function injectFileIntoInput(input, file) {
  if (!input || !file || typeof DataTransfer !== "function") {
    return false;
  }

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (error) {
    console.warn("POSSE: Unable to inject file into cover input", error);
    return false;
  }
}

function simulateCoverDrop(container, file) {
  if (!container || !file || typeof DataTransfer !== "function" || typeof DragEvent !== "function") {
    return false;
  }

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    const trigger = (type) => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      });
      container.dispatchEvent(event);
    };

    trigger("dragenter");
    trigger("dragover");
    trigger("drop");
    return true;
  } catch (error) {
    console.warn("POSSE: Failed to simulate cover image drop", error);
    return false;
  }
}

function stageBody(element, html, plainText, allowSimulatedPaste = true) {
  const trimmed = typeof html === "string" ? html.trim() : "";
  if (!trimmed || !element) {
    return false;
  }

  focusBody(element);

  let inserted = false;
  if (allowSimulatedPaste) {
    inserted = simulatePaste(element, trimmed, plainText);
  }

  if (!inserted || !hasBodyContent(element)) {
    replaceBodyContent(element, trimmed);
  }

  dispatchBodyEvents(element, trimmed);

  return hasBodyContent(element);
}

function focusBody(element) {
  element.focus({ preventScroll: false });
  element.dispatchEvent(new Event("focus", { bubbles: true }));
}

function replaceBodyContent(element, html) {
  const hasSelection = selectAllIn(element);

  let inserted = false;
  if (hasSelection && typeof document.execCommand === "function") {
    try {
      inserted = document.execCommand("insertHTML", false, html);
    } catch (error) {
      inserted = false;
    }
  }

  if (!inserted) {
    element.innerHTML = html;
  }
}

function selectAllIn(element) {
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.addRange(range);
  return true;
}

function dispatchBodyEvents(element, html) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: html,
      inputType: "insertHTML"
    }));
  } catch (error) {
    // Some browsers may not support constructing InputEvent.
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function resolveBodyHtml(html, fallbackText) {
  const trimmed = typeof html === "string" ? html.trim() : "";
  if (trimmed) {
    return trimmed;
  }

  const fallback = typeof fallbackText === "string" ? fallbackText.trim() : "";
  if (!fallback) {
    return "";
  }

  const escaped = fallback
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<p>${escaped}</p>`;
}

function hasBodyContent(element) {
  if (!element || !element.isConnected) {
    return false;
  }
  const textContent = element.textContent ? element.textContent.trim() : "";
  if (textContent) {
    return true;
  }

  const hasRichNodes = element.querySelector("img, video, iframe, figure, blockquote, ul, ol, table, pre, code, hr, embed, object");
  if (hasRichNodes) {
    return true;
  }

  return false;
}

async function waitForHydratedBodyField(options = {}) {
  const bodyField = await waitForBodyField();
  if (!bodyField) {
    return null;
  }

  const stableField = await waitForBodyStability(bodyField, options);
  if (stableField && stableField.isConnected) {
    return stableField;
  }

  const latest = document.querySelector('[data-test-article-editor-content-textbox]');
  return latest && latest instanceof HTMLElement && latest.isContentEditable ? latest : null;
}

function waitForBodyStability(initialField, { idleMs = 700, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!initialField) {
      resolve(null);
      return;
    }

    let resolved = false;
    let latestField = initialField;
    let lastMutation = Date.now();

    const updateLatest = () => {
      const current = document.querySelector('[data-test-article-editor-content-textbox]');
      if (current && current instanceof HTMLElement && current.isContentEditable) {
        latestField = current;
      }
      lastMutation = Date.now();
    };

    updateLatest();

    const observer = new MutationObserver((records) => {
      let relevant = false;
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest('[data-test-article-editor-content-textbox]')) {
          relevant = true;
          break;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('[data-test-article-editor-content-textbox]')) {
            relevant = true;
            break;
          }
        }
        if (relevant) {
          break;
        }
      }
      if (relevant) {
        updateLatest();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    const intervalId = setInterval(() => {
      if (resolved) {
        return;
      }
      const now = Date.now();
      if (now - lastMutation >= idleMs) {
        resolved = true;
        clearInterval(intervalId);
        observer.disconnect();
        resolve(latestField && latestField.isConnected ? latestField : document.querySelector('[data-test-article-editor-content-textbox]'));
      }
    }, Math.min(150, idleMs));

    setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearInterval(intervalId);
      observer.disconnect();
      resolve(latestField && latestField.isConnected ? latestField : document.querySelector('[data-test-article-editor-content-textbox]'));
    }, timeoutMs);
  });
}

function simulatePaste(element, html, plainText) {
  if (typeof ClipboardEvent !== "function" || typeof DataTransfer !== "function") {
    return false;
  }

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/html", html);
    if (plainText) {
      dataTransfer.setData("text/plain", plainText);
    }

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(pasteEvent, "clipboardData", {
      value: dataTransfer,
      writable: false
    });

    const dispatched = element.dispatchEvent(pasteEvent);
    return dispatched;
  } catch (error) {
    return false;
  }
}

function extractPlainText(html) {
  if (!html) {
    return "";
  }

  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  const text = scratch.textContent || "";
  return text.trim();
}

function maintainBodyContent(html, plainText, { durationMs = 12000 } = {}) {
  if (!html) {
    return;
  }

  let active = true;
  let observer = null;

  const stop = () => {
    if (!active) {
      return;
    }
    active = false;
    if (observer) {
      observer.disconnect();
    }
    document.removeEventListener("input", onUserInput, true);
  };

  const onUserInput = (event) => {
    if (!event || !event.target) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-test-article-editor-content-textbox]')) {
      stop();
    }
  };

  document.addEventListener("input", onUserInput, true);

  const tryRestoreBody = (markup, textFallback, allowPaste) => {
    const field = document.querySelector('[data-test-article-editor-content-textbox]');
    if (!field || hasBodyContent(field)) {
      return;
    }
    stageBody(field, markup, textFallback, allowPaste);
  };

  observer = new MutationObserver(() => {
    if (!active) {
      return;
    }
    tryRestoreBody(html, plainText, false);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => {
    stop();
  }, durationMs);

  setTimeout(() => tryRestoreBody(html, plainText, false), 150);
  setTimeout(() => tryRestoreBody(html, plainText, false), 600);
  setTimeout(() => tryRestoreBody(html, plainText, false), 1400);
}
