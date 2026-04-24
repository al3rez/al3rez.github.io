import { defineConfig } from "astro/config";

import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://al3rez.com",
  integrations: [sitemap()],
  trailingSlash: "never",
  markdown: {
    shikiConfig: {
      theme: "one-light",
    },
  },
});
