import { useEffect, useState } from 'react';
import { request } from './api.js';

type TestVerdict = { position: number; status: string };

export function SubmissionResults({
  submissionId,
  token,
  status,
}: {
  submissionId: string;
  token: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<TestVerdict[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    void request<TestVerdict[]>(`/v1/submissions/${submissionId}/tests`, token)
      .then((value) => {
        if (active) setResults(value);
      })
      .catch(() => {
        if (active) setError('Unable to load test verdicts.');
      });
    return () => {
      active = false;
    };
  }, [open, submissionId, token, status]);
  return (
    <div>
      <button type="button" className="secondary" onClick={() => setOpen(!open)}>
        {open ? 'Hide test verdicts' : 'View test verdicts'}
      </button>
      {open && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open &&
        !error &&
        (results === null ? (
          <p>Loading…</p>
        ) : results.length === 0 ? (
          <p>No test verdicts yet.</p>
        ) : (
          <ul>
            {results.map((item) => (
              <li key={item.position}>
                Test {item.position}: {item.status}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
