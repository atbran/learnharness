"use client";

import { useEffect } from "react";

/** Whether this page should run public/sw.js: production build, served over
 * https (the Tailscale serve origin the iPad uses), and not the Electron
 * window (its preload exposes window.lh). `next dev` and plain-http
 * localhost therefore never get a worker. */
export function wantsServiceWorker(env: { production: boolean; protocol: string; electron: boolean }): boolean {
	return env.production && env.protocol === "https:" && !env.electron;
}

/** Registers the iPad companion's service worker (offline page + static
 * asset cache). Where it isn't wanted, removes any worker this origin
 * registered earlier (e.g. a dev server now running on the same https
 * origin), so a stale cache can never shadow a dev build. */
export default function ServiceWorkerRegister() {
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		const wanted = wantsServiceWorker({
			production: process.env.NODE_ENV === "production",
			protocol: location.protocol,
			electron: "lh" in window,
		});
		if (wanted) {
			navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
		} else {
			navigator.serviceWorker
				.getRegistrations()
				.then((regs) => Promise.all(regs.map((r) => r.unregister())))
				.catch(() => {});
		}
	}, []);
	return null;
}
