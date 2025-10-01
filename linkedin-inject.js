const browserApi = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_WAIT_DELAY_MS = 75;
const DEFAULT_WAIT_ATTEMPTS = 80;

const logStep = (step, detail = "", level = "info") => {
  const timestamp = new Date().toISOString();
  const message = `POSSE: ${timestamp} ${step}`;
  if (level === "warn") {
    console.warn(message, detail);
  } else if (level === "error") {
    console.error(message, detail);
  } else {
    console.info(message, detail);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => resolve());
  } else {
    setTimeout(() => resolve(), 16);
  }
});

(async () => {
  try {
    const response = await browserApi.runtime.sendMessage({ type: "POSSE_REQUEST_LINKEDIN_METADATA" });

    if (!response || !response.success) {
      logStep("Missing article metadata, aborting LinkedIn injection.", "", "warn");
      return;
    }

    logStep("Received metadata for LinkedIn staging.");

    const titleField = await waitForTitleField();

    if (!titleField) {
      logStep("Could not locate LinkedIn article title input.", "", "error");
      return;
    }

    logStep("Located LinkedIn article title input.");

    const preferredTitle = response.title || response.sourceUrl || "";
    const preparedBodyHtml = resolveBodyHtml(response.bodyHtml || "", response.sourceUrl || "");
    const preparedBodyText = extractPlainText(preparedBodyHtml);

    stageTitle(titleField, preferredTitle);
    logStep("Title injected.");

    const coverPromise = stageCoverImage(response.coverImage || null);

    if (!preparedBodyHtml) {
      logStep("No body content available, skipping body injection.", "", "warn");
      return;
    }

    const hydratedBodyField = await waitForHydratedBodyField();

    if (!hydratedBodyField) {
      logStep("Could not locate a stable LinkedIn article body editor.", "", "error");
      return;
    }

    logStep("Located hydrated body editor.");

  const injected = await stageBody(hydratedBodyField, preparedBodyHtml, preparedBodyText, true);

    if (!injected) {
      logStep("LinkedIn body editor rejected injected content.", "", "warn");
      return;
    }

    maintainBodyContent(preparedBodyHtml, preparedBodyText);
    logStep("Body content staged and maintenance watcher active.");

    await coverPromise;
    logStep("Cover staging flow completed.");
  } catch (error) {
    logStep("Failed to inject LinkedIn content", error, "error");
  }
})();

async function waitForTitleField(maxAttempts = DEFAULT_WAIT_ATTEMPTS, delayMs = DEFAULT_WAIT_DELAY_MS) {
  const candidate = await waitForElement("#article-editor-headline__textarea", document, maxAttempts, delayMs);
  return candidate instanceof HTMLTextAreaElement ? candidate : null;
}

async function waitForBodyField(maxAttempts = DEFAULT_WAIT_ATTEMPTS, delayMs = DEFAULT_WAIT_DELAY_MS) {
  const candidate = await waitForElement('[data-test-article-editor-content-textbox]', document, maxAttempts, delayMs);
  return candidate && candidate instanceof HTMLElement && candidate.isContentEditable ? candidate : null;
}

