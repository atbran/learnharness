/** Server start hook: the production server (npm run pc) resumes the
 *  background demo build if it was left on. Dev servers never do, so a
 *  dev server beside the launcher doesn't build the same demos twice. */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
	const { resumeDemoPrebuild } = await import("./src/server/demo-prebuild.ts");
	resumeDemoPrebuild();
}
