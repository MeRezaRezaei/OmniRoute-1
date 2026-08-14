/**
 * CdpFetchExecutor — bind web-provider upstream requests to the user's real Chrome.
 *
 * Pillar 3 of the CDP feature. Instead of sending web-provider requests from
 * Node (datacenter IP, no browser fingerprint), this executor performs the
 * upstream request INSIDE a page of the user's CDP-controlled Chrome via
 * `page.evaluate(() => fetch(url, init))`. The upstream provider therefore sees
 * a genuine browser request: real TLS handshake, canvas/UA fingerprint, profile
 * cookies, and the user's network path — making proxy detection much harder.
 *
 * Two transports:
 *   - `cdpFetchJson()`  — whole-body JSON/Text/ArrayBuffer response (non-stream).
 *   - `cdpFetchStream()`— SSE/streaming response relayed chunk-by-chunk from the
 *     page to a Node ReadableStream via page.exposeFunction() bridge.
 *
 * Both compose the persistent cdpController (attachOrLaunch + getDefaultContext)
 * so the SAME Chrome instance used for login is reused for execution. This keeps
 * the session warm and shares the profile cookies captured at login time.
 *
 * Opt-in only (WEB_PROVIDER_CDP_BIND default off). LOCAL-ONLY: all CDP endpoints
 * are bound to 127.0.0.1; routes using this service must be classified with
 * isLocalOnlyPath(). Errors are routed through sanitizeErrorMessage.
 */

import { Readable } from "stream";
import type { Page } from "playwright";

import { attachOrLaunch, getDefaultContext } from "./cdpController";
import { sanitizeErrorMessage } from "../utils/error";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";

export interface CdpFetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  profileDir?: string;
  endpointUrl?: string;
  /** Max whole-body size for the JSON path (bytes). Default 10 MB. */
  maxResponseBytes?: number;
  /** AbortSignal honored for the whole-body path. */
  signal?: AbortSignal;
  /** Ignore the WEB_PROVIDER_CDP_BIND flag and force on. */
  force?: boolean;
  /** A pre-obtained page (reused by callers that already hold one). */
  page?: Page;
}

export interface CdpFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Raw body bytes (JSON path only). */
  body: Buffer;
  /** base64 body relayed from the page (stream path). */
  timing: { startedAt: number; completedAt: number; ms: number };
}

export interface CdpStreamResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Readable;
  timing: { startedAt: number; completedAt: number; ms: number };
}

/** Whether Pillar 3 binding is enabled (feature flag or force). */
export function isCdpBindingEnabled(force?: boolean): boolean {
  if (force) return true;
  return isFeatureFlagEnabled("WEB_PROVIDER_CDP_BIND");
}

/**
 * Acquire a page in the user's real Chrome default (profile-persistent) context.
 * The page is a real tab; we use it to run in-page fetch. Reuses a caller-supplied
 * page when provided (so login + execution share the same context).
 */
async function acquirePage(opts: {
  profileDir?: string;
  endpointUrl?: string;
  page?: Page;
}): Promise<{ page: Page; isOwned: boolean }> {
  if (opts.page) return { page: opts.page, isOwned: false };
  const browser = await attachOrLaunch({
    profileDir: opts.profileDir,
    endpointUrl: opts.endpointUrl,
  });
  const context = getDefaultContext(browser);
  if (!context) {
    throw new Error("Chrome exposed no default (profile-persistent) context");
  }
  const page = await context.newPage();
  return { page, isOwned: true };
}

/**
 * Whole-body request executed inside the user's Chrome. Returns the full
 * response body as a Buffer (JSON path / non-streaming providers).
 */
export async function cdpFetch(opts: CdpFetchOptions): Promise<CdpFetchResult> {
  const startedAt = Date.now();
  if (!isCdpBindingEnabled(opts.force)) {
    throw new Error("WEB_PROVIDER_CDP_BIND is disabled");
  }

  const { page, isOwned } = await acquirePage(opts);
  try {
    const maxBytes = opts.maxResponseBytes ?? 10 * 1024 * 1024;
    const result = await page.evaluate(
      async (args: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
        maxBytes: number;
      }) => {
        const init: RequestInit = { method: args.method, headers: args.headers };
        if (args.body) init.body = args.body;
        const res = await fetch(args.url, init);
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key] = value;
        });
        const buf = await res.arrayBuffer();
        if (buf.byteLength > args.maxBytes) {
          throw new Error(`Response exceeds ${args.maxBytes} bytes`);
        }
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + chunkSize))
          );
        }
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          headers,
          body: btoa(binary),
        };
      },
      {
        url: opts.url,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
        body: opts.body !== undefined ? String(opts.body) : undefined,
        maxBytes,
      }
    );

    const body = Buffer.from(result.body, "base64");
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body,
      timing: { startedAt, completedAt: Date.now(), ms: Date.now() - startedAt },
    };
  } finally {
    if (isOwned) await page.close().catch(() => undefined);
  }
}

