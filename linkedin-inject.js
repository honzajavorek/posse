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

    stageTitle(titleField, preferredTitle);

    if (!preparedBodyHtml) {
      console.warn("POSSE: No body content available, skipping body injection.");
      return;
    }

    await delay(750);

    let bodyField = await waitForBodyField();
    if (!bodyField) {
      console.error("POSSE: Could not locate LinkedIn article body editor.");
      return;
    }

    let injected = stageBody(bodyField, preparedBodyHtml);

    if (!injected) {
      await delay(500);
      bodyField = await waitForBodyField();
      if (!bodyField) {
        console.error("POSSE: Could not re-locate LinkedIn article body editor after retry.");
        return;
      }
      injected = stageBody(bodyField, preparedBodyHtml);
    }

    if (injected) {
      ensureBodyPersistence(preparedBodyHtml);
    } else {
      console.warn("POSSE: LinkedIn body editor rejected injected content.");
    }
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

function stageBody(element, html) {
  const trimmed = typeof html === "string" ? html.trim() : "";
  if (!trimmed) {
    return false;
  }

  focusBody(element);
  replaceBodyContent(element, trimmed);
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

function ensureBodyPersistence(html, attemptsLeft = 3, initialDelay = 800) {
  if (!html || attemptsLeft <= 0) {
    return;
  }

  setTimeout(async () => {
    const candidate = await waitForBodyField(10, 200);
    if (!candidate) {
      ensureBodyPersistence(html, attemptsLeft - 1, initialDelay + 300);
      return;
    }

    if (!hasBodyContent(candidate)) {
      const injected = stageBody(candidate, html);
      if (!injected) {
        ensureBodyPersistence(html, attemptsLeft - 1, initialDelay + 300);
        return;
      }
    }

    // Verify once more later to guard against late re-renders.
    ensureBodyPersistence(html, attemptsLeft - 1, initialDelay + 300);
  }, initialDelay);
}

function hasBodyContent(element) {
  if (!element || !element.isConnected) {
    return false;
  }
  if (element.innerHTML && element.innerHTML.trim()) {
    return true;
  }
  if (element.textContent && element.textContent.trim()) {
    return true;
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
