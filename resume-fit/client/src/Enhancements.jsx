import React, { useState, useRef } from 'react';
import { applyImprovement } from './enhancements.js';

export default function Enhancements({ draft, jd, disabled, onApply }) {
  const [facts, setFacts] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState({});
  const [applied, setApplied] = useState({});
  const [source, setSource] = useState('');
  const current = useRef({ draft, jd, facts });
  current.current = { draft, jd, facts };
  async function generate() {
    const requested = { resume: draft, jd, facts };
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requested),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not generate improvements.');
      if (
        current.current.draft !== requested.resume ||
        current.current.jd !== requested.jd ||
        current.current.facts !== requested.facts
      )
        throw Error('Your inputs changed during generation. Generate again for the current draft.');
      setAnalysis(data);
      setSource(draft);
      setConfirmed({});
      setApplied({});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card editor-card enhancement-card"
      aria-labelledby="enhance-title"
      aria-busy={busy}
    >
      <div className="eyebrow">GO BEYOND REORDERING</div>
      <h3 id="enhance-title">Improve points for this job</h3>
      <p>
        Generate stronger bullet wording, new points from your additional experience, and specific
        advice for missing skills. Review each suggestion for accuracy before applying it.
      </p>
      <label htmlFor="additional-experience">Additional real experience (optional)</label>
      <textarea
        id="additional-experience"
        maxLength={10000}
        value={facts}
        disabled={busy || disabled}
        onChange={(e) => {
          setFacts(e.target.value);
          setAnalysis(null);
        }}
        placeholder="Name the role/project and explain what you actually built, tools used and outcomes. For example: In Task Planner, I also wrote tests for the dashboard using React Testing Library. New points need this evidence."
      />
      <p className="privacy-note">
        Clicking Generate sends the current draft, job description and additional experience to
        OpenAI. API usage may cost money. Configure OPENAI_API_KEY in the server .env; never paste
        your key here.
      </p>
      <button
        type="button"
        className="primary"
        disabled={disabled || busy || draft.trim().length < 20}
        onClick={generate}
      >
        {busy
          ? 'Generating improvements…'
          : analysis
            ? 'Regenerate improvements'
            : 'Generate AI improvements'}
      </button>
      {error && <p role="alert">{error}</p>}
      {analysis && (
        <>
          {draft !== source && (
            <p role="status">
              The draft has changed. Regenerate improvements before applying more suggestions.
            </p>
          )}
          {!analysis.improvements.length && (
            <p>
              No supported wording changes found. Add real experience above to generate new points.
            </p>
          )}
          {analysis.improvements.map((item, i) => (
            <article className="change-group" key={i}>
              <h4>
                {item.kind === 'add' ? 'New point' : 'Stronger wording'} · line {item.line}
              </h4>
              <p>
                <b>{item.kind === 'add' ? 'Insert after:' : 'Before:'}</b> {item.before}
              </p>
              <p>
                <b>{item.kind === 'add' ? 'New point:' : 'After:'}</b> {item.after}
              </p>
              <p>{item.reason}</p>
              <details>
                <summary>Source evidence</summary>
                <ul>
                  {item.evidence.map((quote, j) => (
                    <li key={j}>{quote}</li>
                  ))}
                </ul>
              </details>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!confirmed[i]}
                  disabled={!!applied[i]}
                  onChange={(e) => setConfirmed({ ...confirmed, [i]: e.target.checked })}
                />
                I confirm this wording accurately describes my experience.
              </label>
              <button
                type="button"
                disabled={disabled || busy || applied[i] || !confirmed[i] || draft !== source}
                onClick={() => {
                  try {
                    const next = applyImprovement(draft, item);
                    onApply(next);
                    setSource(next);
                    setApplied({ ...applied, [i]: true });
                    setError('');
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                {applied[i] ? 'Applied' : item.kind === 'add' ? 'Add new point' : 'Apply rewrite'}
              </button>
            </article>
          ))}
          {!!analysis.gaps.length && (
            <div className="change-group">
              <h4>Skills to strengthen</h4>
              <p>These are questions or learning tasks. They are not added as experience.</p>
              <ul>
                {analysis.gaps.map((item, i) => (
                  <li key={i}>
                    <b>{item.skill}:</b> {item.nextStep}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
