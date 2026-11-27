import { createDb, requireDatabaseUrl } from '../../../packages/db/src/client.js';
import { bootstrapAdmin } from './auth/bootstrap-admin.js';

const [email, displayName] = process.argv.slice(2);
if (!email || !displayName || process.stdin.isTTY) {
  console.error(
    'Supply email and display name as arguments and the password through standard input.',
  );
  process.exit(1);
}

let password = '';
for await (const chunk of process.stdin) {
  password += String(chunk);
  if (password.length > 1026) throw new Error('Password input is too long.');
}
password = password.replace(/\r?\n$/, '');
const handle = createDb(requireDatabaseUrl());
try {
  if (!(await bootstrapAdmin(handle.db, email, displayName, password))) {
    console.error('An admin already has credentials or the email cannot be used.');
    process.exitCode = 1;
  } else {
    console.log('Initial administrator created.');
  }
} catch {
  console.error('Administrator setup failed. Check the database and input.');
  process.exitCode = 1;
} finally {
  await handle.close();
}
