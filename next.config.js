/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14: pacotes server-only (não bundlados pelo webpack)
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@prisma/client', 'prisma', '@anthropic-ai/sdk'],
  },

  webpack: (config, { isServer }) => {
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
