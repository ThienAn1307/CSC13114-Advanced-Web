import { useState } from 'react';
import type { FormEvent } from 'react';

export function LabForm({
  onSubmit,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>, constraintCount: number, caseCount: number) => void;
}) {
  const [constraintCount, setConstraintCount] = useState(1);
  const [caseCount, setCaseCount] = useState(1);
  return (
    <form className="stack" onSubmit={(event) => onSubmit(event, constraintCount, caseCount)}>
      <h3>New lab</h3>
      <label>
        Title
        <input name="title" required maxLength={200} />
      </label>
      <label>
        Problem statement
        <textarea name="statement" required maxLength={65536} rows={5} />
      </label>
      <label>
        CPU seconds per test
        <input name="cpuLimitSeconds" type="number" min={1} max={5} defaultValue={1} required />
      </label>
      <label>
        Memory limit (MB)
        <input name="memoryLimitMb" type="number" min={64} max={512} defaultValue={256} required />
      </label>
      <h3>Constraints</h3>
      {Array.from({ length: constraintCount }, (_, index) => (
        <div className="stack" key={index}>
          <label>
            Constraint {index + 1}
            <textarea name={`constraint-${index}`} required maxLength={4000} />
          </label>
          <label>
            Deduction (points)
            <input
              name={`deduction-${index}`}
              type="number"
              min={0}
              max={10}
              step={0.01}
              required
            />
          </label>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="secondary"
          disabled={constraintCount >= 50}
          onClick={() => setConstraintCount(constraintCount + 1)}
        >
          Add constraint
        </button>
        {constraintCount > 1 && (
          <button
            type="button"
            className="secondary"
            onClick={() => setConstraintCount(constraintCount - 1)}
          >
            Remove last
          </button>
        )}
      </div>
      <h3>Hidden test cases</h3>
      {Array.from({ length: caseCount }, (_, index) => (
        <div className="stack" key={index}>
          <label>
            Test {index + 1} input
            <textarea name={`input-${index}`} />
          </label>
          <label>
            Expected output
            <textarea name={`output-${index}`} />
          </label>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="secondary"
          disabled={caseCount >= 50}
          onClick={() => setCaseCount(caseCount + 1)}
        >
          Add test
        </button>
        {caseCount > 1 && (
          <button type="button" className="secondary" onClick={() => setCaseCount(caseCount - 1)}>
            Remove last
          </button>
        )}
      </div>
      <label>
        Opens
        <input name="opensAt" type="datetime-local" required />
      </label>
      <label>
        Deadline
        <input name="deadlineAt" type="datetime-local" required />
      </label>
      <button>Create lab</button>
    </form>
  );
}
