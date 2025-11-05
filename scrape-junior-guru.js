(() => {
  const SUPPORTED_SOURCE_HOSTNAME = "junior.guru";
  const SUPPORTED_SOURCE_PATH_PREFIX = "/news/";
  const UNSUPPORTED_PAGE_MESSAGE = "POSSE currently supports articles on https://honzajavorek.cz/blog/ and https://junior.guru/news/.";

  function ensureSupportedUrl(urlString) {
    if (!urlString) {
      throw new Error(UNSUPPORTED_PAGE_MESSAGE);
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (error) {
      throw new Error(UNSUPPORTED_PAGE_MESSAGE);
    }

    if (parsed.hostname !== SUPPORTED_SOURCE_HOSTNAME || !parsed.pathname.startsWith(SUPPORTED_SOURCE_PATH_PREFIX)) {
      throw new Error(UNSUPPORTED_PAGE_MESSAGE);
    }

    return parsed;
  }

  const currentUrl = ensureSupportedUrl(window.location.href);
  const baseUrl = currentUrl.href;

  function toAbsoluteUrl(url) {
    if (!url) {
      return "";
    }

    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      return "";
    }
  }

  function getCanonicalUrl() {
    const canonical = document.querySelector('link[rel="canonical"][href]');
    if (canonical && canonical.href) {
      return ensureSupportedUrl(canonical.href).href;
    }

    return currentUrl.href;
  }

  function getMetaDescription() {
    const selectors = [
      'meta[name="description"][content]',
      'meta[property="og:description"][content]',
      'meta[name="twitter:description"][content]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && typeof node.content === "string") {
        const trimmed = node.content.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }

    return "";
  }

  function getMetaContent(selector) {
    const node = document.querySelector(selector);
    if (node && typeof node.content === "string") {
      const trimmed = node.content.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return "";
  }

  function getOgImageUrl() {
    const content = getMetaContent('meta[property="og:image"][content]');
    if (!content) {
      throw new Error("POSSE: Unable to locate og:image metadata on the newsletter page.");
    }

    const absolute = toAbsoluteUrl(content);
    if (!absolute) {
      throw new Error("POSSE: Unable to resolve og:image to an absolute URL.");
    }

    return absolute;
  }

  function getOgImageAlt() {
    const candidates = [
      'meta[property="og:image:alt"][content]',
      'meta[name="twitter:image:alt"][content]'
    ];

    for (const selector of candidates) {
      const value = getMetaContent(selector);
      if (value) {
        return value;
      }
    }

    return "";
  }

  function getOgImageDimension(dimension) {
    const selector = `meta[property="og:image:${dimension}"][content]`;
    const value = getMetaContent(selector);
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function getNewsletterRoot() {
    const issue = document.querySelector('.newsletter-issue');
    if (!issue) {
      throw new Error("POSSE: Unable to locate the newsletter issue container.");
    }
    return issue;
  }

  function getNewsletterIssueDate(issueElement) {
    if (!issueElement) {
      return "";
    }
    const dateNode = issueElement.querySelector('.newsletter-issue-date');
    if (dateNode && dateNode.textContent) {
      return dateNode.textContent.trim();
    }
    return "";
  }

  function getArticleTitle() {
    const heading = document.querySelector('main.content.document h1');
    if (!heading) {
      throw new Error("POSSE: Unable to locate the newsletter title.");
    }

    const clone = heading.cloneNode(true);
    const anchors = clone.querySelectorAll('a');
    anchors.forEach((anchor) => anchor.remove());

    const text = clone.textContent ? clone.textContent.trim() : "";
    if (!text) {
      throw new Error("POSSE: Newsletter title is empty.");
    }

    return text;
  }

  function removeCommentNodes(root) {
    if (!root || typeof document.createTreeWalker !== "function" || typeof NodeFilter === "undefined") {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null, false);
    const comments = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    comments.forEach((comment) => {
      if (comment && comment.parentNode) {
        comment.parentNode.removeChild(comment);
      }
    });
  }

  function absolutizeAttribute(element, attributeName) {
    const value = element.getAttribute(attributeName);
    if (!value) {
      return;
    }

    if (value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('javascript:')) {
      return;
    }

    try {
      const absoluteValue = new URL(value, baseUrl).href;
      element.setAttribute(attributeName, absoluteValue);
    } catch (error) {
      // Ignore invalid URLs and leave them as-is.
    }
  }

  function absolutizeSrcset(element) {
    const value = element.getAttribute('srcset');
    if (!value) {
      return;
    }

    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [url, descriptor] = part.split(/\s+/, 2);
        if (!url) {
          return null;
        }
        try {
          const absoluteUrl = new URL(url, baseUrl).href;
          return descriptor ? `${absoluteUrl} ${descriptor}` : absoluteUrl;
        } catch (error) {
          return part;
        }
      })
      .filter(Boolean);

    if (parts.length) {
      element.setAttribute('srcset', parts.join(', '));
    }
  }

  function sanitizeClone(clone) {
    clone.querySelectorAll('script, style').forEach((node) => node.remove());

    clone.querySelectorAll('[src]').forEach((node) => absolutizeAttribute(node, 'src'));
    clone.querySelectorAll('[href]').forEach((node) => absolutizeAttribute(node, 'href'));
    clone.querySelectorAll('[poster]').forEach((node) => absolutizeAttribute(node, 'poster'));
    clone.querySelectorAll('img[srcset]').forEach((node) => absolutizeSrcset(node));
  }

  function buildBodyHtml(issueElement) {
    const clone = issueElement.cloneNode(true);
    sanitizeClone(clone);
    removeCommentNodes(clone);

    clone.querySelectorAll('.newsletter-issue-date').forEach((node) => node.remove());

    return clone.innerHTML;
  }

  function fetchImageAsDataUrl(absoluteUrl) {
    try {
      if (!absoluteUrl) {
        return null;
      }

      const request = new XMLHttpRequest();
      request.open('GET', absoluteUrl, false);
      request.responseType = 'arraybuffer';
      request.send(null);

      if (request.status < 200 || request.status >= 300) {
        return null;
      }

      const buffer = request.response;
      if (!buffer) {
        return null;
      }

      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }

      const base64 = btoa(binary);
      const contentType = request.getResponseHeader('content-type') || 'application/octet-stream';
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      return null;
    }
  }

  function inferMimeTypeFromDataUrl(dataUrl) {
    if (!dataUrl) {
      return null;
    }
    const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
    return match && match[1] ? match[1] : null;
  }

  function deriveFileNameFromUrl(url) {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url, baseUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length) {
        return parts[parts.length - 1];
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function buildCoverImage(absoluteUrl, caption, title) {
    const dataUrl = fetchImageAsDataUrl(absoluteUrl);
    const mimeType = inferMimeTypeFromDataUrl(dataUrl);
    const width = getOgImageDimension('width');
    const height = getOgImageDimension('height');
    const alt = getOgImageAlt() || title || '';

    return {
      url: absoluteUrl,
      alt,
      caption: caption || '',
      width,
      height,
      dataUrl: dataUrl || null,
      mimeType: mimeType || null,
      fileName: deriveFileNameFromUrl(absoluteUrl)
    };
  }

  const issueElement = getNewsletterRoot();
  const issueDateText = getNewsletterIssueDate(issueElement);
  const articleTitle = getArticleTitle();
  const canonicalUrl = getCanonicalUrl();
  const metaDescription = getMetaDescription();
  const ogImageUrl = getOgImageUrl();
  const bodyHtml = buildBodyHtml(issueElement);
  const coverImage = buildCoverImage(ogImageUrl, issueDateText, articleTitle);

  return {
    url: canonicalUrl,
    title: articleTitle,
    bodyHtml,
    coverImage,
    metaDescription
  };
})();
