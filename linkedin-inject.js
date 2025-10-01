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

function describeElement(element) {
  if (!(element instanceof Element)) {
    return "unknown";
  }

  const tag = element.tagName ? element.tagName.toLowerCase() : "element";
  const id = element.id ? `#${element.id}` : "";
  const classList = element.classList && element.classList.length
    ? `.${Array.from(element.classList).join('.')}`
    : "";
  return `${tag}${id}${classList}`;
}

function ensureElementInView(element) {
  if (!(element instanceof Element) || typeof element.getBoundingClientRect !== "function") {
    return;
  }

  try {
    const rect = element.getBoundingClientRect();
    const withinViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!withinViewport) {
      element.scrollIntoView({ block: "center", behavior: "auto" });
    }
  } catch (error) {
    // Ignore scrolling issues.
  }
}

function suppressFileDialogTemporarily() {
  const proto = HTMLInputElement && HTMLInputElement.prototype ? HTMLInputElement.prototype : null;
  if (!proto) {
    return () => {};
  }

  const originalClick = proto.click;
  const originalShowPicker = typeof proto.showPicker === "function" ? proto.showPicker : null;
  const suppressedInputs = new WeakSet();

  const clickOverride = function clickOverride(...args) {
    if (this && this.type === "file") {
      suppressedInputs.add(this);
      logStep("File dialog suppressed via click override.");
      return undefined;
    }
    return originalClick.apply(this, args);
  };

  try {
    proto.click = clickOverride;
  } catch (error) {
    // Ignore inability to override.
  }

  if (originalShowPicker) {
    const showPickerOverride = function showPickerOverride(...args) {
      if (this && this.type === "file") {
        suppressedInputs.add(this);
        logStep("File dialog suppressed via showPicker override.");
        return Promise.resolve();
      }
      return originalShowPicker.apply(this, args);
    };
    try {
      proto.showPicker = showPickerOverride;
    } catch (error) {
      // Ignore inability to override showPicker.
    }
  }

  const captureClick = (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "file") {
      suppressedInputs.add(target);
      event.preventDefault();
      event.stopImmediatePropagation();
      logStep("File dialog suppressed via capture listener.");
    }
  };

  document.addEventListener("click", captureClick, true);

  return () => {
    try {
      proto.click = originalClick;
    } catch (error) {
      // ignore restoration issues
    }
    if (originalShowPicker) {
      try {
        proto.showPicker = originalShowPicker;
      } catch (error) {
        // ignore restoration issues
      }
    }
    document.removeEventListener("click", captureClick, true);
  };
}

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
    logStep("Attempting to stage cover image (file input mode).");
    logStep("Initiating cover upload modal if necessary.");
    await ensureCoverUploadModal();

    const activationResult = await triggerCoverUploadButton();
    if (!activationResult) {
      logStep("Could not trigger cover upload button.", "", "warn");
      return;
    }

    const uploaderRoot = await waitForCoverUploaderRoot();
    if (!uploaderRoot) {
      logStep("Could not locate LinkedIn cover uploader root.", "", "warn");
      return;
    }

    logStep("Cover uploader root located.");

    const editorModal = await waitForCoverEditorModal({ timeoutMs: 4500 });
    if (editorModal) {
      logStep("Cover editor modal located while preparing for file input search.");
    }

    const input = await waitForCoverFileInput([uploaderRoot, editorModal]);
    if (!input) {
      logStep("Cover file input not found after button activation.", "", "warn");
      return;
    }

    logStep("Cover file input available after activation.", describeElement(input));
    preventPendingFileDialog(input);

    let file = await buildCoverFile(coverImage);
    if (!file) {
      logStep("Unable to construct cover image file payload.", "", "warn");
      return;
    }

    logStep("Cover image file prepared.", {
      name: file.name,
      type: file.type,
      size: file.size
    });

    file = await ensureCoverFileCompatibility(file, coverImage);
    if (!file) {
      logStep("Cover image file could not be normalized for LinkedIn.", "", "warn");
      return;
    }

    logStep("Cover image file normalized.", {
      name: file.name,
      type: file.type,
      size: file.size
    });

    const injected = await injectFileIntoInput(input, file);
    if (!injected) {
      logStep("Cover image injection via file input failed.", "", "warn");
      return;
    }

    logStep("Cover image injected into file input.");

    const preview = await waitForCoverPreview(uploaderRoot, { timeoutMs: 8000 });
    if (preview) {
      logStep("Cover image preview detected after file input injection.");
      await applyCoverMetadata(coverImage, uploaderRoot, preview);
    } else {
      logStep("Cover preview not detected after file input injection.", "", "warn");
    }
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

