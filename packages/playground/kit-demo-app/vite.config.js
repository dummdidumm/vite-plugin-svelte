// eslint-disable-next-line node/no-missing-import
import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
const config = {
	plugins: [sveltekit()],
	css: {
		devSourcemap: true
	}
};

export default config;
