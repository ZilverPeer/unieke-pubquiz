import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Picture/Music Item uploads exceed the 1 MB Server Actions default (spec
  // 4, ticket #90/#91; node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/serverActions.md's `bodySizeLimit`).
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default withNextIntl(nextConfig);
