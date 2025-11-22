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

// --- CATEGORY CLASS HELPER ---
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// --- GENERATE AI CONTENT (Temporarily Disabled) ---
async function generateDetailedContent(article, category) {
  console.log(`   📝 Using original content (AI generation temporarily disabled)`);
  
  // Use the full content from the news API
  const fallback = article.content || 
                   article.description || 
                   `${article.title}\n\nRead more at the source.`;
  
  console.log(`   ✅ Content ready (${fallback.length} chars)`);
  return fallback;
}

// --- FETCH FROM NEWSAPI.ORG ---
async function fetchFromNewsAPI(category, country = "ng", retries = 3) {
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
  console.log("\n📰 Fetching Football (only) News (worldwide)...");

  try {
    const q = encodeURIComponent('football OR soccer');
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
    console.log(`✓ NewsAPI: Fetched ${apiArticles.length} football articles (worldwide)`);

    const newsDataQ = encodeURIComponent("football OR soccer");
    const newsDataUrl = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=${newsDataQ}&language=en&page=1`;
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
    console.log(`✓ NewsData: Fetched ${ndArticles.length} football articles (worldwide)`);

    const combined = [...ndArticles, ...apiArticles];
    const unique = combined.filter(
      (a, i, self) => i === self.findIndex((b) => b.title === a.title)
    );
    console.log(`   Combined: ${unique.length} unique football articles`);
    return unique;
  } catch (err) {
    console.error("❌ fetchSports (football) failed:", err.message);
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
    
    return { 
      ...article, 
      content: detailedContent, 
      category, 
      _id: result._id,
      urlToImage: article.urlToImage,
      image: cloudinaryUrl
    };
  } catch (err) {
    console.error(`   ❌ Error saving article: ${err.message}`);
    return null;
  }
}

// --- MAIN HANDLER (FOR VERCEL CRON) ---
export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  
  const start = Date.now();
  console.log("🚀 Starting automated news update...");

  try {
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

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✅ News update completed in ${duration}s`);

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
    console.error("\n❌ Fatal error:", err.message);
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
}
