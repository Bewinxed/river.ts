import { sveltekit } from "@sveltejs/kit/vite";
// import { defineConfig } from "vitest/config.js";

export default {
	plugins: [sveltekit()],
	test: {
		include: ["./src/**/*.{test,spec}.{js,ts}"],
	},
	server: {
		host: "127.0.0.1"
	}
};
