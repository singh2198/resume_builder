import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import Enhancements from './Enhancements.jsx';
import { paidDownload, recoverDownload, savedPurchase, paymentConfig } from './payments.js';
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
    return { text, from: original + 1, to: index + 1, moved: original >= 0 && original !== index };
  });
}
function ResumeChanges({ result, edited }) {
  const groups = result.changes.map((change) => ({ ...change, points: bulletComparison(change) }));
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
function App() {
  const [resume, setResume] = useState(''),
    [jd, setJd] = useState(''),
    [label, setLabel] = useState(''),
    [save, setSave] = useState(false),
    [result, setResult] = useState(null),
    [edited, setEdited] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [history, setHistory] = useState([]),
    [view, setView] = useState('workspace'),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [finalReady, setFinalReady] = useState(false);
  const [payment, setPayment] = useState(null);
  useEffect(() => {
    paymentConfig()
      .then(setPayment)
      .catch(() => setPayment({ configured: false }));
  }, []);
  useEffect(() => {
    setFinalReady(false);
  }, [edited, result]);
  function finishEditing() {
    if (!edited.trim()) {
      setError('Add resume text before finishing.');
      return;
    }
    setEditing(false);
    setFinalReady(true);
    setNotice('Your draft is ready. Download costs ₹1; the file is prepared before payment.');
    setTimeout(
      () => document.getElementById('final-resume')?.scrollIntoView({ behavior: 'smooth' }),
      50,
    );
  }
  const [sourcePdf, setSourcePdf] = useState(null),
    [pdfResult, setPdfResult] = useState(null),
    [preview, setPreview] = useState([]);
  const refresh = () =>
    api('/api/history')
      .then(setHistory)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
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
  function setInput(which, value) {
    if (which === 'resume') {
      setResume(value);
      setSourcePdf(null);
    } else setJd(value);
    setResult(null);
    setPdfResult(null);
    setPreview([]);
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
        output.originalLayout
          ? 'PDF imported in visual reading order. Original-layout export keeps its fonts, colors, spacing and page size.'
          : 'File imported. DOCX/TXT inputs use rebuilt exports.',
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
      setPreview([]);
      setResult(data);
      setEdited(data.updatedResume);
      if (sourcePdf) {
        try {
          setPreview((await fetchPreview({ file: sourcePdf, jd }, data.updatedResume)).pages);
        } catch (e) {
          setNotice('Your original-layout PDF is ready. Preview could not load: ' + e.message);
        }
      }
      if (save) await refresh();
      setTimeout(
        () => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }),
        50,
      );
    });
  }
  async function download(format) {
    if (format === 'pdf' && result?.layoutMode && !pdfResult && edited === result.updatedResume) {
      setError(
        'Re-upload your original PDF to download this saved draft with its original formatting.',
      );
      return;
    }
    await perform('Preparing download', async () => {
      const original = format === 'pdf' && pdfResult;
      await paidDownload(
        {
          text: edited,
          format,
          mode: original
            ? edited === result.updatedResume
              ? 'original'
              : 'edited-original'
            : 'rebuilt',
          jd: original ? pdfResult.jd : '',
          layoutMode: !original && !!result?.layoutMode && edited === result.updatedResume,
        },
        original ? pdfResult.file : null,
        setBusy,
      );
      setNotice(
        'Payment confirmed. Your download is ready. You can retry this file without paying again.',
      );
    });
  }
  async function originalPDF(action) {
    if (action === 'download') return download('pdf');
    await perform('Preparing original-layout preview', async () => {
      setPreview((await fetchPreview(pdfResult, edited)).pages);
    });
  }
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
        <nav>
          <button
            className={view === 'workspace' ? 'selected' : ''}
            onClick={() => setView('workspace')}
          >
            ▦ <span>Resume workspace</span>
          </button>
          <button
            className={view === 'history' ? 'selected' : ''}
            onClick={() => {
              setView('history');
              refresh();
            }}
          >
            ◷ <span>Saved applications</span>
            <small>{history.length}</small>
          </button>
        </nav>
        <div className="aside-note">
          <div className="shield">◇</div>
          <strong>Your experience. Better aligned.</strong>
          <p>Relevant details first. Original facts preserved. You stay in control.</p>
          <span className="local-dot">●</span> Your resume workspace
        </div>
        <div className="aside-bottom">
          REACT + NODE.JS <span>v1.0</span>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span>{' '}
            {view === 'workspace' ? 'Tailor your resume' : 'Saved applications'}
          </span>
          <span className="private">◉ Private by default</span>
        </header>
        <div className="content">
          <div className="eyebrow">MAKE YOUR EXPERIENCE COUNT</div>
          <div className="title-row">
            <div>
              <h1>
                {view === 'workspace'
                  ? 'The right experience.\nIn the right order.'
                  : 'Your next opportunity,\norganized.'}
              </h1>
              <p className="subtitle">
                {view === 'workspace'
                  ? 'Connect your resume to the role you want, without changing your story.'
                  : 'Revisit your saved resume drafts and download them again.'}
              </p>
            </div>
            <span className="version">
              FACT-FIRST
              <br />
              <b>Resume tailoring</b>
            </span>
          </div>
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
          <section className="notice" aria-label="Download payment">
            <strong>Resume downloads · ₹1 per file</strong>
            <p>
              Editing and previewing are free. Pay securely with Razorpay before downloading.
              Retrying the same purchased file is free.
            </p>
            {payment?.testMode && (
              <p>Test mode: payments are simulated; no real money is charged.</p>
            )}
            {payment && !payment.configured && (
              <p>Downloads will be available once Razorpay is configured.</p>
            )}
            {savedPurchase() && (
              <button
                disabled={!!busy}
                onClick={() =>
                  perform('Recovering download', async () => {
                    await recoverDownload(setBusy);
                    setNotice(
                      'Your download is ready. A confirmed payment is never charged again.',
                    );
                  })
                }
              >
                Recover last download
              </button>
            )}
          </section>
          {view === 'history' ? (
            <section className="card history">
              <h2>Saved applications</h2>
              <p>
                Saved on this server. On the public app, history belongs to this browser for up to
                30 days. Clearing cookies or changing devices loses access. Deleting an entry
                permanently removes its stored draft.
              </p>
              {history.length === 0 ? (
                <div className="empty">
                  No saved applications yet. Turn on “Save this result” when tailoring a resume.
                </div>
              ) : (
                history.map((item) => (
                  <div className="history-row" key={item.id}>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{new Date(item.created).toLocaleString()}</p>
                    </div>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        perform('Loading draft', async () => {
                          const data = await api('/api/history/' + item.id);
                          setResult(data);
                          setEdited(data.updatedResume);
                          setPdfResult(null);
                          setPreview([]);
                          setView('workspace');
                          setNotice(
                            'Loaded a saved draft. Its analysis belongs to the saved version.',
                          );
                        })
                      }
                    >
                      Open draft
                    </button>
                    <button
                      disabled={!!busy}
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
              <form onSubmit={generate}>
                <div className="steps">
                  <span>
                    <b>01</b> Add your details
                  </span>
                  <span>
                    <b>02</b> Review the match
                  </span>
                  <span>
                    <b>03</b> Export your resume
                  </span>
                </div>
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
                      {sourcePdf.name} · fonts, colors and spacing come from your file. Source text
                      is locked to keep the original design attached. Upload another file to replace
                      it.
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
                  ◇ Prepared downloads and payment records are stored on this server. Resume content
                  is not sent to Razorpay. Optional AI improvements send your draft and job
                  description to OpenAI only when you click Generate AI improvements.
                </p>
              </form>
              {result && (
                <section id="results" className="results">
                  <div className="results-heading">
                    <div className="eyebrow">YOUR APPLICATION, REFINED</div>
                    <h2>Review before you send.</h2>
                    <p>
                      Review the prioritized draft, generate stronger wording and new points from
                      real experience, then edit before exporting.
                    </p>
                  </div>
                  <div className="analysis-grid">
                    <div className="card metric">
                      <span>JD keyword coverage</span>
                      <strong>
                        {result.score === null ? 'N/A' : result.score + '%'}
                        <small>
                          {result.matched.length} of {result.keywords.length} recognized keywords
                        </small>
                      </strong>
                      <progress max="100" value={result.score || 0} />
                      <p>
                        {result.score === null
                          ? 'No supported keywords found. Compare this job manually.'
                          : result.method}
                      </p>
                      <p>
                        Reordering does not increase keyword coverage. This is not an ATS score or a
                        selection probability.
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
                  <ResumeChanges result={result} edited={edited} />
                  <Enhancements
                    key={result.updatedResume}
                    draft={edited}
                    jd={jd}
                    disabled={!!busy}
                    onApply={(text) => {
                      setEdited(text);
                      setEditing(true);
                      setPreview([]);
                      setNotice(
                        'Improvement applied. Review the editor and final PDF layout before sending.',
                      );
                    }}
                  />
                  <GapSuggestions
                    suggestions={result.suggestions || []}
                    disabled={!!busy}
                    onAdd={(point, line) => {
                      const lines = edited.split('\n');
                      const index = Math.max(
                        0,
                        Math.min(lines.length, (Number.isFinite(line) ? line : 1) - 1),
                      );
                      lines.splice(
                        index,
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
                      setEdited(text);
                      setEditing(true);
                      setPreview([]);
                      setNotice(
                        'Point added. Review its placement in the editor before exporting.',
                      );
                    }}
                  />
                  <div className="card layout-card">
                    <h3>{pdfResult ? 'Your tailored PDF · original design' : 'Rebuilt exports'}</h3>
                    {pdfResult ? (
                      <>
                        <p>
                          The PDF retains your original typography, margins, bullets and page count.
                          Only safely detected bullet groups move within their section. This preview
                          is the exported PDF, not the plain-text editor below.
                        </p>
                        <div className="layout-actions">
                          <button
                            disabled={!!busy || edited !== result.updatedResume}
                            onClick={() => originalPDF('preview')}
                          >
                            Preview original layout
                          </button>
                          <button
                            className="primary"
                            disabled={!!busy}
                            onClick={() => originalPDF('download')}
                          >
                            Pay ₹1 & download PDF ↓
                          </button>
                          {edited !== result.updatedResume && (
                            <button
                              onClick={() => {
                                setEdited(result.updatedResume);
                                setPreview([]);
                              }}
                            >
                              Restore generated draft
                            </button>
                          )}
                        </div>
                        {edited !== result.updatedResume && (
                          <p className="edit-note">
                            Choose Done editing to generate your original resume design with your
                            edited text.
                          </p>
                        )}
                        {preview.length > 0 && edited === result.updatedResume && (
                          <div
                            className="pdf-preview"
                            aria-label="Original-layout tailored PDF preview"
                          >
                            {preview.map((page, i) => (
                              <figure key={i}>
                                <figcaption>
                                  Page {i + 1} of {preview.length} · original dimensions and page
                                  count
                                </figcaption>
                                <div className="pdf-comparison">
                                  {page.originalImage && (
                                    <div>
                                      <strong>Original resume</strong>
                                      <img
                                        alt={`Original resume page ${i + 1}`}
                                        src={`data:image/png;base64,${page.originalImage}`}
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <strong>Tailored resume</strong>
                                    <img
                                      alt={`Tailored PDF page ${i + 1}`}
                                      src={`data:image/png;base64,${page.image}`}
                                    />
                                  </div>
                                </div>
                              </figure>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p>
                        {result.layoutMode
                          ? 'This saved draft does not include the original PDF. Re-upload the original PDF and job description to generate an original-layout download.'
                          : 'Upload your original PDF before tailoring to preserve its formatting. Pasted text and Word files use rebuilt exports.'}
                      </p>
                    )}
                  </div>
                  <div className="card editor-card">
                    <div className="editor-header">
                      <div>
                        <h3>Your tailored resume</h3>
                        <p>
                          {pdfResult
                            ? 'Edit your text, then choose Done editing to prepare the final PDF'
                            : 'Plain-text editor · original formatting requires the source PDF'}
                        </p>
                      </div>
                      <div className="export-buttons">
                        {(result.layoutMode && edited === result.updatedResume
                          ? ['txt']
                          : ['pdf', 'docx', 'txt']
                        ).map((format) => (
                          <button
                            key={format}
                            disabled={!!busy || !edited.trim()}
                            onClick={() => download(format)}
                          >
                            {format === 'pdf'
                              ? pdfResult
                                ? 'Original design PDF'
                                : 'Rebuilt PDF'
                              : format.toUpperCase()}{' '}
                            · ₹1 ↓
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="actions">
                      <button
                        disabled={!!busy}
                        onClick={() => {
                          if (editing) finishEditing();
                          else {
                            setFinalReady(false);
                            setEditing(true);
                          }
                        }}
                      >
                        {editing ? 'Done editing' : 'Edit resume'}
                      </button>
                      <button
                        disabled={!!busy || !edited.trim()}
                        onClick={() =>
                          perform('Saving edited draft', async () => {
                            await api('/api/drafts', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ text: edited, jd, label }),
                            });
                            await refresh();
                            setNotice('Edited draft saved locally.');
                          })
                        }
                      >
                        Save edited draft
                      </button>
                    </div>
                    {editing && (
                      <p>
                        Line numbers start at 1. New text keeps the source PDF design when attached;
                        review the downloaded document for page breaks and spacing.
                      </p>
                    )}
                    <textarea
                      aria-label="Tailored resume editor"
                      readOnly={!editing}
                      maxLength={60000}
                      value={edited}
                      onChange={(e) => setEdited(e.target.value)}
                    />
                    {edited !== result.updatedResume && (
                      <p className="edit-note">
                        Unsaved edits. Downloads include your edits; the analysis and saved history
                        describe the original generated draft.
                      </p>
                    )}
                    {finalReady && !editing && (
                      <section id="final-resume" aria-labelledby="final-resume-title">
                        <h3 id="final-resume-title">Your final resume is ready</h3>
                        <p>
                          Review your text above. Your PDF will be prepared before checkout and
                          released after the ₹1 payment is confirmed.
                        </p>
                        <button
                          className="primary"
                          disabled={!!busy}
                          onClick={() => download('pdf')}
                        >
                          Pay ₹1 & download final PDF ↓
                        </button>
                      </section>
                    )}
                    <details>
                      <summary>Evidence behind the keyword matches</summary>
                      {result.evidence.map((e) => (
                        <p key={e.term}>
                          <strong>{e.term}:</strong> {e.excerpt}
                        </p>
                      ))}
                    </details>
                  </div>
                </section>
              )}
              <div className="principles">
                <div>
                  <span>01 / HONEST</span>
                  <h3>Built on your real experience</h3>
                  <p>No invented metrics, skills or qualifications.</p>
                </div>
                <div>
                  <span>02 / READABLE</span>
                  <h3>Your design preserved</h3>
                  <p>PDF uploads retain their fonts, headings, spacing and page count.</p>
                </div>
                <div>
                  <span>03 / TRANSPARENT</span>
                  <h3>A clear view of your match</h3>
                  <p>See the keywords, evidence and every change.</p>
                </div>
              </div>
            </>
          )}
          <footer>
            ResumeFit{' '}
            <span>
              A stronger application starts with an honest story. Selection is never guaranteed.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
