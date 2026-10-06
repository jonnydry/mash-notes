#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_STATE_DIR } from './policy.mjs';

const execFileAsync = promisify(execFile);

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

async function listenPids(port) {
	try {
		const { stdout } = await execFileAsync('ss', ['-ltnp', `sport = :${port}`], {
			encoding: 'utf8'
		});
		return [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
	} catch {
		return null;
	}
}

async function main() {
	const dir = stateDir();
	let state;
	try {
		state = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'));
	} catch {
		throw new Error(`No verification server state in ${dir}. Run launch first.`);
	}
	if (!pidAlive(state.pid)) throw new Error(`Preview pid ${state.pid} is not running.`);
	let cmdline;
	try {
		cmdline = await readFile(`/proc/${state.pid}/cmdline`, 'utf8');
	} catch {
		cmdline = '';
	}
	if (!cmdline.includes('serve-static.mjs')) {
		throw new Error(`Pid ${state.pid} is not scripts/serve-static.mjs.`);
	}
	const response = await fetch(state.origin);
	if (!response.ok) throw new Error(`${state.origin} returned HTTP ${response.status}.`);
	const body = await response.text();
	if (!body.includes('data-sveltekit-preload-data') || !body.includes('/_app/immutable/')) {
		throw new Error(`${state.origin} did not return the Mash static shell.`);
	}
	const manifest = await fetch(`${state.origin}/manifest.webmanifest`);
	if (!manifest.ok) throw new Error(`manifest.webmanifest returned HTTP ${manifest.status}.`);
	const manifestBody = await manifest.text();
	if (!manifestBody.includes('"name":"Mash"') && !manifestBody.includes('"name": "Mash"')) {
		throw new Error('manifest.webmanifest is not the Mash app manifest.');
	}
	const owners = await listenPids(state.port);
	if (owners && owners.length > 0 && !owners.includes(state.pid)) {
		throw new Error(`Port ${state.port} is owned by ${owners.join(',')} instead of ${state.pid}.`);
	}
	console.log('doctor ok');
	console.log(`pid ${state.pid}`);
	console.log(`origin ${state.origin}`);
	console.log(`portOwner ${owners && owners.length > 0 ? owners.join(',') : 'unreported'}`);
	console.log('auth none');
	console.log('storage browser-indexeddb');
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