function waitForElement(selector, root = document, maxAttempts = DEFAULT_WAIT_ATTEMPTS, delayMs = DEFAULT_WAIT_DELAY_MS) {
  return new Promise((resolve) => {
    if (!selector) {
      resolve(null);
      return;
    }

    const scope = root && typeof root.querySelector === "function" ? root : document;
    const initial = scope.querySelector(selector);
    if (initial instanceof Element) {
      resolve(initial);
      return;
    }

    let attempts = 0;
    let resolved = false;
    const observedNode = scope instanceof Document ? scope.documentElement : scope;
    let intervalId = null;
    let observer = null;

    const cleanup = () => {
      resolved = true;
      if (observer) {
        observer.disconnect();
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };

    const attemptResolve = () => {
      if (resolved) {
        return;
      }
      const candidate = scope.querySelector(selector);
      if (candidate instanceof Element) {
        cleanup();
        resolve(candidate);
      }
    };

    intervalId = setInterval(() => {
      if (resolved) {
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        cleanup();
        logStep("waitForElement timeout", { selector, root }, "warn");
        resolve(null);
        return;
      }
      attemptResolve();
    }, Math.max(16, delayMs));

    if (observedNode && typeof MutationObserver === "function") {
      observer = new MutationObserver(() => {
        attemptResolve();
      });

      try {
        observer.observe(observedNode, { childList: true, subtree: true });
      } catch (error) {
        // Ignore observer issues and rely solely on polling.
      }
    }

    attemptResolve();
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
  if (!coverImage || typeof coverImage !== "object") {
    logStep("No cover image provided, skipping cover staging.");
    return;
  }

  try {
    logStep("Attempting to stage cover image.");
    logStep("Initiating cover upload modal if necessary.");
    await ensureCoverUploadModal();

    const uploaderRoot = await waitForCoverUploaderRoot();
    if (!uploaderRoot) {
      logStep("Could not locate LinkedIn cover uploader root.", "", "warn");
      return;
    }

    logStep("Cover uploader root located.");

    const file = await buildCoverFile(coverImage);
    if (!file) {
      logStep("Unable to construct cover image file payload.", "", "warn");
      return;
    }

    logStep("Cover image file prepared.");

    const strategies = [
      { name: "file input", handler: () => attemptCoverFileInput(uploaderRoot, file), previewTimeout: 7000 },
      { name: "simulated drop", handler: () => attemptCoverSimulatedDrop(uploaderRoot, file) },
      { name: "React drop handlers", handler: () => attemptReactDropHandlers(uploaderRoot, file) },
      { name: "LinkedIn upload action", handler: () => attemptLinkedInUploadAction(uploaderRoot, file), previewTimeout: 8000 }
    ];

    for (const strategy of strategies) {
      logStep("Attempting cover staging strategy.", { strategy: strategy.name });
      const executed = await strategy.handler();
      if (!executed) {
        logStep("Cover staging strategy reported immediate failure.", { strategy: strategy.name }, "warn");
        continue;
      }

      const preview = await waitForCoverPreview(uploaderRoot, { timeoutMs: strategy.previewTimeout || 6000 });
      if (preview) {
        logStep("Cover image preview detected after strategy.", { strategy: strategy.name });
        return;
      }

      logStep("Preview not detected after strategy execution.", { strategy: strategy.name }, "warn");
    }

    logStep("Unable to stage cover image using available strategies.", "", "warn");
  } catch (error) {
    logStep("Failed to stage cover image", error, "error");
  }
}

async function waitForCoverUploaderRoot() {
  const selectors = ['.article-editor-cover-media', '[data-test-article-editor-cover-media]'];
  for (const selector of selectors) {
    logStep("Waiting for cover uploader root.", selector);
    const element = await waitForElement(selector);
    if (element) {
      logStep("Found cover uploader root element.", selector);
      return element;
    }
  }
  return null;
}

async function ensureCoverFileInput(root) {
  logStep("Ensuring cover file input is available.");
  const immediate = findCoverFileInput(root) || findCoverFileInput(document);
  if (immediate) {
    logStep("Cover file input found immediately.");
    return immediate;
  }

  const scoped = await waitForElement('#media-editor-file-selector__file-input', root);
  if (scoped instanceof HTMLInputElement) {
    logStep("Cover file input resolved within uploader root.");
    return scoped;
  }

  const global = await waitForElement('#media-editor-file-selector__file-input', document, DEFAULT_WAIT_ATTEMPTS * 2, DEFAULT_WAIT_DELAY_MS);
  if (global) {
    logStep("Cover file input resolved via global lookup.");
  }
  if (!global) {
    logStep("Cover file input still not found after global lookup.", "", "warn");
  }
  return global instanceof HTMLInputElement ? global : null;
}

function findCoverFileInput(scope) {
  if (!scope || typeof scope.querySelector !== "function") {
    return null;
  }

  const selector = '#media-editor-file-selector__file-input, input[name="file"][type="file"][accept*="image/"]';
  const candidate = scope.querySelector(selector);
  if (candidate instanceof HTMLInputElement) {
    logStep("Found candidate cover file input within scope.");
    return candidate;
  }
  return null;
}

function findCoverDropTarget(root) {
  if (!root || typeof root.querySelector !== "function") {
    return root instanceof Element ? root : null;
  }

  const selectors = [
    '[data-test-article-editor-cover-media] .media-editor-drop-target',
    '.media-editor-drop-target',
    '.article-editor-cover-media__media-drop-target',
    '.article-editor-cover-media__placeholder-container',
    '.article-editor-cover-media'
  ];

  for (const selector of selectors) {
    const candidate = root.querySelector(selector);
    if (candidate instanceof HTMLElement) {
      logStep("Located cover drop target.", selector);
      return candidate;
    }
  }

  return root instanceof HTMLElement ? root : null;
}

async function waitForCoverPreview(root, { timeoutMs = 6000, intervalMs = 120 } = {}) {
  const selector = '[data-test-article-editor-cover-media] img, .article-editor-cover-media img';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const scope = root && typeof root.querySelector === "function" ? root : document;
    const candidate = scope.querySelector(selector);
    if (candidate instanceof HTMLImageElement) {
      return candidate;
    }
    await sleep(intervalMs);
  }

  return null;
}

async function attemptCoverFileInput(root, file) {
  const input = await ensureCoverFileInput(root);
  if (!input) {
    logStep("Cover file input unavailable for injection.", { root }, "warn");
    return false;
  }

  const injected = injectFileIntoInput(input, file);
  if (!injected) {
    logStep("Cover file input injection failed.", { input }, "warn");
  } else {
    logStep("Cover file input injection dispatched.");
  }
  return injected;
}

async function attemptCoverSimulatedDrop(root, file) {
  const target = findCoverDropTarget(root);
  if (!target) {
    logStep("Cover drop target not found for simulated drop.", { root }, "warn");
    return false;
  }

  return simulateCoverDrop(target, file);
}

async function attemptReactDropHandlers(root, file) {
  const target = findCoverDropTarget(root);
  if (!target) {
    logStep("Cover drop target not found for React handlers.", { root }, "warn");
    return false;
  }

  return invokeReactDropHandlers(target, file);
}

async function attemptLinkedInUploadAction(root, file) {
  return invokeLinkedInUploadAction(root, file);
}

async function ensureCoverUploadModal() {
  const existing = document.querySelector('[data-test-article-editor-cover-media], .article-editor-cover-media');
  if (existing) {
    logStep("Cover uploader already present in DOM.");
    return;
  }

  const triggerSelectors = [
    '[data-test-article-editor-cover-placeholder] button',
    '.article-editor-cover-media__placeholder-container button',
    '.article-editor-cover-media button',
    'button[aria-label="Add cover"]',
    'button[aria-label="Add cover image"]'
  ];

  for (const selector of triggerSelectors) {
    const trigger = document.querySelector(selector);
    if (!trigger) {
      continue;
    }

    logStep("Attempting to activate cover uploader trigger.", { selector });

    const triggerProps = extractReactProps(trigger);
    if (triggerProps) {
      const handlerCandidates = [
        triggerProps.onManualUpload,
        triggerProps.onUpload,
        triggerProps.onAddCover,
        triggerProps.onClick,
        triggerProps.onActivate,
        triggerProps.onToggle
      ].filter((fn) => typeof fn === "function");

      for (const handler of handlerCandidates) {
        try {
          handler({
            preventDefault() {},
            stopPropagation() {},
            target: trigger,
            currentTarget: trigger,
            type: "click"
          });
          await sleep(150);
          const presentAfterHandler = document.querySelector('[data-test-article-editor-cover-media], .article-editor-cover-media');
          if (presentAfterHandler) {
            logStep("Cover uploader detected after invoking trigger handler.");
            return;
          }
        } catch (error) {
          logStep("Cover trigger handler invocation failed.", error, "warn");
        }
      }
    }

    safeActivate(trigger);
    await sleep(200);

    const present = document.querySelector('[data-test-article-editor-cover-media], .article-editor-cover-media');
    if (present) {
      logStep("Cover uploader detected after trigger activation.");
      return;
    }
  }

  logStep("Cover uploader trigger activation unsuccessful; proceeding with lazy load.", "", "warn");
}

function safeActivate(element) {
  const eventInit = { bubbles: true, cancelable: true, composed: true, view: window }; // view for MouseEvent compat

  try {
    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerId: 1, pointerType: "mouse" }));
    }
  } catch (error) {
    // Ignore pointer activation issues.
  }

  try {
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  } catch (error) {
    // Ignore mouse down issues.
  }

  try {
    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, pointerId: 1, pointerType: "mouse" }));
    }
  } catch (error) {
    // Ignore pointer up issues.
  }

  try {
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  } catch (error) {
    // Ignore mouse up issues.
  }

  try {
    element.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 1 }));
  } catch (error) {
    // Ignore click issues.
  }
}

