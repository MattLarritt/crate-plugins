import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

/**
 * yt-dlp, kept alive.
 *
 * YouTube changes something every few weeks and yt-dlp ships a fix within days; a copy that
 * is not kept current stops working quietly, and "search finds nothing" is indistinguishable
 * from "there was nothing to find". crate's image does not carry yt-dlp at all, and an image is
 * rebuilt far less often than yt-dlp needs updating, so this plugin cannot rely on the image to
 * carry a current copy — it manages its own, in its data directory:
 *
 *   - installed on first use from yt-dlp's official GitHub release, the musl build (crate's
 *     image is Alpine), and CHECKED against the SHA2-256SUMS published with that release
 *     before it is ever executed;
 *   - updated daily with yt-dlp's own `-U`, and straight away after an extractor error, at
 *     most once an hour — an error is the most likely sign that YouTube has just changed;
 *   - given Node as its JavaScript runtime. Recent yt-dlp needs one to solve YouTube's player
 *     challenges, and crate's image already has Node, so nothing new has to be installed.
 */

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const DAY_MS = 24 * 3600 * 1000;
const ERROR_UPDATE_GAP_MS = 3600 * 1000;

/** The release asset for this machine. crate's image is Alpine, so always a musl build. */
function assetName(): string {
  return process.arch === 'arm64' ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_musllinux';
}

export interface YtdlpStatus {
  path: string;
  version: string | null;
  installedAt: number | null;
  lastUpdateCheck: number | null;
  lastError: string | null;
}

export class Ytdlp {
  private bin: string;
  private stateFile: string;
  private installing: Promise<void> | null = null;
  private updating: Promise<void> | null = null;
  private lastErrorUpdate = 0;
  private status: YtdlpStatus;

  constructor(
    private dataDir: string,
    private log: FastifyBaseLogger,
  ) {
    this.bin = join(dataDir, 'bin', 'yt-dlp');
    this.stateFile = join(dataDir, 'bin', 'state.json');
    this.status = { path: this.bin, version: null, installedAt: null, lastUpdateCheck: null, lastError: null };
  }

  current(): YtdlpStatus {
    return { ...this.status };
  }

  /** A usable binary, installing it first if there is none. Updates happen in the background. */
  async ready(): Promise<string> {
    const present = await stat(this.bin).then(
      () => true,
      () => false,
    );
    if (!present) {
      this.installing ??= this.install().finally(() => (this.installing = null));
      await this.installing;
    } else if (this.status.version === null) {
      await this.loadState();
    }
    if (!this.status.lastUpdateCheck || Date.now() - this.status.lastUpdateCheck > DAY_MS) {
      void this.update('daily');
    }
    return this.bin;
  }

  /**
   * Run yt-dlp and return stdout.
   *
   * Always with --ignore-config (a stray config file must not change behaviour), a cache inside
   * the plugin's own directory (the signature cache makes later calls much faster), and Node as
   * the JS runtime. stderr is kept only for the error message, capped.
   */
  async run(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
    const bin = await this.ready();
    const full = [
      '--ignore-config',
      '--no-warnings',
      '--no-progress',
      '--cache-dir',
      join(this.dataDir, 'cache'),
      '--js-runtimes',
      `node:${process.execPath}`,
      ...args,
    ];
    try {
      return await exec(bin, full, opts.timeoutMs ?? 60_000);
    } catch (err) {
      const message = (err as Error).message;
      this.status.lastError = message.slice(0, 300);
      // An extractor error is how YouTube changing shows up. Update, but not on every failure:
      // a video that is genuinely gone would otherwise trigger a download of yt-dlp per request.
      if (/ERROR: \[youtube|Sign in to confirm|nsig|signature|Unsupported URL|Requested format/i.test(message)) {
        if (Date.now() - this.lastErrorUpdate > ERROR_UPDATE_GAP_MS) {
          this.lastErrorUpdate = Date.now();
          void this.update('after an error');
        }
      }
      throw err;
    }
  }

  private async loadState(): Promise<void> {
    const raw = await readFile(this.stateFile, 'utf8').catch(() => null);
    if (raw) {
      try {
        const s = JSON.parse(raw) as Partial<YtdlpStatus>;
        this.status.installedAt = s.installedAt ?? null;
        this.status.lastUpdateCheck = s.lastUpdateCheck ?? null;
      } catch {
        /* a corrupt state file just means "check soon" */
      }
    }
    this.status.version = await exec(this.bin, ['--version'], 15_000)
      .then((v) => v.trim())
      .catch(() => null);
  }

  private async saveState(): Promise<void> {
    await writeFile(
      this.stateFile,
      JSON.stringify({ installedAt: this.status.installedAt, lastUpdateCheck: this.status.lastUpdateCheck }),
    ).catch(() => undefined);
  }

  /**
   * Download the release binary and refuse it unless it matches the published checksum.
   *
   * Downloaded to a temporary name, hashed while it streams, and only renamed into place and
   * made executable once the hash matches — so a truncated or tampered download is never run.
   */
  private async install(): Promise<void> {
    const dir = join(this.dataDir, 'bin');
    await mkdir(dir, { recursive: true });
    const asset = assetName();
    this.log.warn({ asset }, 'youtube: installing yt-dlp');

    const sums = await fetchText(`${RELEASE}/SHA2-256SUMS`);
    const expected = sums
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find(([, name]) => name === asset)?.[0];
    if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) {
      throw new Error(`no published checksum for ${asset}`);
    }

    const tmp = join(dir, `.yt-dlp.${process.pid}.download`);
    const actual = await download(`${RELEASE}/${asset}`, tmp);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      await rm(tmp, { force: true });
      throw new Error(`yt-dlp checksum mismatch: expected ${expected}, got ${actual}`);
    }
    await chmod(tmp, 0o755);
    await rename(tmp, this.bin);

