import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pickBestArticle, postToX, testConnection } from "./twitter_bot.js";
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
    console.log(`   🤖 Generating AI content...`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `
You are a professional news writer. Based on the following headline and description, write a detailed 400-600 word news article.

Title: ${article.title}
Description: ${article.description || "No description available"}
Source: ${article.source?.name || "Unknown"}
Category: ${category}

Ensure the article:
- Expands on the main points
- Adds relevant background
- Maintains journalistic tone
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

// --- FETCH FROM NEWSAPI.ORG ---
async function fetchFromNewsAPI(category, country = "us", retries = 3) {
  const categoryMap = { sport: "sports", entertainment: "entertainment" };
  const mappedCategory = categoryMap[category] || category;

  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWSAPI_KEY}&category=${mappedCategory}&country=${country}&pageSize=20`;
      const { data } = await axios.get(url, { timeout: 10000 });
      console.log(
        `✓ NewsAPI: Fetched ${data.articles?.length || 0} ${category} articles from ${country.toUpperCase()}`
      );

      return data.articles.map((a) => ({
        title: a.title,
        description: a.description,
        content: a.content,
        urlToImage: a.urlToImage,
        url: a.url,
        source: { name: a.source?.name },
        author: a.author,
        publishedAt: a.publishedAt,
      }));
    } catch (error) {
      console.error(`NewsAPI attempt ${i + 1}/${retries} failed:`, error.message);
      if (i === retries - 1) return [];
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return [];
}

// --- FETCH FROM NEWSDATA.IO ---
async function fetchFromNewsData(category, country = "ng", retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&category=${category}&country=${country}&language=en`;
      const { data } = await axios.get(url, { timeout: 10000 });
      console.log(
        `✓ NewsData: Fetched ${data.results?.length || 0} ${category} articles from ${country.toUpperCase()}`
      );

      return data.results.map((a) => ({
        title: a.title,
        description: a.description,
        content: a.content,
        urlToImage: a.image_url,
        url: a.link,
        source: { name: a.source_name || a.source_id },
        author: a.creator?.[0],
        publishedAt: a.pubDate,
      }));
    } catch (error) {
      console.error(`NewsData attempt ${i + 1}/${retries} failed:`, error.message);
      if (i === retries - 1) return [];
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return [];
}

// --- COMBINED FETCHERS ---
async function fetchEntertainment() {
  console.log("\n📰 Fetching Entertainment News...");
  const apiNews = await fetchFromNewsAPI("entertainment", "us");
  const dataNews = await fetchFromNewsData("entertainment", "ng");
  const combined = [...dataNews, ...apiNews];

  const unique = combined.filter(
    (a, i, self) => i === self.findIndex((b) => b.title === a.title)
  );
  console.log(`   Combined: ${unique.length} unique entertainment articles`);
  return unique;
}

async function fetchSports() {
  console.log("\n📰 Fetching Sports News...");
  return await fetchFromNewsAPI("sport", "us");
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

// --- SAVE TO SANITY ---
async function saveToSanity(article, category = "general") {
  try {
    if (!article.urlToImage) {
      console.log(`   ⚠️ Skipping invalid article: Missing image`);
      return null;
    }

    const existing = await client.fetch(
      '*[_type=="news" && title==$title][0]',
      { title: article.title }
    );
    if (existing) {
      console.log(`   ⏭️ Already exists: ${article.title.slice(0, 60)}...`);
      return null;
    }

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(
      article.urlToImage
    )}`;

    console.log(`   💾 Saving: "${article.title.slice(0, 50)}..."`);
    const detailedContent = await generateDetailedContent(article, category);

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

    console.log(`   ✅ Saved [${category}]: ${article.title.slice(0, 60)}...`);
    
    // Return the complete article with all fields needed for Twitter posting
    return { 
      ...article, 
      content: detailedContent, 
      category, 
      _id: result._id,
      // Keep original urlToImage for Twitter validation
      urlToImage: article.urlToImage,
      // Also include the Cloudinary URL as 'image' field
      image: cloudinaryUrl
    };
  } catch (err) {
    console.error(`   ❌ Error saving article: ${err.message}`);
    return null;
  }
}

