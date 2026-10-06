#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEFAULT_STATE_DIR, deletionTarget, evidenceDir, requestDecision } from './policy.mjs';

const PROBE_URL = 'https://example.com/verify-mash-notes-probe';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE_VIEWPORTS = [
	{ name: '375', width: 375, height: 812 },
	{ name: '390', width: 390, height: 844 }
];
const FEATURES = new Set(['create-note', 'search', 'mash', 'finish', 'mobile']);

function stateDir() {
	return process.env.VERIFY_MASH_NOTES_STATE || DEFAULT_STATE_DIR;
}

function emptyBag() {
	return {
		aborted: [],
		abortedUrls: new Set(),
		consoleErrors: [],
		pageErrors: [],
		networkErrors: []
	};
}

function attach(page, bag) {
	page.on('pageerror', (error) => bag.pageErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') bag.consoleErrors.push(message.text());
	});
	page.on('requestfailed', (request) => {
		const url = request.url();
		if (bag.abortedUrls.has(url)) return;
		bag.networkErrors.push({ url, error: request.failure()?.errorText ?? 'failed' });
	});
	page.on('response', (response) => {
		if (response.status() >= 400) {
			bag.networkErrors.push({ url: response.url(), status: response.status() });
		}
	});
}

async function installGate(context, bag) {
	await context.route('**/*', async (route) => {
		const url = route.request().url();
		const decision = requestDecision(url);
		if (decision.ok) {
			await route.continue();
			return;
		}
		bag.aborted.push({ url, host: decision.host, reason: decision.reason });
		bag.abortedUrls.add(url);
		await route.abort('blockedbyclient');
	});
}

async function notesInPage(page) {
	return page.evaluate(async () => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open('mashdb-notes-v1');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const notes = await new Promise((resolve, reject) => {
				const request = database.transaction('notes', 'readonly').objectStore('notes').getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return notes.map((note) => ({ title: note.title, body: note.body }));
		} finally {
			database.close();
		}
	});
}

async function waitForStoredNote(page, title, body) {
	const deadline = Date.now() + 8_000;
	let notes = [];
	while (Date.now() < deadline) {
		notes = await notesInPage(page);
		if (notes.some((note) => note.title === title && note.body === body)) return notes;
		await page.waitForTimeout(100);
	}
	const stored = notes.map((note) => note.title).join(', ') || '(empty)';
	throw new Error(
		`IndexedDB mashdb-notes-v1 has no note ${JSON.stringify({ title, body })}. Stored titles: ${stored}`
	);
}

async function bootDesk(page, origin) {
	await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('navigation', { name: 'Mash dock' }).waitFor({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Desk', exact: true }).click();
	await page
		.getByRole('complementary', { name: 'Ingredients' })
		.getByText("Hi — I'm Scoop")
		.waitFor({ timeout: 15_000 });
}

async function createNamedNote(page, title, body) {
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	const newNote = page.getByRole('button', { name: 'New note' });
	const box = await newNote.boundingBox();
	if (!box || box.width < 44 || box.height < 44) {
		throw new Error(`New note is not a 44px tap target (${box?.width}x${box?.height})`);
	}
	if (
		box.x < 0 ||
		box.y < 0 ||
		box.x + box.width > DESKTOP.width + 1 ||
		box.y + box.height > DESKTOP.height + 1
	) {
		throw new Error('New note is outside the desktop viewport');
	}
	const before = await page
		.locator('[data-canvas-card]')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getAttribute('data-note-id'))
				.filter((id) => typeof id === 'string' && id !== '')
		);
	await newNote.click();
	const noteIdHandle = await page.waitForFunction(
		(previous) => {
			const known = new Set(previous);
			const cards = document.querySelectorAll('[data-canvas-card][data-expanded="true"]');
			for (const candidate of cards) {
				const id = candidate.getAttribute('data-note-id');
				if (id && !known.has(id)) return id;
			}
			return null;
		},
		before,
		{ timeout: 10_000 }
	);
	const noteId = await noteIdHandle.jsonValue();
	const card = page.locator(`[data-canvas-card][data-note-id="${noteId}"]`);
	await card.locator('input[type="text"]').first().fill(title);
	const bodyField = card.locator('textarea.mash-sticky-body');
	await bodyField.fill(body);
	await bodyField.blur();
	await waitForStoredNote(page, title, body);
	await card.getByRole('button', { name: 'Collapse sticky' }).click();
	await card.locator('textarea.mash-sticky-body').waitFor({ state: 'detached', timeout: 5_000 });
}