async function buildCoverFile(coverImage) {
  const fileName = deriveCoverFileName(coverImage);
  logStep("Preparing cover file.", fileName);

  if (coverImage.dataUrl) {
    const file = dataUrlToFile(coverImage.dataUrl, fileName, coverImage.mimeType);
    if (file) {
      logStep("Cover file created from data URL.");
      return file;
    }
    logStep("Failed to create cover file from data URL, falling back to fetch.", "", "warn");
  }

  if (!coverImage.url) {
    logStep("No cover image URL available to fetch.", "", "warn");
    return null;
  }

  try {
    const response = await fetch(coverImage.url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      logStep("Cover image fetch returned non-OK status.", String(response.status), "warn");
      return null;
    }
    const blob = await response.blob();
    logStep("Cover image fetched successfully, constructing file.");
    return new File([blob], fileName, {
      type: blob.type || coverImage.mimeType || guessMimeTypeFromFileName(fileName)
    });
  } catch (error) {
    logStep("Unable to fetch cover image directly.", error, "warn");
    return null;
  }
}

function deriveCoverFileName(coverImage) {
  if (coverImage && typeof coverImage === "object") {
    if (coverImage.fileName) {
      return coverImage.fileName;
    }
    if (coverImage.url) {
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

function dataUrlToFile(dataUrl, fileName, mimeType) {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) {
    return null;
  }

  const type = mimeType || blob.type || guessMimeTypeFromFileName(fileName);

  try {
    return new File([blob], fileName, { type });
  } catch (error) {
    console.warn("POSSE: Failed to convert data URL to file", error);
    return null;
  }
}

function injectFileIntoInput(input, file) {
  if (!input || !file || typeof DataTransfer !== "function") {
    return false;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);

  try {
    input.value = "";
    input.files = transfer.files;
    logStep("Assigned file list to input via direct property.");
  } catch (directError) {
    try {
      const descriptor = {
        configurable: true,
        get: () => transfer.files
      };

      Object.defineProperty(input, "files", descriptor);
      logStep("Assigned file list via property descriptor override.");
    } catch (descriptorError) {
      logStep("Unable to override file input.", descriptorError, "warn");
      return false;
    }
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  logStep("Dispatched input/change events after file injection.");

  try {
    delete input.files;
  } catch (cleanupError) {
    // ignore cleanup issues
  }

  return true;
}

async function simulateCoverDrop(target, file) {
  if (!target || !file || typeof DataTransfer !== "function" || typeof DragEvent !== "function") {
    return false;
  }

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    const item = transfer.items[0];
    if (item && !item.getAsFile) {
      try {
        Object.defineProperty(item, "getAsFile", {
          configurable: true,
          value: () => file
        });
      } catch (error) {
        // Ignore if we can't override
      }
    }

    try {
      Object.defineProperty(transfer, "dropEffect", {
        configurable: true,
        value: "copy"
      });
      Object.defineProperty(transfer, "effectAllowed", {
        configurable: true,
        value: "all"
      });
    } catch (error) {
      // Ignore if properties are read-only.
    }

    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const dispatch = (type) => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: transfer,
        clientX,
        clientY
      });
      target.dispatchEvent(event);
    };

    dispatch("dragenter");
    await nextFrame();
    dispatch("dragover");
    await sleep(30);
    dispatch("drop");
    await nextFrame();
    dispatch("dragend");

    logStep("Simulated drop events dispatched.");

    return true;
  } catch (error) {
    logStep("Failed to simulate cover drop", error, "warn");
    return false;
  }
}

