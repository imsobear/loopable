import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPending,
  beginAuthorize,
  createPkce,
  exchangeCode,
  GITHUB_OAUTH_SCOPES,
} from "../src/github/oauth.ts";

const ORIGIN = "http://127.0.0.1:8787";

test("authorize sends the browser to github.com with a loopback callback", () => {
  const started = beginAuthorize(ORIGIN, { clientId: "Ov23li", clientSecret: "secret" });
  const url = new URL(started.redirect);
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Ov23li");
  assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/oauth/github/callback`);
  assert.equal(url.searchParams.get("scope"), GITHUB_OAUTH_SCOPES);
  assert.equal(url.searchParams.get("state"), started.pending.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("authorize refuses to run without an OAuth app configured offline", () => {
  assert.throws(() => beginAuthorize(ORIGIN, null), /client ID/);
});

test("pending state must match the value GitHub sends back", () => {
  const pending = beginAuthorize(ORIGIN, { clientId: "Ov23li" }).pending;
  assert.throws(() => assertPending(pending, "other"), /state mismatch/);
  assert.throws(() => assertPending(null, pending.state), /No authorization in progress/);
  assert.equal(assertPending(pending, pending.state).state, pending.state);
});

test("pkce verifier hashes to the challenge sent to GitHub", () => {
  const { verifier, challenge } = createPkce();
  assert.notEqual(verifier, challenge);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
});

test("callback code is exchanged for a user token", async () => {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://github.com/login/oauth/access_token");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.code, "abc");
    assert.equal(body.client_secret, "secret");
    assert.equal(body.code_verifier, "verifier");
    assert.equal(body.redirect_uri, `${ORIGIN}/oauth/github/callback`);
    return new Response(
      JSON.stringify({
        access_token: "gho_test",
        refresh_token: "ghr_test",
        expires_in: 28800,
      }),
      { status: 200 },
    );
  };
  const tokens = await exchangeCode(
    {
      clientId: "Ov23li",
      clientSecret: "secret",
      code: "abc",
      origin: ORIGIN,
      verifier: "verifier",
    },
    fetchImpl as typeof fetch,
  );
  assert.equal(tokens.accessToken, "gho_test");
  assert.equal(tokens.refreshToken, "ghr_test");
  assert.ok(tokens.expiresAt && tokens.expiresAt > Date.now());
});

test("GitHub errors during exchange surface a readable message", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({ error: "bad_verification_code", error_description: "The code is incorrect." }),
      { status: 200 },
    );
  await assert.rejects(
    exchangeCode(
      { clientId: "Ov23li", code: "abc", origin: ORIGIN, verifier: "verifier" },
      fetchImpl as typeof fetch,
    ),
    /The code is incorrect/,
  );
});
