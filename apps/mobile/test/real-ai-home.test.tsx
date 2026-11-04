import { render, screen } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { rootNavigationCopy } from '../src/root-navigation-copy';
describe('honest real contract orientation', () => {
  it.each(['en', 'sv'] as const)('keeps %s real Home focused on the story choices without infrastructure copy', async language => {
    await render(<HomeScreen language={language} apiContract="real-v2" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />);
    expect(screen.queryByText(rootNavigationCopy[language].realAvailability)).toBeNull();
    expect(screen.getByRole('button', { name: rootNavigationCopy[language].openStories })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: rootNavigationCopy[language].createStory })).toBeOnTheScreen();
    expect(screen.queryByText(rootNavigationCopy[language].simulation)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves the original simulation notice in the separate legacy workflow', async () => {
    await render(<HomeScreen language="en" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />);
    expect(screen.getByText(rootNavigationCopy.en.simulation)).toBeTruthy();
  });
});
