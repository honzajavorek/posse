#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const SENSITIVE_HEADER_PATTERNS = [
  /cookie/i,
  /token/i,
  /auth/i,
  /secret/i,
  /session/i,
  /credential/i,
  /^x-li-/i,
  /^x-restli-/i,
  /trace/i,
  /tracking/i,
  /client-version/i,
  /clientid/i,
  /page-instance/i,
  /pem/i
];

function sanitizeHeaders(headers, additionalSensitive = []) {
  if (!Array.isArray(headers)) {
    return;
  }

  headers.forEach((header) => {
    if (!header || typeof header.name !== "string") {
      return;
    }

    const name = header.name;
    const lower = name.toLowerCase();
    const isSensitive = SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(name));
    const isAdditional = additionalSensitive.some((pattern) => pattern.test(name));

    if (isSensitive || isAdditional) {
      header.value = "<redacted>";
    }
  });
}

function sanitizeCookies(cookies) {
  if (!Array.isArray(cookies)) {
    return;
  }

  cookies.forEach((cookie) => {
    if (cookie && Object.prototype.hasOwnProperty.call(cookie, "value")) {
      cookie.value = "<redacted>";
    }
  });
}

function sanitizePostData(postData) {
  if (!postData || typeof postData !== "object") {
    return;
  }

  if (typeof postData.text === "string" && postData.text.length) {
    postData.text = "<redacted>";
  }

  if (Array.isArray(postData.params)) {
    postData.params.forEach((param) => {
      if (param && Object.prototype.hasOwnProperty.call(param, "value")) {
        param.value = "<redacted>";
      }
    });
  }
}

function sanitizeQueryString(queryString) {
  if (!Array.isArray(queryString)) {
    return;
  }

  queryString.forEach((pair) => {
    if (!pair || typeof pair.name !== "string") {
      return;
    }

    const isSensitive = SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(pair.name));
    if (isSensitive && Object.prototype.hasOwnProperty.call(pair, "value")) {
      pair.value = "<redacted>";
    }
  });
}

function sanitizeContent(content) {
  if (!content || typeof content !== "object") {
    return;
  }

  if (typeof content.text === "string" && content.text.length) {
    content.text = "<redacted>";
  }
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return;
  }

  if (entry.request && typeof entry.request === "object") {
    sanitizeHeaders(entry.request.headers || []);
    sanitizeCookies(entry.request.cookies || []);
    sanitizeQueryString(entry.request.queryString || []);
    sanitizePostData(entry.request.postData);
  }

  if (entry.response && typeof entry.response === "object") {
    sanitizeHeaders(entry.response.headers || [], [/^set-cookie$/i]);
    sanitizeCookies(entry.response.cookies || []);
    sanitizeContent(entry.response.content);
  }
}

function sanitizeHarFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const data = JSON.parse(raw);

  if (!data.log || !Array.isArray(data.log.entries)) {
    throw new Error(`HAR file ${filePath} does not contain log.entries array.`);
  }

  data.log.entries.forEach(sanitizeEntry);

  fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2));
}

function main() {
  const [, , ...inputs] = process.argv;
  if (inputs.length === 0) {
    console.error("Usage: sanitize-har.js <har-file> [<har-file> ...]");
    process.exit(1);
  }

  inputs.forEach((inputPath) => {
    try {
      sanitizeHarFile(inputPath);
      console.log(`Sanitized ${inputPath}`);
    } catch (error) {
      console.error(`Failed to sanitize ${inputPath}:`, error.message);
      process.exitCode = 1;
    }
  });
}

if (require.main === module) {
  main();
}
