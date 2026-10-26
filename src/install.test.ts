import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import manifestText from '../public/manifest.webmanifest?raw';

// Instalação na tela de início: o que o Chrome (Android) e o Safari (iPhone) pedem
const publicFiles = new Set(Object.keys(import.meta.glob('../public/**/*.png')).map((p) => p.replace('../public', '')));

describe('instalação na tela de início', () => {
  const manifest = JSON.parse(manifestText);

  it('o manifesto abre em tela cheia, com nome e ícones de 192 e 512 px que existem', () => {
    expect(manifest).toMatchObject({ name: 'Rota Fácil', short_name: 'Rota Fácil', start_url: '/', display: 'standalone' });
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect(publicFiles).toContain(icon.src);
  });

  it('a página aponta para o manifesto e para o ícone do iPhone', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    const apple = /rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
    expect(publicFiles).toContain(apple);
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });
});
