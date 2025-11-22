import axios from "axios";
import { createClient } from "@sanity/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { fetchSportsScraped } from "./sports-scraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

// --- GENERATE AI CONTENT WITH GEMINI ---
async function generateDetailedContent(article, category) {
  try {
    console.log(`   🤖 Generating AI-enhanced content...`);
    
    // Try multiple model names in order of preference
    const modelNames = [
      "gemini-2.0-flash-exp",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro"
    ];
    
    let model = null;
    let workingModel = null;
    
    for (const modelName of modelNames) {
      try {
        model = genAI.getGenerativeModel({ model: modelName });
        const testResult = await model.generateContent("test");
        await testResult.response;
        
        workingModel = modelName;
        console.log(`   ✓ Using model: ${modelName}`);
        break;
      } catch (err) {
        console.log(`   ⚠️ Model ${modelName} not available, trying next...`);
        continue;
      }
    }
    
    if (!workingModel) {
      throw new Error('No working Gemini model found');
    }
    
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
    
    if (!generatedText || generatedText.trim().length < 100) {
      throw new Error('Generated content too short');
    }
    
    console.log(`   ✅ AI content generated (${generatedText.length} chars)`);
    return generatedText.trim();
    
  } catch (error) {
    console.warn(`   ⚠️ AI generation failed: ${error.message}`);
    console.log(`   📝 Falling back to original content`);
    
    const fallback = article.content || 
                     article.description || 
                     `${article.title}\n\nRead more at the source.`;
    
    return fallback;
  }
}

// --- FETCH ENTERTAINMENT FROM SCRAPERS ---
async function fetchEntertainment() {
  console.log("\n📰 Fetching Entertainment News from Nigerian sources...");
  
  try {
    const scrapedArticles = await fetchEntertainmentScraped();
    
    // Map scraped articles to match existing format
    const articles = scrapedArticles.map((a) => ({
      title: a.title,
      description: a.detail?.substring(0, 200) + "..." || a.title,
      content: a.detail,
      urlToImage: a.image,
      url: a.link,
      source: { name: a.source },
      author: a.source || "Trendzlib Editorial",
      publishedAt: a.publishedAt,
    }));
    
    console.log(`   ✅ Scraped: ${articles.length} entertainment articles`);
    return articles;
    
  } catch (err) {
    console.error("❌ fetchEntertainment (scraping) failed:", err.message);
    return [];
  }
}

// --- FETCH SPORTS FROM SCRAPERS ---
async function fetchSports() {
  console.log("\n⚽ Fetching Sports News from Nigerian sources...");

  try {
    const scrapedArticles = await fetchSportsScraped();
    
    // Map scraped articles to match existing format
    const articles = scrapedArticles.map((a) => ({
      title: a.title,
      description: a.detail?.substring(0, 200) + "..." || a.title,
      content: a.detail,
      urlToImage: a.image,
      url: a.link,
      source: { name: a.source },
      author: a.source || "Trendzlib Sports",
      publishedAt: a.publishedAt,
    }));
    
    console.log(`   ✅ Scraped: ${articles.length} sports articles`);
    return articles;
    
  } catch (err) {
    console.error("❌ fetchSports (scraping) failed:", err.message);
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
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  
  const start = Date.now();
  console.log("🚀 Starting automated news update (using web scrapers)...");

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
        if (entertainmentCount >= 3) break; // Save up to 3 articles
      }
    }

    console.log("\n⚽ Processing Sports News:");
    for (const a of sports) {
      const saved = await saveToSanity(a, "sport");
      if (saved) {
        savedArticles.push(saved);
        sportsCount++;
        if (sportsCount >= 3) break; // Save up to 3 articles
      }
    }

    console.log(`\n📋 Total articles saved: ${savedArticles.length}`);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✅ News update completed in ${duration}s`);

    res.status(200).json({
      success: true,
      message: "News updated successfully (via web scraping)",
      stats: {
        entertainment: { saved: entertainmentCount, fetched: entertainment.length },
        sports: { saved: sportsCount, fetched: sports.length },
        total: savedArticles.length
      },
      duration: `${duration}s`,
      source: "Web Scraping (TheCable, Complete Sports, Punch)"
    });
  } catch (err) {
    console.error("\n❌ Fatal error:", err.message);
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
}