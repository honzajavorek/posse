(() => {
  const SUPPORTED_SOURCE_HOSTNAME = "honzajavorek.cz";
  const SUPPORTED_SOURCE_PATH_PREFIX = "/blog/";
  const UNSUPPORTED_PAGE_MESSAGE = "POSSE currently supports articles on https://honzajavorek.cz/blog/ and https://junior.guru/news/.";

  function ensureBlogUrl(urlString) {
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

  const currentUrl = ensureBlogUrl(window.location.href);
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
      return ensureBlogUrl(canonical.href).href;
    }

    return currentUrl.href;
  }

  function getOgImageUrl() {
    const ogImage = document.querySelector('meta[property="og:image"][content]');
    if (!ogImage || !ogImage.content) {
      throw new Error("POSSE: Unable to locate og:image metadata on the blog page.");
    }

    const absolute = toAbsoluteUrl(ogImage.content);
    if (!absolute) {
      throw new Error("POSSE: Unable to resolve og:image to an absolute URL.");
    }

    return absolute;
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

  function getArticleRoot() {
    const article = document.querySelector("article.article");
    if (!article) {
      throw new Error("POSSE: Unable to locate the blog article wrapper.");
    }
    return article;
  }

  function getArticleTitle(articleElement) {
    const titleElement = articleElement.querySelector("h1.title");
    if (!titleElement) {
      throw new Error("POSSE: Unable to locate the blog article title.");
    }

    const cloned = titleElement.cloneNode(true);
    const permalink = cloned.querySelector("small");
    if (permalink) {
      permalink.remove();
    }

    const text = cloned.textContent ? cloned.textContent.trim() : "";
    if (!text) {
      throw new Error("POSSE: Blog article title is empty.");
    }

    return text;
  }

  function getArticleBody(articleElement) {
    const body = articleElement.querySelector("main.article-content");
    if (!body) {
      throw new Error("POSSE: Unable to locate the blog article body.");
    }
    return body;
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

  function convertAdmonitionsToBlockquotes(clone) {
    const admonitions = clone.querySelectorAll('[role="alert"], [role="status"]');
    admonitions.forEach((node) => {
      const blockquote = document.createElement('blockquote');
      blockquote.innerHTML = node.innerHTML;
      node.replaceWith(blockquote);
    });
  }

  function insertLinkedinSubscriptionCallout(clone, coverImageUrlAbsolute) {
    if (!clone || !coverImageUrlAbsolute) {
      return;
    }

    if (clone.querySelector('blockquote[data-posse-subscription="true"]')) {
      return;
    }

    const images = Array.from(clone.querySelectorAll('img'));
    let coverImageElement = null;
    for (const img of images) {
      const src = img.getAttribute('src');
      if (!src) {
        continue;
      }
      if (src === coverImageUrlAbsolute) {
        coverImageElement = img;
        break;
      }
      try {
        const normalized = new URL(src, baseUrl).href;
        if (normalized === coverImageUrlAbsolute) {
          coverImageElement = img;
          break;
        }
      } catch (error) {
        // Ignore URL normalization failures.
      }
    }

    if (!coverImageElement) {
      return;
    }

    const insertionAnchor = coverImageElement.closest('figure, picture') || coverImageElement.parentElement;
    const parent = insertionAnchor && insertionAnchor.parentNode;
    if (!parent) {
      return;
    }

    const doc = clone.ownerDocument || document;
    const blockquote = doc.createElement('blockquote');
    blockquote.setAttribute('data-posse-subscription', 'true');
    blockquote.innerHTML = '<p><strong>Odebírání:</strong> Baví tě týdenní poznámky a chceš si je číst pravidelně? Nespoléhej se na algoritmus LinkedInu! Odebírej moje články <a href="http://eepurl.com/ifI06H">e-mailem</a>.</p>';

    if (insertionAnchor.nextSibling) {
      parent.insertBefore(blockquote, insertionAnchor.nextSibling);
    } else {
      parent.appendChild(blockquote);
    }
  }

  function appendOriginalLinkFooter(root, url, title) {
    if (!root || typeof root.appendChild !== "function") {
      return;
    }

    if (!url || !title) {
      return;
    }

    const blockquote = document.createElement('blockquote');
    blockquote.innerHTML = `Článek si můžeš přečíst i přímo na webu, v jeho původní podobě: <a href="${url}">${title}</a>`;

    root.appendChild(blockquote);
  }

  function stripLinksFromFigureCaptions(clone) {
    const captions = clone.querySelectorAll('figcaption');
    captions.forEach((caption) => {
      const anchors = caption.querySelectorAll('a');
      anchors.forEach((anchor) => {
        const text = anchor.textContent || anchor.getAttribute('title') || anchor.href || '';
        const replacement = document.createTextNode(text.trim());
        anchor.replaceWith(replacement);
      });
      caption.normalize();
    });
  }

  function readImageDataUrl(imageElement, absoluteUrl) {
    if (!imageElement) {
      return null;
    }

    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;

    if (width && height) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(imageElement, 0, 0, width, height);
          const dataUrl = canvas.toDataURL();
          if (dataUrl) {
            return dataUrl;
          }
        }
      } catch (error) {
        // Drawing may fail if the image taints the canvas.
      }
    }

    return fetchImageAsDataUrl(absoluteUrl);
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

  function extractCoverImage(articleBody, articleClone, coverImageUrlAbsolute) {
    const originalImages = Array.from(articleBody.querySelectorAll('img'));
    const cloneImages = Array.from(articleClone.querySelectorAll('img'));

    if (!originalImages.length || !cloneImages.length) {
      throw new Error("POSSE: Unable to find any images in the article body.");
    }

    const firstOriginalSrc = originalImages[0].getAttribute('src');
    const firstOriginalAbsolute = firstOriginalSrc ? toAbsoluteUrl(firstOriginalSrc) : "";

    if (!firstOriginalAbsolute || firstOriginalAbsolute !== coverImageUrlAbsolute) {
      throw new Error("POSSE: First article image does not match og:image.");
    }

    let matchIndex = -1;
    for (let index = 0; index < originalImages.length; index += 1) {
      const originalSrc = originalImages[index].getAttribute('src');
      if (!originalSrc) {
        continue;
      }
      const candidateAbsolute = toAbsoluteUrl(originalSrc);
      if (candidateAbsolute && candidateAbsolute === coverImageUrlAbsolute) {
        matchIndex = index;
        break;
      }
    }

    if (matchIndex === -1) {
      throw new Error("POSSE: The first large image in the article does not match og:image.");
    }

    const originalImage = originalImages[matchIndex];
    const cloneImage = cloneImages[matchIndex];

    if (!originalImage || !cloneImage) {
      throw new Error("POSSE: Unable to resolve cover image elements for removal.");
    }

    const removalTarget = cloneImage.closest('figure') || cloneImage.closest('picture') || cloneImage.parentElement;

    if (!removalTarget) {
      throw new Error("POSSE: Unable to determine how to remove the cover image from the article body.");
    }

    const captionElement = removalTarget.querySelector('figcaption');
    const captionText = captionElement ? captionElement.textContent.trim() : '';
    const altText = cloneImage.getAttribute('alt') ? cloneImage.getAttribute('alt').trim() : '';

    removalTarget.remove();

    const dataUrl = readImageDataUrl(originalImage, coverImageUrlAbsolute);
    const mimeType = inferMimeTypeFromDataUrl(dataUrl);
    const fileName = deriveFileNameFromUrl(coverImageUrlAbsolute);

    return {
      url: coverImageUrlAbsolute,
      alt: altText,
      caption: captionText,
      width: originalImage.naturalWidth || null,
      height: originalImage.naturalHeight || null,
      dataUrl: dataUrl || null,
      mimeType: mimeType || null,
      fileName: fileName || null
    };
  }

  const articleElement = getArticleRoot();
  const articleBody = getArticleBody(articleElement);
  const articleClone = articleBody.cloneNode(true);
  const coverImageUrlAbsolute = getOgImageUrl();
  const articleTitle = getArticleTitle(articleElement);
  const canonicalUrl = getCanonicalUrl();
  const metaDescription = getMetaDescription();

  sanitizeClone(articleClone);
  insertLinkedinSubscriptionCallout(articleClone, coverImageUrlAbsolute);
  convertAdmonitionsToBlockquotes(articleClone);
  stripLinksFromFigureCaptions(articleClone);

  const coverImage = extractCoverImage(articleBody, articleClone, coverImageUrlAbsolute);

  appendOriginalLinkFooter(articleClone, canonicalUrl, articleTitle);

  return {
    url: canonicalUrl,
    title: articleTitle,
    bodyHtml: articleClone.innerHTML,
    coverImage,
    metaDescription
  };
})();
