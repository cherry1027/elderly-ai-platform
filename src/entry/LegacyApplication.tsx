import App from "../App";
import "../index.css";

// Keep existing routes/authentication intact, outside the public entrance graph.
// The safe entry-review configuration replaces this module with an inert view.
export default function LegacyApplication() {
  return <App />;
}
