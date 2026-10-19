import { useId } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/** Native adaptation of the existing web Welcome wordmark and sprout path. */
export function MemyBrand() {
  return (
    <View style={styles.brand}>
      <Svg
        width={34}
        height={38}
        viewBox="0 0 30 32"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path
          d="M15 27V8M15 15C4 15 3 7 4 3c7 0 11 4 11 12Zm0 7c10 0 12-7 11-12-7 0-11 5-11 12Z"
          fill="none"
          stroke="#345b46"
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
      <Text allowFontScaling style={styles.wordmark}>Memy</Text>
    </View>
  );
}

/**
 * Static native version of the web MemoryBookScene's settled Welcome artwork.
 * The original page, cover, foliage and pencil paths are preserved. The web
 * action button, cursor and draft label are deliberately absent here.
 */
export function MemoryBookArtwork() {
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '');
  const paper = `memy-paper-${instance}`;
  const cover = `memy-cover-${instance}`;
  const pageShade = `memy-page-shade-${instance}`;

  return (
    <View
      style={styles.artwork}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" viewBox="0 0 760 650" accessible={false}>
        <Defs>
          <LinearGradient id={paper} x1="0" y1="0" x2="1" y2="1">
            <Stop stopColor="#fffef6" />
            <Stop offset="1" stopColor="#eee4cf" />
          </LinearGradient>
          <LinearGradient id={cover} x1="0" y1="0" x2="0.8" y2="1">
            <Stop stopColor="#547767" />
            <Stop offset="1" stopColor="#254c3c" />
          </LinearGradient>
          <LinearGradient id={pageShade}>
            <Stop stopColor="#9d8968" stopOpacity="0" />
            <Stop offset="0.48" stopColor="#9d8968" stopOpacity="0" />
            <Stop offset="0.51" stopColor="#796348" stopOpacity="0.2" />
            <Stop offset="0.56" stopColor="#9d8968" stopOpacity="0" />
            <Stop offset="1" stopColor="#9d8968" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Rect x="151" y="79" width="464" height="465" rx="220" fill="#e3e9dd" />
        <Rect x="176" y="101" width="420" height="419" rx="199" fill="none" stroke="#b6c5af" />
        <Path d="M95 346c13-45 13-76-4-98m0 0c-17 24-10 43 6 52m-6-52c27 8 31 23 12 42" fill="none" stroke="#91a48c" strokeWidth="2" strokeLinecap="round" />
        <Path d="M643 401c4-47 15-80 36-105m-16 29c-24-6-32 13-16 29m16-29c30 6 31 25-5 25" fill="none" stroke="#91a48c" strokeWidth="2" strokeLinecap="round" />
        <Circle cx="643" cy="197" r="5" fill="#b39b61" />
        <Circle cx="115" cy="437" r="4" fill="#b39b61" />
        <Path d="M606 114v14m-7-7h14M124 192v12m-6-6h12" stroke="#b39b61" strokeWidth="2" strokeLinecap="round" />
        <Ellipse cx="382" cy="551" rx="251" ry="22" fill="#685c40" opacity="0.09" />
        <Ellipse cx="382" cy="549" rx="191" ry="12" fill="#685c40" opacity="0.08" />

        <G>
          <Path d="M123 204c81-33 171-26 257 16 88-42 178-49 259-16v299c-89-30-175-23-259 19-83-42-171-49-257-19Z" fill={`url(#${cover})`} />
          <Path d="M134 216c81-29 162-20 246 18 84-38 165-47 248-18v272c-86-24-169-17-248 22-81-39-164-46-246-22Z" fill="none" stroke="#bba466" strokeWidth="1.5" />
          <Path d="M141 203c75-28 158-18 239 19v284c-80-39-165-47-239-20Z" fill="#cabc9d" />
          <Path d="M145 196c78-28 157-17 235 21v279c-80-39-161-48-235-21Z" fill="#e7dcc4" />
          <Path d="M150 187c75-26 151-16 230 23v277c-80-39-160-48-230-22Z" fill={`url(#${paper})`} />
          <Path d="M161 456c65-20 133-12 207 19M156 472c73-23 146-12 216 21" fill="none" stroke="#cbbc9d" />
          <Path d="M380 222c81-37 163-47 239-19v283c-74-27-159-19-239 20Z" fill="#cabc9d" />
          <Path d="M380 217c78-38 158-49 235-21v279c-74-27-155-18-235 21Z" fill="#e7dcc4" />
          <Path d="M380 210c79-39 155-49 230-23v278c-70-26-150-17-230 22Z" fill={`url(#${paper})`} />
          <Path d="M392 475c74-31 142-39 207-19M388 493c70-33 143-44 216-21" fill="none" stroke="#cbbc9d" />
          <Path d="M150 187c75-26 151-16 230 23 79-39 155-49 230-23v278c-70-26-150-17-230 22-80-39-160-48-230-22Z" fill={`url(#${pageShade})`} />
          <Path d="M380 215v269" fill="none" stroke="#cdbfa6" strokeWidth="1.5" />
          <Path d="M391 479v66l13-9 13 2v-72" fill="#c5a460" />

          <Path d="M219 289h83" stroke="#b69b5f" strokeWidth="2" strokeLinecap="round" />
          <Path d="M204 324h119M204 341h108M204 358h119M204 375h88M204 403h119M204 420h94" stroke="#aaa089" strokeWidth="4" strokeLinecap="round" />
          <Rect x="425" y="256" width="25" height="27" rx="3" fill="#d6ddcb" />
          <Path d="M434 270h7" stroke="#5c7654" strokeWidth="2" strokeLinecap="round" />
          <Path d="M463 265h87M463 278h57" stroke="#8c9878" strokeWidth="4" strokeLinecap="round" />
          <Path d="M425 310h126M425 327h115M425 344h126M425 361h92M425 395h126M425 412h105M425 429h72" stroke="#aaa089" strokeWidth="4" strokeLinecap="round" />
        </G>

        <G>
          <Rect x="87" y="297" width="86" height="107" rx="16" fill="#fffdf6" stroke="#d7d6c5" transform="rotate(-9 130 350)" />
          <Path d="M115 361c-2-23 9-36 27-43 1 24-9 37-27 43Z" fill="#98ac88" />
          <Path d="m112 375 21-38" stroke="#55734c" strokeWidth="2" strokeLinecap="round" />
          <Path d="M105 385h39" stroke="#c9bea6" strokeWidth="3" strokeLinecap="round" />
        </G>
        <G transform="translate(578 452) rotate(34)">
          <Rect x="0" y="-88" width="17" height="104" rx="3" fill="#b79b5e" />
          <Path d="M4-74v86M12-74v86" stroke="#e4ce95" strokeWidth="2" />
          <Path d="m0 16 8.5 20L17 16" fill="#e4d2ad" />
          <Path d="m5 28 3.5 8 3.5-8" fill="#635444" />
          <Path d="M0-75h17" stroke="#395e48" strokeWidth="5" />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 10,
    rowGap: 4,
    width: '100%',
  },
  wordmark: {
    color: '#345b46',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
    fontSize: 42,
    flexShrink: 1,
    textAlign: 'center',
  },
  artwork: {
    width: '100%',
    maxWidth: 480,
    aspectRatio: 760 / 650,
    alignSelf: 'center',
  },
});
