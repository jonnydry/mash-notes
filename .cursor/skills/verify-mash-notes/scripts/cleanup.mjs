#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_STATE_DIR, deletionTarget } from './policy.mjs';

function stateDir() {
	return process.env.VERIFY_MASH_NOTES_STATE || DEFAULT_STATE_DIR;
}

function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function cmdline(pid) {
	try {
		return await readFile(`/proc/${pid}/cmdline`, 'utf8');
	} catch {
		return '';
	}
}

async function stopRecordedServer(dir) {
	let state;
	try {
		state = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'));
	} catch {
		return;
	}
	if (!pidAlive(state.pid)) return;
	const command = await cmdline(state.pid);
	if (!command.includes('serve-static.mjs')) {
		throw new Error(`Refusing to kill pid ${state.pid}. It is not scripts/serve-static.mjs.`);
	}
	process.kill(state.pid, 'SIGTERM');
	const deadline = Date.now() + 5_000;
	while (pidAlive(state.pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (pidAlive(state.pid)) process.kill(state.pid, 'SIGKILL');
}

async function main() {
	const dir = stateDir();
	const decision = deletionTarget(dir);
	if (!decision.ok) throw new Error(`Refusing to delete ${dir} (${decision.reason}).`);
	await stopRecordedServer(dir);
	await rm(decision.path, { recursive: true, force: true });
	console.log('cleanup ok');
	console.log(`removed ${decision.path}`);
	console.log('evidence kept /opt/cursor/artifacts/verify-mash-notes');
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
