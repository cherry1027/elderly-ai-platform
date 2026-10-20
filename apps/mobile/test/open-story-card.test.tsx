import { fireEvent, render, screen } from '@testing-library/react-native';
import type { StoryProject } from '../src/api/story-projects';
import { MyStoriesScreen } from '../src/screens/MyStoriesScreen';
import { storiesCopy } from '../src/stories-copy';

const projects: StoryProject[] = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Synthetic English story', description: null, language: 'en', status: 'draft', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Påhittad svensk berättelse', description: null, language: 'sv', status: 'unknown', created_at: '2026-10-19T12:00:00Z', updated_at: '2026-10-19T12:00:00Z' },
];
it.each(['en', 'sv'] as const)('opens only the intentionally selected story ID with readable controls in %s', language => {
  const onOpenStory = jest.fn();
  render(<MyStoriesScreen language={language} user={{ id: 'synthetic-user', email: 'synthetic@example.test' }}
    state={{ status: 'ready', projects }} onOpenStory={onOpenStory} onRefresh={jest.fn()} onCreateStory={jest.fn()} onSignOut={jest.fn()} />);
  expect(onOpenStory).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: `${storiesCopy[language].openStory}: ${projects[1].title}` });
  expect(button).toHaveStyle({ minHeight: 56 }); fireEvent.press(button);
  expect(onOpenStory).toHaveBeenCalledWith(projects[1].id); expect(onOpenStory).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
