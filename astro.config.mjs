import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://al3rez.com",
  integrations: [tailwind(), sitemap()],
  trailingSlash: "never",
  markdown: {
    shikiConfig: {
      theme: "one-light",
    },
  },
});