/**
 * Streaming request executed inside the user's Chrome. The in-page `fetch` reads
 * the body stream chunk-by-chunk and relays each chunk to Node via an exposed
 * function bridge, which pushes into a Node ReadableStream. Ideal for SSE.
 */
export async function cdpFetchStream(opts: CdpFetchOptions): Promise<CdpStreamResult> {
  const startedAt = Date.now();
  if (!isCdpBindingEnabled(opts.force)) {
    throw new Error("WEB_PROVIDER_CDP_BIND is disabled");
  }

  const { page, isOwned } = await acquirePage(opts);
  try {
    const bridgeName = `__omniRouteCdpStream_${Math.random().toString(36).slice(2, 10)}`;

    let meta: { status: number; statusText: string; headers: Record<string, string> } | null =
      null;
    let relayError: string | null = null;

    // Node side of the bridge: each chunk pushed into the readable.
    const nodeStream = new Readable({
      read() {
        /* pull-free; chunks are pushed by the page relay */
      },
    });
    let bridgeDone: (() => void) | null = null;
    const bridgeClosed = new Promise<void>((resolve) => {
      bridgeDone = resolve;
    });

    await page.exposeFunction(bridgeName, (payload: {
      type: "meta" | "chunk" | "done" | "error";
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      chunk?: string;
      error?: string;
    }) => {
      if (payload.type === "meta" && payload.status !== undefined) {
        meta = {
          status: payload.status,
          statusText: payload.statusText ?? "",
          headers: payload.headers ?? {},
        };
      } else if (payload.type === "chunk" && payload.chunk) {
        nodeStream.push(Buffer.from(payload.chunk, "base64"));
      } else if (payload.type === "error") {
        relayError = payload.error ?? "in-page fetch failed";
        nodeStream.push(null);
      } else if (payload.type === "done") {
        nodeStream.push(null);
        bridgeDone?.();
      }
      return true;
    });

    const evalPromise = page.evaluate(
      async (args: { url: string; method: string; headers: Record<string, string>; body?: string; bridge: string }) => {
        const win = window as unknown as Record<string, (p: unknown) => unknown>;
        const signal = (p: unknown): unknown => win[args.bridge](p);
        const init: RequestInit = { method: args.method, headers: args.headers };
        if (args.body) init.body = args.body;
        const res = await fetch(args.url, init);
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key] = value;
        });
        signal({
          type: "meta",
          status: res.status,
          statusText: res.statusText,
          headers,
        });
        if (!res.body) {
          signal({ type: "done" });
          return;
        }
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          // Relay in reasonably sized base64 pieces to bound message size.
          if (chunks.length >= 16) {
            const merged = new Uint8Array(
              chunks.reduce((acc, c) => acc + c.length, 0)
            );
            let offset = 0;
            for (const c of chunks) {
              merged.set(c, offset);
              offset += c.length;
            }
            let binary = "";
            for (let i = 0; i < merged.length; i += 0x8000) {
              binary += String.fromCharCode.apply(
                null,
                Array.from(merged.subarray(i, i + 0x8000))
              );
            }
            signal({ type: "chunk", chunk: btoa(binary) });
            chunks.length = 0;
          }
        }
        if (chunks.length > 0) {
          const merged = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          let binary = "";
          for (let i = 0; i < merged.length; i += 0x8000) {
            binary += String.fromCharCode.apply(
              null,
              Array.from(merged.subarray(i, i + 0x8000))
            );
          }
          signal({ type: "chunk", chunk: btoa(binary) });
        }
        signal({ type: "done" });
      },
      {
        url: opts.url,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
        body: opts.body !== undefined ? String(opts.body) : undefined,
        bridge: bridgeName,
      }
    );

    await Promise.race([bridgeClosed, evalPromise]).catch((err) => {
      relayError = err instanceof Error ? err.message : String(err);
    });

    if (!meta) {
      nodeStream.push(null);
      throw new Error(sanitizeErrorMessage(relayError ?? "No response metadata"));
    }

    return {
      status: meta.status,
      statusText: meta.statusText,
      headers: meta.headers,
      body: nodeStream,
      timing: { startedAt, completedAt: Date.now(), ms: Date.now() - startedAt },
    };
  } finally {
    if (isOwned) await page.close().catch(() => undefined);
  }
}