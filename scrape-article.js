(() => {
  const SUPPORTED_SOURCE_HOSTNAME = "honzajavorek.cz";
  const SUPPORTED_SOURCE_PATH_PREFIX = "/blog/";
  const UNSUPPORTED_PAGE_MESSAGE = "POSSE currently supports only articles on https://honzajavorek.cz/blog/.";

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

  function getCanonicalUrl() {
    const canonical = document.querySelector('link[rel="canonical"][href]');
    if (canonical && canonical.href) {
      return ensureBlogUrl(canonical.href).href;
    }

    return currentUrl.href;
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

  const articleElement = getArticleRoot();
  const articleBody = getArticleBody(articleElement);
  const articleClone = articleBody.cloneNode(true);

  sanitizeClone(articleClone);
  convertAdmonitionsToBlockquotes(articleClone);
  stripLinksFromFigureCaptions(articleClone);

  return {
    url: getCanonicalUrl(),
    title: getArticleTitle(articleElement),
    bodyHtml: articleClone.innerHTML
  };
})();
