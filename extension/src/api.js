/* Typed-ish client for the FlexiVault server API. */

export class ApiError extends Error {
  constructor(message, status = 0, code = "request_failed", data = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function normalizeServerUrl(input) {
  let value = String(input ?? "").trim();
  if (!value) throw new Error("Enter your server URL.");
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, "");

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid URL, for example https://vault.example.com");
  }
  if (!parsed.hostname) throw new Error("Enter a valid server URL.");
  return value;
}

async function request(baseUrl, path, options = {}) {
  const url = `${normalizeServerUrl(baseUrl)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new ApiError(
            `The server returned ${response.status}.`,
            response.status,
            "invalid_response"
          );
        }
      }
    }

    if (!response.ok) {
      throw new ApiError(
        String(payload.error ?? `Request failed with status ${response.status}.`),
        response.status,
        String(payload.code ?? "request_failed"),
        payload
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("The server took too long to respond.", 0, "timeout");
    }
    throw new ApiError(
      "Could not reach the server. Check the URL and your connection.",
      0,
      "network_error"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  serverInfo(baseUrl) {
    return request(baseUrl, "/api/server-info");
  },

  prelogin(baseUrl, email) {
    return request(baseUrl, "/api/accounts/prelogin", {
      method: "POST",
      body: { email },
    });
  },

  register(baseUrl, input) {
    return request(baseUrl, "/api/accounts/register", {
      method: "POST",
      body: input,
    });
  },

  login(baseUrl, input) {
    return request(baseUrl, "/api/accounts/login", {
      method: "POST",
      body: input,
    });
  },

  me(baseUrl, token) {
    return request(baseUrl, "/api/accounts/me", { token });
  },

  getVault(baseUrl, token) {
    return request(baseUrl, "/api/sync", { token });
  },

  quickUnlockEnroll(baseUrl, token, input = {}) {
    return request(baseUrl, "/api/quick-unlock", { method: "POST", token, body: input });
  },

  quickUnlockRelease(baseUrl, input) {
    return request(baseUrl, "/api/quick-unlock/release", { method: "POST", body: input });
  },

  quickUnlockRevoke(baseUrl, input) {
    return request(baseUrl, "/api/quick-unlock/revoke", { method: "POST", body: input });
  },

  putVault(baseUrl, token, input) {
    return request(baseUrl, "/api/sync", {
      method: "PUT",
      token,
      body: input,
      timeoutMs: 45_000,
    });
  },
};
