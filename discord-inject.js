const browserApi = typeof browser !== "undefined" ? browser : chrome;

(async () => {
  try {
    const response = await browserApi.runtime.sendMessage({ type: "POSSE_REQUEST_URL" });
    if (!response || !response.success || !response.postUrl) {
      console.warn("POSSE: Missing post URL, aborting injection.");
      return;
    }

    const composer = await waitForComposer();
    if (!composer) {
      console.error("POSSE: Could not locate Discord message composer.");
      return;
    }

    stageMessage(composer, response.postUrl);
  } catch (error) {
    console.error("POSSE: Failed to inject message", error);
  }
})();

function waitForComposer(maxAttempts = 30, delayMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;

    const lookup = () => {
      const candidate = document.querySelector('[role="textbox"]');

      if (candidate && candidate.isContentEditable) {
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

function stageMessage(element, message) {
  focusComposer(element);
  const stagedMessage = message.startsWith(" ") ? message : ` ${message}`;
  const inserted = replaceComposerContent(element, stagedMessage);

  if (!inserted) {
    element.textContent = stagedMessage;
  }

  collapseSelectionToStart(element);

  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: stagedMessage,
    inputType: "insertText"
  }));

  requestAnimationFrame(() => {
    collapseSelectionToStart(element);
  });
}

function focusComposer(element) {
  element.focus({ preventScroll: false });
  element.dispatchEvent(new Event("focus", { bubbles: true }));
}

function replaceComposerContent(element, message) {
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.addRange(range);

  const insertedText = document.execCommand("insertText", false, message);
  if (insertedText) {
    return true;
  }

  const insertedHtml = document.execCommand("insertHTML", false, message);
  return insertedHtml;
}

function collapseSelectionToStart(element) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.addRange(range);
}
