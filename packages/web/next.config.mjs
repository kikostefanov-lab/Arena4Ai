/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@remotion/renderer',
    '@remotion/bundler',
    'remotion',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent Remotion/rspack native binaries from being bundled.
      // They are required at runtime via serverExternalPackages, but webpack
      // still traverses their import graph — this stops it completely.
      const existingExternals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);

      config.externals = [
        ...existingExternals,
        ({ request }, callback) => {
          if (
            request?.startsWith('@remotion/') ||
            request?.startsWith('@rspack/') ||
            request === 'remotion' ||
            request?.endsWith('.node')
          ) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
