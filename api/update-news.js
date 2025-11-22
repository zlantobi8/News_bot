// api/update-news.js
import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// ------------------------
// SANITY CONFIG
// ------------------------
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// ------------------------
// GOOGLE GEMINI AI CONFIG
// ------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ------------------------
// HELPERS
// ------------------------
async function fetchHtml(url, timeout = 15000) {
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout,
  });
  return data;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ------------------------
// SCRAPERS
// ------------------------

// LEGIT NG
async function scrapeLegit(limit = 3) {
  const url = "https://www.legit.ng/entertainment/";
  const results = [];

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $("article, div.story-card, .story-card__content").each((i, el) => {
      if (results.length >= limit) return;
      const el$ = $(el);

      let title =
        el$.find(".story-card__title a").text().trim() ||
        el$.find("h2 a, h3 a").text().trim() ||
        el$.find("a").first().text().trim();

      let link =
        el$.find(".story-card__title a").attr("href") ||
        el$.find("a").first().attr("href");

      if (link && !link.startsWith("http")) link = "https://www.legit.ng" + link;

      let image = el$.find("img").attr("src") || el$.find("img").attr("data-src") || null;

      if (title && link && image) results.push({ title, link, image, source: "Legit NG" });
    });
  } catch (err) {
    console.error("Legit scrape failed:", err.message);
  }

  return results;
}

// SKYSPORTS
async function scrapeSkyNews(limit = 3) {
  const url = "https://www.skysports.com/football/news";
  const results = [];

  try {
    const { data } = await fetchHtml(url);
    const $ = cheerio.load(data);

    $("h2, h3").each((i, el) => {
      if (results.length >= limit) return;
      const title = $(el).text().trim();
      let anchor = $(el).closest("a");
      let link = anchor.attr("href") || $(el).find("a").attr("href");
      if (!title || !link) return;
      if (link.includes("/video/") || link.includes("/live-blog/")) return;
      if (!link.startsWith("http")) link = "https://www.skysports.com" + link;

      results.push({ title, link, image: null, source: "SkySports" });
    });
  } catch (err) {
    console.error("SkySports scrape failed:", err.message);
  }

  return results;
}

// ------------------------
// SAVE RAW TO SANITY (no AI yet)
async function saveRawToSanity(article, category) {
  const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
  if (existing) return null;

  const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.image)}`;

  const result = await client.create({
    _type: "news",
    title: article.title,
    content: "", // AI content will be added later
    category,
    categoryClass: category === "entertainment" ? "tag-base-sm" : "tag-base-sm bg-primary",
    image: cloudinaryUrl,
    source: article.source || "Unknown Source",
    link: article.link,
    author: article.source || "Trendzlib Editorial",
    publishedAt: new Date().toISOString(),
    aiGenerated: false
  });

  return { ...article, _id: result._id, image: cloudinaryUrl };
}

// ------------------------
// HANDLER
export default async function handler(req, res) {
  try {
    // Scrape articles
    const entertainment = await scrapeLegit(3);
    const sports = await scrapeSkyNews(3);

    const savedArticles = [];

    // Save raw to Sanity (AI content can be generated later)
    for (const a of entertainment) {
      const saved = await saveRawToSanity(a, "entertainment");
      if (saved) savedArticles.push(saved);
    }

    for (const a of sports) {
      const saved = await saveRawToSanity(a, "sport");
      if (saved) savedArticles.push(saved);
    }

    res.status(200).json({
      success: true,
      stats: {
        entertainment: { fetched: entertainment.length, saved: savedArticles.filter(a => a.category === "entertainment").length },
        sports: { fetched: sports.length, saved: savedArticles.filter(a => a.category === "sport").length },
        totalSaved: savedArticles.length
      },
      source: "Web Scraping (AI deferred)"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
}
