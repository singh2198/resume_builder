import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import Enhancements from './Enhancements.jsx';
import {
  payForResume,
  recoverPayment,
  downloadPurchased,
  savedPurchase,
  paymentConfig,
} from './payments.js';
const sampleResume = `ALEX MORGAN
Full Stack Developer
alex@example.com | Bengaluru, India

SUMMARY
Full stack developer building accessible web applications with JavaScript, React and Node.js.

EXPERIENCE
Software Developer | Example Studio | 2023–Present
- Updated CSS styles and HTML templates for the company website.
- Built React interfaces and Node.js REST APIs using Express and PostgreSQL.
- Wrote unit tests and automated testing in CI/CD workflows.
- Collaborated with designers to improve accessibility.

PROJECTS
Task Planner | Personal project
- Created a responsive dashboard using React and JavaScript.
- Designed PostgreSQL tables and REST endpoints using Node.js.

SKILLS
JavaScript, React, Node.js, Express, PostgreSQL, Git, HTML, CSS, Testing

EDUCATION
B.Tech in Computer Science | Example University | 2023`;
const sampleJD =
  'Full Stack Developer — Example Company\nWe are looking for a developer with React, Node.js, Express, PostgreSQL and REST API experience. You will build accessible interfaces, write unit tests and maintain CI/CD workflows. Familiarity with Docker and AWS is preferred. Strong communication skills are helpful.';
