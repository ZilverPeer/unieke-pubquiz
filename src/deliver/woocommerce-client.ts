/**
 * Thin, low-level WooCommerce REST API client (spec #36, ticket #41): Basic
 * auth over the given base URL (plain http locally, per shop/README.md),
 * JSON in and out. No WooCommerce-domain knowledge lives here -- that's
 * index.ts. Every non-2xx response and every network error throws with the
 * method, endpoint, and (for a response) its status, so callers -- the
 * worker's retry loop -- can tell retryable failures apart from a bug.
 */
import type { DelivererConfig } from "./config";

export interface WooCommerceClient {
  get<T>(path: string): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

function basicAuthHeader(consumerKey: string, consumerSecret: string): string {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

// The WooCommerce REST API is always mounted under WordPress's `/wp-json`
// prefix (e.g. `/wp-json/wc/v3/orders/<id>`), never bare `/wc/v3/...` --
// callers pass the `/wc/v3/...` path and this is the one place that adds it.
const API_PREFIX = "/wp-json";

async function request<T>(config: DelivererConfig, method: string, path: string, body?: unknown): Promise<T> {
  const url = `${config.baseUrl}${API_PREFIX}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(config.consumerKey, config.consumerSecret),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`deliver: ${method} ${url} failed before a response was received: ${message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`deliver: ${method} ${url} returned ${response.status}${text ? `: ${text}` : ""}`);
  }

  return (await response.json()) as T;
}

export function createWooCommerceClient(config: DelivererConfig): WooCommerceClient {
  return {
    get: (path) => request(config, "GET", path),
    put: (path, body) => request(config, "PUT", path, body),
    post: (path, body) => request(config, "POST", path, body),
  };
}