async function selectNotes(page, titles) {
	await page
		.getByRole('navigation', { name: 'Mash dock' })
		.getByRole('button', { name: 'Desk', exact: true })
		.click();
	const peel = page.getByRole('complementary', { name: 'Ingredients' });
	await peel.waitFor();
	for (let index = 0; index < titles.length; index += 1) {
		const button = peel
			.getByRole('option')
			.filter({ hasText: titles[index] })
			.getByRole('button')
			.nth(1);
		if (index === 0) await button.click();
		else await button.click({ modifiers: ['Control'] });
	}
	await page.getByText(`${titles.length} selected`).waitFor();
}

async function overflowMetrics(page) {
	const metrics = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	if (metrics.scrollWidth > metrics.clientWidth) {
		throw new Error(`horizontal overflow ${metrics.scrollWidth} > ${metrics.clientWidth}`);
	}
	return metrics;
}

async function visibleControls(page) {
	return page
		.locator('button, a, input, textarea, select, [role="button"]')
		.evaluateAll((elements) =>
			elements
				.map((element) => {
					const style = getComputedStyle(element);
					const rect = element.getBoundingClientRect();
					const name =
						element.getAttribute('aria-label') ||
						element.getAttribute('placeholder') ||
						element.textContent ||
						'';
					return {
						name: name.trim().replace(/\s+/g, ' ').slice(0, 80),
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
						hidden:
							style.visibility === 'hidden' ||
							style.display === 'none' ||
							rect.width === 0 ||
							rect.height === 0
					};
				})
				.filter((control) => !control.hidden)
		);
}

function boxInside(box, viewport, label) {
	if (!box) throw new Error(`${label} has no box`);
	if (box.x < -1 || box.y < -1) throw new Error(`${label} starts outside the viewport`);
	if (box.x + box.width > viewport.width + 1)
		throw new Error(`${label} extends past the right edge`);
	if (box.y + box.height > viewport.height + 1)
		throw new Error(`${label} extends past the bottom edge`);
}

async function probe(page, bag) {
	await page.goto(PROBE_URL, { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		if (
			bag.aborted.some((entry) => entry.url.startsWith(PROBE_URL) && entry.host === 'example.com')
		) {
			return;
		}
		await page.waitForTimeout(50);
	}
	throw new Error('probe request to example.com was not aborted');
}

function unexpectedConsoleErrors(messages) {
	return messages.filter((message) => !message.startsWith('Mash offline support could not start'));
}

function assertAppQuiet(bag) {
	const appAborted = bag.aborted.filter((entry) => !entry.url.startsWith(PROBE_URL));
	if (appAborted.length > 0) {
		throw new Error(`app requested a non-local host: ${JSON.stringify(appAborted)}`);
	}
	if (bag.pageErrors.length > 0) throw new Error(`page errors: ${bag.pageErrors.join(' | ')}`);
	const consoleErrors = unexpectedConsoleErrors(bag.consoleErrors);
	if (consoleErrors.length > 0) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
	if (bag.networkErrors.length > 0) {
		throw new Error(`network errors: ${JSON.stringify(bag.networkErrors)}`);
	}
}

async function withContext(profile, options, run) {
	await mkdir(profile, { recursive: true });
	const context = await chromium.launchPersistentContext(profile, {
		headless: true,
		...options,
		serviceWorkers: 'block'
	});
	const bag = emptyBag();
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		attach(page, bag);
		await installGate(context, bag);
		const result = await run(page, bag);
		assertAppQuiet(bag);
		await probe(page, bag);
		const appAborted = bag.aborted.filter((entry) => !entry.url.startsWith(PROBE_URL));
		if (appAborted.length > 0) {
			throw new Error(`app requested a non-local host: ${JSON.stringify(appAborted)}`);
		}
		return { result, bag };
	} finally {
		await context.close();
		const decision = deletionTarget(profile);
		if (decision.ok) await rm(decision.path, { recursive: true, force: true });
	}
}

