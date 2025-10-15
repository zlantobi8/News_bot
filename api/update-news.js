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
    console.log(`   🤖 Generating AI content...`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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
    const content = result.response.text().trim();
    console.log(`   ✅ AI content generated: ${content.length} characters`);
    return content;

  } catch (error) {
    console.error(`   ⚠️ AI generation failed: ${error.message}`);
    // Fallback to original content
    const fallback = article.content || article.description || `${article.title}\n\nRead more at the source.`;
    console.log(`   📝 Using fallback content: ${fallback.length} characters`);
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
  const filtered = articles.filter(article => {
    const hasTitle = article.title && article.title.length > 5;
    const hasImage = article.urlToImage && article.urlToImage.startsWith('http');
    const hasContent = article.content || article.description;
    
    return hasTitle && hasImage && hasContent;
  });
  
  console.log(`   Filtered: ${filtered.length}/${articles.length} articles valid`);
  return filtered;
}

// --- SAVE ARTICLE TO SANITY ---
async function saveToSanity(article, forcedCategory = "general") {
  try {
    // Check if article already exists
    const existing = await client.fetch(
      '*[_type=="news" && title==$title][0]', 
      { title: article.title }
    );
    
    if (existing) {
      console.log(`   ⏭️  Already exists: ${article.title.slice(0, 60)}...`);
      return null;
    }

    // Generate Cloudinary URL for image optimization
    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;

    console.log(`   💾 Saving: "${article.title.slice(0, 50)}..."`);
    
    // Generate AI content
    const detailedContent = await generateDetailedContent(article, forcedCategory);

    // Create document in Sanity
    const result = await client.create({
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
    
    // Return enhanced article with AI content for Twitter posting
    return {
      ...article,
      content: detailedContent,
      category: forcedCategory,
      _id: result._id
    };

  } catch (err) {
    console.error(`   ❌ Error saving article: ${err.message}`);
    return null;
  }
}

// --- MAIN HANDLER (Called by Vercel Cron) ---
export default async function handler(req, res) {
  // Security check for cron job
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("⚠️ Unauthorized access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const startTime = Date.now();
  console.log("🚀 Starting automated news update...");
  console.log(`   Time: ${new Date().toISOString()}`);

  try {
    // Test Twitter connection first
    console.log("\n🔍 Testing Twitter connection...");
    const twitterConnected = await testConnection();
    if (!twitterConnected) {
      console.warn("⚠️ Twitter connection failed, will attempt posting anyway...");
    }

    // Fetch news from APIs
    const entertainmentNews = filterArticles(await fetchEntertainment());
    const sportsNews = filterArticles(await fetchSports());

    let entertainmentCount = 0;
    let sportsCount = 0;
    const savedArticles = [];

    // Save entertainment articles
    console.log("\n📺 Processing Entertainment News:");
    for (const article of entertainmentNews) {
      const savedArticle = await saveToSanity(article, "entertainment");
      if (savedArticle) {
        entertainmentCount++;
        savedArticles.push(savedArticle);
        if (entertainmentCount >= 5) break;
      }
    }

    // Save sports articles
    console.log("\n⚽ Processing Sports News:");
    for (const article of sportsNews) {
      const savedArticle = await saveToSanity(article, "sport");
      if (savedArticle) {
        sportsCount++;
        savedArticles.push(savedArticle);
        if (sportsCount >= 5) break;
      }
    }

    // Post to Twitter/X
    let twitterResult = null;
    const bestArticle = pickBestArticle(savedArticles);

    if (bestArticle) {
      console.log("\n🐦 Posting best article to X...");
      console.log(`   Selected: "${bestArticle.title.slice(0, 60)}..."`);
      console.log(`   Content length: ${(bestArticle.content || '').length} chars`);
      
      const result = await postToX(bestArticle);
      twitterResult = result;
      
      if (result.success) {
        console.log("✅ Twitter post successful!");
      } else {
        console.error("❌ Twitter posting failed:", result.error);
      }
    } else {
      console.log("\n⚠️ No suitable articles to post to Twitter");
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ News update completed in ${duration}s`);

    // Return response
    res.status(200).json({
      success: true,
      message: "News updated successfully!",
      stats: {
        entertainment: {
          saved: entertainmentCount,
          fetched: entertainmentNews.length
        },
        sports: {
          saved: sportsCount,
          fetched: sportsNews.length
        },
        total: {
          saved: entertainmentCount + sportsCount,
          fetched: entertainmentNews.length + sportsNews.length
        }
      },
      twitter: twitterResult ? {
        posted: twitterResult.success,
        tweetId: twitterResult.tweetId,
        url: twitterResult.tweetUrl,
        error: twitterResult.error
      } : {
        posted: false,
        reason: "No suitable articles"
      },
      duration: `${duration}s`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("\n❌ Fatal error during news update:");
    console.error(err);
    
    res.status(500).json({ 
      success: false,
      message: "Error updating news", 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

// --- LOCAL TESTING ---
async function runTest() {
  console.log("🚀 Starting News Update Test");
  console.log("=".repeat(70));

  try {
    // Test Twitter connection
    console.log("\n🔍 Testing Twitter connection...");
    await testConnection();

    const entertainmentNews = filterArticles(await fetchEntertainment());
    const sportsNews = filterArticles(await fetchSports());

    let entertainmentCount = 0;
    let sportsCount = 0;
    const savedArticles = [];

    console.log("\n📺 Processing Entertainment News:");
    for (const article of entertainmentNews) {
      const savedArticle = await saveToSanity(article, "entertainment");
      if (savedArticle) {
        entertainmentCount++;
        savedArticles.push(savedArticle);
        if (entertainmentCount >= 5) break;
      }
    }

    console.log("\n⚽ Processing Sports News:");
    for (const article of sportsNews) {
      const savedArticle = await saveToSanity(article, "sport");
      if (savedArticle) {
        sportsCount++;
        savedArticles.push(savedArticle);
        if (sportsCount >= 5) break;
      }
    }

    // Post to Twitter
    const bestArticle = pickBestArticle(savedArticles);

    if (bestArticle) {
      console.log("\n🐦 Posting best article to X...");
      console.log(`   Selected: "${bestArticle.title.slice(0, 60)}..."`);
      console.log(`   Has AI content: ${bestArticle.content ? 'YES ✅' : 'NO ❌'}`);
      console.log(`   Content length: ${(bestArticle.content || '').length} chars`);
      
      const result = await postToX(bestArticle);
      
      if (result.success) {
        console.log("\n✅ Twitter post successful!");
        console.log(`   Tweet URL: ${result.tweetUrl}`);
      } else {
        console.error("\n❌ Twitter posting failed:", result.error);
      }
    } else {
      console.log("\n⚠️ No articles were saved");
    }

    console.log("\n" + "=".repeat(70));
    console.log(`\n📊 FINAL RESULTS:`);
    console.log(`   Entertainment: ${entertainmentCount} saved`);
    console.log(`   Sports: ${sportsCount} saved`);
    console.log(`   Total: ${entertainmentCount + sportsCount} articles`);
    console.log(`\n✅ Test completed successfully!\n`);

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
  }
}

// Uncomment to run test
runTest();
