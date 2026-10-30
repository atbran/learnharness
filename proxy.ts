import { NextResponse, type NextRequest } from "next/server";
import { isTailnetRequest } from "./src/core/ipad-access.ts";
import { desktopAPIAuthorized } from "./src/server/desktop-access.ts";
import { tailnetAuthorized } from "./src/server/ipad-access.ts";

/** Two gates.
 *
 * Tailnet (the iPad, through `tailscale serve`): EVERY path, pages and
 * static files included, needs iPad access on and the PC's own Tailscale
 * user (src/server/ipad-access.ts).
 *
 * Local: applies to every API method, including SSE and spending/settings
 * routes. No public callback or worker bypass: internal jobs call server
 * functions, and any legitimate self-HTTP request must carry the private
 * capability. */
export async function proxy(request: NextRequest) {
	if (isTailnetRequest(request.headers)) {
		if (await tailnetAuthorized(request.headers)) return NextResponse.next();
		return new NextResponse("LearnHarness: this device isn't allowed in. Turn on iPad access on the PC and sign in to Tailscale with the PC's account.", {
			status: 403,
			headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	if (!request.nextUrl.pathname.startsWith("/api")) return NextResponse.next();
	if (!desktopAPIAuthorized(request.headers)) {
		return NextResponse.json(
			{ error: "Desktop API access requires the trusted LearnHarness window." },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
	return NextResponse.next();
}
