/** @type {import('next').NextConfig} */
const nextConfig = {
  // 1. 빌드 중 ESLint 검사 무시 (메모리 절약)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 2. 빌드 중 TypeScript 에러 무시 (메모리 절약)
  typescript: {
    ignoreBuildErrors: true,
  },
  // 3. 프로덕션 소스맵 생성 비활성화 (메모리 엄청나게 절약됨)
  productionBrowserSourceMaps: false,
  
  // 4. 이미지 최적화 설정 (Cloudflare와 충돌 방지)
  images: {
    unoptimized: true, 
  }
};

module.exports = nextConfig;
