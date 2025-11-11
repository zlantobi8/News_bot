import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pickBestArticle, postToX, testConnection } from "./twitter_bot.js";
dotenv.config();

// --- CONFIGURE GOOGLE GEMINI AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- GENERATE AI CONTENT ---
async function generateDetailedContent(article, category) {
  try {
    console.log(`   🤖 Generating AI content...`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `
You are a professional sports journalist. Based on the following headline and description, write a detailed 400-600 word football news article.

Title: ${article.title}
Description: ${article.description || "No description available"}
Source: ${article.source?.name || "Unknown"}
Category: ${category}

Ensure the article:
- Expands on the main points
- Adds relevant match context or background
- Maintains a journalistic tone
- Avoids fabricating details
`;

    const result = await model.generateContent(prompt);
    const content = result.response.text().trim();

    console.log(`   ✅ AI content generated (${content.length} chars)`);
    return content;
  } catch (error) {
    console.error(`   ⚠️ AI generation failed: ${error.message}`);
    const fallback =
      article.content ||
      article.description ||
      `${article.title}\n\nRead more at the source.`;
    console.log(`   📝 Using fallback content (${fallback.length} chars)`);
    return fallback;
  }
}

// --- FETCH FOOTBALL NEWS ---
async function fetchFootball() {
  console.log("\n📰 Fetching Football News (worldwide)...");

  try {
    // NewsAPI - use "everything" for global coverage
    const q = encodeURIComponent("football OR soccer");
    const newsApiUrl = `https://newsapi.org/v2/everything?apiKey=${process.env.NEWSAPI_KEY}&q=${q}&language=en&pageSize=50&sortBy=publishedAt`;
    const { data: apiData } = await axios.get(newsApiUrl, { timeout: 10000 });
    const apiArticles = (apiData.articles || []).map((a) => ({
      title: a.title,
      description: a.description,
      content: a.content,
      urlToImage: a.urlToImage,
      url: a.url,
      source: { name: a.source?.name },
      author: a.author,
      publishedAt: a.publishedAt,
    }));
    console.log(`✓ NewsAPI: Fetched ${apiArticles.length} football articles`);

    // NewsData - also query for football
    const newsDataUrl = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=football OR soccer&language=en&page=1`;
    const { data: ndData } = await axios.get(newsDataUrl, { timeout: 10000 });
    const ndArticles = (ndData.results || []).map((a) => ({
      title: a.title,
      description: a.description,
      content: a.content,
      urlToImage: a.image_url,
      url: a.link,
      source: { name: a.source_name || a.source_id },
      author: a.creator?.[0],
      publishedAt: a.pubDate,
    }));
    console.log(`✓ NewsData: Fetched ${ndArticles.length} football articles`);

    const combined = [...ndArticles, ...apiArticles];
    const unique = combined.filter(
      (a, i, self) => i === self.findIndex((b) => b.title === a.title)
    );
    console.log(`   Combined: ${unique.length} unique football articles`);
    return unique;
  } catch (err) {
    console.error("❌ fetchFootball failed:", err.message);
    return [];
  }
}

// --- FILTER ARTICLES ---
function filterArticles(articles) {
  const filtered = articles.filter((a) => {
    const hasTitle = a.title && a.title.length > 5;
    const hasImage = a.urlToImage && a.urlToImage.startsWith("http");
    const hasContent = a.content || a.description;
    const hasUrl = a.url && a.url.startsWith("http");
    return hasTitle && hasImage && hasContent && hasUrl;
  });

  console.log(`   Filtered: ${filtered.length}/${articles.length} valid`);
  return filtered;
}

// --- ENRICH ARTICLE WITH AI CONTENT ---
async function enrichArticle(article, category) {
  try {
    console.log(`   💾 Enriching: "${article.title.slice(0, 50)}..."`);
    const detailedContent = await generateDetailedContent(article, category);

    return {
      ...article,
      content: detailedContent,
      category,
    };
  } catch (err) {
    console.error(`   ❌ Error enriching article: ${err.message}`);
    return null;
  }
}

// --- MAIN HANDLER (FOR VERCEL CRON) ---
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  const start = Date.now();
  console.log("🚀 Starting automated football news update...");

  try {
    console.log("\n🔍 Testing Twitter connection...");
    const twitterConnected = await testConnection();
    if (!twitterConnected) {
      console.warn("⚠️ Twitter connection failed.");
      return res.status(500).json({
        success: false,
        error: "Twitter connection failed",
      });
    }

    const footballArticles = filterArticles(await fetchFootball());
    const enrichedArticles = [];

    console.log("\n⚽ Processing Football News:");
    for (const a of footballArticles) {
      const enriched = await enrichArticle(a, "football");
      if (enriched) {
        enrichedArticles.push(enriched);
        if (enrichedArticles.length >= 1) break; // post one best article per run
      }
    }

    console.log(`\n📋 Total articles enriched: ${enrichedArticles.length}`);

    const bestArticle = await pickBestArticle(enrichedArticles);
    let twitterResult = null;

    if (bestArticle) {
      console.log("\n🐦 Posting best football article to X...");
      console.log(`   Selected: "${bestArticle.title.slice(0, 60)}..."`);
      twitterResult = await postToX(bestArticle);

      if (twitterResult.success) {
        console.log("✅ Twitter post successful!");
        console.log(`   Tweet URL: ${twitterResult.tweetUrl}`);
      } else {
        console.error("❌ Twitter posting failed:", twitterResult.error);
      }
    } else {
      console.log("\n⚠️ No suitable football articles found to post to X");
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✅ Football news update completed in ${duration}s`);

    res.status(200).json({
      success: true,
      message: "Football news updated and posted to Twitter successfully",
      stats: {
        football: {
          enriched: enrichedArticles.length,
          fetched: footballArticles.length,
        },
      },
      twitter: twitterResult || {
        posted: false,
        reason: "No suitable articles with valid images",
      },
      duration: `${duration}s`,
    });
  } catch (err) {
    console.error("\n❌ Fatal error:", err.message);
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
}

// --- LOCAL TEST FUNCTION ---
async function runTest() {
  console.log("🚀 Starting Football Twitter Post Test");
  console.log("=".repeat(70));

  try {
    await testConnection();

    const footballArticles = filterArticles(await fetchFootball());
    const enrichedArticles = [];

    console.log("\n⚽ Processing Football News:");
    for (const a of footballArticles) {
      const enriched = await enrichArticle(a, "football");
      if (enriched) {
        enrichedArticles.push(enriched);
        if (enrichedArticles.length >= 1) break;
      }
    }

    console.log(`\n📋 Total football articles enriched: ${enrichedArticles.length}`);

    if (enrichedArticles.length === 0) {
      console.log("\n⚠️ No articles were enriched. Cannot proceed with Twitter posting.");
      return;
    }

    console.log("\n🔍 Selecting best article for Twitter...");
    const best = await pickBestArticle(enrichedArticles);

    if (best) {
      console.log(`\n✅ Best football article: "${best.title.substring(0, 60)}..."`);
      console.log(`   Has image: ${!!(best.urlToImage || best.image)}`);
      console.log(`   Content length: ${(best.content || '').length} chars`);

      console.log("\n🐦 Posting to X...");
      const result = await postToX(best);

      if (result.success) {
        console.log(`\n✅ Tweet posted successfully!`);
        console.log(`   Tweet URL: ${result.tweetUrl}`);
      } else {
        console.error(`\n❌ Twitter posting failed: ${result.error}`);
      }
    } else {
      console.log("\n⚠️ No valid football article found.");
    }

    console.log("\n✅ Test completed successfully!\n");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
  }
}

// Uncomment to test locally
runTest();