async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Server unavailable. Please try again.' }));
    throw Error(body.error || 'Request failed. Please try again.');
  }
  return res.status === 204 ? null : res.json();
}
function bulletComparison(change) {
  const before = change.before.split('\n'),
    after = change.after.split('\n'),
    used = new Set();
  return after.map((text, index) => {
    const original = before.findIndex((value, i) => value === text && !used.has(i));
    if (original >= 0) used.add(original);
    return {
      text,
      from: original + 1,
      to: index + 1,
      moved: original >= 0 && original !== index,
    };
  });
}
function ResumeChanges({ result, edited }) {
  const groups = result.changes.map((change) => ({
    ...change,
    points: bulletComparison(change),
  }));
  const moved = groups.reduce(
    (total, group) => total + group.points.filter((point) => point.moved).length,
    0,
  );
  return (
    <section className="card resume-changes" aria-labelledby="resume-changes-title">
      <div className="changes-heading">
        <div>
          <div className="eyebrow">ORIGINAL → TAILORED</div>
          <h3 id="resume-changes-title">What changed in your resume</h3>
        </div>
        <span className="changes-count">
          {moved} {moved === 1 ? 'point' : 'points'} moved · {groups.length}{' '}
          {groups.length === 1 ? 'group' : 'groups'}
        </span>
      </div>
      <p>
        Bullets are ranked by matching job-description keywords. Positions below are within each
        bullet group. Every point keeps its original wording.
      </p>
      {edited !== result.updatedResume && (
        <p className="edit-note" role="status">
          This comparison shows the generated draft. Your manual edits are not included.
        </p>
      )}
      {groups.length ? (
        groups.map((group, i) => (
          <article className="change-group" key={i}>
            <h4>
              Bullet group {i + 1}
              {group.page ? ` · Page ${group.page}` : ''}
            </h4>
            <p>{group.description}</p>
            <ul className="moved-points">
              {group.points
                .filter((point) => point.moved)
                .map((point) => (
                  <li key={point.to}>
                    <span className="move-badge">
                      Point {point.from} → {point.to}
                    </span>
                    <span>{point.text.replace(/^\s*[-•*]\s+/, '')}</span>
                    <small>
                      {point.to < point.from ? 'Moved up' : 'Moved down'} · wording unchanged
                    </small>
                  </li>
                ))}
            </ul>
            <details>
              <summary>Compare all points in this group</summary>
              <div className="change-columns">
                <div>
                  <h4>Original order</h4>
                  <ol>
                    {group.points
                      .slice()
                      .sort((a, b) => a.from - b.from)
                      .map((point) => (
                        <li className={point.moved ? 'point-changed' : ''} key={point.from}>
                          {point.text.replace(/^\s*[-•*]\s+/, '')}
                        </li>
                      ))}
                  </ol>
                </div>
                <div>
                  <h4>Tailored order</h4>
                  <ol>
                    {group.points.map((point) => (
                      <li className={point.moved ? 'point-changed' : ''} key={point.to}>
                        {point.text.replace(/^\s*[-•*]\s+/, '')}
                        {point.moved && <small>Originally point {point.from}</small>}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </details>
          </article>
        ))
      ) : (
        <div className="no-changes">No points were moved. Your original bullet order was kept.</div>
      )}
    </section>
  );
}
function GapSuggestions({ suggestions, onAdd, disabled }) {
  const [term, setTerm] = useState('');
  const [point, setPoint] = useState('');
  const [line, setLine] = useState('1');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="card editor-card">
      <h3>Strengthen your resume with real experience</h3>
      <p>
        Missing from the resume does not always mean missing experience. Choose a JD skill, describe
        work you actually did, and insert it before the appropriate line in the editor. These are
        prompts, not AI-generated claims.
      </p>
      <label>
        JD skill{' '}
        <select
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">Choose a missing skill</option>
          {suggestions.map((item) => (
            <option key={item.term} value={item.term}>
              {item.term}
            </option>
          ))}
        </select>
      </label>
      {term && <p>{suggestions.find((item) => item.term === term)?.prompt}</p>}
      <textarea
        aria-label="New experience point"
        placeholder="Describe your actual contribution, tools used and outcome. Avoid invented metrics."
        maxLength={2000}
        value={point}
        onChange={(e) => {
          setPoint(e.target.value);
          setConfirmed(false);
        }}
      />
      <label>
        Insert before line{' '}
        <input type="number" min="1" value={line} onChange={(e) => setLine(e.target.value)} />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{' '}
        I have this experience and can support this point.
      </label>
      <button
        disabled={disabled || !term || !point.trim() || !confirmed}
        onClick={() => {
          onAdd(point, Number(line));
          setPoint('');
          setConfirmed(false);
        }}
      >
        Add point to resume
      </button>
    </section>
  );
}
const wizardSteps = [
  'Upload & tailor',
  'Match score',
  'AI & edit',
  'Compare',
  'Pay ₹1',
  'Download',
];

function DraftComparison({ original, draft }) {
  const before = new Set(original.split('\n'));
  const after = new Set(draft.split('\n'));
  return (
    <div className="draft-comparison">
      {[
        { title: 'Original resume', text: original, other: after, kind: 'removed' },
        { title: 'Your final draft', text: draft, other: before, kind: 'added' },
      ].map((side) => (
        <section className="card comparison-side" key={side.title} aria-label={side.title}>
          <h3>{side.title}</h3>
          <div className="comparison-text">
            {side.text.split('\n').map((line, i) => (
              <div key={i} className={line.trim() && !side.other.has(line) ? side.kind : ''}>
                <span className="line-number" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{line || ' '}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function App() {
  const [resume, setResume] = useState('');
  const [jd, setJd] = useState('');
  const [label, setLabel] = useState('');
  const [save, setSave] = useState(false);
  const [result, setResult] = useState(null);
  const [originalText, setOriginalText] = useState('');
  const [edited, setEdited] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('workspace');
  const [history, setHistory] = useState([]);
  const [step, setStep] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [format, setFormat] = useState('pdf');
  const [purchase, setPurchase] = useState(null);
  const [payment, setPayment] = useState(null);
  const [sourcePdf, setSourcePdf] = useState(null);
  const [pdfResult, setPdfResult] = useState(null);
  const [preview, setPreview] = useState([]);
  const [aiRequest, setAiRequest] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const locked = !!busy || aiBusy;
  const lastStep = purchase ? 6 : reviewed ? 5 : result ? 4 : 1;

  useEffect(() => {
    paymentConfig()
      .then(setPayment)
      .catch(() => setPayment({ configured: false }));
  }, []);
  const refresh = () =>
    api('/api/history')
      .then(setHistory)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (view === 'workspace') {
      document.getElementById('step-title')?.focus({ preventScroll: true });
      document.querySelector('.wizard-nav')?.scrollIntoView({ block: 'start' });
    }
  }, [step, view]);
  function go(next) {
    setError('');
    setNotice('');
    setStep(next);
  }
  async function perform(name, fn) {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  function invalidatePurchase() {
    setReviewed(false);
    setPurchase(null);
    setDownloaded(false);
  }
  function updateDraft(text) {
    setEdited(text);
    setPreview([]);
    invalidatePurchase();
  }
  function setInput(which, value) {
    if (which === 'resume') {
      setResume(value);
      setSourcePdf(null);
    } else setJd(value);
    setResult(null);
    setPdfResult(null);
    setPreview([]);
    setAiRequest(0);
    invalidatePurchase();
  }
  async function upload(e, which) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await perform('Reading file', async () => {
      const data = new FormData();
      data.append('file', file);
      const output = await api('/api/extract', { method: 'POST', body: data });
      setInput(which, output.text);
      if (which === 'resume' && output.originalLayout) setSourcePdf(file);
      setNotice(
        output.originalLayout && which === 'resume'
          ? 'PDF attached. Your original design will be used for the final PDF.'
          : 'File imported.',
      );
    });
  }
  async function fetchPreview(context, text) {
    const form = new FormData();
    form.append('file', context.file);
    form.append('jd', context.jd);
    form.append('text', text);
    return api('/api/preview-original', { method: 'POST', body: form });
  }
  async function generate(e) {
    e.preventDefault();
    await perform('Tailoring resume', async () => {
      let data;
      if (sourcePdf) {
        const form = new FormData();
        form.append('file', sourcePdf);
        form.append('jd', jd);
        form.append('label', label || 'Untitled application');
        form.append('save', String(save));
        data = await api('/api/tailor-pdf', { method: 'POST', body: form });
        setPdfResult({ file: sourcePdf, jd });
      } else {
        data = await api('/api/tailor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume, jd, label: label || 'Untitled application', save }),
        });
        setPdfResult(null);
      }
      setOriginalText(resume);
      setResult(data);
      setEdited(data.updatedResume);
      setPreview([]);
      setAiRequest(0);
      invalidatePurchase();
      setStep(2);
      if (save) await refresh();
    });
  }
  async function pay() {
    await perform('Preparing your final file', async () => {
      const original = format === 'pdf' && pdfResult;
      if (format === 'pdf' && result?.layoutMode && !pdfResult)
        throw Error(
          'Re-upload the original PDF in Step 1 to preserve its design, or choose TXT / DOCX.',
        );
      setPayment(await paymentConfig());
      const paid = await payForResume(
        {
          text: edited,
          format,
          mode: original
            ? edited === result.updatedResume
              ? 'original'
              : 'edited-original'
            : 'rebuilt',
          jd: original ? pdfResult.jd : '',
          layoutMode: false,
        },
        original ? pdfResult.file : null,
        setBusy,
      );
      setPurchase(paid);
      setDownloaded(false);
      setStep(6);
      setNotice('Payment confirmed. Your purchased file is ready to download.');
    });
  }
  async function recover() {
    await perform('Checking your previous payment', async () => {
      const paid = await recoverPayment(setBusy);
      setPurchase(paid);
      setDownloaded(false);
      setView('workspace');
      setStep(6);
      setNotice('Recovered your previously purchased file. It may differ from your current draft.');
    });
  }
  async function download() {
    await perform('Downloading your resume', async () => {
      await downloadPurchased(purchase, setBusy);
      setDownloaded(true);
      setNotice(
        'Download started. You can download this same purchased file again without paying.',
      );
    });
  }
  async function openHistory(item) {
    await perform('Loading saved draft', async () => {
      const data = await api('/api/history/' + item.id);
      setResult(data);
      setEdited(data.updatedResume);
      setOriginalText('');
      setResume('');
      setJd('');
      setLabel(item.label);
      setSourcePdf(null);
      setPdfResult(null);
      setPreview([]);
      setAiRequest(0);
      invalidatePurchase();
      setView('workspace');
      setStep(3);
      setNotice(
        'Saved draft loaded. Paste its job description below to use AI. The original resume is not stored with this draft.',
      );
    });
  }
  const headings = [
    [
      'Add your resume and job description',
      'Upload files or paste text, then tailor your resume to the role.',
    ],
    [
      'See how your resume matches',
      'Review the recognized job keywords before improving your draft.',
    ],
    [
      'Make your resume stronger',
      'Generate suggestions with AI, review them, and edit your final wording.',
    ],
    [
      'Compare before you continue',
      'Review your original resume beside the latest draft, including AI and manual edits.',
    ],
    [
      'Choose your file and pay ₹1',
      'Your exact file is prepared before checkout. Payment unlocks that file.',
    ],
    [
      'Your resume is ready',
      'Download your purchased file. Repeating this download does not cost extra.',
    ],
  ];
  return (
    <div className="app">
      <aside>
        <a className="brand" href="/">
          ▧{' '}
          <span>
            ResumeFit<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="nav-caption">YOUR APPLICATION TOOLKIT</div>
        <nav aria-label="Workspace navigation">
          <button
            disabled={locked}
            className={view === 'workspace' ? 'selected' : ''}
            onClick={() => setView('workspace')}
          >
            ▦ Resume workspace
          </button>
          <button
            disabled={locked}
            className={view === 'history' ? 'selected' : ''}
            onClick={() => {
              setView('history');
              refresh();
            }}
          >
            ◷ Saved applications <small>{history.length}</small>
          </button>
        </nav>
        <div className="aside-note">
          <div className="shield">◇</div>
          <strong>Your experience. Better aligned.</strong>
          <p>Six simple steps. Review every change. Keep your story true.</p>
          <span className="local-dot">●</span> Editing and previews are free
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span>{' '}
            {view === 'workspace' ? 'Tailor your resume' : 'Saved applications'}
          </span>
          <span className="private">Review. Refine. Apply.</span>
        </header>
        <div className="content wizard-content">
          <div className="eyebrow">YOUR NEXT OPPORTUNITY STARTS HERE</div>
          <div className="title-row">
            <div>
              <h1>
                {view === 'workspace'
                  ? 'A better resume, step by step.'
                  : 'Your saved applications.'}
              </h1>
              <p className="subtitle">
                {view === 'workspace'
                  ? 'From your first upload to your final download, one clear step at a time.'
                  : 'Pick up a saved draft and continue editing.'}
              </p>
            </div>
          </div>
          {view === 'workspace' && (
            <>
              <nav className="wizard-nav" aria-label="Resume steps">
                <ol>
                  {wizardSteps.map((name, i) => (
                    <li key={name}>
                      <button
                        type="button"
                        aria-current={step === i + 1 ? 'step' : undefined}
                        aria-label={`Step ${i + 1}: ${name}`}
                        disabled={locked || i + 1 > lastStep || (!result && i > 0 && i < 5)}
                        className={step === i + 1 ? 'active' : step > i + 1 ? 'complete' : ''}
                        onClick={() => go(i + 1)}
                      >
                        <span className="step-circle">{i + 1}</span>
                        <span>{name}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="step-heading">
                <span className="step-kicker">STEP {step} OF 6</span>
                <h2 id="step-title" tabIndex={-1}>
                  {headings[step - 1][0]}
                </h2>
                <p>{headings[step - 1][1]}</p>
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {busy && (
            <div role="status" className="notice">
              {busy}…
            </div>
          )}
          {payment?.demoMode && (
            <div className="notice">
              <strong>Demo mode</strong>
              <p>Real payments are disabled. Saved files may disappear when the demo restarts.</p>
            </div>
          )}
          {view === 'history' ? (
            <section className="card history">
              <h2>Saved applications</h2>
              <p>
                History belongs to this browser on the hosted app. Saved drafts do not include the
                source PDF or original job description.
              </p>
              {!history.length ? (
                <div className="empty">
                  No saved applications yet. Select “Save this result” in Step 1.
                </div>
              ) : (
                history.map((item) => (
                  <div className="history-row" key={item.id}>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{new Date(item.created).toLocaleString()}</p>
                    </div>
                    <button disabled={locked} onClick={() => openHistory(item)}>
                      Open draft
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        perform('Deleting draft', async () => {
                          await api('/api/history/' + item.id, { method: 'DELETE' });
                          await refresh();
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </section>
          ) : (
            <>
              <div hidden={step !== 1}>
                <form onSubmit={generate}>
                  <div className="input-grid">
                    {[
                      {
                        which: 'resume',
                        title: 'Your resume',
                        desc: 'Start with the experience you already have.',
                        value: resume,
                      },
                      {
                        which: 'jd',
                        title: 'The job description',
                        desc: 'Add the requirements for your next role.',
                        value: jd,
                      },
                    ].map((item, i) => (
                      <section className="card input-card" key={item.which}>
                        <div className="card-heading">
                          <span className="number">0{i + 1}</span>
                          <div>
                            <h2>{item.title}</h2>
                            <p>{item.desc}</p>
                          </div>
                        </div>
                        <label className="upload">
                          <span className="upload-icon">↥</span>
                          <strong>Choose a file</strong>
                          <span>PDF, DOCX or TXT · up to 5 MB</span>
                          <input
                            aria-label={'Upload ' + item.title}
                            disabled={!!busy}
                            type="file"
                            accept=".pdf,.docx,.txt"
                            onChange={(e) => upload(e, item.which)}
                          />
                        </label>
                        <div className="text-label">
                          <label htmlFor={item.which}>
                            {item.which === 'resume' && sourcePdf
                              ? 'Extracted text · original PDF attached'
                              : 'Or paste the text below'}
                          </label>
                          <span>{item.value.length.toLocaleString()} / 60,000</span>
                        </div>
                        <textarea
                          id={item.which}
                          required
                          minLength={20}
                          maxLength={60000}
                          value={item.value}
                          readOnly={item.which === 'resume' && !!sourcePdf}
                          disabled={!!busy}
                          onChange={(e) => setInput(item.which, e.target.value)}
                          placeholder={
                            item.which === 'resume'
                              ? 'Your name, experience, projects, skills and education…'
                              : 'Job title, responsibilities, required skills and qualifications…'
                          }
                        />
                      </section>
                    ))}
                  </div>
                  {sourcePdf && (
                    <div className="layout-banner">
                      <strong>Original PDF layout ready</strong>
                      <span>
                        {sourcePdf.name} · fonts, colors and spacing come from your file. Source
                        text is locked to keep the original design attached. Upload another file to
                        replace it.
                      </span>
                    </div>
                  )}
                  <div className="action-card">
                    <div>
                      <label className="app-label" htmlFor="label">
                        Application name <span>(optional)</span>
                      </label>
                      <input
                        id="label"
                        className="label-input"
                        value={label}
                        maxLength={100}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="e.g. Acme · Full Stack Developer"
                      />
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={save}
                          onChange={(e) => setSave(e.target.checked)}
                        />{' '}
                        Save this result
                      </label>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        disabled={!!busy}
                        className="secondary"
                        onClick={() => {
                          setSourcePdf(null);
                          setPdfResult(null);
                          setPreview([]);
                          setResume(sampleResume);
                          setJd(sampleJD);
                          setLabel('Example Company · Full Stack Developer');
                          setResult(null);
                          setPurchase(null);
                          setReviewed(false);
                        }}
                      >
                        Try sample data
                      </button>
                      <button
                        className="primary"
                        disabled={!!busy || resume.trim().length < 20 || jd.trim().length < 20}
                      >
                        {busy || 'Tailor my resume'} <span>↗</span>
                      </button>
                    </div>
                  </div>
                  <p className="privacy-note">
                    ◇ Prepared downloads and payment records are stored on this server. Resume
                    content is not sent to Razorpay. Optional AI improvements send your draft and
                    job description to your configured AI provider only when you click Generate AI
                    improvements.
                  </p>
                </form>
              </div>
              {result && (
                <>
                  <section hidden={step !== 2} aria-label="Match score">
                    <div className="analysis-grid">
                      <div className="card metric">
                        <span>Original resume match</span>
                        <strong>
                          {result.score === null ? 'N/A' : result.score + '%'}
                          <small>
                            {result.matched.length} of {result.keywords.length} recognized keywords
                          </small>
                        </strong>
                        <progress
                          aria-label="Job keyword match"
                          max="100"
                          value={result.score || 0}
                        />
                        {result.score !== null && (
                          <p className="unmatched">
                            {100 - result.score}% of recognized JD keywords are not mentioned.
                          </p>
                        )}
                        <p>
                          {result.score === null
                            ? 'No supported keywords found. Compare this job manually.'
                            : result.method}
                        </p>
                        <p>
                          Reordering does not increase keyword coverage. This is not an ATS score or
                          a selection probability.
                        </p>
                      </div>
                      <div className="card keyword-card">
                        <h3>
                          Already in your resume <span>{result.matched.length}</span>
                        </h3>
                        <div className="chips">
                          {result.matched.map((k) => (
                            <span key={k}>{k}</span>
                          ))}
                          {!result.matched.length && <p>No recognized overlap.</p>}
                        </div>
                        <h3>
                          Not mentioned <span>{result.missing.length}</span>
                        </h3>
                        <div className="chips missing">
                          {result.missing.map((k) => (
                            <span key={k}>{k}</span>
                          ))}
                          {!result.missing.length && <p>No recognized keyword gaps.</p>}
                        </div>
                        <p>
                          Add a missing skill only if you actually have it. Required and preferred
                          skills are not distinguished by this metric.
                        </p>
                      </div>
                    </div>

                    <div className="step-actions">
                      <button disabled={locked} onClick={() => go(1)}>
                        ← Back
                      </button>
                      <div className="actions">
                        <button disabled={locked} onClick={() => go(3)}>
                          Continue with manual editing
                        </button>
                        <button
                          className="primary"
                          disabled={locked || jd.trim().length < 20}
                          onClick={() => {
                            go(3);
                            setAiRequest((value) => value + 1);
                          }}
                        >
                          Generate with AI →
                        </button>
                      </div>
                    </div>
                  </section>
                  <section hidden={step !== 3} aria-label="Edit tailored resume">
                    {!originalText && (
                      <div className="card">
                        <label htmlFor="saved-jd">Job description for this saved draft</label>
                        <textarea
                          id="saved-jd"
                          value={jd}
                          maxLength={60000}
                          onChange={(e) => setJd(e.target.value)}
                          placeholder="Paste the job description to use AI improvements."
                        />
                      </div>
                    )}
                    <Enhancements
                      key={result.updatedResume}
                      draft={edited}
                      jd={jd}
                      disabled={!!busy || jd.trim().length < 20}
                      requestId={aiRequest}
                      onBusyChange={setAiBusy}
                      onApply={updateDraft}
                    />
                    <section className="card editor-card">
                      <div className="editor-header">
                        <div>
                          <h3>Your tailored resume</h3>
                          <p>Edit the text below. Every applied AI suggestion appears here.</p>
                        </div>
                        <button disabled={locked} onClick={() => updateDraft(result.updatedResume)}>
                          Restore tailored draft
                        </button>
                      </div>
                      <label className="sr-only" htmlFor="resume-editor">
                        Tailored resume editor
                      </label>
                      <textarea
                        id="resume-editor"
                        aria-label="Tailored resume editor"
                        disabled={locked}
                        maxLength={60000}
                        value={edited}
                        onChange={(e) => updateDraft(e.target.value)}
                      />
                      <p className="privacy-note">
                        {pdfResult
                          ? 'Your original PDF design is attached. Review the PDF preview in the next step after editing.'
                          : 'Pasted text and Word files use a clean rebuilt layout.'}
                      </p>
                      <button
                        disabled={locked || !edited.trim() || jd.trim().length < 20}
                        onClick={() =>
                          perform('Saving edited draft', async () => {
                            await api('/api/drafts', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ text: edited, jd, label }),
                            });
                            await refresh();
                            setNotice('Edited draft saved.');
                          })
                        }
                      >
                        Save edited draft
                      </button>
                    </section>
                    <details className="extra-help">
                      <summary>Add missing experience yourself</summary>
                      <GapSuggestions
                        suggestions={result.suggestions || []}
                        disabled={locked}
                        onAdd={(point, line) => {
                          const lines = edited.split('\n');
                          lines.splice(
                            Math.max(
                              0,
                              Math.min(lines.length, (Number.isFinite(line) ? line : 1) - 1),
                            ),
                            0,
                            '- ' +
                              point
                                .trim()
                                .replace(/^[-•*]\s+/, '')
                                .replace(/\n+/g, ' '),
                          );
                          const text = lines.join('\n');
                          if (text.length > 60000) {
                            setError('Resume must stay under 60,000 characters.');
                            return;
                          }
                          updateDraft(text);
                        }}
                      />
                    </details>
                    <div className="step-actions">
                      <button disabled={locked} onClick={() => go(2)}>
                        ← Back to match
                      </button>
                      <button
                        className="primary"
                        disabled={locked || !edited.trim()}
                        onClick={() => go(4)}
                      >
                        Compare resumes →
                      </button>
                    </div>
                  </section>
                  <section hidden={step !== 4} aria-label="Compare resumes">
                    {originalText ? (
                      <>
                        <p className="comparison-legend">
                          <span>Removed or reworded lines</span>
                          <span>New or reworded lines</span> · Reordered lines keep their original
                          color.
                        </p>
                        <DraftComparison original={originalText} draft={edited} />
                      </>
                    ) : (
                      <div className="notice">
                        The original resume is not available for this saved draft. Review the
                        current draft below, or upload the original in Step 1 for a full comparison.
                      </div>
                    )}
                    {!originalText && (
                      <div className="card">
                        <pre className="plain-resume">{edited}</pre>
                      </div>
                    )}
                    <details className="extra-help">
                      <summary>See which points were reordered during tailoring</summary>
                      <ResumeChanges result={result} edited={edited} />
                    </details>
                    {pdfResult && (
                      <section className="card layout-card">
                        <h3>Check your original PDF design</h3>
                        <p>Preview your current edited draft before paying.</p>
                        <button
                          disabled={locked}
                          onClick={() =>
                            perform('Preparing PDF comparison', async () => {
                              setPreview((await fetchPreview(pdfResult, edited)).pages);
                            })
                          }
                        >
                          {preview.length ? 'Refresh PDF preview' : 'Preview final PDF'}
                        </button>
                        {!!preview.length && (
                          <div className="pdf-preview">
                            {preview.map((page, i) => (
                              <figure key={i}>
                                <figcaption>
                                  Page {i + 1} of {preview.length}
                                </figcaption>
                                <div className="pdf-comparison">
                                  {page.originalImage && (
                                    <div>
                                      <strong>Original resume</strong>
                                      <img
                                        alt={`Original PDF page ${i + 1}`}
                                        src={`data:image/png;base64,${page.originalImage}`}
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <strong>Final resume</strong>
                                    <img
                                      alt={`Final PDF page ${i + 1}`}
                                      src={`data:image/png;base64,${page.image}`}
                                    />
                                  </div>
                                </div>
                              </figure>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                    <label className="checkbox review-check">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      I have reviewed the final draft and confirm that it accurately describes my
                      experience.
                    </label>
                    <div className="step-actions">
                      <button disabled={locked} onClick={() => go(3)}>
                        ← Back to editing
                      </button>
                      <button
                        className="primary"
                        disabled={locked || !reviewed || !edited.trim()}
                        onClick={() => go(5)}
                      >
                        Continue to payment →
                      </button>
                    </div>
                  </section>
                  <section hidden={step !== 5} aria-label="Payment">
                    <div className="card checkout-card">
                      <div>
                        <div className="eyebrow">YOUR FINAL RESUME</div>
                        <h3>{label || 'Tailored resume'}</h3>
                        <p>Select the format you want to purchase.</p>
                        <div className="format-options">
                          {['pdf', 'docx', 'txt'].map((value) => (
                            <label className={format === value ? 'chosen' : ''} key={value}>
                              <input
                                type="radio"
                                name="format"
                                value={value}
                                checked={format === value}
                                disabled={
                                  locked || (value === 'pdf' && !!result.layoutMode && !pdfResult)
                                }
                                onChange={() => {
                                  setFormat(value);
                                  setPurchase(null);
                                }}
                              />
                              <strong>{value.toUpperCase()}</strong>
                              <span>
                                {value === 'pdf'
                                  ? pdfResult
                                    ? 'Your original design'
                                    : 'Clean rebuilt layout'
                                  : value === 'docx'
                                    ? 'Editable Word document'
                                    : 'Plain text'}
                              </span>
                            </label>
                          ))}
                        </div>
                        {result.layoutMode && !pdfResult && (
                          <p>
                            Re-upload the source PDF in Step 1 to unlock its original design. DOCX
                            and TXT are available as rebuilt files.
                          </p>
                        )}
                        <p>
                          Each payment unlocks one exact file in your chosen format. Download it
                          again in this browser session without another charge.
                        </p>
                      </div>
                      <div className="payment-total">
                        <span>One-time payment</span>
                        <strong>₹1</strong>
                        <span>Secure checkout with Razorpay</span>
                      </div>
                    </div>
                    {payment?.testMode && (
                      <div className="notice">Razorpay test mode: no real money is charged.</div>
                    )}
                    {payment?.configured &&
                      !payment.testMode &&
                      payment.checkoutAllowed !== false && (
                        <div className="notice">
                          Razorpay Live Mode: this checkout charges real money.
                        </div>
                      )}
                    {payment?.blockedReason && (
                      <div className="alert" role="status">
                        {payment.blockedReason}
                      </div>
                    )}
                    {payment && !payment.configured && (
                      <div className="alert" role="status">
                        Payments are not configured on this server yet. Your draft is safe; editing
                        and previews remain available.
                      </div>
                    )}
                    <div className="step-actions">
                      <button disabled={locked} onClick={() => go(4)}>
                        ← Back to comparison
                      </button>
                      <button
                        className="primary"
                        disabled={
                          locked ||
                          !reviewed ||
                          !payment?.configured ||
                          payment?.checkoutAllowed === false ||
                          (format === 'pdf' && !!result.layoutMode && !pdfResult)
                        }
                        onClick={purchase ? () => go(6) : pay}
                      >
                        {purchase ? 'Continue to download →' : 'Pay ₹1 securely →'}
                      </button>
                    </div>
                  </section>
                </>
              )}
              <section hidden={step !== 6} aria-label="Download resume">
                {purchase && (
                  <div className="card download-card">
                    <span className="success-mark" aria-hidden="true">
                      ✓
                    </span>
                    <div className="eyebrow">PAYMENT VERIFIED</div>
                    <h3>
                      {downloaded
                        ? 'Ready for your next opportunity.'
                        : 'Your final file is ready.'}
                    </h3>
                    <p>{purchase.filename}</p>
                    <p>Payment confirmed · ₹{(purchase.amount / 100).toFixed(0)}</p>
                    <button className="primary" disabled={locked} onClick={download}>
                      {downloaded ? 'Download again' : 'Download resume'} ↓
                    </button>
                    <p className="privacy-note">
                      This downloads the exact file prepared before payment. Further edits or
                      another format require a separate purchase.
                    </p>
                  </div>
                )}
                <div className="step-actions">
                  <button disabled={locked || !result} onClick={() => go(4)}>
                    ← Back to comparison
                  </button>
                  <button disabled={locked} onClick={() => go(1)}>
                    Tailor another resume
                  </button>
                </div>
              </section>
              {savedPurchase() && (
                <div className="recovery-bar">
                  <span>Already paid or interrupted checkout?</span>
                  <button disabled={locked} onClick={recover}>
                    Recover previous purchase
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            ResumeFit <span>Your experience stays yours. Download one file for ₹1.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
