/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14.2+: pacotes que só rodam no servidor (não bundlados pelo webpack)
  serverExternalPackages: ['pdf-parse', '@prisma/client', 'prisma', '@anthropic-ai/sdk'],

  // Compatibilidade com versões anteriores do Next.js 14
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@prisma/client', 'prisma', '@anthropic-ai/sdk'],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Garante que esses pacotes nunca entram no bundle do servidor via webpack
      config.externals.push('pdf-parse', '@anthropic-ai/sdk');
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