async function invokeReactDropHandlers(target, file) {
  const props = extractReactProps(target);
  if (!props) {
    logStep("React props not found on drop target.", "", "warn");
    return false;
  }

  if (typeof props.onDrop !== "function" && typeof props.onDragEnter !== "function" && typeof props.onDragOver !== "function") {
    logStep("React drop handlers missing on target.", "", "warn");
    return false;
  }

  if (typeof DataTransfer !== "function") {
    return false;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);

  const createEvent = (type) => ({
    preventDefault() {},
    stopPropagation() {},
    persist() {},
    dataTransfer: transfer,
    target,
    currentTarget: target,
    type,
    nativeEvent: { dataTransfer: transfer }
  });

  try {
    if (typeof props.onDragEnter === "function") {
      props.onDragEnter(createEvent("dragenter"));
      await nextFrame();
    }

    if (typeof props.onDragOver === "function") {
      props.onDragOver(createEvent("dragover"));
      await sleep(20);
    }

    if (typeof props.onDrop === "function") {
      props.onDrop(createEvent("drop"));
      await nextFrame();
      logStep("React drop handlers invoked successfully.");
      return true;
    }
  } catch (error) {
    logStep("Error invoking React drop handlers.", error, "warn");
  }

  return false;
}

function extractReactProps(element) {
  if (!element) {
    return null;
  }

  // eslint-disable-next-line no-for-in-array
  for (const key in element) {
    if (key.startsWith("__reactProps")) {
      return element[key];
    }
  }

  if (element.parentElement) {
    return extractReactProps(element.parentElement);
  }

  return null;
}

