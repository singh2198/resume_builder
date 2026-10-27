// Explicit vocabulary makes this metric reproducible; it is not an ATS simulation.
const groups = [
  ['JavaScript', 'javascript'],
  ['TypeScript', 'typescript'],
  ['React', 'react', 'react.js', 'reactjs'],
  ['Node.js', 'node.js', 'nodejs', 'node'],
  ['Express', 'express', 'express.js'],
  ['Python', 'python'],
  ['Java', 'java'],
  ['C++', 'c++'],
  ['C#', 'c#'],
  ['SQL', 'sql'],
  ['PostgreSQL', 'postgresql', 'postgres'],
  ['MySQL', 'mysql'],
  ['MongoDB', 'mongodb', 'mongo'],
  ['SQLite', 'sqlite'],
  ['AWS', 'aws', 'amazon web services'],
  ['Azure', 'azure'],
  ['Docker', 'docker'],
  ['Kubernetes', 'kubernetes', 'k8s'],
  ['Git', 'git'],
  ['REST', 'rest', 'restful'],
  ['GraphQL', 'graphql'],
  ['HTML', 'html'],
  ['CSS', 'css'],
  ['Next.js', 'next.js', 'nextjs'],
  ['Vue', 'vue', 'vue.js'],
  ['Angular', 'angular'],
  ['Redis', 'redis'],
  ['Linux', 'linux'],
  ['CI/CD', 'ci/cd', 'continuous integration'],
  ['Testing', 'testing', 'unit tests', 'jest', 'vitest'],
  ['Agile', 'agile', 'scrum'],
  ['Communication', 'communication'],
  ['Leadership', 'leadership'],
  ['Excel', 'excel'],
  ['Power BI', 'power bi'],
  ['Tableau', 'tableau'],
  ['Machine learning', 'machine learning'],
  ['Generative AI', 'generative ai', 'genai'],
  ['LLMs', 'llm', 'llms', 'large language models'],
  ['Agentic AI', 'agentic', 'autonomous agents'],
  ['OpenAI', 'openai', 'gpt'],
  ['Claude', 'claude', 'anthropic'],
  ['Gemini', 'gemini'],
  ['LangChain', 'langchain'],
  ['AutoGen', 'autogen'],
  ['Semantic Kernel', 'semantic kernel'],
  ['RAG', 'rag', 'retrieval-augmented generation'],
  ['Pinecone', 'pinecone'],
  ['Weaviate', 'weaviate'],
  ['Prompt engineering', 'prompt engineering'],
  ['Hugging Face', 'hugging face'],
  ['Deep learning', 'deep learning'],
  ['NLP', 'nlp', 'natural language processing'],
  ['Computer vision', 'computer vision'],
  ['MLOps', 'mlops'],
  ['LLMOps', 'llmops'],
  ['Model evaluation', 'model evaluation'],
  ['AI observability', 'ai observability'],
  ['GCP', 'gcp', 'google cloud'],
  ['Data analysis', 'data analysis'],
  ['Project management', 'project management'],
  ['Customer service', 'customer service'],
  ['Sales', 'sales'],
  ['Figma', 'figma'],
  ['Accessibility', 'accessibility', 'wcag'],
];
function contains(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
}
export function keywords(text) {
  return groups.filter((g) => g.slice(1).some((t) => contains(text, t))).map((g) => g[0]);
}
export function tailor(resume, jd) {
  const wanted = keywords(jd),
    present = keywords(resume),
    matched = wanted.filter((t) => present.includes(t)),
    missing = wanted.filter((t) => !present.includes(t));
  const lines = resume.replace(/\r\n?/g, '\n').split('\n');
  const changes = [];
  // Sort only consecutive bullets; never move achievements across roles or projects.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[-•*]\s+/.test(lines[i])) continue;
    let end = i;
    while (end < lines.length && /^\s*[-•*]\s+/.test(lines[end])) end++;
    const before = lines.slice(i, end);
    const after = before
      .map((text, index) => ({
        text,
        index,
        rank: keywords(text).filter((t) => matched.includes(t)).length,
      }))
      .sort((a, b) => b.rank - a.rank || a.index - b.index)
      .map((x) => x.text);
    if (before.some((t, k) => t !== after[k])) {
      lines.splice(i, end - i, ...after);
      changes.push({
        line: i + 1,
        description: 'Prioritized relevant bullets within the same role or project.',
        before: before.join('\n'),
        after: after.join('\n'),
      });
    }
    i = end - 1;
  }
  return {
    updatedResume: lines.join('\n'),
    matched,
    missing,
    suggestions: missing.map((term) => ({
      term,
      prompt: `Have you used ${term}? Describe the project, your contribution and a result you can explain in an interview.`,
    })),
    keywords: wanted,
    score: wanted.length ? Math.round((matched.length / wanted.length) * 100) : null,
    changes,
    method:
      'Exact keyword coverage with common aliases. All JD keywords are equally weighted. Mentions may be negated or incidental; review evidence. No claims, skills, dates or achievements are added.',
    evidence: matched.map((term) => ({
      term,
      excerpt: lines.find((line) => keywords(line).includes(term))?.trim(),
    })),
  };
}
