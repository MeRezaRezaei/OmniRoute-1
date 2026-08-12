import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  InAppLoginService,
  parseCdpEndpointFromStderr,
} from "../../open-sse/services/inAppLoginService.ts";

test("parseCdpEndpointFromStderr extracts loopback port + ws url", () => {
  const line =
    "DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123";
  const parsed = parseCdpEndpointFromStderr(line);
  assert.ok(parsed);
  assert.equal(parsed.port, 9222);
  assert.equal(parsed.wsUrl, "ws://127.0.0.1:9222/devtools/browser/abc-123");
});

test("parseCdpEndpointFromStderr returns null for unrelated output", () => {
  assert.equal(parseCdpEndpointFromStderr("some random log line"), null);
  assert.equal(parseCdpEndpointFromStderr(""), null);
});

test("captureCdpEndpoint stores endpoint + emits cdp status", () => {
  const service = new InAppLoginService();
  const stderr = new EventEmitter();
  const proc = { stderr };
  const browser = {
    process: () => proc as unknown as import("child_process").ChildProcess,
  };

  let cdpStatus: string | null = null;
  service.on("status", (_providerId: string, status: string, _msg: string) => {
    if (status === "cdp") cdpStatus = status;
  });

  (
    service as unknown as {
      captureCdpEndpoint(browser: unknown, providerId: string): void;
    }
  ).captureCdpEndpoint(browser, "deepseek-web");

  stderr.emit(
    "data",
    Buffer.from(
      "DevTools listening on ws://127.0.0.1:9333/devtools/browser/xyz\n"
    )
  );

  const ep = service.getCdpEndpoint("deepseek-web");
  assert.ok(ep);
  assert.equal(ep.port, 9333);
  assert.equal(ep.wsUrl, "ws://127.0.0.1:9333/devtools/browser/xyz");
  assert.equal(cdpStatus, "cdp");

  service.clearCdpEndpoint("deepseek-web");
  assert.equal(service.getCdpEndpoint("deepseek-web"), undefined);
});
