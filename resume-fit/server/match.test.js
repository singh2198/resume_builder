import test from 'node:test';
import assert from 'node:assert/strict';
import { tailor, keywords } from './match.js';
test('aliases match without Java / JavaScript or SQL / MySQL collisions', () => {
  assert.deepEqual(keywords('JavaScript MySQL NodeJS'), ['JavaScript', 'Node.js', 'MySQL']);
  assert.deepEqual(keywords('C++ C#'), ['C++', 'C#']);
});
test('only reorders contiguous bullets within their original job', () => {
  const resume =
    'Name\nJob A 2020\n- Designed CSS layouts\n- Built React applications\nJob B 2022\n- Managed teams\n- Built Node.js APIs';
  const result = tailor(resume, 'React Node.js Docker');
  assert.equal(
    result.updatedResume,
    'Name\nJob A 2020\n- Built React applications\n- Designed CSS layouts\nJob B 2022\n- Built Node.js APIs\n- Managed teams',
  );
  assert.deepEqual(result.missing, ['Docker']);
  assert.equal(result.score, 67);
  assert.deepEqual(result.updatedResume.split('\n').sort(), resume.split('\n').sort());
});
test('no recognized keywords gives unavailable score, unchanged text', () => {
  const resume = 'Name\n- Did useful work\n- Another achievement';
  const r = tailor(resume, 'Specialist in an unrecognized discipline');
  assert.equal(r.score, null);
  assert.equal(r.updatedResume, resume);
});
test('stable ordering with equal relevance and no fabricated keywords', () => {
  const resume = '- React project one\n- React project two';
  const r = tailor(resume, 'React AWS Docker');
  assert.equal(r.updatedResume, resume);
  assert.equal(r.changes.length, 0);
  assert.ok(!r.updatedResume.includes('AWS'));
});
