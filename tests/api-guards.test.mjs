// Guards on the local API. This server can delete files, terminate processes
// and spawn programs, so these checks protect the highest-risk endpoints.
//
// Requires the backend on 127.0.0.1:3333 (`npm run dev:backend`). Skips itself
// when the backend isn't running so `npm test` stays usable offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = 'http://127.0.0.1:3333';

// fetch() treats Host as a forbidden header and silently drops it, so the
// rebinding check has to go through the raw http client to set it for real.
function rawRequest(pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 3333, path: pathname, method: 'GET', headers: { Host: hostHeader } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Probed at module load, NOT in a before() hook: node:test evaluates each
// test's `skip` option when the test is defined, which happens before hooks run.
const backendUp = await (async () => {
  try {
    const res = await fetch(`${BASE}/api/config`);
    return res.ok;
  } catch {
    return false;
  }
})();

if (!backendUp) {
  console.log('  (backend not running on :3333 — API guard tests skipped)');
}

test('rejects requests with a non-loopback Host header (DNS rebinding)', { skip: !backendUp }, async (t) => {
  if (!backendUp) return t.skip();
  const res = await rawRequest('/api/config', 'evil.example.com');
  assert.equal(res.status, 403);
  assert.match(res.body, /DNS-rebinding|localhost/i);
});

test('still accepts a normal loopback Host header', { skip: !backendUp }, async (t) => {
  if (!backendUp) return t.skip();
  const res = await rawRequest('/api/config', '127.0.0.1:3333');
  assert.equal(res.status, 200);
});

test('refuses to launch a folder that no scan surfaced', { skip: !backendUp }, async (t) => {
  if (!backendUp) return t.skip();
  // Deliberately a directory the scanner never returns as a runnable project.
  const res = await fetch(`${BASE}/api/launch-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: 'C:\\Windows\\System32' })
  });
  assert.equal(res.status, 403, 'arbitrary folders must not be executable');
  const body = await res.json();
  assert.match(body.error, /only projects detected by a scan/i);
});

test('rejects a kill request without a numeric pid', { skip: !backendUp }, async (t) => {
  if (!backendUp) return t.skip();
  const res = await fetch(`${BASE}/api/processes/kill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid: 'not-a-pid' })
  });
  assert.equal(res.status, 400);
});

test('rejects a clean request whose itemIds is not an array', { skip: !backendUp }, async (t) => {
  if (!backendUp) return t.skip();
  const res = await fetch(`${BASE}/api/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: 'everything' })
  });
  assert.equal(res.status, 400);
});
