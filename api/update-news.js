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

// Fetch news
async function fetchNews(category, country = "") {
  try {
    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWS_API_KEY}&category=${category}${country ? `&country=${country}` : ""}&language=en`;
    const { data } = await axios.get(url);
    return data.results || [];
  } catch (error) {
    console.error(error);
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
  if (!article.title || article.title.length < 10) return;
  if (!article.image_url) {
    console.log(`⚠️ Skipped: No image for "${article.title.slice(0, 50)}..."`);
    return;
  }

  try {
    const existing = await client.fetch('*[_type=="news" && title==$title][0]', { title: article.title });
    if (existing) return;

    // Generate Cloudinary fetch URL
    const cloudinaryUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.image_url)}`;

    const content = article.description || article.content || `${article.title}\n\nRead more at the source.`;

    await client.create({
      _type: "news",
      title: article.title,
      content,
      category: forcedCategory,
      categoryClass: getCategoryClass(forcedCategory),
      image: cloudinaryUrl, // store optimized image
      source: article.source_name || article.source_id || "Unknown Source",
      link: article.link || "",
      author: article.creator?.[0] || "Trendzlib Editorial",
      publishedAt: article.pubDate || new Date().toISOString(),
    });

    console.log(`✅ Saved [${forcedCategory}]: ${article.title.slice(0, 60)}...`);
  } catch (err) {
    console.error("❌ Error saving article:", err.message);
  }
}


// Main handler
export default async function handler(req, res) {
  try {
    const entertainmentNews = await fetchNews("entertainment", "ng");
    const sportsNews = filterSportsNews(await fetchNews("sports"));

    let entertainmentCount = 0;
    let sportsCount = 0;

    for (const article of entertainmentNews.slice(0, 10)) {
      const saved = await saveToSanity(article, "entertainment");
      if (saved) entertainmentCount++;
    }

    for (const article of sportsNews.slice(0, 10)) {
      const saved = await saveToSanity(article, "sport");
      if (saved) sportsCount++;
    }

    res.status(200).json({
      message: "News updated successfully!",
      stats: { entertainment: entertainmentCount, sports: sportsCount }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating news", error: err.message });
  }
}


// To run this script manually for testing

 