// --- MAIN HANDLER (FOR VERCEL CRON) ---
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  const start = Date.now();
  console.log("🚀 Starting automated news update...");

  try {
    console.log("\n🔍 Testing Twitter connection...");
    const twitterConnected = await testConnection();
    if (!twitterConnected) console.warn("⚠️ Twitter connection failed.");

    const entertainment = filterArticles(await fetchEntertainment());
    const sports = filterArticles(await fetchSports());

    let entertainmentCount = 0;
    let sportsCount = 0;
    const savedArticles = [];

    console.log("\n📺 Processing Entertainment News:");
    for (const a of entertainment) {
      const saved = await saveToSanity(a, "entertainment");
      if (saved) {
        savedArticles.push(saved);
        entertainmentCount++;
        if (entertainmentCount >= 1) break;
      }
    }

    console.log("\n⚽ Processing Sports News:");
    for (const a of sports) {
      const saved = await saveToSanity(a, "sport");
      if (saved) {
        savedArticles.push(saved);
        sportsCount++;
        if (sportsCount >= 1) break;
      }
    }

    console.log(`\n📋 Total articles saved: ${savedArticles.length}`);
    
    // CRITICAL FIX: await pickBestArticle
    const bestArticle = await pickBestArticle(savedArticles);
    let twitterResult = null;

    if (bestArticle) {
      console.log("\n🐦 Posting best article to X...");
      console.log(`   Selected: "${bestArticle.title.slice(0, 60)}..."`);
      twitterResult = await postToX(bestArticle);
      
      if (twitterResult.success) {
        console.log("✅ Twitter post successful!");
        console.log(`   Tweet URL: ${twitterResult.tweetUrl}`);
      } else {
        console.error("❌ Twitter posting failed:", twitterResult.error);
      }
    } else {
      console.log("\n⚠️ No suitable articles found to post to X");
      console.log("   All articles either had invalid images or failed validation");
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✅ News update completed in ${duration}s`);

    res.status(200).json({
      success: true,
      message: "News updated successfully",
      stats: {
        entertainment: { saved: entertainmentCount, fetched: entertainment.length },
        sports: { saved: sportsCount, fetched: sports.length },
      },
      twitter: twitterResult || { posted: false, reason: "No suitable articles with valid images" },
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
  console.log("🚀 Starting News Update Test");
  console.log("=".repeat(70));

  try {
    await testConnection();

    const entertainment = filterArticles(await fetchEntertainment());
    const sports = filterArticles(await fetchSports());
    const savedArticles = [];

    console.log("\n📺 Processing Entertainment News:");
    for (const a of entertainment) {
      const saved = await saveToSanity(a, "entertainment");
      if (saved) {
        savedArticles.push(saved);
        if (savedArticles.filter(s => s.category === 'entertainment').length >= 1) break;
      }
    }

    console.log("\n⚽ Processing Sports News:");
    for (const a of sports) {
      const saved = await saveToSanity(a, "sport");
      if (saved) {
        savedArticles.push(saved);
        if (savedArticles.filter(s => s.category === 'sport').length >= 1) break;
      }
    }

    console.log(`\n📋 Total articles saved: ${savedArticles.length}`);
    
    if (savedArticles.length === 0) {
      console.log("\n⚠️ No articles were saved. Cannot proceed with Twitter posting.");
      console.log("✅ Test completed (no articles to post)\n");
      return;
    }

    // CRITICAL FIX: await pickBestArticle
    console.log("\n🔍 Selecting best article for Twitter...");
    const best = await pickBestArticle(savedArticles);
    
    if (best) {
      console.log(`\n✅ Best article selected: "${best.title.substring(0, 60)}..."`);
      console.log(`   Category: ${best.category}`);
      console.log(`   Has image: ${!!(best.urlToImage || best.image)}`);
      console.log(`   Content length: ${(best.content || '').length} chars`);
      
      console.log("\n🐦 Posting to X...");
      const result = await postToX(best);
      
      if (result.success) {
        console.log(`\n✅ Tweet posted successfully!`);
        console.log(`   Tweet URL: ${result.tweetUrl}`);
      } else {
        console.error(`\n❌ Twitter posting failed: ${result.error}`);
        if (result.details) {
          console.error(`   Details:`, result.details);
        }
      }
    } else {
      console.log("\n⚠️ No valid article found with working images.");
      console.log("   All articles failed image validation.");
    }

    console.log("\n✅ Test completed successfully!\n");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
  }
}

// Uncomment to run test
runTest();