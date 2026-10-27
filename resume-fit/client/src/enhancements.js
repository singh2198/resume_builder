// Resolve the anchor against the current draft, so applying one suggestion cannot shift another into a different role.
export function applyImprovement(draft, item) {
  const lines = draft.split('\n');
  const indices = lines.flatMap((line, i) => (line === item.before ? [i] : []));
  if (indices.length !== 1)
    throw Error(
      'This source point changed or appears more than once. Edit it manually or regenerate suggestions.',
    );
  const index = indices[0];
  if (item.kind === 'rewrite') lines[index] = item.after;
  else if (item.kind === 'add') {
    if (lines.some((line) => line.trim() === item.after.trim()))
      throw Error('This point already exists in your draft.');
    lines.splice(index + 1, 0, item.after);
  } else throw Error('Unsupported improvement.');
  const next = lines.join('\n');
  if (next.length > 60000) throw Error('Resume must stay under 60,000 characters.');
  return next;
}
