import axios from "axios";
import { createClient } from "@sanity/client";
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

// Map category to CSS class
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// Fetch news from NewsAPI.org
async function fetchNews(category, country = "ng") {
  try {
    // NewsAPI uses different category names
    const categoryMap = {
      sport: "sports",
      entertainment: "entertainment",
    };
    
    const mappedCategory = categoryMap[category] || category;
    
    // Use top-headlines endpoint for better quality news
    const url = `https://newsapi.org/v2/top-headlines?apiKey=${process.env.NEWS_API_KEY}&category=${mappedCategory}&country=${country}&pageSize=20`;
    
    const { data } = await axios.get(url);
    return data.articles || [];
  } catch (error) {
    console.error(`Error fetching ${category} news:`, error.response?.data || error.message);
    return [];
  }
}

// Filter sports news
function filterSportsNews(articles) {
  const keywords = [
    "football","soccer","fifa","premier league","chelsea","arsenal","manchester","liverpool",
    "messi","ronaldo","osimhen","super eagles","nigeria","basketball","nba","lebron",
    "stephen curry","giannis"
  ];
  return articles.filter(article =>
    keywords.some(word => (`${article.title} ${article.description || ""}`).toLowerCase().includes(word))
  );
}

/// 💾 Save article to Sanity (skip if no image)
async function saveToSanity(article, forcedCategory = "general") {
  if (!article.title || article.title.length < 10) return false;
  
  // NewsAPI uses 'urlToImage' instead of 'image_url'
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

    // Generate Cloudinary fetch URL
    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.urlToImage)}`;

    // NewsAPI provides better content in 'description' and 'content' fields
    const content = article.content || article.description || `${article.title}\n\nRead more at the source.`;

    await client.create({
      _type: "news",
      title: article.title,
      content,
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
    console.error("❌ Error saving article:", err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end("Unauthorized");
  }

  try {
    const entertainmentNews = await fetchNews("entertainment", "ng");
    const sportsNews = await fetchNews("sport", "us"); // US has better sports coverage

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
      message: "News updated successfully!",
      stats: { 
        entertainment: entertainmentCount, 
        sports: sportsCount,
        totalFetched: { entertainment: entertainmentNews.length, sports: filteredSports.length }
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating news", error: err.message });
  }
}
handler()