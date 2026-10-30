import { redirect } from "next/navigation";

// The physics program is the home; the knowledge graph lives at /graph.
export default function HomePage() {
	redirect("/program");
}
