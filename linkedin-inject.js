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

    stageTitle(titleField, response.title || response.sourceUrl || "");
  } catch (error) {
    console.error("POSSE: Failed to inject LinkedIn title", error);
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
