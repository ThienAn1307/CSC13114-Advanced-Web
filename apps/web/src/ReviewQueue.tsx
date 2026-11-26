import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { request } from './api.js';

interface Evidence {
  line: number;
  text: string;
}
interface Proposal {
  id: string;
  submissionId: string;
  studentName?: string;
  labTitle: string;
  constraint: string;
  deduction: number;
  verdict: 'pass' | 'violation' | 'unsure';
  evidence: Evidence[];
  reason: string | null;
  unsureCause: string | null;
  decidedBy: string;
  decision: 'pass' | 'violation' | null;
  reviewEvidence?: Evidence[] | null;
  source: string;
  history?: {
    reviewerId: string;
    previousDecision: string | null;
    decision: string;
    recordedAt: string;
  }[];
}

function ReviewItem({
  proposal,
  save,
}: {
  proposal: Proposal;
  save: (id: string, decision: 'pass' | 'violation', evidence: Evidence[]) => Promise<void>;
}) {
  const [decision, setDecision] = useState('');
  const [lineNumbers, setLineNumbers] = useState('');
  const [error, setError] = useState('');
  const lines = proposal.source.split('\n');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (decision !== 'pass' && decision !== 'violation') return;
    const values = lineNumbers.trim() ? lineNumbers.split(',').map((value) => value.trim()) : [];
    const numbers = values.map(Number);
    if (
      (decision === 'violation' && numbers.length === 0) ||
      values.some((value) => !/^\d+$/.test(value)) ||
      numbers.some((line) => !Number.isSafeInteger(line) || line < 1 || line > lines.length)
    ) {
      setError('Provide valid source line numbers for a violation.');
      return;
    }
    setError('');
    void save(
      proposal.id,
      decision,
      numbers.map((line) => ({ line, text: lines[line - 1]!.replace(/\r$/, '') })),
    );
  }

  return (
    <article className="review-item">
      <h3>
        {proposal.labTitle}: {proposal.constraint}
      </h3>
      <p>
        {proposal.studentName ?? 'Student'} · Submission {proposal.submissionId}
      </p>
      <p>
        Proposed: <strong>{proposal.verdict}</strong> · {proposal.decidedBy} · Deduction:{' '}
        {proposal.deduction} points
      </p>
      {proposal.unsureCause && <p>Unsure: {proposal.unsureCause}</p>}
      {proposal.reason && <p>{proposal.reason}</p>}
      {proposal.evidence.length > 0 && (
        <ul>
          {proposal.evidence.map((item) => (
            <li key={`${item.line}-${item.text}`}>
              Line {item.line}: {item.text}
            </li>
          ))}
        </ul>
      )}
      <p>TA decision: {proposal.decision ?? 'not reviewed'}</p>
      {proposal.reviewEvidence && proposal.reviewEvidence.length > 0 && (
        <div>
          <strong>TA evidence</strong>
          <ul>
            {proposal.reviewEvidence.map((item) => (
              <li key={`${item.line}-${item.text}`}>
                Line {item.line}: {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal.history && proposal.history.length > 0 && (
        <details>
          <summary>Decision history</summary>
          <ul>
            {proposal.history.map((entry, index) => (
              <li key={index}>
                {entry.previousDecision ?? 'unreviewed'} → {entry.decision} · {entry.reviewerId} ·{' '}
                {new Date(entry.recordedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Submission source</summary>
        <pre>{lines.map((line, index) => `${index + 1}: ${line}`).join('\n')}</pre>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <label>
          Decision
          <select value={decision} onChange={(event) => setDecision(event.target.value)}>
            <option value="">Choose a decision</option>
            <option value="pass">Pass</option>
            <option value="violation">Violation</option>
          </select>
        </label>
        <label>
          Evidence line numbers
          <input
            value={lineNumbers}
            onChange={(event) => setLineNumbers(event.target.value)}
            placeholder="For example, 2, 5"
          />
        </label>
        <button disabled={!decision}>Save decision</button>
      </form>
    </article>
  );
}

export function ReviewQueue({ classId, token }: { classId: string; token: string }) {
  const [items, setItems] = useState<Proposal[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const url = `/v1/classes/${classId}/reviews`;

  useEffect(() => {
    let active = true;
    setItems([]);
    setError('');
    setNotice('');
    void request<Proposal[]>(url, token)
      .then((result) => {
        if (active) setItems(result);
      })
      .catch(() => {
        if (active) setError('Unable to load the review queue.');
      });
    return () => {
      active = false;
    };
  }, [url, token]);

  async function save(id: string, decision: 'pass' | 'violation', evidence: Evidence[]) {
    setError('');
    setNotice('');
    try {
      await request(`${url}/${id}/decision`, token, { decision, evidence });
      setItems(await request<Proposal[]>(url, token));
      setNotice('Decision saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the decision.');
    }
  }

  return (
    <section className="card">
      <h2>Review queue</h2>
      <p>Verdicts are proposals. A TA must decide before any grade can be published.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {items.length ? (
        items.map((item) => <ReviewItem key={item.id} proposal={item} save={save} />)
      ) : (
        <p>No proposals to review.</p>
      )}
    </section>
  );
}
