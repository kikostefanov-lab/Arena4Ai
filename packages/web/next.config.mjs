/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@remotion/renderer',
    '@remotion/bundler',
    '@remotion/compositor-darwin-arm64',
    '@remotion/compositor-darwin-x64',
    '@rspack/binding-darwin-arm64',
    '@rspack/binding-darwin-x64',
    '@rspack/binding-linux-x64-gnu',
    '@rspack/binding-win32-x64-msvc',
    'remotion',
  ],
};
export default nextConfig;
