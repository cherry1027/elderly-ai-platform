import { render, screen } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { rootNavigationCopy } from '../src/root-navigation-copy';
describe('honest real contract orientation', () => {
  it.each(['en', 'sv'] as const)('shows real service availability rather than claiming simulated behavior for %s', async language => {
    await render(<HomeScreen language={language} apiContract="real-v2" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />);
    expect(screen.getByText(rootNavigationCopy[language].realAvailability)).toBeTruthy();
    expect(screen.queryByText(rootNavigationCopy[language].simulation)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves the original simulation notice in the separate legacy workflow', async () => {
    await render(<HomeScreen language="en" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />);
    expect(screen.getByText(rootNavigationCopy.en.simulation)).toBeTruthy();
  });
});
