// Reads `docker compose config --format json` on stdin and stops when a service has more than
// D12 and D16 allow. deploy/up.sh runs it before every start. It never prints a value.
import process from 'node:process';
import { text } from 'node:stream/consumers';

const { services, networks: defined } = JSON.parse(await text(process.stdin));
const problems = [];
const must = (ok, message) => {
  if (!ok) problems.push(message);
};

const SOCKET = '/var/run/docker.sock';
const MODEL_KEY = /^(GEMINI|GOOGLE)_API_KEY$/;
const networks = (name) => Object.keys(services[name]?.networks ?? {});

const expected = ['api', 'check', 'judge', 'migrate', 'postgres', 'web'];
must(Object.keys(services).sort().join() === expected.join(), `services must be ${expected}`);

for (const [name, service] of Object.entries(services)) {
  const env = Object.keys(service.environment ?? {});
  const mounts = service.volumes ?? [];
  must(!service.privileged, `${name} is privileged`);
  must(!service.env_file, `${name} has an env_file: it would get every secret`);
  must(service.network_mode === undefined, `${name} sets network_mode`);
  must(
    service.security_opt?.includes('no-new-privileges:true'),
    `${name} can gain privileges at run time`,
  );
  // D16: only the web ports are open to everyone.
  const ports = (service.ports ?? []).map((port) => port.published).sort();
  must(ports.join() === (name === 'web' ? '443,80' : ''), `${name} publishes ports ${ports}`);
  // D12: one process holds the key, another one can start containers.
  must(name === 'check' || !env.some((key) => MODEL_KEY.test(key)), `${name} has a model key`);
  must(name === 'api' || !env.includes('JWT_SECRET'), `${name} has JWT_SECRET`);
  must(name === 'judge' || !env.includes('DOCKER_HOST'), `${name} has DOCKER_HOST`);
  for (const mount of mounts) {
    if (mount.type !== 'bind') continue;
    must(
      mount.source === SOCKET && name === 'judge',
      `${name} mounts a path of the host: ${mount.source}`,
    );
  }
}

// The database is on a network with no way out, and only its clients are on it.
must(networks('postgres').join() === 'db', 'postgres must be on the network db only');
must(networks('judge').join() === 'db', 'judge must be on the network db only');
must(!networks('web').includes('db'), 'web must not reach the database');
must(defined?.db?.internal === true, 'the network db must be internal');

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`compose: ${problem}\n`);
  process.exit(1);
}
process.stdout.write('compose: ok\n');
