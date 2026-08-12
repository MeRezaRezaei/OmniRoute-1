import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  listChromeProfiles,
  parseCdpEndpointFromStderr,
  getChromeUserDataDir,
} from "../../open-sse/services/chromeProfiles";

let tmp: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-profiles-"));
  fs.writeFileSync(
    path.join(tmp, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Person 1" },
          "Profile 1": { name: "Work" },
        },
      },
    }),
  );
  fs.mkdirSync(path.join(tmp, "Default"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "Default", "Preferences"),
    JSON.stringify({ account_info: [{ email: "a@b.com" }] }),
  );
  fs.mkdirSync(path.join(tmp, "Profile 1"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "Profile 1", "Preferences"),
    JSON.stringify({ gaia_info: { email: "work@x.com" } }),
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("chromeProfiles", () => {
  test("listChromeProfiles enumerates name + email per profile", () => {
    const profiles = listChromeProfiles(tmp);
    assert.equal(profiles.length, 2);

    const person = profiles.find((p) => p.dir === "Default");
    assert.ok(person);
    assert.equal(person.name, "Person 1");
    assert.equal(person.email, "a@b.com");

    const work = profiles.find((p) => p.dir === "Profile 1");
    assert.ok(work);
    assert.equal(work.name, "Work");
    assert.equal(work.email, "work@x.com");
  });

  test("listChromeProfiles returns [] when Local State missing", () => {
    const profiles = listChromeProfiles(
      path.join(os.tmpdir(), "definitely-not-a-chrome-dir"),
    );
    assert.deepEqual(profiles, []);
  });

  test("parseCdpEndpointFromStderr extracts wsUrl + port", () => {
    const stderr =
      "noise\nDevTools listening on ws://127.0.0.1:54921/devtools/browser/abc-123\nmore";
    const r = parseCdpEndpointFromStderr(stderr);
    assert.ok(r);
    assert.equal(r?.port, 54921);
    assert.equal(r?.wsUrl, "ws://127.0.0.1:54921/devtools/browser/abc-123");
  });

  test("parseCdpEndpointFromStderr returns null when absent", () => {
    assert.equal(parseCdpEndpointFromStderr("no endpoint here"), null);
  });

  test("getChromeUserDataDir honours override", () => {
    assert.equal(getChromeUserDataDir("/tmp/x"), "/tmp/x");
  });
});
