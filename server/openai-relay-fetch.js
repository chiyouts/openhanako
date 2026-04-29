const WRAPPED_MARKER = Symbol.for("hanako.openaiRelayFetchWrapped");
const SDK_HEADER_PREFIX = "x-stainless-";
const STRIP_HEADER_NAMES = new Set([
  "user-agent",
  "openai-organization",
  "openai-project",
]);

function toUrlString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

function collectHeaders(input, init) {
  const headers = new Headers();
  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function hasSdkMarkers(headers) {
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith(SDK_HEADER_PREFIX)) return true;
    if (lower === "user-agent" && /^OpenAI\/JS/i.test(value || "")) return true;
    if (STRIP_HEADER_NAMES.has(lower)) return true;
  }
  return false;
}

export function shouldSanitizeOpenAIRelayRequest(input, init) {
  const rawUrl = toUrlString(input);
  if (!rawUrl) return false;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "api.openai.com") return false;

  const pathname = parsed.pathname.toLowerCase();
  const looksOpenAICompatPath = (
    pathname.endsWith("/chat/completions")
    || pathname.endsWith("/responses")
    || pathname.endsWith("/models")
    || pathname.endsWith("/embeddings")
    || pathname.endsWith("/completions")
    || pathname.includes("/images/")
    || pathname.includes("/audio/")
    || pathname.includes("/moderations")
  );
  if (!looksOpenAICompatPath) return false;

  const headers = collectHeaders(input, init);
  if (!hasSdkMarkers(headers)) return false;
  return true;
}

export function sanitizeOpenAIRelayFetchArgs(input, init = {}) {
  if (!shouldSanitizeOpenAIRelayRequest(input, init)) {
    return { input, init, sanitized: false };
  }

  const headers = collectHeaders(input, init);
  for (const key of [...headers.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith(SDK_HEADER_PREFIX) || STRIP_HEADER_NAMES.has(lower)) {
      headers.delete(key);
    }
  }

  const nextInit = { ...init, headers };
  return { input, init: nextInit, sanitized: true };
}

export function installOpenAIRelayFetchSanitizer() {
  if (typeof globalThis.fetch !== "function") return false;
  if (globalThis.fetch[WRAPPED_MARKER]) return false;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const wrappedFetch = async (input, init) => {
    const prepared = sanitizeOpenAIRelayFetchArgs(input, init);
    return originalFetch(prepared.input, prepared.init);
  };
  wrappedFetch[WRAPPED_MARKER] = true;
  wrappedFetch.__hanakoOriginalFetch = originalFetch;
  globalThis.fetch = wrappedFetch;
  return true;
}
