import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// --- SANITY CLIENT ---
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// --- GOOGLE GEMINI AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CATEGORY CLASS HELPER ---
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// --- GENERATE AI CONTENT ---
async function generateDetailedContent(article, category) {
  try {
    const modelNames = [
      "gemini-2.0-flash-exp",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro"
    ];
    let workingModel = null;
    let model = null;

    for (const modelName of modelNames) {
      try {
        model = genAI.getGenerativeModel({ model: modelName });
        const testResult = await model.generateContent("test");
        await testResult.response;
        workingModel = modelName;
        break;
      } catch { continue; }
    }
    if (!workingModel) throw new Error("No working Gemini model found");

    const originalContent = article.content || article.description || '';
    const source = article.source?.name || 'News Source';
    const prompt = `You are a professional news writer for Trendzlib, a ${category} news platform.

ARTICLE DETAILS:
Title: ${article.title}
Source: ${source}
Category: ${category}
Original Content: ${originalContent}

TASK: Rewrite this article in an engaging, professional style.

REQUIREMENTS:
1. Write 3-5 well-structured paragraphs (300-500 words)
2. Maintain factual accuracy - don't add information not in the original
3. Use an engaging, journalistic tone appropriate for ${category} news
4. Start with a strong hook that captures attention
5. Include relevant context and details from the original article
6. End with a concluding statement or future outlook
7. Write in a flowing narrative style, not bullet points
8. DO NOT include the title in your response
9. DO NOT add any promotional language or calls to action

Write the article now:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedText = response.text();

    if (!generatedText || generatedText.trim().length < 100)
      throw new Error('Generated content too short');

    return generatedText.trim();

  } catch (err) {
    console.warn("AI generation failed, using fallback content");
    return article.content || article.description || `${article.title}\n\nRead more at the source.`;
  }
}

// --- SKYSPORTS SCRAPER ---
async function fetchSportsFromSkySports() {
  console.log("\n⚽ Fetching Football News from SkySports...");
  const url = "https://www.skysports.com/football/news";
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    const $ = cheerio.load(data);
    const articles = [];

    $("h2, h3").each((i, el) => {
      const title = $(el).text().trim();
      let anchor = $(el).closest("a");
      let link = anchor.attr("href") || $(el).find("a").attr("href");
      if (!title || !link) return;
      if (link.includes("/video/") || link.includes("/live-blog/")) return;
      if (!link.startsWith("http")) link = "https://www.skysports.com" + link;
      articles.push({ title, link, image: null, detail: null, source: "SkySports" });
    });

    const unique = [];
    const seen = new Set();
    for (const art of articles) {
      if (!seen.has(art.link)) {
        seen.add(art.link);
        unique.push(art);
      }
    }

    await Promise.all(unique.map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const $a = cheerio.load(html);
        const img = $a("img.sdc-article-image__item").attr("src") || null;
        if (!img) return;
        art.image = img;

        const content = [];
        $a(".sdc-article-body p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text) content.push(text);
        });
        art.detail = content.join("\n\n");

      } catch { return; }
    }));

    return unique.filter(a => a.image && a.detail).slice(0, 20);

  } catch (err) {
    console.error("SkySports scrape failed:", err.message);
    return [];
  }
}

// --- SAFE ENTERTAINMENT FETCH ---
async function fetchEntertainment() {
  try {
    const apiNews = await fetchFromNewsAPI("entertainment", "us") || [];
    const dataNews = await fetchFromNewsData("entertainment", "ng") || [];
    const combined = [...apiNews, ...dataNews];
    const unique = combined.filter(
      (a, i, self) => i === self.findIndex((b) => b.title === a.title)
    );
    return unique || [];
  } catch (err) {
    console.error("fetchEntertainment failed:", err.message);
    return [];
  }
}

// --- SAVE TO SANITY ---
async function saveToSanity(article, category = "general") {
  try {
    if (!article.urlToImage) return null;
    const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
    if (existing) return null;

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;
    const detailedContent = article.detail || await generateDetailedContent(article, category);

    const result = await client.create({
      _type: "news",
      title: article.title,
      content: detailedContent,
      category,
      categoryClass: getCategoryClass(category),
      image: cloudinaryUrl,
      source: article.source?.name || "Unknown Source",
      link: article.url,
      author: article.author || "Trendzlib Editorial",
      publishedAt: article.publishedAt || new Date().toISOString(),
    });

    return { 
      ...article, 
      content: detailedContent, 
      category, 
      _id: result._id,
      urlToImage: article.urlToImage,
      image: cloudinaryUrl
    };

  } catch (err) {
    console.error("Error saving article:", err.message);
    return null;
  }
}

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const start = Date.now();
  console.log("🚀 Starting automated news update...");

  try {
    const entertainment = await fetchEntertainment() || [];
    const sports = await fetchSportsFromSkySports() || [];

    let entertainmentCount = 0;
    let sportsCount = 0;
    const savedArticles = [];

    console.log("\n📺 Processing Entertainment News:");
    for (const a of entertainment) {
      const saved = await saveToSanity(a, "entertainment");
      if (saved) { savedArticles.push(saved); entertainmentCount++; if (entertainmentCount >= 1) break; }
    }

    console.log("\n⚽ Processing Sports News:");
    for (const a of sports) {
      const mapped = {
        ...a,
        urlToImage: a.image,
        content: a.detail,
        url: a.link,
        source: { name: a.source }
      };
      const saved = await saveToSanity(mapped, "sport");
      if (saved) { savedArticles.push(saved); sportsCount++; if (sportsCount >= 1) break; }
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    res.status(200).json({
      success: true,
      message: "News updated successfully",
      stats: {
        entertainment: { saved: entertainmentCount, fetched: entertainment.length },
        sports: { saved: sportsCount, fetched: sports.length },
        total: savedArticles.length
      },
      duration: `${duration}s`,
    });

  } catch (err) {
    console.error("Fatal error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