function findCoverDropTarget(root) {
  const selectors = [
    '.article-editor-cover-media__placeholder',
    '.article-editor-cover-media__placeholder-container',
    '.article-editor-cover-media__media-drop-target',
    '.media-editor-drop-target',
    '[data-test-article-editor-cover-media] .media-editor-drop-target'
  ];

  const scopes = [];
  if (root && root instanceof HTMLElement) {
    scopes.push(root);
  }
  scopes.push(document.body);

  for (const scope of scopes) {
    if (!scope || typeof scope.querySelector !== "function") {
      continue;
    }
    for (const selector of selectors) {
      const candidate = scope.querySelector(selector);
      if (candidate instanceof HTMLElement && candidate.isConnected) {
        logStep("Located cover drop target.", selector);
        return candidate;
      }
    }
  }

  if (root instanceof HTMLElement && root.matches('.article-editor-cover-media__placeholder, .article-editor-cover-media__placeholder-container')) {
    return root;
  }

  return null;
}

async function waitForCoverDropTarget(root, { timeoutMs = 6000, intervalMs = 120 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const target = findCoverDropTarget(root);
    if (target) {
      return target;
    }
    await sleep(intervalMs);
  }

  return null;
}

async function waitForCoverFileInput(rootOrRoots, { timeoutMs = 5000, intervalMs = 120 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const selectors = [
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*="png"]',
    'input[type="file"][accept*="jpg"]',
    'input[type="file"][accept*="jpeg"]',
    'input[type="file"]'
  ];

  const normalizeScope = (candidate) => (
    candidate && typeof candidate.querySelector === "function" ? candidate : null
  );

  const scopes = new Set();
  if (Array.isArray(rootOrRoots)) {
    for (const candidate of rootOrRoots) {
      const scope = normalizeScope(candidate);
      if (scope) {
        scopes.add(scope);
      }
    }
  } else {
    const scope = normalizeScope(rootOrRoots);
    if (scope) {
      scopes.add(scope);
    }
  }

  while (Date.now() <= deadline) {
    const activeScopes = scopes.size ? Array.from(scopes) : [];
    activeScopes.push(document);

    for (const scope of activeScopes) {
      const queryRoot = scope && typeof scope.querySelector === "function" ? scope : document;
      for (const selector of selectors) {
        const candidate = queryRoot.querySelector(selector);
        if (candidate instanceof HTMLInputElement && candidate.isConnected) {
          return candidate;
        }
      }
    }

    await sleep(intervalMs);
  }

  return null;
}

function findCoverEditorModal() {
  const selectors = [
    '[data-test-article-editor-cover-media-editor-modal]',
    '.article-editor__media-editor-modal',
    '.article-editor__media-editor-modal-v2',
    '.article-editor-cover-media__editor-modal',
    '.artdeco-modal.article-editor__media-editor-modal'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      return element;
    }
  }

  const modalCandidates = document.querySelectorAll('.artdeco-modal');
  for (const candidate of modalCandidates) {
    if (candidate instanceof HTMLElement) {
      const modalId = candidate.getAttribute('data-test-modal-id') || candidate.getAttribute('data-test-modal');
      if (modalId && modalId.toLowerCase().includes('media-editor')) {
        return candidate;
      }
      const role = candidate.getAttribute('role');
      if (role === 'dialog' && candidate.querySelector('.media-editor') && candidate.querySelector('button')) {
        return candidate;
      }
    }
  }

  return null;
}

