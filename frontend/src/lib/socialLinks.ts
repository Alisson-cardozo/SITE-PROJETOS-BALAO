export type SocialPlatform = 'telegram' | 'instagram' | 'whatsapp';

/**
 * Admin pode colar um link pronto ou so o usuario/numero — aceita os dois.
 * Se ja for um link (http/https), usa direto; senao monta a URL padrao de
 * cada rede (whatsapp usa so os digitos, telegram/instagram tiram o @).
 */
export function buildSocialUrl(platform: SocialPlatform, value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (platform === 'whatsapp') {
    const digits = trimmed.replace(/\D/g, '');
    return `https://wa.me/${digits}`;
  }

  const handle = trimmed.replace(/^@/, '');
  return platform === 'telegram' ? `https://t.me/${handle}` : `https://instagram.com/${handle}`;
}
