import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mwell Intra',
    short_name: 'Mwell Intra',
    description:
      'Mwell Intra — one governed operating system for Warehouse, Procurement, Legal, Finance, Events, Product, Insights and Administration.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#004f9d',
    background_color: '#004f9d',
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
