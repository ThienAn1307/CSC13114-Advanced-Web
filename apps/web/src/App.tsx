import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LabForm } from './LabForm.js';
import './style.css';

type Role = 'admin' | 'ta' | 'student';
type Classroom = { id: string; code: string; name: string };
type Lab = {
  id: string;
  title: string;
  opensAt: string;
  deadlineAt: string;
  statement?: string;
  constraints?: { id: string; text: string; deduction: number }[];
  testCases?: { input: string; expectedOutput: string }[];
};
type Submission = { id: string; labId: string; status: string; receivedAt: string };
type Session = { token: string; role: Role };

async function request<T>(
  path: string,
  token?: string,
  body?: unknown,
  extra?: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(
      typeof problem.detail === 'string' ? problem.detail : 'The request could not be completed.',
    );
  }
  return response.json() as Promise<T>;
}

function fields(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [classId, setClassId] = useState('');
  const [labs, setLabs] = useState<Lab[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  async function perform(action: () => Promise<void>) {
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed.');
    }
  }

  async function refreshClasses(token: string) {
    setClasses(await request<Classroom[]>('/v1/classes', token));
  }
  async function refreshLabs(token: string, selected: string) {
    setLabs(await request<Lab[]>(`/v1/classes/${selected}/labs`, token));
  }

  useEffect(() => {
    if (!session) return;
    let active = true;
    void request<Classroom[]>('/v1/classes', session.token)
      .then((result) => {
        if (active) setClasses(result);
      })
      .catch(() => {
        if (active) setError('Unable to load classes.');
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !classId || session.role === 'admin') {
      setLabs([]);
      return;
    }
    let active = true;
    void request<Lab[]>(`/v1/classes/${classId}/labs`, session.token)
      .then((result) => {
        if (active) setLabs(result);
      })
      .catch(() => {
        if (active) setError('Unable to load labs.');
      });
    return () => {
      active = false;
    };
  }, [session, classId]);

  useEffect(() => {
    if (!session || session.role !== 'student') return;
    let active = true;
    const poll = () => {
      void request<Submission[]>('/v1/submissions', session.token)
        .then((result) => {
          if (active) setSubmissions(result);
        })
        .catch(() => {
          if (active) setError('Unable to refresh submission status.');
        });
    };
    poll();
    const interval = window.setInterval(poll, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [session]);

  function login(event: FormEvent<HTMLFormElement>) {
    const form = fields(event);
    void perform(async () => {
      const result = await request<{ accessToken: string }>('/v1/auth/login', undefined, {
        email: form.get('email'),
        password: form.get('password'),
      });
      const payload = JSON.parse(
        atob(result.accessToken.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/')),
      ) as { role?: string };
      if (payload.role !== 'admin' && payload.role !== 'ta' && payload.role !== 'student')
        throw new Error('Invalid session.');
      setClassId('');
      setSession({ token: result.accessToken, role: payload.role });
    });
  }

  if (!session)
    return (
      <main className="login">
        <div className="brand">
          LEE<span>TKOB</span>
        </div>
        <h1>Welcome back</h1>
        <p>Sign in to manage your C++ labs.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={login} className="stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button>Sign in</button>
        </form>
      </main>
    );

  function createClass(event: FormEvent<HTMLFormElement>) {
    const form = fields(event);
    void perform(async () => {
      await request('/v1/classes', session!.token, {
        code: form.get('code'),
        name: form.get('name'),
      });
      await refreshClasses(session!.token);
      setNotice('Class created.');
    });
  }
  function addMember(event: FormEvent<HTMLFormElement>) {
    const form = fields(event);
    const password = textField(form, 'password');
    void perform(async () => {
      await request(
        `/v1/classes/${classId}/${session!.role === 'admin' ? 'tas' : 'students'}`,
        session!.token,
        {
          email: form.get('email'),
          displayName: form.get('displayName'),
          ...(password ? { password } : {}),
        },
      );
      setNotice('Member added.');
    });
  }
  function createLab(
    event: FormEvent<HTMLFormElement>,
    constraintCount: number,
    caseCount: number,
  ) {
    const form = fields(event);
    void perform(async () => {
      await request(`/v1/classes/${classId}/labs`, session!.token, {
        title: form.get('title'),
        statement: textField(form, 'statement'),
        cpuLimitSeconds: Number(textField(form, 'cpuLimitSeconds')),
        memoryLimitMb: Number(textField(form, 'memoryLimitMb')),
        constraints: Array.from({ length: constraintCount }, (_, index) => ({
          text: textField(form, `constraint-${index}`),
          deduction: Number(textField(form, `deduction-${index}`)),
        })),
        testCases: Array.from({ length: caseCount }, (_, index) => ({
          input: textField(form, `input-${index}`),
          expectedOutput: textField(form, `output-${index}`),
        })),
        opensAt: new Date(textField(form, 'opensAt')).toISOString(),
        deadlineAt: new Date(textField(form, 'deadlineAt')).toISOString(),
      });
      await refreshLabs(session!.token, classId);
      setNotice('Lab created.');
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    const element = event.currentTarget;
    const form = fields(event);
    void perform(async () => {
      if (!file || !file.name.toLowerCase().endsWith('.cpp'))
        throw new Error('Choose a C++ source file ending in .cpp.');
      await request(
        `/v1/labs/${textField(form, 'labId')}/submissions`,
        session!.token,
        { source: await file.text() },
        { 'Idempotency-Key': submissionKey },
      );
      setSubmissionKey(crypto.randomUUID());
      setFile(null);
      element.reset();
      setNotice('Submission received.');
    });
  }

  return (
    <>
      <header>
        <div className="brand">
          LEE<span>TKOB</span>
        </div>
        <div>
          {session.role.toUpperCase()}{' '}
          <button
            className="quiet"
            onClick={() => {
              setSession(null);
              setClasses([]);
              setLabs([]);
              setSubmissions([]);
              setFile(null);
              setError('');
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>
            {session.role === 'admin'
              ? 'Administration'
              : session.role === 'ta'
                ? 'Teaching workspace'
                : 'My labs'}
          </h1>
          <p>Classes, labs and submissions in one place.</p>
        </div>
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
        <div className="layout">
          <section className="card">
            <h2>Classes</h2>
            {classes.length === 0 ? (
              <p>No classes yet.</p>
            ) : (
              <ul className="class-list">
                {classes.map((item) => (
                  <li key={item.id}>
                    <button
                      className={classId === item.id ? 'selected' : 'class-button'}
                      onClick={() => setClassId(item.id)}
                    >
                      {item.code}
                      <small>{item.name}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {session.role === 'admin' && (
              <form className="stack" onSubmit={createClass}>
                <h3>New class</h3>
                <label>
                  Class code
                  <input name="code" required maxLength={100} />
                </label>
                <label>
                  Name
                  <input name="name" required maxLength={200} />
                </label>
                <button>Create class</button>
              </form>
            )}
          </section>
          <div className="stack">
            {!classId ? (
              <section className="card">
                <h2>Select a class</h2>
                <p>Choose a class to see its available actions.</p>
              </section>
            ) : (
              <>
                <section className="card">
                  <h2>{classes.find((item) => item.id === classId)?.name}</h2>
                  {session.role !== 'admin' && (
                    <>
                      <h3>Labs</h3>
                      {labs.length === 0 ? (
                        <p>No labs in this class.</p>
                      ) : (
                        <ul className="labs">
                          {labs.map((lab) => (
                            <li key={lab.id}>
                              <strong>{lab.title}</strong>
                              <span>Closes {new Date(lab.deadlineAt).toLocaleString()}</span>
                              {lab.statement && <p className="preformatted">{lab.statement}</p>}
                              {lab.constraints && (
                                <ul>
                                  {lab.constraints.map((constraint) => (
                                    <li key={constraint.id}>
                                      {constraint.text} · {constraint.deduction} points
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {session.role === 'ta' && lab.testCases && (
                                <details>
                                  <summary>Test cases ({lab.testCases.length})</summary>
                                  {lab.testCases.map((testCase, index) => (
                                    <div key={index}>
                                      <p>Input</p>
                                      <pre>{testCase.input}</pre>
                                      <p>Expected output</p>
                                      <pre>{testCase.expectedOutput}</pre>
                                    </div>
                                  ))}
                                </details>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {session.role === 'ta' && <LabForm onSubmit={createLab} />}
                </section>
                {session.role !== 'student' && (
                  <section className="card">
                    <h2>Add {session.role === 'admin' ? 'a TA' : 'a student'}</h2>
                    <p>
                      For a new account, provide a password. Existing accounts keep their current
                      password.
                    </p>
                    <form className="stack" onSubmit={addMember}>
                      <label>
                        Email
                        <input name="email" type="email" required />
                      </label>
                      <label>
                        Display name
                        <input name="displayName" required maxLength={200} />
                      </label>
                      <label>
                        Initial password <small>(new accounts, at least 12 characters)</small>
                        <input
                          name="password"
                          type="password"
                          minLength={12}
                          autoComplete="new-password"
                        />
                      </label>
                      <button>Add member</button>
                    </form>
                  </section>
                )}
                {session.role === 'student' && (
                  <section className="card">
                    <h2>Submit a solution</h2>
                    {/* Theo FAQ-06: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-06 */}
                    <p>
                      Your code is reviewed by automated rules and a model. The model receives the
                      lab statement, constraints, and code with comments and your identity removed.
                      The TA reviews the result before grades are published. The free Gemini service
                      may allow Google reviewers to inspect the stripped code.
                    </p>
                    <form className="stack" onSubmit={submit}>
                      <label>
                        Lab
                        <select name="labId" required defaultValue="">
                          <option value="" disabled>
                            Choose a lab
                          </option>
                          {labs.map((lab) => (
                            <option key={lab.id} value={lab.id}>
                              {lab.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        C++ file
                        <input
                          type="file"
                          accept=".cpp"
                          required
                          onChange={(event) => {
                            setFile(event.target.files?.[0] ?? null);
                            setSubmissionKey(crypto.randomUUID());
                          }}
                        />
                      </label>
                      <button disabled={labs.length === 0}>Submit</button>
                    </form>
                  </section>
                )}
              </>
            )}
            {session.role === 'student' && (
              <section className="card">
                <h2>Submission status</h2>
                {submissions.length === 0 ? (
                  <p>No submissions yet.</p>
                ) : (
                  <ul className="labs">
                    {submissions.map((submission) => (
                      <li key={submission.id}>
                        <strong>{submission.status}</strong>
                        <span>
                          {new Date(submission.receivedAt).toLocaleString()} · {submission.id}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
