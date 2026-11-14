//---------------
// onboarding — first-visit wizard copy (issue #573).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this copy lives here. It is merged
// into the onboarding section in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
// Short lines only: the wizard explains in four steps, it does not lecture.
//---------------

export const onboardingStrings = {
  en: {
    onboarding: {
      stepOf: 'Step {step} of 4',
      reopen: 'See onboarding',
      step1Title: 'Welcome to Post Engineer',
      step1Body:
        'Create persona videos and publish them on your accounts. Your agent does it all through the MCP: routines and automation.',
      continue: 'Continue',
      step2Title: 'Connect your account',
      step2Body: 'Choose where to publish.',
      step2OAuthHint: 'Connect in one tap',
      step2KeyHint: 'Connect with a key',
      connected: 'Connected',
      backToProviders: 'Back to providers',
      skip: 'Skip for now',
      step3Title: 'Connect your agent',
      step3Step1: 'Create an API key.',
      step3Step2: 'Paste the setup into your agent.',
      step3Step3: 'Say what to publish and when.',
      step3SetupLink: 'Open the setup prompt',
      step3Done: 'I connected my agent',
      step4Title: 'Your tokens',
      step4Body: 'Talk to us and get 3 free tokens. No automatic purchase yet.',
      talkToUs: 'Talk to us',
      startPublishing: 'Start publishing',
      step4Whatsapp: "Hi! I'd like my 3 free Post Engineer tokens.",
    },
  },
  pt: {
    onboarding: {
      stepOf: 'Passo {step} de 4',
      reopen: 'Ver onboarding',
      step1Title: 'Bem-vindo ao Post Engineer',
      step1Body:
        'Crie vídeos de persona e publique nas suas contas. O seu agente faz tudo pelo MCP: rotinas e automação.',
      continue: 'Continuar',
      step2Title: 'Conecte a sua conta',
      step2Body: 'Escolha onde publicar.',
      step2OAuthHint: 'Ligue num toque',
      step2KeyHint: 'Ligue com uma chave',
      connected: 'Conectada',
      backToProviders: 'Voltar à lista',
      skip: 'Pular por agora',
      step3Title: 'Ligue o seu agente',
      step3Step1: 'Crie uma chave de API.',
      step3Step2: 'Cole o setup no agente.',
      step3Step3: 'Diga o que publicar e quando.',
      step3SetupLink: 'Abrir o prompt de setup',
      step3Done: 'Já liguei o agente',
      step4Title: 'Os seus tokens',
      step4Body: 'Fale connosco e ganhe 3 tokens grátis. Ainda não há compra automática.',
      talkToUs: 'Falar connosco',
      startPublishing: 'Começar a publicar',
      step4Whatsapp: 'Olá! Quero os meus 3 tokens grátis do Post Engineer.',
    },
  },
};
