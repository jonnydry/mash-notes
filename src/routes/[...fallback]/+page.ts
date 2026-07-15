import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: PageLoad = () => {
	redirect(307, '/');
};