async function waitForCoverEditorModal({ timeoutMs = 3500, intervalMs = 120 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let modal = findCoverEditorModal();

  while (!modal && Date.now() <= deadline) {
    await sleep(intervalMs);
    modal = findCoverEditorModal();
  }

  return modal instanceof HTMLElement ? modal : null;
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

async function triggerCoverUploadButton({ timeoutMs = 4000 } = {}) {
  const selectors = [
    'button[aria-label="Upload from computer"]',
    '.article-editor-cover-media__placeholder button.artdeco-button',
    '.article-editor-cover-media button[aria-label*="Upload"]'
  ];

  let button = null;
  for (const selector of selectors) {
    button = document.querySelector(selector);
    if (button instanceof HTMLButtonElement) {
      break;
    }
  }

  if (!(button instanceof HTMLButtonElement)) {
    button = await waitForElement(selectors[0], document, Math.max(1, Math.floor(timeoutMs / DEFAULT_WAIT_DELAY_MS)), DEFAULT_WAIT_DELAY_MS);
  }

  if (!(button instanceof HTMLButtonElement)) {
    logStep("Cover upload button not found for activation.", "", "warn");
    return false;
  }

  logStep("Cover upload button located, suppressing file dialog and triggering click.");

  ensureElementInView(button);

  const restoreDialog = suppressFileDialogTemporarily();
  try {
    safeActivate(button);
    await sleep(180);
  } catch (error) {
    logStep("Cover upload button activation failed.", error, "warn");
    restoreDialog();
    return false;
  }

  restoreDialog();
  return true;
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

async function ensureCoverFileCompatibility(file, coverImage) {
  if (!file) {
    return null;
  }

  const allowedTypes = new Set(["image/jpeg", "image/png"]);
  const lowerType = (file.type || "").toLowerCase();

  if (allowedTypes.has(lowerType)) {
    const normalizedName = normalizeFileNameForType(file.name, lowerType);
    if (normalizedName === file.name && file.type === lowerType) {
      return file;
    }
    return new File([file], normalizedName, {
      type: lowerType,
      lastModified: typeof file.lastModified === "number" ? file.lastModified : Date.now()
    });
  }

  let sourceDataUrl = null;
  if (coverImage && typeof coverImage.dataUrl === "string" && coverImage.dataUrl.startsWith("data:")) {
    sourceDataUrl = coverImage.dataUrl;
  }

  if (!sourceDataUrl) {
    sourceDataUrl = await blobToDataUrl(file);
  }

  if (!sourceDataUrl) {
    logStep("Unable to obtain data URL for cover image conversion.", "", "warn");
    return file;
  }

  const pngDataUrl = await convertDataUrlToMime(sourceDataUrl, "image/png");
  if (!pngDataUrl) {
    logStep("Cover image conversion to PNG failed.", "", "warn");
    return file;
  }

  const pngFileName = normalizeFileNameForType(file.name, "image/png");
  const pngFile = dataUrlToFile(pngDataUrl, pngFileName, "image/png");
  if (pngFile) {
    return pngFile;
  }

  logStep("Cover image conversion yielded no file, falling back to original payload.", "", "warn");
  return file;
}

function normalizeFileNameForType(fileName, mimeType) {
  const base = deriveFileNameBase(fileName);
  const extension = mimeType === "image/png" ? ".png" : ".jpg";
  return `${base}${extension}`;
}

function deriveFileNameBase(fileName) {
  const fallback = "cover-image";
  if (!fileName || typeof fileName !== "string") {
    return fallback;
  }

  const sanitized = fileName.split(/[?#]/)[0];
  const segments = sanitized.split('/');
  const lastSegment = segments[segments.length - 1] || "";
  const base = lastSegment.replace(/\.[^.]+$/, "").trim();
  return base || fallback;
}

async function blobToDataUrl(blob) {
  if (!blob) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => {
        resolve(null);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      resolve(null);
    }
  });
}

async function convertDataUrlToMime(dataUrl, mimeType = "image/png") {
  if (!dataUrl) {
    return null;
  }

  try {
    const image = await loadImageFromSource(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL(mimeType);
  } catch (error) {
    logStep("Image conversion failed.", error, "warn");
    return null;
  }
}

function loadImageFromSource(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = (event) => reject(event);
    image.src = src;
  });
}

function augmentFileForDragAndDrop(file) {
  if (!(file instanceof File)) {
    return file;
  }

  const lastModified = typeof file.lastModified === "number" ? file.lastModified : Date.now();
  const descriptorOptions = { configurable: true, enumerable: false, writable: false };

  try {
    Object.defineProperty(file, "lastModifiedDate", { ...descriptorOptions, value: new Date(lastModified) });
  } catch (error) {
    // ignore descriptor override issues
  }

  try {
    Object.defineProperty(file, "webkitRelativePath", { ...descriptorOptions, value: "" });
  } catch (error) {
    // ignore descriptor override issues
  }

  if (!("path" in file)) {
    try {
      Object.defineProperty(file, "path", { ...descriptorOptions, value: `/${file.name}` });
    } catch (error) {
      // ignore descriptor override issues
    }
  }

  return file;
}

function createSyntheticFileEntry(file) {
  if (!(file instanceof File)) {
    return null;
  }

  const entry = {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    filesystem: null,
    file(callback, errorCallback) {
      try {
        const cloned = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
        callback(cloned);
      } catch (error) {
        if (typeof errorCallback === "function") {
          errorCallback(error);
        }
      }
    },
    createReader() {
      return {
        readEntries(readCallback) {
          if (typeof readCallback === "function") {
            readCallback([]);
          }
        }
      };
    },
    toURL() {
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        return URL.createObjectURL(file);
      }
      return `blob:${location.origin}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    }
  };

  return entry;
}

function preventPendingFileDialog(input) {
  if (!(input instanceof HTMLInputElement) || input.type !== "file") {
    return;
  }

  const markerAttribute = "data-posse-file-dialog-suppressed";
  input.setAttribute(markerAttribute, "true");

  const preventer = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  input.addEventListener("click", preventer, true);

  try {
    Object.defineProperty(input, "showPicker", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve()
    });
  } catch (error) {
    // Ignore inability to override showPicker on element instance.
  }

  try {
    Object.defineProperty(input, "click", {
      configurable: true,
      writable: true,
      value: () => {}
    });
  } catch (error) {
    // Ignore inability to override click on element instance.
  }
}

async function injectFileIntoInput(input, file) {
  if (!(input instanceof HTMLInputElement) || !file) {
    return false;
  }

  try {
    const files = buildFileList([file]);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "files")?.set;
    if (setter) {
      setter.call(input, files);
    } else {
      input.files = files;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    logStep("Dispatched input/change events for cover file input.");
    return true;
  } catch (error) {
    logStep("Failed to inject file into input.", error, "warn");
    return false;
  }
}

function buildFileList(files) {
  if (typeof DataTransfer === "function") {
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }
    return transfer.files;
  }

  if (typeof FileList !== "undefined") {
    try {
      const dataTransfer = document.createElement("input");
      dataTransfer.type = "file";
      const dt = new ClipboardEvent("").clipboardData || new DataTransfer();
      for (const file of files) {
        dt.items.add(file);
      }
      return dt.files;
    } catch (error) {
      // fall through to shim
    }
  }

  const list = {
    length: files.length,
    item(index) {
      return files[index] || null;
    }
  };

  let index = 0;
  for (const file of files) {
    Object.defineProperty(list, index, {
      configurable: true,
      enumerable: true,
      value: file
    });
    index += 1;
  }

  return list;
}

async function simulateCoverDrop(target, file) {
  if (!target || !file || typeof DataTransfer !== "function" || typeof DragEvent !== "function") {
    return false;
  }

  try {
    const normalizedFile = augmentFileForDragAndDrop(file);

    const transfer = new DataTransfer();
    transfer.items.add(normalizedFile);

    const item = transfer.items[0];
    if (item && !item.getAsFile) {
      try {
        Object.defineProperty(item, "getAsFile", {
          configurable: true,
          value: () => normalizedFile
        });
      } catch (error) {
        // Ignore if we can't override
      }
    }

    const ensureProperty = (object, key, value) => {
      try {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          value
        });
      } catch (error) {
        // Ignore if property is read-only
      }
    };

    ensureProperty(transfer, "dropEffect", "copy");
    ensureProperty(transfer, "effectAllowed", "all");
    ensureProperty(item, "kind", "file");
    ensureProperty(item, "type", normalizedFile.type || "application/octet-stream");
    ensureProperty(transfer, "types", Object.freeze(["Files"]));

    const syntheticEntry = createSyntheticFileEntry(normalizedFile);
    if (item && syntheticEntry) {
      ensureProperty(item, "webkitGetAsEntry", () => syntheticEntry);
      ensureProperty(item, "getAsEntry", () => syntheticEntry);
    }

    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = rect.left + Math.max(1, rect.width) / 2;
    const clientY = rect.top + Math.max(1, rect.height) / 2;

    const bubbleTargets = [target];
    const placeholder = target.closest('.article-editor-cover-media');
    if (placeholder && placeholder !== target) {
      bubbleTargets.push(placeholder);
    }

    const dispatch = async (type) => {
      for (const currentTarget of bubbleTargets) {
        if (!currentTarget || !currentTarget.isConnected) {
          continue;
        }
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: transfer,
          clientX,
          clientY
        });
        try {
          Object.defineProperty(event, "dataTransfer", {
            configurable: true,
            enumerable: true,
            value: transfer
          });
        } catch (error) {
          // Ignore property override issues.
        }
        currentTarget.dispatchEvent(event);
      }
      await nextFrame();
    };

  await dispatch("dragenter");
    await sleep(40);
    await dispatch("dragover");
    await sleep(60);
    await dispatch("drop");
    await sleep(20);
    await dispatch("dragend");

    logStep("Simulated drop events dispatched.");

    return true;
  } catch (error) {
    logStep("Failed to simulate cover drop", error, "warn");
    return false;
  }
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
