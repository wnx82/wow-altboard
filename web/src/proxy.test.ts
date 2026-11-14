import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { sessionCookieName } from "@/lib/auth/cookie";
import { proxy, REACT_HIDDEN_SEGMENT_STYLE } from "./proxy";

describe("CSP posée par le proxy", () => {
  test("seul l'attribut style des morceaux différés de React est admis, par son empreinte", () => {
    assert.equal(REACT_HIDDEN_SEGMENT_STYLE, `sha256-${createHash("sha256").update("display:none").digest("base64")}`);
    const request = new NextRequest("http://localhost/market", { headers: { cookie: `${sessionCookieName()}=x` } });
    const csp = proxy(request).headers.get("content-security-policy") ?? "";
    assert.match(csp, /style-src 'self' 'nonce-[^']+'(;|$)/);
    assert.ok(csp.includes(`style-src-attr 'unsafe-hashes' '${REACT_HIDDEN_SEGMENT_STYLE}'`));
    assert.ok(!csp.includes("'unsafe-inline'"));
  });
});
