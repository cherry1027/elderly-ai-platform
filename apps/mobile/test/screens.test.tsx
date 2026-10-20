import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LargeButton } from '../src/components/LargeButton';
import { accessibilityLanguages, copy, type Language } from '../src/i18n';
import { LanguageScreen } from '../src/screens/LanguageScreen';
import { WelcomeScreen } from '../src/screens/WelcomeScreen';
import { colors, layout } from '../src/theme';
import { introCopy } from '../src/intro-copy';

describe('language selection', () => {
  it('shows readable language self-names with an explicitly checked English default', () => {
    render(<LanguageScreen language="en" onSelectLanguage={jest.fn()} onContinue={jest.fn()} />);

    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByRole('radio', { name: 'Svenska' }).props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText('Selected')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Choose your language' })).toBeOnTheScreen();
    expect(screen.getByText('Memy')).toBeOnTheScreen();
  });

  it('requests the selected language and updates checked states when the parent supplies it', () => {
    const onSelectLanguage = jest.fn();
    const onContinue = jest.fn();
    const view = render(
      <LanguageScreen language="en" onSelectLanguage={onSelectLanguage} onContinue={onContinue} />,
    );

    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    expect(onSelectLanguage).toHaveBeenCalledTimes(1);
    expect(onSelectLanguage).toHaveBeenCalledWith('sv');
    expect(onContinue).not.toHaveBeenCalled();

    view.rerender(
      <LanguageScreen language="sv" onSelectLanguage={onSelectLanguage} onContinue={onContinue} />,
    );
    expect(screen.getByRole('radio', { name: 'Svenska' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText('Valt')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Välj ditt språk' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(onSelectLanguage).toHaveBeenLastCalledWith('en');
  });

  it.each<Language>(['en', 'sv'])('offers one working primary Continue action in %s', (language) => {
    const onContinue = jest.fn();
    render(<LanguageScreen language={language} onSelectLanguage={jest.fn()} onContinue={onContinue} />);

    const next = screen.getByRole('button', { name: copy[language].continue });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(next.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    fireEvent.press(next);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('announces each language choice using its own pronunciation locale', () => {
    render(<LanguageScreen language="sv" onSelectLanguage={jest.fn()} onContinue={jest.fn()} />);

    expect(screen.getByRole('radio', { name: 'Svenska' }).props.accessibilityLanguage).toBe('sv-SE');
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityLanguage).toBe('en-GB');
  });

  it('provides a visible focus treatment without changing the selected language', () => {
    render(<LanguageScreen language="en" onSelectLanguage={jest.fn()} onContinue={jest.fn()} />);

    const swedish = screen.getByRole('radio', { name: 'Svenska' });
    fireEvent(swedish, 'focus');
    expect(swedish).toHaveStyle({ borderColor: colors.ink });
    expect(swedish.props.accessibilityState).toEqual({ checked: false });
    fireEvent(swedish, 'blur');
    expect(swedish).toHaveStyle({ borderColor: colors.border });
  });

  it.each<Language>(['en', 'sv'])('offers an optional returning Back action without presenting it as cancelling selected preferences in %s', language => {
    const onBack = jest.fn(), onSelectLanguage = jest.fn(), onContinue = jest.fn();
    render(<LanguageScreen language={language} onSelectLanguage={onSelectLanguage} onContinue={onContinue} onBack={onBack} />);
    const back = screen.getByRole('button', { name: introCopy[language].back });
    expect(back).toHaveStyle({ minHeight: 56 });
    expect(back.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    expect(screen.queryByRole('button', { name: /cancel|avbryt/i })).toBeNull();
    fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1); expect(onContinue).not.toHaveBeenCalled(); expect(onSelectLanguage).not.toHaveBeenCalled();
  });
});

describe('Welcome', () => {
  it.each<Language>(['en', 'sv'])('renders the approved %s wording and working language-change action', (language) => {
    const onChangeLanguage = jest.fn();
    render(<WelcomeScreen language={language} onChangeLanguage={onChangeLanguage} />);

    const heading = screen.getByRole('header', { name: copy[language].welcomeTitle });
    expect(heading.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    expect(screen.getByText(copy[language].welcomeDescription)).toBeOnTheScreen();
    expect(screen.getByText(copy[language].welcomeEyebrow)).toBeOnTheScreen();
    expect(screen.getByText(copy[language].footer)).toBeOnTheScreen();
    expect(screen.getByText('Memy')).toBeOnTheScreen();

    const buttons = screen.getAllByRole('button');
    expect(buttons.filter((button) => !button.props.accessibilityState?.disabled)).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
    expect(onChangeLanguage).toHaveBeenCalledTimes(1);
  });

  it('does not enable unavailable authentication, guest or story-creation actions', () => {
    render(<WelcomeScreen language="en" onChangeLanguage={jest.fn()} />);

    for (const name of ['Log In', 'Create Account', 'Continue as Guest']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.queryByText(/create my story/i)).toBeNull();
    expect(screen.getAllByRole('button').filter((button) => !button.props.accessibilityState?.disabled)).toHaveLength(1);
  });

  it.each<Language>(['en', 'sv'])('offers only an explicitly supplied primary action before the unavailable account controls in %s', language => {
    const onPress = jest.fn(), label = language === 'sv' ? 'Öppna exempelberättelser' : 'Open sample stories';
    render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} primaryAction={{ label, onPress }} />);
    const primary = screen.getByRole('button', { name: label });
    expect(primary).toHaveStyle({ minHeight: 56 }); expect(primary.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    expect(onPress).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button');
    expect(buttons.indexOf(primary)).toBeLessThan(buttons.indexOf(screen.getByRole('button', { name: introCopy[language].login })));
    for (const name of [introCopy[language].login, introCopy[language].register, introCopy[language].guest]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.press(primary); expect(onPress).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('readability and flexible native layout', () => {
  const cases = [
    { name: 'English language screen', language: 'en', welcome: false },
    { name: 'Swedish language screen', language: 'sv', welcome: false },
    { name: 'English Welcome', language: 'en', welcome: true },
    { name: 'Swedish Welcome', language: 'sv', welcome: true },
  ] as const;

  it.each(cases)('$name keeps all text scalable without truncation or shrink-to-fit', ({ language, welcome }) => {
    render(welcome
      ? <WelcomeScreen language={language} onChangeLanguage={jest.fn()} />
      : <LanguageScreen language={language} onSelectLanguage={jest.fn()} onContinue={jest.fn()} />);

    for (const text of screen.UNSAFE_getAllByType(Text)) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).not.toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
      const style = StyleSheet.flatten(text.props.style);
      expect(style?.height).toBeUndefined();
      expect(style?.maxHeight).toBeUndefined();
    }
  });

  it.each(cases)('$name provides large targets, four safe edges and vertical scrolling', ({ language, welcome }) => {
    render(welcome
      ? <WelcomeScreen language={language} onChangeLanguage={jest.fn()} />
      : <LanguageScreen language={language} onSelectLanguage={jest.fn()} onContinue={jest.fn()} />);

    for (const target of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('radio')]) {
      expect(target).toHaveStyle({ minHeight: layout.minimumTouchTarget });
      const style = StyleSheet.flatten(target.props.style);
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
    }
    expect(layout.minimumTouchTarget).toBeGreaterThanOrEqual(56);
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    const scrollView = screen.UNSAFE_getByType(ScrollView);
    expect(scrollView.props.scrollEnabled).not.toBe(false);
    expect(StyleSheet.flatten(scrollView.props.contentContainerStyle)).toMatchObject({ flexGrow: 1 });
  });

  it('uses percentage width and a readable maximum instead of assuming phone dimensions', () => {
    render(<WelcomeScreen language="sv" onChangeLanguage={jest.fn()} />);

    const content = screen.UNSAFE_getAllByType(View).find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.maxWidth === layout.contentWidth && style?.flexGrow === 1;
    });
    expect(content).toBeDefined();
    expect(StyleSheet.flatten(content?.props.style)).toMatchObject({ width: '100%', maxWidth: 480 });
    // Jest does not run native layout. Actual small-screen/large-font checks
    // remain on the Android device verification checklist.
  });

  it.each(['primary', 'secondary'] as const)('%s buttons retain readable labels and visible keyboard focus', (variant) => {
    const onPress = jest.fn();
    render(<LargeButton label="Change language" language="en" onPress={onPress} variant={variant} />);
    const button = screen.getByRole('button', { name: 'Change language' });

    expect(button).toHaveStyle({ minHeight: 56 });
    fireEvent(button, 'focus');
    expect(button).toHaveStyle({ borderColor: colors.ink });
    fireEvent(button, 'blur');
    expect(button).toHaveStyle({ borderColor: colors.forest });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
