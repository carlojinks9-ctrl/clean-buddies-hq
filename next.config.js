/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'yxgyhdfmubdgelonnalr.supabase.co',
      },
    ],
  },
}

module.exports = nextConfig
