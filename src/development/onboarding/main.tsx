import { createRoot } from "react-dom/client";
import { OnboardingExperience } from "../../features/onboarding/OnboardingExperience";

const root = document.getElementById("root");
if (root) createRoot(root).render(<OnboardingExperience />);
