import { createRoot } from "react-dom/client";
import LoginApplication from "../../features/login/LoginApplication";

// This entry is served only by the dedicated login configuration. Importing the
// legacy main/App/AuthProvider here would initialize the old Supabase project.
const element = document.getElementById("root");
if (element && import.meta.env.DEV && import.meta.env.MODE === "login") {
  createRoot(element).render(<LoginApplication />);
}
