import type { APIRoute } from "astro";
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import getPostDate from "../lib/get-post-date";

export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection("posts")).filter(
    (post) => !post.data.unlisted,
  );

  return rss({
    title: "Alireza Bashiri",
    description: "Alireza Bashiri’ personal website.",
    site: site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: getPostDate(post),
      link: `/${post.slug}`,
    })),
  });
};
