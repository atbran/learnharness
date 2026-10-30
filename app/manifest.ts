import type { MetadataRoute } from "next";

/** Web app manifest for the iPad home-screen companion (served at
 * /manifest.webmanifest). Colors = the app's --background token in
 * app/globals.css (#141414; the app is always dark). Icons are derived from
 * build/icon.png: opaque on #141414 so iOS never fills transparent corners
 * with black, plus a maskable one with the glyph inside the safe zone. */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "LearnHarness",
		short_name: "LearnHarness",
		description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
		id: "/",
		start_url: "/program",
		scope: "/",
		display: "standalone",
		background_color: "#141414",
		theme_color: "#141414",
		icons: [
			{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
