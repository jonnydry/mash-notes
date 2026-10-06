#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, DEFAULT_STATE_DIR, childEnvForLaunch, localOrigin } from './policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function stateDir() {
	return process.env.VERIFY_MASH_NOTES_STATE || DEFAULT_STATE_DIR;
}

function portNumber() {
	const raw = process.env.VERIFY_MASH_NOTES_PORT || String(DEFAULT_PORT);
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid VERIFY_MASH_NOTES_PORT: ${raw}`);
	}
	return port;
}

function statePath(dir) {
	return path.join(dir, 'state.json');
}

async function readState(dir) {
	try {
		return JSON.parse(await readFile(statePath(dir), 'utf8'));
	} catch {
		return null;
	}
}

function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function portFree(port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', () => resolve(false));
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolve(true));
		});
	});
}

async function waitForPreview(origin, logPath) {
	const deadline = Date.now() + 30_000;
	let lastLog = '';
	while (Date.now() < deadline) {
		try {
			lastLog = await readFile(logPath, 'utf8');
		} catch {
			lastLog = '';
		}
		if (lastLog.includes(`Mash static preview: ${origin}`)) {
			const response = await fetch(origin).catch(() => null);
			if (response?.ok) return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Preview did not become ready at ${origin}. Log tail:\n${lastLog.slice(-2000)}`);
}

async function main() {
	const dir = stateDir();
	const port = portNumber();
	const origin = localOrigin(port);
	await mkdir(dir, { recursive: true });
	const existing = await readState(dir);
	if (existing && pidAlive(existing.pid) && existing.origin === origin) {
		console.log(`Mash static preview: ${origin}`);
		console.log(`pid ${existing.pid}`);
		return;
	}
	if (!(await portFree(port))) {
		throw new Error(`127.0.0.1:${port} is already in use. Refusing to share it.`);
	}
	const indexHtml = path.join(repoRoot, 'build', 'index.html');
	try {
		if (!(await stat(indexHtml)).isFile()) throw new Error('missing');
	} catch {
		throw new Error('Static build not found. Run `npm run build` before launch.');
	}
	const logPath = path.join(dir, 'server.log');
	const log = await open(logPath, 'w');
	const child = spawn(
		process.execPath,
		['scripts/serve-static.mjs', '--host', '127.0.0.1', '--port', String(port)],
		{
			cwd: repoRoot,
			env: childEnvForLaunch(process.env, origin),
			detached: true,
			stdio: ['ignore', log.fd, log.fd]
		}
	);
	child.unref();
	await log.close();
	const state = {
		pid: child.pid,
		origin,
		port,
		host: '127.0.0.1',
		logPath,
		repoRoot
	};
	await writeFile(statePath(dir), JSON.stringify(state, null, 2));
	try {
		await waitForPreview(origin, logPath);
	} catch (error) {
		if (pidAlive(child.pid)) process.kill(child.pid, 'SIGTERM');
		throw error;
	}
	console.log(`Mash static preview: ${origin}`);
	console.log(`pid ${child.pid}`);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
