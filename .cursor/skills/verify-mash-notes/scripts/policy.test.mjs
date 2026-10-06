import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	APP_SCAN_PATHS,
	EVIDENCE_DIR,
	ORIGIN_ENV_KEYS,
	SECRET_ENV_KEYS,
	childEnvForLaunch,
	collectEnvNames,
	deletionTarget,
	envNamesInSource,
	isOriginEnvName,
	isSecretEnvName,
	localOrigin,
	namesMatching,
	requestDecision
} from './policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const origin = localOrigin(4183);

describe('secret and origin env lock', () => {
	it('classifies secret names and leaves ordinary names alone', () => {
		assert.equal(isSecretEnvName('OPENAI_API_KEY'), true);
		assert.equal(isSecretEnvName('DATABASE_URL'), true);
		assert.equal(isSecretEnvName('MASH_EXPORT_QA_DIR'), false);
		assert.equal(isSecretEnvName('CI'), false);
		assert.equal(isOriginEnvName('PUBLIC_APP_URL'), true);
		assert.equal(isOriginEnvName('DATABASE_URL'), false);
		assert.equal(isOriginEnvName('CI'), false);
	});

	it('reads env names from source text', () => {
		const names = envNamesInSource(
			"const a = process.env.EVIL_API_KEY; const b = import.meta.env['PUBLIC_APP_URL'];"
		);
		assert.deepEqual(names, ['EVIL_API_KEY', 'PUBLIC_APP_URL']);
	});

	it('locks the app secret list and the app origin list to the scan', async () => {
		const found = await collectEnvNames(repoRoot, APP_SCAN_PATHS);
		assert.deepEqual(namesMatching(found, isSecretEnvName), SECRET_ENV_KEYS);
		assert.deepEqual(namesMatching(found, isOriginEnvName), ORIGIN_ENV_KEYS);
		assert.deepEqual(
			found.filter((name) => name === 'CI' || name === 'MASH_EXPORT_QA_DIR').sort(),
			['CI', 'MASH_EXPORT_QA_DIR']
		);
	});

	it('finds a secret planted in a fixture file', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'verify-mash-scan-'));
		await mkdir(path.join(root, 'src'));
		await writeFile(
			path.join(root, 'src', 'remote.ts'),
			'export const key = process.env.EVIL_API_KEY;\n'
		);
		const found = await collectEnvNames(root, ['src']);
		assert.deepEqual(namesMatching(found, isSecretEnvName), ['EVIL_API_KEY']);
		await rm(root, { recursive: true, force: true });
	});
});

describe('child environment', () => {
	it('blanks secrets, rewrites origin-like urls, and drops everything else', () => {
		const child = childEnvForLaunch(
			{
				PATH: '/usr/bin',
				HOME: '/tmp/home',
				OPENAI_API_KEY: 'sk-live',
				DATABASE_URL: 'postgres://user:pass@db.example/app',
				PUBLIC_APP_URL: 'https://evil.example',
				RANDOM_CONFIG: 'hello',
				NODE_OPTIONS: '--require /tmp/pwn.js'
			},
			origin
		);
		assert.equal(child.PATH, '/usr/bin');
		assert.equal(child.HOME, '/tmp/home');
		assert.equal(child.OPENAI_API_KEY, '');
		assert.equal(child.DATABASE_URL, '');
		assert.equal(child.PUBLIC_APP_URL, origin);
		assert.equal(child.RANDOM_CONFIG, undefined);
		assert.equal(child.NODE_OPTIONS, undefined);
		for (const key of SECRET_ENV_KEYS) assert.equal(child[key], '');
		for (const key of ORIGIN_ENV_KEYS) assert.equal(child[key], origin);
	});
});

describe('request host gate', () => {
	it('allows only loopback hosts and local schemes', () => {
		assert.equal(requestDecision('http://127.0.0.1:4183/').ok, true);
		assert.equal(requestDecision('http://localhost:4183/').ok, true);
		assert.equal(requestDecision('http://[::1]:4183/').ok, true);
		assert.equal(requestDecision('http://[::1]/app').host, '[::1]');
		assert.equal(requestDecision('http://[::1]/app').ok, true);
		assert.equal(requestDecision('data:text/plain,hi').ok, true);
		assert.equal(requestDecision('blob:http://127.0.0.1:4183/uuid').ok, true);
		assert.equal(requestDecision('about:blank').ok, true);

		const remote = requestDecision('https://example.com/verify-mash-notes-probe');
		assert.equal(remote.ok, false);
		assert.equal(remote.host, 'example.com');
		assert.equal(remote.reason, 'non-local-host');

		assert.equal(requestDecision('http://127.0.0.1.evil.com/').ok, false);
		assert.equal(requestDecision('http://evil.com/?host=127.0.0.1').ok, false);
		assert.equal(requestDecision('not a url').ok, false);
		assert.equal(requestDecision('not a url').reason, 'unparseable');

		const queryHost = requestDecision('http://127.0.0.1:4183/?host=evil.com');
		assert.equal(queryHost.ok, true);
		assert.equal(queryHost.host, '127.0.0.1');
	});
});

describe('cleanup fence', () => {
	it('deletes scratch under /tmp and refuses the evidence directory', () => {
		assert.equal(deletionTarget('/tmp/verify-mash-notes/profile').ok, true);
		assert.equal(deletionTarget(EVIDENCE_DIR).ok, false);
		assert.equal(deletionTarget(`${EVIDENCE_DIR}/create-note-saved.png`).reason, 'evidence');
		assert.equal(deletionTarget('/workspace').reason, 'outside-tmp');
		assert.equal(deletionTarget('/tmp').reason, 'outside-tmp');
	});
});
