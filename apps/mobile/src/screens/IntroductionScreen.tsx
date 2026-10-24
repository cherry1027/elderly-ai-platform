import { useEffect, useRef, type ComponentRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { AnimatedMemoryBook } from '../components/AnimatedMemoryBook';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { introCopy, type IntroScene } from '../intro-copy';
import { colors, headingFont } from '../theme';
import { useReducedMotion } from '../useReducedMotion';

interface IntroductionScreenProps {
  language: Language;
  scene: IntroScene;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onEnter: () => void;
}

export function IntroductionScreen({
  language, scene, onNext, onBack, onSkip, onEnter,
}: IntroductionScreenProps) {
  const text = introCopy[language];
  const current = text.scenes[scene];
  const locale = accessibilityLanguages[language];
  const reducedMotion = useReducedMotion();
  const heading = useRef<ComponentRef<typeof Text>>(null);
  const headingLaidOut = useRef(false);
  const requestHeadingFocus = useRef<(() => void) | undefined>(undefined);

  // The route keys this screen by scene. Focus once on a newly entered scene,
  // without moving normal keyboard focus or refocusing on language/layout edits.
  useEffect(() => {
    let active = true;
    let readerEnabled = false;
    let requested = false;
    let frame: number | undefined;
    const focus = () => {
      if (!active || !readerEnabled || !headingLaidOut.current || requested) return;
      requested = true;
      frame = requestAnimationFrame(() => {
        if (!active || !heading.current) return;
        try {
          AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
        } catch {
          // Native focus support is best effort; navigation remains available.
        }
      });
    };
    requestHeadingFocus.current = focus;
    void (async () => {
      try {
        readerEnabled = await AccessibilityInfo.isScreenReaderEnabled();
        focus();
      } catch {
        // Leave focus unchanged when device accessibility state is unavailable.
      }
    })();
    return () => {
      active = false;
      requestHeadingFocus.current = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <Screen>
      <MemyBrand />
      <Text
        allowFontScaling
        accessibilityLanguage={locale}
        accessibilityLiveRegion="polite"
        style={screenStyles.footer}
      >
        {text.progress(scene + 1)}
      </Text>
      <View style={screenStyles.section}>
        <Text allowFontScaling accessibilityLanguage={locale} style={styles.eyebrow}>
          {current.eyebrow}
        </Text>
        <Text
          ref={heading}
          accessible
          accessibilityRole="header"
          accessibilityLanguage={locale}
          allowFontScaling
          style={[screenStyles.heading, styles.heading]}
          onLayout={() => {
            headingLaidOut.current = true;
            requestHeadingFocus.current?.();
          }}
        >
          {current.title}
        </Text>
        <Text allowFontScaling accessibilityLanguage={locale} style={screenStyles.description}>
          {current.description}
        </Text>
      </View>
      <AnimatedMemoryBook scene={scene} language={language} motion={!reducedMotion} />
      <View style={screenStyles.section}>
        <Text allowFontScaling accessibilityLanguage={locale} style={screenStyles.description}>
          {current.caption}
        </Text>
        <Text allowFontScaling accessibilityLanguage={locale} style={screenStyles.footer}>
          {text.illustration}
        </Text>
      </View>
      <View style={styles.controls}>
        <LargeButton
          label={scene === 2 ? text.enter : text.next}
          language={language}
          onPress={scene === 2 ? onEnter : onNext}
        />
        <LargeButton label={text.back} language={language} onPress={onBack} variant="secondary" />
        <LargeButton label={text.skip} language={language} onPress={onSkip} variant="secondary" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: headingFont },
  eyebrow: {
    color: colors.forest,
    fontSize: 19,
    lineHeight: 29,
    textAlign: 'center',
    flexShrink: 1,
  },
  controls: { width: '100%', gap: 16 },
});
