"use client";
/**
 * Settings → iPad: serve this PC's LearnHarness to the user's iPad over
 * Tailscale (the server side is src/server/ipad-access.ts). Shows what the
 * PC's serve config already uses, so another app's port is never taken.
 */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { BrailleSpinner } from "@/components/braille-spinner";
import { IPAD_DEFAULT_PORT, IPAD_LOCAL_PORT, IPAD_TARGET } from "@/src/core";
import { SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";

interface ServeEntry {
	port: number;
	proxy: string | null;
}
interface IpadStatus {
	installed: boolean;
	backendState: string | null;
	owner: string | null;
	host: string | null;
	config: { enabled: boolean; port: number };
	ports: ServeEntry[];
	serving: boolean;
	url: string | null;
	localPort: number;
	error: string | null;
}

const isOurs = (e: ServeEntry) => e.proxy?.replace("localhost", "127.0.0.1").replace(/\/$/, "") === IPAD_TARGET;

export function IpadSettings() {
	const [status, setStatus] = useState<IpadStatus | null>(null);
	const [port, setPort] = useState(String(IPAD_DEFAULT_PORT));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ text: string; link?: string | null } | null>(null);
	const [qr, setQr] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	// The launcher serves on IPAD_LOCAL_PORT; a dev server elsewhere isn't what the iPad reaches.
	const [here, setHere] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetch("/api/ipad", { cache: "no-store" });
		const s = (await res.json()) as IpadStatus;
		setStatus(s);
		setPort(String(s.config.port));
	}, []);

	useEffect(() => {
		setHere(window.location.port);
		void load();
	}, [load]);

	useEffect(() => {
		if (!status?.serving || !status.url) return setQr(null);
		void QRCode.toDataURL(status.url, { margin: 1, width: 220 }).then(setQr, () => setQr(null));
	}, [status?.serving, status?.url]);

	const apply = async (enabled: boolean) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/ipad", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled, port: Number(port) }),
			});
			const body = (await res.json()) as { ok: boolean; error?: string; link?: string | null; status?: IpadStatus };
			if (body.status) setStatus(body.status);
			if (!body.ok) setError({ text: body.error ?? `Failed (${res.status})`, link: body.link });
		} catch (err) {
			setError({ text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	if (!status) return <p className="text-xs text-muted-foreground/70">Checking Tailscale…</p>;

	const running = status.backendState === "Running";
	const others = status.ports.filter((e) => !isOurs(e));
	const portNum = Number(port);
	const clash = others.find((e) => e.port === portNum);
	const onLauncher = here === String(IPAD_LOCAL_PORT);

	return (
		<>
			{!status.installed && <Note>Tailscale isn't installed on this PC. Install it from tailscale.com, sign in, then come back.</Note>}
			{status.installed && !running && <Note>Tailscale isn't running or signed in on this PC ({status.backendState ?? "unknown"}). Open Tailscale and sign in.</Note>}
			{status.error && <Note>{status.error}</Note>}

			<SettingsRow
				label="Serve to my iPad"
				hint={status.owner ? `Only ${status.owner}'s devices on your tailnet can open it.` : "Over your private Tailscale network only."}
				testid="row-ipad-access"
			>
				<span className="flex items-center gap-2">
					{busy && <BrailleSpinner label="Updating Tailscale" />}
					<Toggle checked={status.serving} disabled={busy || !running || (!status.serving && !!clash)} label="ipad access" onChange={(on) => void apply(on)} />
				</span>
			</SettingsRow>

			<SettingsRow
				label="Tailscale HTTPS port"
				hint={clash ? `Port ${clash.port} is used by another app (${clash.proxy ?? "TCP"}).` : "The iPad's address uses this port."}
				dimmed={status.serving}
				testid="row-ipad-port"
			>
				<input
					type="number"
					min={1}
					max={65535}
					value={port}
					disabled={status.serving || busy}
					onChange={(e) => setPort(e.target.value)}
					className="w-24 rounded-sm border border-border bg-background px-2 py-1 text-right text-sm"
					aria-label="Tailscale HTTPS port"
				/>
			</SettingsRow>
			{others.length > 0 && (
				<p className="text-xs text-muted-foreground/70">
					Already used on this PC: {others.map((e) => `${e.port} → ${e.proxy ?? "TCP"}`).join(" · ")}. LearnHarness never changes these.
				</p>
			)}

			{error && (
				<Note>
					{error.text}
					{error.link && (
						<>
							{" "}
							<a href={error.link} target="_blank" rel="noreferrer" className="underline">
								Enable it in Tailscale
							</a>
							, then turn this on again.
						</>
					)}
				</Note>
			)}

			{status.serving && status.url && (
				<SettingsGroup label="On the iPad" testid="ipad-url">
					{!onLauncher && (
						<Note>
							This window isn&apos;t the launcher&apos;s server (port {IPAD_LOCAL_PORT}). The iPad reaches the PC only while LearnHarness runs from the desktop
							shortcut or <code>npm run pc</code>.
						</Note>
					)}
					<div className="flex flex-wrap items-start gap-4">
						{/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
						{qr && <img src={qr} alt="QR code for the iPad address" width={140} height={140} className="rounded-sm bg-white p-1" />}
						<div className="min-w-0 flex-1 space-y-2 text-sm">
							<p className="break-all font-mono text-xs">{status.url}</p>
							<Button
								type="button"
								size="xs"
								variant="outline"
								onClick={() =>
									void navigator.clipboard.writeText(status.url!).then(() => {
										setCopied(true);
										setTimeout(() => setCopied(false), 1500);
									})
								}
							>
								{copied ? "Copied" : "Copy address"}
							</Button>
							<ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
								<li>Install Tailscale on the iPad and sign in as {status.owner ?? "the same account"}.</li>
								<li>Scan the code with the iPad camera (or open the address in Safari).</li>
								<li>Share → Add to Home Screen. It opens full screen like an app.</li>
								<li>Keep LearnHarness running on the PC while you study.</li>
							</ol>
						</div>
					</div>
				</SettingsGroup>
			)}
		</>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return <p className="rounded-sm border border-border px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}
