export interface InterviewQuestion {
  id: string;
  question: string;
  followUp: string;
  deeperFollowUps: string[];
}

export interface InterviewTheme {
  id: string;
  name: string;
  icon: string;
  description: string;
  questions: InterviewQuestion[];
}

export const INTERVIEW_THEMES: Record<string, InterviewTheme> = {
  childhood: {
    id: 'childhood',
    name: 'Barndom & Uppväxt',
    icon: '👶',
    description: 'Dina tidiga minnen och uppväxtår',
    questions: [
      {
        id: 'ch1',
        question: 'Berätta om platsen där du växte upp. Hur såg den ut?',
        followUp: 'Vad är ditt starkaste minne från den platsen?',
        deeperFollowUps: [
          'Vilka dofter eller ljud kommer du ihåg därifrån?',
          'Fanns det någon speciell plats där du brukade leka?',
          'Hur har platsen förändrats sedan dess?'
        ]
      },
      {
        id: 'ch2',
        question: 'Berätta om dina föräldrar. Vilka var de?',
        followUp: 'Vad lärde de dig som du har med dig än idag?',
        deeperFollowUps: [
          'Finns det något speciellt råd de gav dig?',
          'Hur påverkade deras relation dig?',
          'Vilken av dem liknar du mest?'
        ]
      },
      {
        id: 'ch3',
        question: 'Vilket var ditt första riktigt starka minne?',
        followUp: 'Hur gammal var du då, och varför tror du att du minns just det?',
        deeperFollowUps: [
          'Hur kändes det i kroppen när det hände?',
          'Vem var med dig?',
          'Hur har det minnet format dig?'
        ]
      },
      {
        id: 'ch4',
        question: 'Berätta om en typisk dag när du var barn.',
        followUp: 'Vad var det bästa och det svåraste med den tiden?',
        deeperFollowUps: [
          'Vad gjorde du efter skolan?',
          'Vilka vänner hade du?',
          'Vad åt ni till middag?'
        ]
      },
      {
        id: 'ch5',
        question: 'Hade du syskon? Berätta om er relation.',
        followUp: 'Hur är er relation idag jämfört med då?',
        deeperFollowUps: [
          'Vad brukade ni göra tillsammans?',
          'Vad bråkade ni om?',
          'Finns det något roligt minne ni ofta skrattar åt?'
        ]
      }
    ]
  },
  career: {
    id: 'career',
    name: 'Karriär & Arbete',
    icon: '💼',
    description: 'Din yrkesresa och arbetslivet',
    questions: [
      {
        id: 'ca1',
        question: 'Vad drömde du om att bli när du var liten?',
        followUp: 'Hur kom det sig att du valde en annan väg?',
        deeperFollowUps: [
          'Vem inspirerade dig i ditt yrkesval?',
          'Ångrade du dig någon gång?',
          'Vad skulle du säga till ditt yngre jag om karriärval?'
        ]
      },
      {
        id: 'ca2',
        question: 'Berätta om ditt första riktiga jobb.',
        followUp: 'Vad lärde du dig där som du hade nytta av senare?',
        deeperFollowUps: [
          'Hur var din första dag?',
          'Vem var din första chef?',
          'Hur mycket tjänade du egentligen?'
        ]
      },
      {
        id: 'ca3',
        question: 'Vilket var ditt bästa arbetsliv-minne?',
        followUp: 'Varför betydde just det så mycket för dig?',
        deeperFollowUps: [
          'Vem delade du det med?',
          'Hur firade ni?',
          'Påverkade det din fortsatta karriär?'
        ]
      },
      {
        id: 'ca4',
        question: 'Berätta om en utmaning du mötte i arbetslivet.',
        followUp: 'Hur löste du den, och vad tog du med dig?',
        deeperFollowUps: [
          'Vad var det värsta ögonblicket?',
          'Vem hjälpte dig?',
          'Skulle du göra annorlunda idag?'
        ]
      }
    ]
  },
  family: {
    id: 'family',
    name: 'Familj & Relationer',
    icon: '❤️',
    description: 'Viktiga människor i ditt liv',
    questions: [
      {
        id: 'fa1',
        question: 'Berätta om när du träffade din partner.',
        followUp: 'Vad var det första du la märke till?',
        deeperFollowUps: [
          'Var träffades ni?',
          'Vad sa dina vänner?',
          'När visste du att det var "rätt"?'
        ]
      },
      {
        id: 'fa2',
        question: 'Berätta om när du blev förälder första gången.',
        followUp: 'Hur förändrades ditt liv?',
        deeperFollowUps: [
          'Vad var det första du tänkte?',
          'Vilka råd fick du?',
          'Vad önskar du att du vetat då?'
        ]
      },
      {
        id: 'fa3',
        question: 'Vilken familjetradition betyder mest för dig?',
        followUp: 'Varifrån kommer den traditionen?',
        deeperFollowUps: [
          'Kommer du fortsätta den?',
          'Vad gör den speciell?',
          'Finns det någon rolig historia kopplad till den?'
        ]
      }
    ]
  },
  milestones: {
    id: 'milestones',
    name: 'Viktiga Ögonblick',
    icon: '⭐',
    description: 'Händelser som format ditt liv',
    questions: [
      {
        id: 'mi1',
        question: 'Berätta om en dag som förändrade ditt liv.',
        followUp: 'Förstod du direkt hur viktig den var?',
        deeperFollowUps: [
          'Vad hände efteråt?',
          'Vem berättade du för först?',
          'Hur skulle ditt liv sett ut om det inte hänt?'
        ]
      },
      {
        id: 'mi2',
        question: 'Vad är du mest stolt över i ditt liv?',
        followUp: 'Varför betyder just det så mycket?',
        deeperFollowUps: [
          'Vem delade du glädjen med?',
          'Var det svårt att nå dit?',
          'Vad skulle du säga till den som hjälpte dig?'
        ]
      }
    ]
  },
  wisdom: {
    id: 'wisdom',
    name: 'Visdom & Lärdomar',
    icon: '🦉',
    description: 'Det du lärt dig genom livet',
    questions: [
      {
        id: 'wi1',
        question: 'Vad är det viktigaste du lärt dig i livet?',
        followUp: 'Hur lärde du dig det?',
        deeperFollowUps: [
          'Vem lärde dig det?',
          'Var det en svår lärdom?',
          'Vad vill du lära dina barnbarn?'
        ]
      },
      {
        id: 'wi2',
        question: 'Om du kunde ge ett råd till ditt yngre jag, vad skulle det vara?',
        followUp: 'Tror du att du hade lyssnat då?',
        deeperFollowUps: [
          'Vilket misstag hade du velat undvika?',
          'Vad skulle du ändå inte ändra på?',
          'Vad är du tacksam för idag?'
        ]
      }
    ]
  }
};

export function getThemeById(themeId: string): InterviewTheme | undefined {
  return INTERVIEW_THEMES[themeId];
}

export function getAllThemes(): InterviewTheme[] {
  return Object.values(INTERVIEW_THEMES);
}
