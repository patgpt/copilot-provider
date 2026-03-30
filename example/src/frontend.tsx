/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { throwIfNull } from "./lib/utils";

const elem = throwIfNull(document.getElementById("root"));
const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.

	// Assignment within this expression is intentional to persist the root across HMR updates.

	// biome-ignore lint/suspicious/noAssignInExpressions: Intentionally using assignment in expression for hot module reloading state persistence.
	const root = (import.meta.hot.data.root ??= createRoot(elem));

	root.render(app);
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(app);
}
