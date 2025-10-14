import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pickBestArticle, postToX } from "./twitter_bot.js";
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

// --- FETCH FROM NEWSAPI.ORG ---
async function fetchFromNewsAPI(category, country = "us", retries = 3) {
  const categoryMap = { sport: "sports", entertainment: "entertainment" };
  const mappedCategory = categoryMap[category] || category;

  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWSAPI_KEY}&category=${mappedCategory}&country=${country}&pageSize=20`;
      const { data } = await axios.get(url, { timeout: 10000 });
      console.log(`✓ NewsAPI: Fetched ${data.articles?.length || 0} ${category} articles from ${country.toUpperCase()}`);

      return data.articles.map(article => ({
        title: article.title,
        description: article.description,
        content: article.content,
        urlToImage: article.urlToImage,
        url: article.url,
        source: { name: article.source?.name },
        author: article.author,
        publishedAt: article.publishedAt
      }));
    } catch (error) {
      console.error(`NewsAPI attempt ${i + 1}/${retries} failed:`, error.message);
      if (i === retries - 1) return [];
      await new Promise(resolve => setTimeout(resolve, 2000));
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
      console.log(`✓ NewsData: Fetched ${data.results?.length || 0} ${category} articles from ${country.toUpperCase()}`);

      return data.results.map(article => ({
        title: article.title,
        description: article.description,
        content: article.content,
        urlToImage: article.image_url,
        url: article.link,
        source: { name: article.source_name || article.source_id },
        author: article.creator?.[0],
        publishedAt: article.pubDate
      }));
    } catch (error) {
      console.error(`NewsData attempt ${i + 1}/${retries} failed:`, error.message);
      if (i === retries - 1) return [];
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return [];
}

// --- FETCH ENTERTAINMENT (Worldwide) ---
async function fetchEntertainment() {
  console.log("\n📰 Fetching Entertainment News...");

  const newsAPIArticles = await fetchFromNewsAPI("entertainment", "us");
  const newsDataArticles = await fetchFromNewsData("entertainment", "ng");

  const combined = [...newsDataArticles, ...newsAPIArticles];
  const unique = combined.filter((article, index, self) =>
    index === self.findIndex(a => a.title === article.title)
  );

  console.log(`   Combined: ${unique.length} unique entertainment articles`);
  return unique;
}

// --- FETCH SPORTS (NewsAPI only) ---
async function fetchSports() {
  console.log("\n📰 Fetching Sports News...");
  return await fetchFromNewsAPI("sport", "us");
}

// --- FILTER ARTICLES ---
function filterArticles(articles) {
  return articles.filter(article =>
    article.title && article.title.length > 1 && article.urlToImage
  );
}

// --- SAVE ARTICLE TO SANITY ---
async function saveToSanity(article, forcedCategory = "general") {
  try {
    const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
    if (existing) {
      console.log(`   ⏭️ Already exists: ${article.title.slice(0, 60)}...`);
      return false;
    }

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;

    console.log(`   🤖 Generating AI content: "${article.title.slice(0, 50)}..."`);
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

    console.log(`   ✅ Saved [${forcedCategory}]: ${article.title.slice(0, 60)}...`);
    return true;

  } catch (err) {
    console.error(`   ❌ Error saving: ${err.message}`);
    return false;
  }
}

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }

  try {
    console.log("Starting news update with dual API + AI generation...");

    const entertainmentNews = filterArticles(await fetchEntertainment());
    const sportsNews = filterArticles(await fetchSports());

    let entertainmentCount = 0;
    let sportsCount = 0;

    // Save up to 10 valid entertainment articles
    for (const article of entertainmentNews) {
      if (await saveToSanity(article, "entertainment")) entertainmentCount++;
      if (entertainmentCount >= 1) break;
    }

    // Save up to 5 valid sports articles
    for (const article of sportsNews) {
      if (await saveToSanity(article, "sport")) sportsCount++;
      if (sportsCount >= 1) break;
    }

    // 🐦 POST TO TWITTER BEFORE SENDING RESPONSE
    let twitterSuccess = false;
    const bestArticle = pickBestArticle([...entertainmentNews, ...sportsNews]);

    if (bestArticle) {
      console.log("\n🚀 Posting best article to X...");
      try {
        await postToX(bestArticle);
        twitterSuccess = true;
      } catch (error) {
        console.error("Twitter posting failed:", error.message);
      }
    }

    // Now send response with all results
    res.status(200).json({
      message: "News updated successfully with AI-generated content!",
      stats: {
        entertainment: entertainmentCount,
        sports: sportsCount,
        totalFetched: { 
          entertainment: entertainmentNews.length, 
          sports: sportsNews.length 
        },
        twitterPosted: twitterSuccess
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating news", error: err.message });
  }
}
// --- TEST RUN ---
async function runTest() {
  console.log("🚀 Starting News Update Test (Dual API + AI)\n");
  console.log("=".repeat(60));

  try {
    const entertainmentNews = filterArticles(await fetchEntertainment());
    const sportsNews = filterArticles(await fetchSports());

    let entertainmentCount = 0;
    let sportsCount = 0;

    console.log("\n📺 Processing Entertainment News:");
    for (const article of entertainmentNews) {
      if (await saveToSanity(article, "entertainment")) entertainmentCount++;
      if (entertainmentCount >= 1) break;
    }

    console.log("\n⚽ Processing Sports News:");
    for (const article of sportsNews) {
      if (await saveToSanity(article, "sport")) sportsCount++;
      if (sportsCount >= 1) break;
    }

    console.log("\n" + "=".repeat(60));
    console.log(`\n📊 RESULTS:`);
    console.log(`   Entertainment: ${entertainmentCount} saved`);
    console.log(`   Sports: ${sportsCount} saved`);
    console.log(`   Total: ${entertainmentCount + sportsCount} articles\n`);
    console.log("✅ Test completed successfully!\n");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  }
}
runTest()
// Run the test

