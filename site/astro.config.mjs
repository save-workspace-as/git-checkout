import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The address the site is served from. A custom domain or a user site is `/`; a project site is its repository name.
const base = process.env.SITE_BASE || '/git-checkout';

export default defineConfig({
  site: process.env.SITE_URL || 'https://save-workspace-as.github.io',
  base,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Git Checkout',
      description: 'A graphical Git client for VS Code.',
      favicon: '/favicon.svg',
      logo: { src: './public/favicon.svg', alt: 'Git Checkout' },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/save-workspace-as/git-checkout' }],
      customCss: ['./src/styles/starlight.css'],
      sidebar: [
        { label: 'Guide', items: ['docs/getting-started', 'docs/sidebar', 'docs/features', 'docs/shortcuts', 'docs/settings'] },
        { label: 'More', items: ['docs/extending', 'docs/remote', 'docs/privacy', 'changelog'] },
      ],
    }),
  ],
});
