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
  console.log(`\n🔍 Filtering ${articles.length} articles...`);
  
  const filtered = articles.filter((a, index) => {
    const hasTitle = a.title && a.title.length > 5;
    const hasImage = a.urlToImage && a.urlToImage.startsWith("http");
    const hasContent = a.content || a.description;
    const hasUrl = a.url && a.url.startsWith("http");

    // Log each article's validation status
    if (!hasTitle || !hasImage || !hasContent || !hasUrl) {
      console.log(`   [${index + 1}] ❌ FAILED: "${a.title?.substring(0, 50)}..."`);
      if (!hasTitle) console.log(`       - Missing valid title`);
      if (!hasImage) console.log(`       - Missing valid image URL`);
      if (!hasContent) console.log(`       - Missing content/description`);
      if (!hasUrl) console.log(`       - Missing valid URL`);
    } else {
      console.log(`   [${index + 1}] ✅ PASSED: "${a.title?.substring(0, 50)}..."`);
    }

    return hasTitle && hasImage && hasContent && hasUrl;
  });

  console.log(`   📊 Result: ${filtered.length}/${articles.length} articles passed validation`);
  return filtered;
}

// --- SAVE TO SANITY (with enhanced debugging) ---
async function saveToSanity(article, category = "general") {
  try {
    console.log(`\n💾 Attempting to save article: "${article.title.slice(0, 60)}..."`);
    
    if (!article.urlToImage) {
      console.log(`   ❌ REJECTED: Missing image URL`);
      return null;
    }

    // Check for existing article
    console.log(`   🔍 Checking for duplicates in Sanity...`);
    const existing = await client.fetch(
      '*[_type=="news" && title==$title][0]',
      { title: article.title }
    );
    
    if (existing) {
      console.log(`   ⚠️ DUPLICATE FOUND: Article already exists in Sanity`);
      console.log(`       Existing ID: ${existing._id}`);
      console.log(`       Published: ${existing.publishedAt}`);
      return null;
    }
    
    console.log(`   ✅ No duplicate found - proceeding with save`);

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(
      article.urlToImage
    )}`;

    console.log(`   🖼️ Image URL: ${article.urlToImage.substring(0, 80)}...`);
    console.log(`   ☁️ Cloudinary URL: ${cloudinaryUrl.substring(0, 80)}...`);
    
    console.log(`   🤖 Generating detailed content with AI...`);
    const detailedContent = await generateDetailedContent(article, category);

    console.log(`   💾 Creating document in Sanity...`);
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

    console.log(`   ✅ SUCCESS! Saved to Sanity`);
    console.log(`       Document ID: ${result._id}`);
    console.log(`       Category: ${category}`);
    
    // Return the complete article with all fields needed for Twitter posting
    return { 
      ...article, 
      content: detailedContent, 
      category, 
      _id: result._id,
      urlToImage: article.urlToImage,
      image: cloudinaryUrl
    };
  } catch (err) {
    console.error(`   ❌ ERROR saving article: ${err.message}`);
    console.error(`       Stack: ${err.stack}`);
    return null;
  }
}

// --- MAIN TEST FUNCTION ---
async function runDetailedTest() {
  console.log("🚀 DETAILED NEWS UPDATE TEST");
  console.log("=".repeat(80));

  try {
    console.log("\n1️⃣ Testing Twitter Connection...");
    await testConnection();

    console.log("\n2️⃣ Fetching Articles...");
    const entertainment = await fetchEntertainment();
    const sports = await fetchSports();
    
    console.log("\n3️⃣ Filtering Articles...");
    const filteredEntertainment = filterArticles(entertainment);
    const filteredSports = filterArticles(sports);

    const savedArticles = [];
    let entertainmentSaved = 0;
    let sportsSaved = 0;

    console.log("\n4️⃣ Processing Entertainment Articles...");
    console.log(`   Target: Save 1 entertainment article`);
    for (let i = 0; i < filteredEntertainment.length && entertainmentSaved < 1; i++) {
      console.log(`\n   --- Processing Entertainment Article ${i + 1}/${filteredEntertainment.length} ---`);
      const saved = await saveToSanity(filteredEntertainment[i], "entertainment");
      if (saved) {
        savedArticles.push(saved);
        entertainmentSaved++;
        console.log(`   🎯 Entertainment article ${entertainmentSaved}/1 saved!`);
      }
    }

    console.log("\n5️⃣ Processing Sports Articles...");
    console.log(`   Target: Save 1 sports article`);
    for (let i = 0; i < filteredSports.length && sportsSaved < 1; i++) {
      console.log(`\n   --- Processing Sports Article ${i + 1}/${filteredSports.length} ---`);
      const saved = await saveToSanity(filteredSports[i], "sport");
      if (saved) {
        savedArticles.push(saved);
        sportsSaved++;
        console.log(`   🎯 Sports article ${sportsSaved}/1 saved!`);
      }
    }

    console.log("\n6️⃣ Summary of Saved Articles:");
    console.log(`   📺 Entertainment: ${entertainmentSaved}/1`);
    console.log(`   ⚽ Sports: ${sportsSaved}/1`);
    console.log(`   📋 Total: ${savedArticles.length} articles saved`);
    
    if (savedArticles.length === 0) {
      console.log("\n⚠️ NO ARTICLES SAVED!");
      console.log("   Possible reasons:");
      console.log("   1. All articles already exist in Sanity (duplicates)");
      console.log("   2. All articles failed validation");
      console.log("   3. Sanity API error");
      console.log("\n   💡 Recommendation: Clear your Sanity database or check API keys");
      return;
    }

    console.log("\n7️⃣ Selecting Best Article for Twitter...");
    const best = await pickBestArticle(savedArticles);
    
    if (best) {
      console.log(`   ✅ Selected: "${best.title.substring(0, 60)}..."`);
      console.log(`   Category: ${best.category}`);
      console.log(`   Image URL: ${(best.urlToImage || best.image)?.substring(0, 60)}...`);
      
      console.log("\n8️⃣ Posting to Twitter...");
      const result = await postToX(best);
      
      if (result.success) {
        console.log(`\n✅ TWITTER POST SUCCESSFUL!`);
        console.log(`   Tweet URL: ${result.tweetUrl}`);
      } else {
        console.error(`\n❌ Twitter posting failed: ${result.error}`);
      }
    } else {
      console.log(`   ⚠️ No valid article with working images found`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Test completed!\n");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
  }
}

// Run the detailed test