    this.status.installedAt = Date.now();
    this.status.lastUpdateCheck = Date.now();
    this.status.version = await exec(this.bin, ['--version'], 15_000)
      .then((v) => v.trim())
      .catch(() => null);
    this.status.lastError = null;
    await this.saveState();
    this.log.warn({ version: this.status.version }, 'youtube: yt-dlp installed');
  }

  /** yt-dlp's own self-update. One at a time; a failure is recorded, never thrown. */
  update(why: string): Promise<void> {
    this.updating ??= (async () => {
      try {
        const out = await exec(this.bin, ['-U'], 180_000);
        this.status.lastUpdateCheck = Date.now();
        this.status.version = await exec(this.bin, ['--version'], 15_000)
          .then((v) => v.trim())
          .catch(() => this.status.version);
        await this.saveState();
        this.log.info({ why, version: this.status.version, out: out.trim().split('\n').pop() }, 'youtube: yt-dlp update check');
      } catch (err) {
        this.status.lastError = `update failed: ${(err as Error).message}`.slice(0, 300);
        this.log.warn({ why, err: (err as Error).message }, 'youtube: yt-dlp update failed');
      }
    })().finally(() => (this.updating = null));
    return this.updating;
  }
}

/** Run a process, resolve stdout, reject with stderr's tail. Killed outright on timeout. */
export function exec(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (c: string) => {
      out += c;
      if (out.length > 32_000_000) proc.kill('SIGKILL');
    });
    proc.stderr.on('data', (c: string) => {
      err = (err + c).slice(-4000);
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    timer.unref();
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(signal ? `yt-dlp killed (${signal})` : err.trim().split('\n').slice(-3).join(' ') || `yt-dlp exited ${code}`));
    });
  });
}

/** GET over IPv4 following redirects — for networks where IPv6 resolves but goes nowhere. */
function get(url: string, hops = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { family: 4, headers: { 'User-Agent': 'crate-youtube-plugin' } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hops > 0) {
        res.resume();
        resolve(get(new URL(loc, url).href, hops - 1));
        return;
      }
      if ((res.statusCode ?? 0) >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timed out fetching ${url}`)));
    req.end();
  });
}

async function fetchText(url: string): Promise<string> {
  const res = await get(url);
  let body = '';
  res.setEncoding('utf8');
  for await (const chunk of res) body += chunk as string;
  return body;
}

/** Stream to a file, returning the SHA-256 of exactly the bytes written. */
async function download(url: string, to: string): Promise<string> {
  const res = await get(url);
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(to);
    res.on('data', (c: Buffer) => hash.update(c));
    res.on('error', reject);
    file.on('error', reject);
    file.on('finish', () => resolve());
    res.pipe(file);
  });
  return hash.digest('hex');
}
