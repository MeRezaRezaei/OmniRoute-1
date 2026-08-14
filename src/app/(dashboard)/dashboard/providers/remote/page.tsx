"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChromeProfile = {
  dir: string;
  name: string;
  email?: string;
  userDataDir: string;
};

type CdpProviderMatch = {
  providerId: string;
  displayName: string;
  requiredCookies: string[];
  foundCookies: string[];
  available: boolean;
};

type CdpProfileScanResult = {
  profileDir: string;
  userDataDir: string;
  providers: CdpProviderMatch[];
  matchedProviderIds: string[];
  scannedAt: string;
  error?: string;
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
  const [bindEnabled, setBindEnabled] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<CdpProfileScanResult[]>([]);
  const [scanning, setScanning] = useState<boolean>(false);
  const [bindings, setBindings] = useState<Record<string, string>>({});
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

  const scanProfiles = useCallback(async () => {
    setScanning(true);
    setStatus("scanning profiles for provider cookies...");
    try {
      const res = await fetch("/api/providers/cdp-profile-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setStatus(`scan failed: ${JSON.stringify(data?.error ?? data)}`);
        return;
      }
      setScanResults(data.results ?? []);
      const nextBindings: Record<string, string> = {};
      for (const r of data.results ?? []) {
        for (const m of r.providers ?? []) {
          if (m.available && !nextBindings[m.providerId]) {
            nextBindings[m.providerId] = r.profileDir;
          }
        }
      }
      setBindings((prev) => ({ ...nextBindings, ...prev }));
      setStatus(`scan complete: ${(data.results ?? []).length} profiles`);
    } catch (e) {
      setStatus(`scan error: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, []);

  const bindProfile = useCallback(async (provider: string, profileDir: string) => {
    try {
      const res = await fetch("/api/providers/cdp-bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: provider, profileDir }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setStatus(`bind failed: ${JSON.stringify(data?.error ?? data)}`);
        return;
      }
      setBindings((prev) => ({ ...prev, [provider]: profileDir }));
      setStatus(`bound ${provider} → ${profileDir}`);
    } catch (e) {
      setStatus(`bind error: ${(e as Error).message}`);
    }
  }, []);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setWsUrl(null);
    const profileDir = selectedProfile || bindings[providerId] || undefined;
    setStatus(
      profileDir
        ? `starting web login on profile ${profileDir}...`
        : "starting web login..."
    );
    try {
      const res = await fetch(`/api/providers/${providerId}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileDir,
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
  }, [providerId, selectedProfile, bindings, forceCdp, stopPoll]);

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
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
        {bindings[providerId] && (
          <span style={{ marginLeft: 12, opacity: 0.8 }}>
            bound to <code>{bindings[providerId]}</code>
          </span>
        )}
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

      <fieldset style={{ marginTop: 24 }}>
        <legend>Profile → provider matrix</legend>
        <p style={{ opacity: 0.8, marginTop: 0 }}>
          Scan each Chrome profile to see which web-provider session cookies it
          already holds, then bind providers to a profile. Requests for a bound
          provider are routed through that profile&apos;s Chrome (execution
          binding) so the provider sees genuine browser traffic.
        </p>
        <button type="button" onClick={scanProfiles} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan profiles"}
        </button>
        {scanResults.length > 0 && (
          <table
            style={{
              marginTop: 12,
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 10px" }}>Profile</th>
                <th style={{ textAlign: "left", padding: "4px 10px" }}>Provider</th>
                <th style={{ textAlign: "left", padding: "4px 10px" }}>Cookies</th>
                <th style={{ textAlign: "left", padding: "4px 10px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {scanResults.map((r) =>
                r.error ? (
                  <tr key={r.profileDir}>
                    <td style={{ padding: "4px 10px" }}>
                      <code>{r.profileDir}</code>
                    </td>
                    <td colSpan={3} style={{ padding: "4px 10px", opacity: 0.7 }}>
                      error: {r.error}
                    </td>
                  </tr>
                ) : (
                  r.providers.map((m) => (
                    <tr key={`${r.profileDir}:${m.providerId}`}>
                      <td style={{ padding: "4px 10px" }}>
                        <code>{r.profileDir}</code>
                      </td>
                      <td style={{ padding: "4px 10px" }}>
                        {m.displayName} <code>({m.providerId})</code>
                      </td>
                      <td style={{ padding: "4px 10px" }}>
                        {m.available ? (
                          <span style={{ color: "#4caf50" }}>
                            ✓ ready ({m.foundCookies.join(", ")})
                          </span>
                        ) : (
                          <span style={{ opacity: 0.6 }}>
                            missing: {m.requiredCookies.join(", ")}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "4px 10px" }}>
                        {bindings[m.providerId] === r.profileDir ? (
                          <strong style={{ color: "#4caf50" }}>bound</strong>
                        ) : (
                          <button
                            type="button"
                            onClick={() => bindProfile(m.providerId, r.profileDir)}
                            disabled={!m.available}
                          >
                            Bind
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        )}
        <label style={{ display: "block", marginTop: 12 }}>
          <input
            type="checkbox"
            checked={bindEnabled}
            onChange={(e) => setBindEnabled(e.target.checked)}
          />{" "}
          Bind web-provider execution to CDP Chrome (WEB_PROVIDER_CDP_BIND —
          route bound providers&apos; upstream requests through the user&apos;s
          real Chrome)
        </label>
      </fieldset>

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
