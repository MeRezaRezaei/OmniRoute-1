"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Self-contained dashboard section: lets a remote installer start a provider
// web login on this server and reach the loopback CDP endpoint from a distance.
//
// How the pieces fit together (the "most reliable" web-login methods):
//   1. In-app login: POST /api/providers/[id]/login launches a real browser on
//      THIS server with --remote-debugging on 127.0.0.1. The CDP ws URL is
//      captured and exposed only via the authenticated GET /api/providers/[id]/cdp
//      (loopback-private; never exposed publicly). A remote operator tunnels it
//      home with SSH and drives the login in their own browser.
//   2. Manual cookie (most reliable when the browser login is flaky): log into
//      the provider site in YOUR browser, copy the session cookie (e.g. DeepSeek
//      = `user-token`), and paste it into the provider connection's API Key
//      field. This bypasses the browser entirely.
//
// Only providers with a token-extraction config get an in-app browser tab
// (claude-web, chatgpt-web, gemini-web, grok-web, perplexity-web, deepseek-web,
// qwen-web). Others (e.g. kimi-web) must use the manual-cookie method.

const KNOWN_WEB_PROVIDERS = [
  "deepseek-web",
  "kimi-web",
  "qwen-web",
  "claude-web",
  "chatgpt-web",
  "gemini-web",
  "grok-web",
  "perplexity-web",
];

export default function RemoteWebLoginPage() {
  const [providerId, setProviderId] = useState("deepseek-web");
  const [status, setStatus] = useState<string>("idle");
  const [endpoint, setEndpoint] = useState<{ port: number; wsUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollCdp = useCallback(async () => {
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/cdp`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data?.endpoint?.wsUrl) {
        setEndpoint({ port: data.endpoint.port, wsUrl: data.endpoint.wsUrl });
        setStatus("ready");
        stopPolling();
      }
    } catch {
      /* keep polling */
    }
  }, [providerId, stopPolling]);

  const startLogin = useCallback(async () => {
    setError(null);
    setEndpoint(null);
    setStatus("starting");
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/login`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Login failed (${res.status})`);
      }
      setStatus("waiting-cdp");
      pollRef.current = setInterval(pollCdp, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }, [providerId, pollCdp]);

  const copy = useCallback(async () => {
    if (endpoint?.wsUrl) {
      try {
        await navigator.clipboard.writeText(endpoint.wsUrl);
      } catch {
        /* ignore */
      }
    }
  }, [endpoint]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-xl font-semibold">Remote Web Login</h1>
      <p className="mb-4 text-sm text-gray-500">
        Start a provider web login on this server and reach its loopback Chrome
        DevTools Protocol (CDP) endpoint from a remote machine.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value.trim())}
          placeholder="provider id (e.g. deepseek-web)"
        />
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          onClick={startLogin}
          disabled={status === "starting" || status === "waiting-cdp"}
        >
          Start web login
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {KNOWN_WEB_PROVIDERS.map((p) => (
          <button
            key={p}
            className="rounded border px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
            onClick={() => setProviderId(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {status === "waiting-cdp" && (
        <p className="mb-2 text-sm text-amber-400">
          Browser launched — waiting for the CDP endpoint to appear…
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-400">Error: {error}</p>}

      {endpoint && (
        <div className="mb-4 rounded border border-green-700 bg-green-950 p-3">
          <p className="mb-1 text-sm font-medium text-green-300">CDP endpoint ready (loopback)</p>
          <p className="break-all text-xs text-green-200">{endpoint.wsUrl}</p>
          <button
            className="mt-2 rounded bg-green-700 px-3 py-1 text-xs text-white"
            onClick={copy}
          >
            Copy wsUrl
          </button>
          <p className="mt-3 text-xs text-green-200">
            From your remote machine, tunnel it home:
            <br />
            <code className="block whitespace-pre bg-black/40 p-2">
              {`ssh -N -L ${endpoint.port}:127.0.0.1:${endpoint.port} user@this-host`}
            </code>
            then open the copied wsUrl in your local Chrome DevTools / CDP client.
          </p>
        </div>
      )}

      <div className="mt-6 rounded border p-3 text-xs text-gray-400">
        <p className="mb-1 font-medium text-gray-300">Most reliable method (no browser needed)</p>
        If the in-app login is unreliable, log into the provider site in your own
        browser, copy the session cookie (DeepSeek = <code>user-token</code>), and
        paste it into the provider connection&apos;s <strong>API Key</strong> field.
        OmniRoute web providers use <code>authType: apikey</code> / bearer, so the
        cookie value is what they expect.
      </div>
    </div>
  );
}
