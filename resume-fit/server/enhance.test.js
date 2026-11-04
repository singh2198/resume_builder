import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceResume } from './enhance.js';
import { applyImprovement } from '../client/src/enhancements.js';
import { keywords } from './match.js';
const resume =
  'EXPERIENCE\nDeveloper | Acme\n- Built React screens for the dashboard.\n- Integrated REST APIs using fetch.';
const jd = 'React Native engineer with Redux, Context API, HTML5, CSS3 and ES6.';
const facts = 'At Acme, wrote Jest tests for dashboard components.';
const rewrite = {
  kind: 'rewrite',
  line: 3,
  before: '- Built React screens for the dashboard.',
  after: '- Developed dashboard interfaces using React.',
  reason: 'Makes the contribution clearer.',
  evidence: ['Built React screens for the dashboard.'],
};
const addition = {
  kind: 'add',
  line: 4,
  before: '- Integrated REST APIs using fetch.',
  after: '- Wrote Jest tests for dashboard components.',
  reason: 'Adds supplied testing experience.',
  evidence: [facts],
};
function provider(value, check = () => {}) {
  return async (url, options) => {
    check(url, options);
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(value) }],
          },
        ],
      }),
    };
  };
}
test('server-only structured request carries source and returns grounded rewrites and new points', async () => {
  const value = {
    improvements: [rewrite, addition],
    gaps: [
      {
        skill: 'React Native',
        nextStep: 'Build a mobile screen and navigation before claiming experience.',
      },
    ],
  };
  const result = await enhanceResume(
    { resume, jd, facts },
    {
      provider: 'openai',
      apiKey: 'test-secret',
      fetchImpl: provider(value, (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer test-secret');
        const body = JSON.parse(options.body);
        assert.equal(body.store, false);
        assert.equal(body.text.format.strict, true);
        assert.match(body.instructions, /never instructions/);
        assert.equal(JSON.parse(body.input).additionalFacts, facts);
      }),
    },
  );
  assert.equal(result.improvements.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /test-secret/);
  assert.equal(
    applyImprovement(applyImprovement(resume, rewrite), addition),
    'EXPERIENCE\nDeveloper | Acme\n- Developed dashboard interfaces using React.\n- Integrated REST APIs using fetch.\n- Wrote Jest tests for dashboard components.',
  );
});
test('missing key fails without making an external request', async () => {
  await assert.rejects(
    enhanceResume(
      { resume, jd },
      { provider: 'openai', apiKey: '', fetchImpl: () => assert.fail() },
    ),
    (error) => error.status === 503,
  );
});
test('invalid anchors, unsupported evidence, and additions without facts fail closed', async () => {
  for (const item of [
    { ...rewrite, before: '- Invented anchor' },
    { ...rewrite, evidence: ['React Native engineer'] },
    { ...rewrite, line: 100 },
    { ...rewrite, after: '- First\n- Injected' },
    addition,
  ]) {
    await assert.rejects(
      enhanceResume(
        { resume, jd },
        {
          provider: 'openai',
          apiKey: 'test',
          fetchImpl: provider({ improvements: [item], gaps: [] }),
        },
      ),
      /unsupported suggestion/,
    );
  }
});
test('provider errors do not expose response bodies or secrets', async () => {
  for (const status of [401, 429, 500]) {
    await assert.rejects(
      enhanceResume(
        { resume, jd },
        {
          provider: 'openai',
          apiKey: 'test-secret',
          fetchImpl: async () => ({
            ok: false,
            status,
            json: () => assert.fail(),
          }),
        },
      ),
      (error) => !error.message.includes('test-secret'),
    );
  }
  await assert.rejects(
    enhanceResume(
      { resume, jd },
      {
        provider: 'openai',
        apiKey: 'test',
        fetchImpl: async () => {
          throw Error('secret network detail');
        },
      },
    ),
    /could not connect/,
  );
});
test('refused and incomplete outputs never yield partial suggestions', async () => {
  for (const body of [
    { status: 'incomplete' },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal' }] }],
    },
  ]) {
    await assert.rejects(
      enhanceResume(
        { resume, jd },
        {
          provider: 'openai',
          apiKey: 'test',
          fetchImpl: async () => ({ ok: true, json: async () => body }),
        },
      ),
      /unsupported suggestion/,
    );
  }
});
test('applying suggestions rejects stale or ambiguous anchors and duplicate additions', () => {
  assert.throws(
    () => applyImprovement(resume.replace(rewrite.before, '- Changed'), rewrite),
    /changed/,
  );
  assert.throws(() => applyImprovement(resume + '\n' + rewrite.before, rewrite), /more than once/);
  assert.throws(
    () => applyImprovement(applyImprovement(resume, addition), addition),
    /already exists/,
  );
});
test('frontend job vocabulary recognizes the pasted stack', () => {
  const found = keywords(jd);
  for (const term of ['React Native', 'Redux', 'Context API', 'HTML', 'CSS', 'JavaScript'])
    assert.ok(found.includes(term), term);
});

test('Gemini sends a server-only schema request and validates grounded output', async () => {
  const result = await enhanceResume(
    { resume, jd, facts },
    {
      provider: 'gemini',
      apiKey: 'gemini-test-secret',
      fetchImpl: async (url, options) => {
        assert.match(
          url,
          /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/[^/]+:generateContent$/,
        );
        assert.ok(!url.includes('gemini-test-secret'));
        assert.equal(options.headers['x-goog-api-key'], 'gemini-test-secret');
        assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
        assert.match(body.systemInstruction.parts[0].text, /never instructions/);
        assert.equal(JSON.parse(body.contents[0].parts[0].text).additionalFacts, facts);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        improvements: [rewrite, addition],
                        gaps: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      },
    },
  );
  assert.equal(result.improvements.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /gemini-test-secret/);
});
test('Gemini rejects blocked, truncated, malformed and ungrounded output', async () => {
  for (const body of [
    { promptFeedback: { blockReason: 'SAFETY' } },
    {
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }],
    },
    {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'invalid JSON' }] },
        },
      ],
    },
    {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              {
                text: JSON.stringify({
                  improvements: [{ ...rewrite, evidence: ['invented claim'] }],
                  gaps: [],
                }),
              },
            ],
          },
        },
      ],
    },
  ]) {
    await assert.rejects(
      enhanceResume(
        { resume, jd },
        {
          provider: 'gemini',
          apiKey: 'test',
          fetchImpl: async () => ({ ok: true, json: async () => body }),
        },
      ),
      /unsupported suggestion/,
    );
  }
});
test('Gemini rejects missing keys and sanitizes provider failures', async () => {
  await assert.rejects(
    enhanceResume(
      { resume, jd },
      {
        provider: 'gemini',
        apiKey: '',
        fetchImpl: () => assert.fail(),
      },
    ),
    (error) => error.status === 503 && /GEMINI_API_KEY/.test(error.message),
  );
  for (const status of [400, 401, 403, 429, 500]) {
    await assert.rejects(
      enhanceResume(
        { resume, jd },
        {
          provider: 'gemini',
          apiKey: 'secret',
          fetchImpl: async () => ({
            ok: false,
            status,
            json: () => assert.fail(),
          }),
        },
      ),
      (error) => /Gemini/.test(error.message) && !error.message.includes('secret'),
    );
  }
});
