import { describe, expect, it } from "vitest";
import {
  sanitizeOpenAIRelayFetchArgs,
  shouldSanitizeOpenAIRelayRequest,
} from "../server/openai-relay-fetch.js";

describe("openai relay fetch sanitizer", () => {
  it("sanitizes OpenAI SDK headers for non-official OpenAI-compatible relays", () => {
    const init = {
      headers: {
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json",
        "User-Agent": "OpenAI/JS 4.0.0",
        "X-Stainless-Retry-Count": "0",
        "X-Stainless-Timeout": "600",
        "OpenAI-Organization": "org_test",
      },
    };

    expect(shouldSanitizeOpenAIRelayRequest("https://sub.llzzjj.com/v1/chat/completions", init)).toBe(true);
    const result = sanitizeOpenAIRelayFetchArgs("https://sub.llzzjj.com/v1/chat/completions", init);
    const headers = new Headers(result.init.headers);

    expect(result.sanitized).toBe(true);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("user-agent")).toBe(false);
    expect(headers.has("x-stainless-retry-count")).toBe(false);
    expect(headers.has("x-stainless-timeout")).toBe(false);
    expect(headers.has("openai-organization")).toBe(false);
  });

  it("does not sanitize requests to official api.openai.com", () => {
    const init = {
      headers: {
        "User-Agent": "OpenAI/JS 4.0.0",
        "X-Stainless-Retry-Count": "0",
      },
    };

    expect(shouldSanitizeOpenAIRelayRequest("https://api.openai.com/v1/chat/completions", init)).toBe(false);
    expect(sanitizeOpenAIRelayFetchArgs("https://api.openai.com/v1/chat/completions", init).sanitized).toBe(false);
  });

  it("does not sanitize ordinary fetch requests without SDK marker headers", () => {
    const init = {
      headers: {
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json",
      },
    };

    expect(shouldSanitizeOpenAIRelayRequest("https://sub.llzzjj.com/v1/chat/completions", init)).toBe(false);
  });
});
