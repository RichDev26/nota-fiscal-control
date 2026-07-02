const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14: pacotes server-only (não bundlados pelo webpack)
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@prisma/client', 'prisma', '@anthropic-ai/sdk'],
    // Next 14.x exige essa flag para rodar src/instrumentation.ts (estabilizado por padrão só na v15) —
    // é o boot do sweep de notificações do Controle de Integração.
    instrumentationHook: true,
  },

  webpack: (config, { isServer }) => {
    // Garante resolução do alias @/ em ambientes Linux (Railway) onde o
    // tsconfig moduleResolution:"bundler" pode não configurar aliases webpack automaticamente
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
    };

    if (isServer) {
      // Garante que esses pacotes nunca entram no bundle do servidor via webpack.
      // Usa abordagem defensiva para suportar diferentes estruturas de config.externals.
      const extra = ['pdf-parse', '@anthropic-ai/sdk'];
      if (Array.isArray(config.externals)) {
        config.externals.push(...extra);
      } else if (config.externals) {
        config.externals = [config.externals, ...extra];
      } else {
        config.externals = extra;
      }
    } else {
      // No bundle do cliente, substitui esses módulos por objeto vazio
      // para evitar erros de "module not found" em cascata
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@anthropic-ai/sdk': false,
        'pdf-parse': false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
