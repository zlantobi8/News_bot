// server.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());

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
async function fetchHtml(url, timeout = 30000) {
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout,
  });
  return data;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// ------------------------
// LEGIT NG ENTERTAINMENT
// ------------------------
async function scrapeLegit() {
  const url = "https://www.legit.ng/entertainment/";
  const results = [];

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $("article, div.story-card, .story-card__content").each((i, el) => {
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

      if (title && link && image) results.push({ title, link, image, source: "Legit NG", detail: null });
    });

    // Fetch detail for each article
    await Promise.all(results.map(async (art, idx) => {
      await delay(idx * 500);
      try {
        const articleHTML = await fetchHtml(art.link);
        const $a = cheerio.load(articleHTML);
        const content = [];
        $a("div.article-content p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text) content.push(text);
        });
        art.detail = content.join("\n\n") || "";
      } catch (err) {
        console.error("Error fetching Legit article detail:", art.link, err.message);
        art.detail = "";
      }
    }));

  } catch (err) {
    console.log("Legit scrape failed:", err.message);
  }

  return results;
}

// ------------------------
// SKYSPORTS FOOTBALL NEWS
// ------------------------
let skyCache = { timestamp: 0, data: [] };
const SKY_CACHE_DURATION = 1000 * 60 * 3;

async function scrapeSkyNews() {
  if (Date.now() - skyCache.timestamp < SKY_CACHE_DURATION && skyCache.data.length > 0) {
    return skyCache.data;
  }

  const url = "https://www.skysports.com/football/news";
  const results = [];

  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const $ = cheerio.load(data);

    $("h2, h3").each((i, el) => {
      const title = $(el).text().trim();
      let anchor = $(el).closest("a");
      let link = anchor.attr("href") || $(el).find("a").attr("href");
      if (!title || !link) return;
      if (link.includes("/video/") || link.includes("/live-blog/")) return;
      if (!link.startsWith("http")) link = "https://www.skysports.com" + link;

      results.push({ title, link, image: null, detail: null, source: "SkySports" });
    });

    // Remove duplicates
    const unique = [];
    const seen = new Set();
    for (const art of results) {
      if (!seen.has(art.link)) {
        seen.add(art.link);
        unique.push(art);
      }
    }

    // Fetch each article page
    await Promise.all(unique.map(async (art) => {
      try {
        const { data: articleHTML } = await axios.get(art.link, { headers: { "User-Agent": "Mozilla/5.0" } });
        const $a = cheerio.load(articleHTML);

        const img = $a("img.sdc-article-image__item").attr("src") || $a("meta[property='og:image']").attr("content") || null;
        if (!img) return;
        art.image = img;

        const content = [];
        $a(".sdc-article-body p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text) content.push(text);
        });
        art.detail = content.join("\n\n") || "";
      } catch (err) {
        console.error("Error fetching SkySports detail:", art.link, err.message);
      }
    }));

    const finalArticles = unique.filter(a => a.image !== null);
    skyCache = { timestamp: Date.now(), data: finalArticles };
    return finalArticles;

  } catch (err) {
    console.error("SkySports scrape error:", err.message);
    return [];
  }
}

// ------------------------
// AI CONTENT GENERATOR
// ------------------------
async function generateDetailedContent(article, category) {
  try {
    console.log(`🤖 Generating AI content for: ${article.title}`);

    const modelNames = ["gemini-2.0-flash-exp", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];
    let workingModel = null, model = null;

    for (const modelName of modelNames) {
      try {
        model = genAI.getGenerativeModel({ model: modelName });
        const testResult = await model.generateContent("test");
        await testResult.response;
        workingModel = modelName;
        break;
      } catch {}
    }

    if (!workingModel) throw new Error("No working Gemini model found");

    const prompt = `You are a professional news writer for Trendzlib, a ${category} news platform.

ARTICLE DETAILS:
Title: ${article.title}
Source: ${article.source?.name || article.source || 'News Source'}
Category: ${category}
Original Content: ${article.detail || ''}

TASK: Rewrite this article in an engaging, professional style.
Requirements:
- 3-5 paragraphs (300-500 words)
- Maintain factual accuracy
- Journalistic tone
- Start with a hook
- End with a conclusion
- No title, no promotional language`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedText = response.text();
    if (!generatedText || generatedText.trim().length < 100) throw new Error("Generated content too short");

    return generatedText.trim();

  } catch (err) {
    console.warn(`⚠️ AI generation failed: ${err.message}`);
    return article.detail || `${article.title}\n\nRead more at the source.`;
  }
}

// ------------------------
// SAVE TO SANITY
// ------------------------
async function saveToSanity(article, category) {
  // Check existing
  const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
  if (existing) return null;

  // Generate AI content
  const detailedContent = await generateDetailedContent(article, category);
  article.detail = detailedContent;

  const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.image)}`;

  const result = await client.create({
    _type: "news",
    title: article.title,
    content: detailedContent,
    category,
    categoryClass: getCategoryClass(category),
    image: cloudinaryUrl,
    source: article.source?.name || article.source || "Unknown Source",
    link: article.link,
    author: article.source || "Trendzlib Editorial",
    publishedAt: new Date().toISOString(),
  });

  return { ...article, content: detailedContent, category, _id: result._id, image: cloudinaryUrl };
}

// ------------------------
// FETCH & FILTER (Top 3 after checking Sanity)
// ------------------------
async function fetchTopArticles(scrapeFunc, category, limit = 3) {
  const scraped = await scrapeFunc();
  const filtered = [];

  for (const art of scraped) {
    const exists = await client.fetch('*[_type=="news" && title==$title][0]', { title: art.title });
    if (!exists) filtered.push(art);
    if (filtered.length >= limit) break;
  }

  return filtered;
}

// ------------------------
// ROUTES
// ------------------------
app.get("/", (req, res) => res.send("Multi Scraper API Running ⚽🎬"));

app.get("/update-news", async (req, res) => {
  const start = Date.now();
  try {
    const entertainment = await fetchTopArticles(scrapeLegit, "entertainment", 3);
    const sports = await fetchTopArticles(scrapeSkyNews, "sport", 3);

    const savedArticles = [];

    for (const a of entertainment) {
      const saved = await saveToSanity(a, "entertainment");
      if (saved) savedArticles.push(saved);
    }

    for (const a of sports) {
      const saved = await saveToSanity(a, "sport");
      if (saved) savedArticles.push(saved);
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);

    res.status(200).json({
      success: true,
      stats: {
        entertainment: { fetched: entertainment.length, saved: savedArticles.filter(a => a.category === 'entertainment').length },
        sports: { fetched: sports.length, saved: savedArticles.filter(a => a.category === 'sport').length },
        totalSaved: savedArticles.length
      },
      duration: `${duration}s`,
      source: "Web Scraping + AI content"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------
// START SERVER
// ------------------------
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} ⚽🎬`));
