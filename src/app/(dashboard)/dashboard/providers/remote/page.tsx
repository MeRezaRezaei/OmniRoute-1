"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChromeProfile = {
  dir: string;
  name: string;
  email?: string;
  userDataDir: string;
};

const KNOWN_WEB_PROVIDERS = [
  "deepseek-web",
  "kimi-web",
  "tasw",
  "claude-web",
  "chatgpt-web",
  "gemini-web",
  "grok-web",
  "perplexity-web",
  "qwen-web",
];

export default function RemoteWebLoginPage() {
  const [providerId, setProviderId] = useState("deepseek-web");
  const [status, setStatus] = useState<string>("");
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [forceCdp, setForceCdp] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/cdp-profiles");
      if (!res.ok) {
        setStatus(`profiles: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { profiles?: ChromeProfile[] };
      setProfiles(data.profiles ?? []);
    } catch {
      setStatus("profiles: fetch failed");
    }
  }, []);

  useEffect(() => {
    loadProfiles();
    return stopPoll;
  }, [loadProfiles, stopPoll]);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setWsUrl(null);
    setStatus("starting web login...");
    try {
      const res = await fetch(`/api/providers/${providerId}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileDir: selectedProfile || undefined,
          forceCdp: forceCdp || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setStatus(`login failed: ${JSON.stringify(data?.error ?? data)}`);
        setBusy(false);
        return;
      }
      setStatus("login complete — polling CDP endpoint");
      pollRef.current = setInterval(async () => {
        try {
          const cdp = await fetch(`/api/providers/${providerId}/cdp`);
          const cdpData = await cdp.json();
          if (cdpData?.endpoint?.wsUrl) {
            setWsUrl(cdpData.endpoint.wsUrl);
            setStatus("CDP endpoint ready");
            stopPoll();
          }
        } catch {
          /* keep polling */
        }
      }, 1000);
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [providerId, selectedProfile, forceCdp, stopPoll]);

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <h1>Remote Web Login</h1>
      <p>
        Start a web-provider login on this server and reach its loopback CDP
        endpoint from anywhere via an authenticated tunnel.
      </p>

      <label style={{ display: "block", marginTop: 16 }}>
        Provider
        <input
          list="web-providers"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          style={{ marginLeft: 8, padding: 6, width: 280 }}
        />
        <datalist id="web-providers">
          {KNOWN_WEB_PROVIDERS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>

      <fieldset style={{ marginTop: 16 }}>
        <legend>Chrome profile</legend>
        <button type="button" onClick={loadProfiles}>
          Refresh profiles
        </button>
        {profiles.length === 0 && (
          <div style={{ opacity: 0.7, marginTop: 8 }}>
            No Chrome profiles found (Chrome not installed or not on this host).
          </div>
        )}
        {profiles.map((p) => (
          <label
            key={p.dir}
            style={{ display: "block", marginTop: 6, cursor: "pointer" }}
          >
            <input
              type="radio"
              name="profile"
              checked={selectedProfile === p.dir}
              onChange={() => setSelectedProfile(p.dir)}
            />{" "}
            <strong>{p.name}</strong>
            {p.email ? ` (${p.email})` : ""} — <code>{p.dir}</code>
          </label>
        ))}
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={forceCdp}
            onChange={(e) => setForceCdp(e.target.checked)}
          />{" "}
          Force CDP launch (use this server&apos;s real Chrome even if the global
          flag is off)
        </label>
      </fieldset>

      <button
        type="button"
        onClick={startLogin}
        disabled={busy}
        style={{ marginTop: 16, padding: "8px 16px" }}
      >
        {busy ? "Working..." : "Start web login"}
      </button>

      <div style={{ marginTop: 16 }}>
        <strong>Status:</strong> {status}
      </div>

      {wsUrl && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#0b1020",
            borderRadius: 8,
          }}
        >
          <div>
            <strong>CDP wsUrl:</strong>
          </div>
          <code style={{ wordBreak: "break-all" }}>{wsUrl}</code>
          <div style={{ marginTop: 8 }}>
            <strong>Tunnel home (run on this host):</strong>
          </div>
          <code>
            ssh -N -R 0:127.0.0.1:
            {wsUrl.match(/:(\d+)\//)?.[1] ?? "PORT"} user@this-host
          </code>
        </div>
      )}

      <div
        style={{
          marginTop: 24,
          padding: 12,
          border: "1px solid #444",
          borderRadius: 8,
        }}
      >
        <strong>Most reliable method (manual cookie):</strong> log into the
        provider site in your own browser, copy the session cookie (DeepSeek ={" "}
        <code>user-token</code>; Kimi / Tencent = their auth cookie), and paste
        it into the provider connection&apos;s <em>API Key</em> field (the
        connection is <code>authType: apikey</code>, <code>bearer</code>). This
        works without any browser automation.
      </div>
    </div>
  );
}
