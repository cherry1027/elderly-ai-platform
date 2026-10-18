import { useId } from "react";

interface MemoryBookSceneProps {
  scene: 0 | 1 | 2;
  language: "en" | "sv";
  motion: boolean;
}

/** Decorative, original vector artwork. The settled composition is the default. */
export function MemoryBookScene({ scene, language, motion }: MemoryBookSceneProps) {
  const id = useId().replace(/:/g, "");
  const paper = `${id}-paper`;
  const cover = `${id}-cover`;
  const pageShade = `${id}-page-shade`;

  return (
    <svg
      key={`${scene}-${motion}`}
      className={`memory-book-scene memory-book-scene-${scene + 1}`}
      data-motion={motion ? "on" : "off"}
      viewBox="0 0 760 650"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fffef6" />
          <stop offset="1" stopColor="#eee4cf" />
        </linearGradient>
        <linearGradient id={cover} x1="0" y1="0" x2="0.8" y2="1">
          <stop stopColor="#547767" />
          <stop offset="1" stopColor="#254c3c" />
        </linearGradient>
        <linearGradient id={pageShade}>
          <stop stopColor="#9d8968" stopOpacity="0" />
          <stop offset="0.48" stopColor="#9d8968" stopOpacity="0" />
          <stop offset="0.51" stopColor="#796348" stopOpacity="0.2" />
          <stop offset="0.56" stopColor="#9d8968" stopOpacity="0" />
          <stop offset="1" stopColor="#9d8968" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="151" y="79" width="464" height="465" rx="220" fill="#e3e9dd" />
      <rect x="176" y="101" width="420" height="419" rx="199" fill="none" stroke="#b6c5af" strokeWidth="1" />
      <path d="M95 346c13-45 13-76-4-98m0 0c-17 24-10 43 6 52m-6-52c27 8 31 23 12 42" fill="none" stroke="#91a48c" strokeWidth="2" strokeLinecap="round" />
      <path d="M643 401c4-47 15-80 36-105m-16 29c-24-6-32 13-16 29m16-29c30 6 31 25-5 25" fill="none" stroke="#91a48c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="643" cy="197" r="5" fill="#b39b61" />
      <circle cx="115" cy="437" r="4" fill="#b39b61" />
      <path d="M606 114v14m-7-7h14M124 192v12m-6-6h12" stroke="#b39b61" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="382" cy="551" rx="251" ry="22" fill="#685c40" opacity="0.09" />
      <ellipse cx="382" cy="549" rx="191" ry="12" fill="#685c40" opacity="0.08" />

      <g className="memory-book-body">
        <g className="memory-book-cover">
          <path d="M123 204c81-33 171-26 257 16 88-42 178-49 259-16v299c-89-30-175-23-259 19-83-42-171-49-257-19Z" fill={`url(#${cover})`} />
          <path d="M134 216c81-29 162-20 246 18 84-38 165-47 248-18v272c-86-24-169-17-248 22-81-39-164-46-246-22Z" fill="none" stroke="#bba466" strokeWidth="1.5" />
        </g>
        <g className="memory-book-pages-left">
          <path d="M141 203c75-28 158-18 239 19v284c-80-39-165-47-239-20Z" fill="#cabc9d" />
          <path d="M145 196c78-28 157-17 235 21v279c-80-39-161-48-235-21Z" fill="#e7dcc4" />
          <path d="M150 187c75-26 151-16 230 23v277c-80-39-160-48-230-22Z" fill={`url(#${paper})`} />
          <path d="M161 456c65-20 133-12 207 19M156 472c73-23 146-12 216 21" fill="none" stroke="#cbbc9d" strokeWidth="1" />
        </g>
        <g className="memory-book-pages-right">
          <path d="M380 222c81-37 163-47 239-19v283c-74-27-159-19-239 20Z" fill="#cabc9d" />
          <path d="M380 217c78-38 158-49 235-21v279c-74-27-155-18-235 21Z" fill="#e7dcc4" />
          <path d="M380 210c79-39 155-49 230-23v278c-70-26-150-17-230 22Z" fill={`url(#${paper})`} />
          <path d="M392 475c74-31 142-39 207-19M388 493c70-33 143-44 216-21" fill="none" stroke="#cbbc9d" strokeWidth="1" />
        </g>
        <path d="M150 187c75-26 151-16 230 23 79-39 155-49 230-23v278c-70-26-150-17-230 22-80-39-160-48-230-22Z" fill={`url(#${pageShade})`} />
        <path d="M380 215v269" fill="none" stroke="#cdbfa6" strokeWidth="1.5" />
        <path d="M391 479v66l13-9 13 2v-72" fill="#c5a460" />

        {scene === 0 && (
          <g className="memory-book-opening-contents">
            <path d="M246 376c-5-66 19-91 47-108-4 51-19 77-47 108Z" fill="#adc0a6" />
            <path d="M247 374c-31-13-44-36-39-63 29 15 42 31 39 63Z" fill="#6e9479" />
            <path d="m244 390 28-86" stroke="#365b45" strokeWidth="2" strokeLinecap="round" />
            <path d="M437 287h109M437 306h85M437 346h109M437 365h99M437 384h71" stroke="#c9bea6" strokeWidth="5" strokeLinecap="round" />
            <path d="M450 415c19-19 43-19 62-8 13 7 28 7 40-1" fill="none" stroke="#a99256" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {scene === 0 && (
          <g className="memory-book-opening-cover">
            <path d="M380 210c79-39 155-49 230-23v278c-70-26-150-17-230 22Z" fill={`url(#${cover})`} />
            <path d="M393 221c67-32 136-39 204-24v254c-66-19-135-10-204 20Z" fill="none" stroke="#bba466" strokeWidth="1.5" />
            <path d="M486 359c-4-36 10-59 37-73 2 39-10 62-37 73Zm-1-1c-23-7-36-24-34-47 27 10 39 26 34 47Z" fill="#bba466" />
            <path d="m482 376 24-54" stroke="#d7c08a" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {scene === 1 && (
          <g>
            <g className="memory-book-voice-mark">
              <circle cx="263" cy="318" r="43" fill="#e0e8da" />
              <rect x="255" y="296" width="16" height="30" rx="8" fill="none" stroke="#3e6750" strokeWidth="2.5" />
              <path d="M248 317v3a15 15 0 0 0 30 0v-3m-15 18v11m-8 0h16" fill="none" stroke="#3e6750" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M207 393h104M219 410h80" stroke="#c7bca4" strokeWidth="4" strokeLinecap="round" />
            </g>
            {[286, 309, 332, 372, 395, 418].map((y, index) => (
              <path key={y} className={`memory-book-ink memory-book-ink-${index + 1}`} d={`M427 ${y}h${[120, 107, 79, 120, 101, 66][index]}`} stroke={index === 0 ? "#7e906f" : "#a69d85"} strokeWidth={index === 0 ? "6" : "4"} strokeLinecap="round" />
            ))}
          </g>
        )}

        {scene === 2 && (
          <g className="memory-book-draft">
            <g className="memory-book-draft-label">
              <text x="218" y="272" fill="#49674a" fontSize="13" fontFamily="system-ui, sans-serif" letterSpacing="3">{language === "sv" ? "UTKAST" : "DRAFT"}</text>
              <path d="M219 289h83" stroke="#b69b5f" strokeWidth="2" strokeLinecap="round" />
            </g>
            <g className="memory-book-paragraph memory-book-paragraph-1">
              <path d="M204 324h119M204 341h108M204 358h119M204 375h88" stroke="#aaa089" strokeWidth="4" strokeLinecap="round" />
              <path d="M204 403h119M204 420h94" stroke="#aaa089" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g className="memory-book-paragraph memory-book-paragraph-2">
              <rect x="425" y="256" width="25" height="27" rx="3" fill="#d6ddcb" />
              <path d="M434 270h7" stroke="#5c7654" strokeWidth="2" strokeLinecap="round" />
              <path d="M463 265h87M463 278h57" stroke="#8c9878" strokeWidth="4" strokeLinecap="round" />
              <path d="M425 310h126M425 327h115M425 344h126M425 361h92M425 395h126M425 412h105M425 429h72" stroke="#aaa089" strokeWidth="4" strokeLinecap="round" />
            </g>
          </g>
        )}
      </g>

      {scene === 0 && (
        <g>
          <g className="memory-book-symbol memory-book-symbol-1">
            <rect x="94" y="127" width="86" height="86" rx="23" fill="#fffdf6" stroke="#d7d6c5" />
            <path d="m115 171 22-19 22 19m-38-4v25h32v-25m-19 25v-15h10v15" fill="none" stroke="#708b6a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <g className="memory-book-symbol memory-book-symbol-2">
            <rect x="571" y="311" width="92" height="92" rx="25" fill="#fffdf6" stroke="#d7d6c5" />
            <path d="M594 379c-7-17 27-14 25-29-1-9-16-12-12-22" fill="none" stroke="#b29b60" strokeWidth="3" strokeLinecap="round" />
            <circle cx="607" cy="327" r="3" fill="#b29b60" />
          </g>
          <g className="memory-book-symbol memory-book-symbol-3" transform="translate(489 113)">
            <path d="M0 36C-7 10 5-7 25-10c2 21-4 38-25 46Z" fill="#799372" />
            <path d="m-3 47 18-38" stroke="#446442" strokeWidth="2" strokeLinecap="round" />
            <path d="M-4 37c-17-1-27-10-29-23 19-3 30 8 29 23Z" fill="#a4b393" />
          </g>
        </g>
      )}

      {scene === 1 && (
        <g>
          <g className="memory-book-speech-ribbon">
            <path d="M176 92h238a28 28 0 0 1 28 28v39a28 28 0 0 1-28 28H289l-28 20 3-20h-88a28 28 0 0 1-28-28v-39a28 28 0 0 1 28-28Z" fill="#365d49" />
            <g stroke="#eee9d9" strokeWidth="4" strokeLinecap="round">
              <path d="M181 132v14M195 119v40M209 127v24M223 111v56M237 123v32M251 116v46M265 130v18M279 122v34M293 128v22" />
            </g>
            <path d="M329 122h77M329 139h58M329 156h69" stroke="#c4d0ba" strokeWidth="3" strokeLinecap="round" />
          </g>
          <g className="memory-book-wave-to-ink" stroke="#83966c" strokeWidth="3" strokeLinecap="round">
            <path d="M323 204v19M337 199v29M351 204v19M365 198v31M379 205v17" />
          </g>
          <g className="memory-book-typing">
            <rect x="564" y="376" width="108" height="76" rx="19" fill="#fffdf6" stroke="#d5d2bf" />
            <rect x="580" y="393" width="76" height="42" rx="7" fill="none" stroke="#758a6c" strokeWidth="2" />
            <path d="M590 403h3m9 0h3m9 0h3m9 0h3m9 0h3m-51 10h3m9 0h3m9 0h3m9 0h3m-30 11h34" stroke="#758a6c" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>
      )}

      {scene === 2 && (
        <g>
          <g className="memory-book-create-action">
            <rect x="252" y="90" width="292" height="58" rx="18" fill="#365d49" />
            <text x="398" y="125" textAnchor="middle" fill="#fffdf6" fontSize="19" fontFamily="system-ui, sans-serif" fontWeight="600">{language === "sv" ? "Skapa min berättelse" : "Create My Story"}</text>
          </g>
          <g className="memory-book-choice-cursor">
            <path d="m511 137 3 33 8-9 10 16 8-5-10-16 12-3Z" fill="#fffdf6" stroke="#6b7d5c" strokeWidth="2" strokeLinejoin="round" />
            <path d="m504 130-5-5m16 0v-7m-20 22h-7" stroke="#b49a5b" strokeWidth="2" strokeLinecap="round" />
          </g>
          <g className="memory-book-source-leaves">
            <rect x="87" y="297" width="86" height="107" rx="16" fill="#fffdf6" stroke="#d7d6c5" transform="rotate(-9 130 350)" />
            <path d="M115 361c-2-23 9-36 27-43 1 24-9 37-27 43Z" fill="#98ac88" />
            <path d="m112 375 21-38" stroke="#55734c" strokeWidth="2" strokeLinecap="round" />
            <path d="M105 385h39" stroke="#c9bea6" strokeWidth="3" strokeLinecap="round" />
          </g>
          <g className="memory-book-pencil" transform="translate(578 452) rotate(34)">
            <rect x="0" y="-88" width="17" height="104" rx="3" fill="#b79b5e" />
            <path d="M4-74v86M12-74v86" stroke="#e4ce95" strokeWidth="2" />
            <path d="m0 16 8.5 20L17 16" fill="#e4d2ad" />
            <path d="m5 28 3.5 8 3.5-8" fill="#635444" />
            <path d="M0-75h17" stroke="#395e48" strokeWidth="5" />
          </g>
        </g>
      )}
    </svg>
  );
}
