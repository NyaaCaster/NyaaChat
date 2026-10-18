import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual proxy without opening a listener or contacting a model.
const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const bootstrap = 'import("node:http").then';
assert.ok(source.includes(bootstrap));
function load(env, fetchFn) {
  const context = { process: { env }, fetch: fetchFn, Request, Response, Headers, AbortSignal, Buffer, console };
  vm.runInNewContext(source.slice(0, source.indexOf(bootstrap))
    + '\nglobalThis.proxy = proxyT2iAgent; globalThis.configured = t2iAgentConfigured;', context);
  return context;
}
const key = name => `COMFYUI_FIXED_T2I_AGENT_API_${name}`;
const request = () => new Request('http://localhost/t2i-agent/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'untrusted-model', apiKey: 'untrusted-key', baseURL: 'https://untrusted.invalid',
    messages: [{ role: 'system', content: 'Write an English image prompt.' }, { role: 'user', content: 'A stone bridge.' }] }),
});

for (const base of ['https://example.invalid', 'https://example.invalid/', 'https://example.invalid/v1', 'https://example.invalid/v1/']) {
  test(`keyless agent uses exactly one /v1 for ${base}`, async () => {
    const env = { [key('BASEURL')]: base, [key('MODEL')]: 'configured-model', [key('APIKEY')]: '' };
    let calls = 0;
    const context = load(env, async (url, options) => {
      calls++;
      assert.equal(url, 'https://example.invalid/v1/chat/completions');
      assert.equal(Object.hasOwn(options.headers, 'authorization'), false);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'configured-model');
      assert.equal(body.stream, false);
      assert.equal(body.max_tokens, 1600);
      assert.equal(body.reasoning_effort, 'none');
      assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'A stone bridge at sunset.', reasoning_content: 'private reasoning' } }] });
    });
    assert.equal(context.configured(), true);
    const response = await context.proxy(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.choices[0].message.content, 'A stone bridge at sunset.');
    assert.equal(Object.hasOwn(data.choices[0].message, 'reasoning_content'), false);
    assert.equal(calls, 1);
  });
}

test('authenticated providers retain server-side Bearer authentication', async () => {
  const context = load({ [key('BASEURL')]: 'https://example.invalid', [key('MODEL')]: 'model', [key('APIKEY')]: 'test-key' }, async (_, options) => {
    assert.equal(options.headers.authorization, 'Bearer test-key');
    return Response.json({ choices: [{ message: { content: 'An English prompt.' } }] });
  });
  assert.equal((await context.proxy(request())).status, 200);
});

test('missing model or base URL still reports unconfigured and never calls upstream', async () => {
  for (const env of [{}, { [key('MODEL')]: 'model' }, { [key('BASEURL')]: 'https://example.invalid' }]) {
    const context = load(env, () => assert.fail('Must not call upstream'));
    assert.equal(context.configured(), false);
    assert.equal((await context.proxy(request())).status, 503);
  }
});