async function invokeLinkedInUploadAction(root, file) {
  const action = findLinkedInUploadAction(root);
  if (!action) {
    logStep("LinkedIn upload action not found.", "", "warn");
    return false;
  }

  logStep("Invoking LinkedIn upload action.");

  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: file.type });
  const fileLike = new File([blob], file.name, { type: file.type, lastModified: Date.now() });

  try {
    const result = await action(fileLike);
    logStep("LinkedIn upload action resolved.", result);
    return true;
  } catch (error) {
    logStep("LinkedIn upload action failed.", error, "warn");
    return false;
  }
}

function findLinkedInUploadAction(root) {
  if (!root) {
    return null;
  }

  let element = root;
  while (element) {
    const props = extractReactProps(element);
    if (props) {
      const candidates = [
        props.onManualUpload,
        props.onUpload,
        props.onFileSelected,
        props.handleOnDrop,
        props.onDrop,
        props.onFilesAdded
      ].filter((fn) => typeof fn === "function");

      if (candidates.length) {
        logStep("LinkedIn upload action candidates discovered.", {
          count: candidates.length,
          names: candidates.map((fn) => (fn && fn.name ? fn.name : "anonymous"))
        });
        return (file) => {
          for (const fn of candidates) {
            try {
              const value = fn({
                preventDefault() {},
                stopPropagation() {},
                dataTransfer: {
                  files: [file]
                },
                target: {
                  files: [file]
                },
                currentTarget: {
                  files: [file]
                },
                file,
                files: [file]
              });
              if (value && typeof value.then === "function") {
                return value;
              }
            } catch (error) {
              logStep("LinkedIn upload candidate threw.", error, "warn");
            }
          }
          return Promise.resolve();
        };
      }
    }

    element = element.parentElement;
  }

  return null;
}

async function stageBody(element, html, plainText, allowSimulatedPaste = true) {
  const trimmed = typeof html === "string" ? html.trim() : "";
  if (!trimmed || !element) {
    return false;
  }

  logStep("Staging body content.");
  focusBody(element);

  let inserted = false;
  if (allowSimulatedPaste) {
    inserted = simulatePaste(element, trimmed, plainText);
    logStep("Simulated paste attempt finished.", inserted ? "success" : "failed");
    if (inserted) {
      await nextFrame();
    }
  }

  if (!inserted) {
    replaceBodyContent(element, trimmed);
    logStep("Body content replaced directly (paste unavailable).");
  } else if (!hasBodyContent(element)) {
    logStep("Body content missing after paste, falling back to direct replacement.");
    replaceBodyContent(element, trimmed);
  }

  dispatchBodyEvents(element, trimmed);
  logStep("Body events dispatched.");

  await nextFrame();
  const finalHasContent = hasBodyContent(element);
  if (!finalHasContent) {
    logStep("Body content still missing after staging.", "", "warn");
  }
  return finalHasContent;
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
  logStep("Waiting for body editor.");
  const bodyField = await waitForBodyField();
  if (!bodyField) {
    return null;
  }

  logStep("Body editor located, waiting for stability.");
  const stableField = await waitForBodyStability(bodyField, options);
  if (stableField && stableField.isConnected) {
    logStep("Body editor stabilized.");
    return stableField;
  }

  const latest = document.querySelector('[data-test-article-editor-content-textbox]');
  return latest && latest instanceof HTMLElement && latest.isContentEditable ? latest : null;
}

function waitForBodyStability(initialField, { idleMs = 400, timeoutMs = 5000 } = {}) {
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

  logStep("Starting body content maintenance watcher.");
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
    logStep("Body maintenance watcher stopped.");
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
