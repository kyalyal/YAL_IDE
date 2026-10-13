#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
function argument(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; }
const stub = process.argv.includes('--stub');
const root = path.resolve(__dirname, '..');
const runs = Number(argument('--runs', 5));
const silenceMs = Number(argument('--no-output-seconds', 60)) * 1000;
const stubDelay = Number(argument('--stub-delay-ms', 0));
const stubExit = Number(argument('--stub-exit', 0));
const project = path.resolve(argument('--project', root));
const output = path.resolve(argument('--output', path.join(root, '.verify/stall-check.json')));
if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(silenceMs) || silenceMs <= 0 || !Number.isFinite(stubDelay) || stubDelay < 0 || !Number.isInteger(stubExit)) throw new Error('Invalid harness options');
if (!stub && process.env.YAL_GPT_WORKER === '1') throw new Error('GPT worker cannot run the real harness; use --stub');
let temporary;
const bashPath = value => value.replace(/\\/g, '/');
(async () => {
  let cwd = project;
  const env = { ...process.env };
  if (stub) {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yal-stall-stub-'));
    cwd = temporary;
    fs.mkdirSync(path.join(cwd, 'scripts')); fs.mkdirSync(path.join(cwd, 'bin'));
    fs.copyFileSync(path.join(root, 'scripts/gpt.sh'), path.join(cwd, 'scripts/gpt.sh'));
    fs.writeFileSync(path.join(cwd, 'bin/codex'), `#!/usr/bin/env bash
if read -r line; then echo unexpected-stdin >&2; exit 99; fi
printf 'stub worker=%s stdin=closed\\n' "$YAL_GPT_WORKER"
sleep "${stubDelay / 1000}"
printf 'stub summary: harmless file read\\n'
exit ${stubExit}
`, { mode: 0o755 });
    env.YAL_GPT_WORKER = '';
    delete env.YAL_MASTER_PATH; delete env.YAL_SKILLS_DIR;
  }
  // Real runs inherit the director environment and preserve the configured worker guard.
  env.YAL_GPT_LOG = bashPath(path.join(cwd, '.verify/stall-check-worker.log'));
  const report = { mode: stub ? 'stub' : 'real', startedAt: new Date().toISOString(), runs, noOutputSeconds: silenceMs / 1000, project: cwd, rounds: [] };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  save();
  for (let round = 1; round <= runs; round++) {
    const record = { round, state: 'working', durationMs: 0, exitCode: null, noOutputWithinThreshold: false };
    report.rounds.push(record); save();
    const started = Date.now(); let last = started; let maxSilenceMs = 0; let noOutput = false; let workerOutput = false; let outputTail = ''; let error;
    const args = stub
      ? ['-c', 'cd "$1"; export PATH="$PWD/bin:$PATH"; exec bash scripts/gpt.sh -', 'yal-stub', bashPath(cwd)]
      : [bashPath(path.join(cwd, 'scripts/gpt.sh')), '-'];
    const child = spawn('bash', args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const observeGap = () => { const gap = Date.now() - last; maxSilenceMs = Math.max(maxSilenceMs, gap); if (gap >= silenceMs && !noOutput) { noOutput = true; Object.assign(record, { durationMs: Date.now() - started, noOutputWithinThreshold: true, maxSilenceMs }); save(); } };
    const timer = setInterval(observeGap, Math.min(1000, Math.max(10, silenceMs / 4)));
    const onData = chunk => {
      observeGap();
      const text = String(chunk); outputTail = (outputTail + text).slice(-2000);
      // Start/order/end markers prove wrapper activity, not model progress.
      if (text.split('\n').some(line => line.trim() && !line.startsWith('=== [YAL-GPT]'))) { last = Date.now(); workerOutput = true; }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', value => { error = value.message; });
    child.stdin.on('error', () => {});
    child.stdin.end('package.json 파일 하나만 읽고 프로젝트 이름을 한 줄로 요약한다. 파일 수정, 추가 프로세스 실행, 외부 CLI 재호출은 하지 않는다. 결과는 한 줄로 출력한다.');
    const result = await new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
    observeGap(); clearInterval(timer);
    Object.assign(record, { round, state: 'finished', durationMs: Date.now() - started, ...result, noOutputWithinThreshold: noOutput, maxSilenceMs, workerOutput, outputTail, ...(error ? { error } : {}) });
    save(); console.log(JSON.stringify(report.rounds.at(-1)));
  }
  report.finishedAt = new Date().toISOString(); save();
  if (report.rounds.some(item => item.exitCode !== 0)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  // This directory is created by this harness, never a user-provided project.
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});
