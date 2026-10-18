import { OnboardingExperience } from "../features/onboarding/OnboardingExperience";
import styles from "../features/onboarding/onboarding.css?inline";

export default function Entrance() {
  return <>
    <style>{`body { margin: 0; background: #f7f4eb; }\n${styles}`}</style>
    <OnboardingExperience variant="application" />
  </>;
}
