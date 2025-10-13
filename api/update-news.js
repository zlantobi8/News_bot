import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

// --- CONFIGURE SANITY ---
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// --- CONFIGURE GOOGLE GEMINI AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CATEGORY CSS CLASS ---
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// --- GENERATE DETAILED CONTENT ---
async function generateDetailedContent(article, category) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
    const prompt = `You are a professional news writer. Based on the following news headline and brief description, write a detailed, engaging news article of 400-600 words.

Title: ${article.title}
Description: ${article.description || "No description available"}
Source: ${article.source?.name || "Unknown"}
Category: ${category}

Write a comprehensive article that:
- Expands on the key points
- Provides context and background
- Maintains journalistic tone
- Uses proper paragraphs
- Does NOT make up facts not implied in the original
- Stays factual and objective

Article:`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();

  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    return article.content || article.description || `${article.title}\n\nRead more at the source.`;
  }
}

// --- FETCH NEWS ---
async function fetchNews(category, country = "us", retries = 3) {
  const categoryMap = { sport: "sports", entertainment: "entertainment" };
  const mappedCategory = categoryMap[category] || category;

  for (let i = 0; i < retries; i++) {
    try {
      const url = category === "entertainment"
        ? `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWS_API_KEY}&category=${mappedCategory}&pageSize=20`
        : `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWS_API_KEY}&category=${mappedCategory}&country=${country}&pageSize=20`;

      const { data } = await axios.get(url, { timeout: 10000 });
      console.log(`✓ Fetched ${data.articles?.length || 0} ${category} articles`);
      return data.articles || [];
    } catch (error) {
      console.error(`Attempt ${i + 1}/${retries} failed for ${category}:`, error.message);
      if (i === retries - 1) return [];
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return [];
}

// --- FILTER ARTICLES (skip only those without title or image) ---
function filterArticles(articles) {
  return articles.filter(article => article.title && article.title.length > 5 && article.urlToImage);
}

// --- SAVE ARTICLE TO SANITY ---
async function saveToSanity(article, forcedCategory = "general") {
  try {
    const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
    if (existing) {
      console.log(`⏭️ Already exists: ${article.title.slice(0, 60)}...`);
      return false;
    }

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;

    console.log(`🤖 Generating content for: "${article.title.slice(0, 50)}..."`);
    const detailedContent = await generateDetailedContent(article, forcedCategory);

    await client.create({
      _type: "news",
      title: article.title,
      content: detailedContent,
      category: forcedCategory,
      categoryClass: getCategoryClass(forcedCategory),
      image: cloudinaryUrl,
      source: article.source?.name || "Unknown Source",
      link: article.url || "",
      author: article.author || "Trendzlib Editorial",
      publishedAt: article.publishedAt || new Date().toISOString(),
    });

    console.log(`✅ Saved [${forcedCategory}]: ${article.title.slice(0, 60)}...`);
    return true;

  } catch (err) {
    console.error(`❌ Error saving: ${err.message}`);
    return false;
  }
}

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }

  try {
    console.log("Starting news update with AI content generation...");

    // Fetch and filter worldwide entertainment news
    const entertainmentNews = filterArticles(await fetchNews("entertainment"));

    // Fetch and filter US sports news
    const sportsNews = filterArticles(await fetchNews("sport", "us"));

    let entertainmentCount = 0;
    let sportsCount = 0;

    for (const article of entertainmentNews.slice(0, 10)) {
      if (await saveToSanity(article, "entertainment")) entertainmentCount++;
    }

    for (const article of sportsNews.slice(0, 10)) {
      if (await saveToSanity(article, "sport")) sportsCount++;
    }

    res.status(200).json({
      message: "News updated successfully with AI-generated content!",
      stats: {
        entertainment: entertainmentCount,
        sports: sportsCount,
        totalFetched: { entertainment: entertainmentNews.length, sports: sportsNews.length }
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating news", error: err.message });
  }
}

// --- TEST RUN ---
async function runTest() {
  console.log("🚀 Starting News Update Test with FREE Gemini AI\n");
  console.log("=".repeat(60));

  try {
    const entertainmentNews = filterArticles(await fetchNews("entertainment"));
    const sportsNews = filterArticles(await fetchNews("sport", "us"));

    let entertainmentCount = 0;
    let sportsCount = 0;

    console.log("📺 Processing Entertainment News:");
    for (const article of entertainmentNews.slice(0, 5)) {
      if (await saveToSanity(article, "entertainment")) entertainmentCount++;
    }

    console.log("\n⚽ Processing Sports News:");
    for (const article of sportsNews.slice(0, 5)) {
      if (await saveToSanity(article, "sport")) sportsCount++;
    }

    console.log("\n" + "=".repeat(60));
    console.log(`📊 RESULTS:\n   Entertainment: ${entertainmentCount}\n   Sports: ${sportsCount}\n   Total: ${entertainmentCount + sportsCount}`);
    console.log("✅ Test completed successfully!\n");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  }
}

// Run the test
runTest();
