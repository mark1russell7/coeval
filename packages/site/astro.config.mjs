// The site of coeval: the ideas, each with a live diagram. GitHub Pages serves it at /coeval/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const base = process.env.SITE_BASE ?? "/coeval";

export default defineConfig({
  site: "https://mark1russell7.github.io",
  base,
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "coeval",
      description:
        "coeval: a base for declarative languages. A document gets its meaning from a question. Its kind names the evaluator, and a ladder finds it.",
      logo: { src: "./src/assets/mark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/mark1russell7/coeval" }],
      editLink: { baseUrl: "https://github.com/mark1russell7/coeval/edit/main/packages/site/" },
      customCss: [
        "@fontsource-variable/atkinson-hyperlegible-next",
        "@fontsource-variable/atkinson-hyperlegible-mono",
        "./src/styles/tokens.css",
        "./src/styles/theme.css",
        "./src/styles/diagrams.css",
      ],
      components: { Hero: "./src/components/Hero.astro" },
      sidebar: [
        { label: "Start", items: [{ label: "Home", link: "/" }, "start/model"] },
        {
          label: "Ideas",
          items: [
            "ideas/documents",
            "ideas/ladder",
            "ideas/context",
            "ideas/direction",
            "ideas/derive-and-run",
            "ideas/evaluators",
            "ideas/schedules",
          ],
        },
        {
          label: "Design",
          items: [
            "design/decisions",
            "design/lineage",
            { label: "Roadmap", link: "https://github.com/mark1russell7/coeval/blob/main/docs/ROADMAP.md" },
          ],
        },
      ],
    }),
    react(),
  ],
});
