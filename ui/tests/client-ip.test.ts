import { test } from "node:test";
import assert from "node:assert/strict";
import { clientRateLimitKey } from "../src/lib/client-ip";

test("untrusted headers cannot change the rate-limit identity", () => {
  for (const ip of ["192.0.2.1", "192.0.2.2", "2001:db8::1"]) {
    assert.equal(clientRateLimitKey(new Headers({
      "x-forwarded-for": `${ip}, 198.51.100.1`,
      "x-real-ip": ip,
      "cf-connecting-ip": ip,
    }), false), "shared");
  }
});

test("Cloudflare identity never comes from spoofable forwarding chains", () => {
  for (const ip of ["192.0.2.1", "192.0.2.2"]) {
    const headers = new Headers({ "x-forwarded-for": ip, "x-real-ip": ip });
    assert.equal(clientRateLimitKey(headers, true), null);
    headers.set("cf-connecting-ip", "198.51.100.1");
    assert.equal(clientRateLimitKey(headers, true), "ip:198.51.100.1");
  }
  for (const ip of ["", "not-an-ip", "192.0.2.1, 192.0.2.2", "192.000.2.1", "[2001:db8::1]", "fe80::1%eth0"]) {
    assert.equal(clientRateLimitKey(new Headers({ "cf-connecting-ip": ip }), true), null, ip);
  }
});

test("equivalent IP representations share a bucket; distinct clients do not", () => {
  const key = (ip: string) => clientRateLimitKey(new Headers({ "cf-connecting-ip": ip }), true);
  for (const ip of ["2001:db8::a", "2001:0DB8:0000:0000:0000:0000:0000:000A", " 2001:DB8::A "]) {
    assert.equal(key(ip), "ip:2001:db8::a");
  }
  for (const ip of ["192.0.2.1", "::ffff:192.0.2.1", "::FFFF:c000:201", "0:0:0:0:0:ffff:c000:0201"]) {
    assert.equal(key(ip), "ip:192.0.2.1");
  }
  assert.notEqual(key("192.0.2.1"), key("192.0.2.2"));
  assert.notEqual(key("2001:db8::a"), key("2001:db8::b"));
});
