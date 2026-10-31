/** Server start hook: the production server (npm run pc) resumes the
 *  background demo, notes, worked-example and flashcard builds if they were left on. Dev servers never do, so a
 *  dev server beside the launcher doesn't build the same demos twice. */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
	const { resumeDemoPrebuild } = await import("./src/server/demo-prebuild.ts");
	resumeDemoPrebuild();
	const { resumeNotesPrebuild } = await import("./src/server/notes.ts");
	resumeNotesPrebuild();
	const { resumeExamplesPrebuild } = await import("./src/server/examples.ts");
	resumeExamplesPrebuild();
	const { resumeFlashcardsPrebuild } = await import("./src/server/flashcards.ts");
	resumeFlashcardsPrebuild();
}
