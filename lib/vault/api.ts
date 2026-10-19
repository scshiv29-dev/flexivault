import { ServerProfile, StoredVaultItem } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    data: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function normalizeServerUrl(input: string): string {
  let value = String(input ?? "").trim();
  if (!value) throw new Error("Server URL is required");
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid server URL, for example https://vault.example.com");
  }
  if (!parsed.hostname) throw new Error("Enter a valid server URL");
  return value;
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
    timeoutMs?: number;
  } = {}
): Promise<T> {
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
    let payload: Record<string, unknown> = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!response.ok) {
          throw new ApiError(
            `Server returned ${response.status}`,
            response.status,
            "invalid_response"
          );
        }
      }
    }

    if (!response.ok) {
      throw new ApiError(
        String(payload.error ?? `Request failed with status ${response.status}`),
        response.status,
        String(payload.code ?? "request_failed"),
        payload
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiError("The server took too long to respond", 0, "timeout");
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

export interface ServerInfo {
  name: string;
  version: string;
  registrationOpen: boolean;
  maxItems: number;
  serverTime: string;
}

export interface PreloginResponse {
  email: string;
  kdfSalt: string;
  kdfIterations: number;
  totpEnabled: boolean;
}

export interface AuthResponse {
  token: string;
  expiresIn: number;
  email: string;
  kdfSalt: string;
  kdfIterations: number;
  totpEnabled: boolean;
  revision: number;
  createdAt: number;
}

export interface RemoteVault {
  revision: number;
  items: StoredVaultItem[];
  updatedAt?: number;
}

export const api = {
  serverInfo(baseUrl: string) {
    return request<ServerInfo>(baseUrl, "/api/server-info");
  },

  prelogin(baseUrl: string, email: string) {
    return request<PreloginResponse>(baseUrl, "/api/accounts/prelogin", {
      method: "POST",
      body: { email },
    });
  },

  register(
    baseUrl: string,
    input: {
      email: string;
      authHash: string;
      kdfSalt: string;
      kdfIterations: number;
    }
  ) {
    return request<AuthResponse>(baseUrl, "/api/accounts/register", {
      method: "POST",
      body: input,
    });
  },

  login(
    baseUrl: string,
    input: { email: string; authHash: string; totpCode?: string }
  ) {
    return request<AuthResponse>(baseUrl, "/api/accounts/login", {
      method: "POST",
      body: input,
    });
  },

  me(baseUrl: string, token: string) {
    return request<ServerProfile>(baseUrl, "/api/accounts/me", { token });
  },

  getVault(baseUrl: string, token: string) {
    return request<RemoteVault>(baseUrl, "/api/sync", { token });
  },

  putVault(
    baseUrl: string,
    token: string,
    input: {
      baseRevision: number;
      items: StoredVaultItem[];
      force?: boolean;
    }
  ) {
    return request<{
      revision: number;
      itemCount: number;
      updatedAt: number;
    }>(baseUrl, "/api/sync", {
      method: "PUT",
      token,
      body: input,
      timeoutMs: 45_000,
    });
  },

  setupTotp(baseUrl: string, token: string) {
    return request<{
      secret: string;
      otpauthUrl: string;
      digits: number;
      period: number;
      algorithm: string;
    }>(baseUrl, "/api/2fa/setup", { method: "POST", token });
  },

  enableTotp(baseUrl: string, token: string, code: string) {
    return request<{ totpEnabled: boolean }>(baseUrl, "/api/2fa/enable", {
      method: "POST",
      token,
      body: { code },
    });
  },

  disableTotp(baseUrl: string, token: string, code: string) {
    return request<{ totpEnabled: boolean }>(baseUrl, "/api/2fa/disable", {
      method: "POST",
      token,
      body: { code },
    });
  },
};