async function driveCreateNote(page, origin, evidenceDir) {
	await bootDesk(page, origin);
	const bootShot = path.join(evidenceDir, 'create-note-boot.png');
	await page.screenshot({ path: bootShot });
	await createNamedNote(page, 'Release checklist', 'Tag and publish');
	const savedShot = path.join(evidenceDir, 'create-note-saved.png');
	await page.screenshot({ path: savedShot });
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('navigation', { name: 'Mash dock' }).waitFor({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Desk', exact: true }).click();
	await page
		.getByRole('complementary', { name: 'Ingredients' })
		.getByRole('option')
		.filter({ hasText: 'Release checklist' })
		.waitFor({ timeout: 15_000 });
	const stored = await waitForStoredNote(page, 'Release checklist', 'Tag and publish');
	const reloadedShot = path.join(evidenceDir, 'create-note-reloaded.png');
	await page.screenshot({ path: reloadedShot });
	return {
		storedTitle: stored.find((note) => note.title === 'Release checklist')?.title ?? null,
		screenshots: [bootShot, savedShot, reloadedShot]
	};
}

async function driveSearch(page, origin, evidenceDir) {
	await bootDesk(page, origin);
	await page
		.getByRole('navigation', { name: 'Mash dock' })
		.getByRole('button', { name: 'Search', exact: true })
		.click();
	const field = page.locator('#global-search');
	await field.waitFor();
	await field.fill('Scoop');
	const results = page.getByRole('listbox', { name: 'Search results' });
	await results.waitFor();
	await results.getByRole('option', { name: /Hi — I'm Scoop/ }).waitFor();
	const matchShot = path.join(evidenceDir, 'search-scoop.png');
	await page.screenshot({ path: matchShot });
	await field.fill('volcano-not-a-note');
	await page.getByText(/No notes match/).waitFor();
	const emptyShot = path.join(evidenceDir, 'search-empty.png');
	await page.screenshot({ path: emptyShot });
	return { screenshots: [matchShot, emptyShot] };
}

async function driveMash(page, origin, evidenceDir) {
	await bootDesk(page, origin);
	await createNamedNote(page, 'Smoke Alpha', 'Alpha body');
	await createNamedNote(page, 'Smoke Beta', 'Beta body');
	await selectNotes(page, ['Smoke Alpha', 'Smoke Beta']);
	await page.getByTestId('selection-mash').click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByRole('heading', { name: 'Mash these notes?' }).waitFor();
	await dialog.getByRole('button', { name: 'Mash', exact: true }).click();
	await page.getByRole('group', { name: /Smoke Alpha \+ Smoke Beta/ }).waitFor({ timeout: 15_000 });
	const notes = await notesInPage(page);
	const title = notes
		.map((note) => note.title)
		.find((value) => value.includes('Smoke Alpha + Smoke Beta'));
	if (!title)
		throw new Error(
			`IndexedDB is missing the mashed note. Titles: ${notes.map((note) => note.title).join(', ')}`
		);
	const shot = path.join(evidenceDir, 'mash-result.png');
	await page.screenshot({ path: shot });
	return { storedTitle: title, screenshots: [shot] };
}

async function driveFinish(page, origin, evidenceDir) {
	await bootDesk(page, origin);
	await page.getByRole('button', { name: 'Finish' }).click();
	const dialog = page.getByRole('dialog', { name: 'Finish this desk' });
	await dialog.waitFor();
	const shot = path.join(evidenceDir, 'finish-open.png');
	await page.screenshot({ path: shot });
	await dialog.getByRole('button', { name: 'Close desk panel' }).click();
	await dialog.waitFor({ state: 'hidden' });
	return { screenshots: [shot] };
}

async function driveMobile(origin, evidenceDir, scratch) {
	const viewports = [];
	for (const viewport of MOBILE_VIEWPORTS) {
		const profile = path.join(scratch, 'profiles', `mobile-${viewport.name}-${Date.now()}`);
		const { result, bag } = await withContext(
			profile,
			{
				viewport: { width: viewport.width, height: viewport.height },
				hasTouch: true,
				isMobile: true,
				deviceScaleFactor: 2
			},
			async (page) => {
				await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
				const notice = page.getByTestId('mobile-desktop-notice');
				await notice.waitFor({ timeout: 30_000 });
				await page
					.getByRole('navigation', { name: 'Mash dock' })
					.waitFor({ state: 'hidden', timeout: 5_000 })
					.catch(() => {});
				if (await page.getByRole('navigation', { name: 'Mash dock' }).count()) {
					throw new Error('phone width mounted the desk');
				}
				const heading = page.getByRole('heading', {
					name: 'Mash is currently optimized for desktop use.'
				});
				await heading.waitFor();
				const headingBox = await heading.boundingBox();
				boxInside(headingBox, viewport, 'heading');
				boxInside(await notice.locator('section').boundingBox(), viewport, 'notice card');
				const overflow = await overflowMetrics(page);
				const controls = await visibleControls(page);
				for (const control of controls) {
					boxInside(control, viewport, control.name || 'control');
					if (control.width < 44 || control.height < 44) {
						throw new Error(`${control.name || 'control'} is ${control.width}x${control.height}`);
					}
				}
				await page.touchscreen.tap(
					headingBox.x + headingBox.width / 2,
					headingBox.y + headingBox.height / 2
				);
				await heading.waitFor();
				const shot = path.join(evidenceDir, `mobile-${viewport.name}.png`);
				await page.screenshot({ path: shot });
				return {
					width: viewport.width,
					height: viewport.height,
					touch: true,
					overflow,
					controlCount: controls.length,
					controls: controls.map((control) => ({
						name: control.name,
						width: control.width,
						height: control.height,
						inside: true
					})),
					headingInside: true,
					screenshot: shot
				};
			}
		);
		viewports.push({
			...result,
			aborted: bag.aborted.map(({ url, host, reason }) => ({ url, host, reason })),
			consoleErrors: unexpectedConsoleErrors(bag.consoleErrors),
			pageErrors: [...bag.pageErrors],
			networkErrors: [...bag.networkErrors]
		});
	}
	return { viewports };
}

async function main() {
	const flag = process.argv.indexOf('--feature');
	const feature = flag >= 0 ? process.argv[flag + 1] : 'create-note';
	if (!FEATURES.has(feature)) {
		throw new Error(`Unknown feature ${feature}. Use ${[...FEATURES].join(', ')}.`);
	}
	const scratch = stateDir();
	const evidence = evidenceDir();
	const state = JSON.parse(await readFile(path.join(scratch, 'state.json'), 'utf8'));
	await mkdir(evidence, { recursive: true });
	const reportPath = path.join(evidence, `${feature}.json`);
	const report = { feature, ok: false, origin: state.origin };
	try {
		if (feature === 'mobile') {
			report.detail = await driveMobile(state.origin, evidence, scratch);
		} else {
			const profile = path.join(scratch, 'profiles', `${feature}-${Date.now()}`);
			const runners = {
				'create-note': driveCreateNote,
				search: driveSearch,
				mash: driveMash,
				finish: driveFinish
			};
			const { result, bag } = await withContext(
				profile,
				{ viewport: DESKTOP, deviceScaleFactor: 1 },
				async (page) => runners[feature](page, state.origin, evidence)
			);
			report.detail = result;
			report.aborted = bag.aborted.map(({ url, host, reason }) => ({ url, host, reason }));
			report.consoleErrors = unexpectedConsoleErrors(bag.consoleErrors);
			report.pageErrors = bag.pageErrors;
			report.networkErrors = bag.networkErrors;
		}
		report.ok = true;
		console.log(`drive ok ${feature}`);
	} catch (error) {
		report.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		await writeFile(reportPath, JSON.stringify(report, null, 2));
		console.log(`report ${reportPath}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
