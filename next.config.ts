import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Admin Item file uploads (Picture/Music) exceed the 1 MB default; see
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md
  // "bodySizeLimit" (spec 4 wave pin, tickets #90/#91).
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default withNextIntl(nextConfig);
