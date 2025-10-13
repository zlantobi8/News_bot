import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

// Configure Sanity
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// Configure Google Gemini AI (FREE!)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Map category to CSS class
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// Generate detailed content using FREE Gemini AI
async function generateDetailedContent(article, category) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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
    const generatedContent = result.response.text().trim();
    
    return generatedContent;

  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    // Fallback to original content
    return article.content || article.description || `${article.title}\n\nRead more at the source.`;
  }
}

// Fetch news from NewsAPI.org with retry logic
async function fetchNews(category, country = "ng", retries = 3) {
  const categoryMap = {
    sport: "sports",
    entertainment: "entertainment",
  };
  
  const mappedCategory = categoryMap[category] || category;
  
  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWS_API_KEY}&category=${mappedCategory}&country=${country}&pageSize=20`;
      
      const { data } = await axios.get(url, {
        timeout: 10000,
        httpsAgent: new (await import('https')).Agent({
          rejectUnauthorized: false
        })
      });
      
      console.log(`✓ Fetched ${data.articles?.length || 0} ${category} articles`);
      return data.articles || [];
      
    } catch (error) {
      console.error(`Attempt ${i + 1}/${retries} failed for ${category}:`, error.message);
      
      if (i === retries - 1) {
        console.error(`Failed to fetch ${category} news after ${retries} attempts`);
        return [];
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return [];
}

// Filter sports news
function filterSportsNews(articles) {
  const keywords = [
    "football","soccer","fifa","premier league","chelsea","arsenal","manchester","liverpool",
    "messi","ronaldo","osimhen","super eagles","nigeria","basketball","nba","lebron",
    "stephen curry","giannis","nfl","cricket","tennis","formula 1","f1"
  ];
  return articles.filter(article =>
    keywords.some(word => (`${article.title} ${article.description || ""}`).toLowerCase().includes(word))
  );
}

// Save article to Sanity with AI-generated content
async function saveToSanity(article, forcedCategory = "general") {
  if (!article.title || article.title.length < 10) return false;
  
  if (!article.urlToImage) {
    console.log(`⚠️ Skipped: No image for "${article.title.slice(0, 50)}..."`);
    return false;
  }

  try {
    const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
    if (existing) {
      console.log(`⏭️ Already exists: ${article.title.slice(0, 60)}...`);
      return false;
    }

    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;
    
    // Generate detailed content with FREE Gemini AI
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

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }

  try {
    console.log("Starting news update with AI content generation...");
    
    const entertainmentNews = await fetchNews("entertainment", "ng");
    const sportsNews = await fetchNews("sport", "us");

    let entertainmentCount = 0;
    let sportsCount = 0;

    // Process entertainment news
    for (const article of entertainmentNews.slice(0, 10)) {
      const saved = await saveToSanity(article, "entertainment");
      if (saved) entertainmentCount++;
    }

    // Process and filter sports news
    const filteredSports = filterSportsNews(sportsNews);
    for (const article of filteredSports.slice(0, 10)) {
      const saved = await saveToSanity(article, "sport");
      if (saved) sportsCount++;
    }

    res.status(200).json({
      message: "News updated successfully with AI-generated content!",
      stats: { 
        entertainment: entertainmentCount, 
        sports: sportsCount,
        totalFetched: { 
          entertainment: entertainmentNews.length, 
          sports: filteredSports.length 
        }
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating news", error: err.message });
  }
}
async function runTest() {
  console.log("🚀 Starting News Update Test with FREE Gemini AI\n");
  console.log("=" .repeat(60));
  
  try {
    // Fetch news
    console.log("\n📰 FETCHING NEWS...\n");
    const entertainmentNews = await fetchNews("entertainment", "ng");
    const sportsNews = await fetchNews("sport", "us");
    
    console.log("\n🔍 FILTERING SPORTS NEWS...");
    const filteredSports = filterSportsNews(sportsNews);
    console.log(`   ✓ ${filteredSports.length} sports articles match keywords\n`);

    // Save news
    console.log("💾 SAVING TO SANITY WITH AI ENHANCEMENT...\n");
    
    let entertainmentCount = 0;
    let sportsCount = 0;

    console.log("📺 Processing Entertainment News:");
    for (const article of entertainmentNews.slice(0, 5)) {
      const saved = await saveToSanity(article, "entertainment");
      if (saved) entertainmentCount++;
    }

    console.log("\n⚽ Processing Sports News:");
    for (const article of filteredSports.slice(0, 5)) {
      const saved = await saveToSanity(article, "sport");
      if (saved) sportsCount++;
    }

    // Results
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 RESULTS:");
    console.log(`   Entertainment: ${entertainmentCount} new articles saved`);
    console.log(`   Sports: ${sportsCount} new articles saved`);
    console.log(`   Total: ${entertainmentCount + sportsCount} articles saved\n`);
    console.log("✅ Test completed successfully!\n");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err);
  }
}

// Run the test
runTest();