import axios from "axios";
import { createClient } from "@sanity/client";
import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

// 🧠 Configure Sanity client
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID || "4smg0h02",
  dataset: process.env.SANITY_DATASET || "trendzlib",
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// 🎨 Map category to CSS class
function getCategoryClass(category) {
  const classMap = {
    entertainment: "tag-base-sm",
    sport: "tag-base-sm bg-primary",
  };
  return classMap[category] || "tag-base-sm bg-secondary";
}

// 🌍 Fetch news by category
async function fetchNews(category, country = "") {
  try {
    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWS_API_KEY}&category=${category}${
      country ? `&country=${country}` : ""
    }&language=en`;
    
    console.log(`🔍 Fetching ${category} news...`);
    const { data } = await axios.get(url);
    
    if (!data.results || data.results.length === 0) {
      console.log(`⚠️ No results for ${category}`);
      return [];
    }
    
    console.log(`📰 Found ${data.results.length} ${category} articles`);
    return data.results || [];
  } catch (error) {
    console.error(`❌ Error fetching ${category} news:`, error.message);
    return [];
  }
}

// 🎯 Filter only football & basketball-related news
function filterSportsNews(articles) {
  const keywords = [
    "football",
    "soccer",
    "fifa",
    "premier league",
    "chelsea",
    "arsenal",
    "manchester",
    "liverpool",
    "messi",
    "ronaldo",
    "osimhen",
    "super eagles",
    "nigeria",
    "basketball",
    "nba",
    "lebron",
    "stephen curry",
    "giannis",
  ];

  const filtered = articles.filter((article) => {
    const text = `${article.title} ${article.description || ""}`.toLowerCase();
    return keywords.some((word) => text.includes(word));
  });
  
  console.log(`⚽ Filtered ${filtered.length} sports articles from ${articles.length} total`);
  return filtered;
}

// 💾 Save article to Sanity
async function saveToSanity(article, forcedCategory = "general") {
  if (!article.title || article.title.length < 10) {
    console.log(`⚠️ Skipped: Title too short`);
    return;
  }

  try {
    // Check if the news already exists (by title)
    const existing = await client.fetch(
      '*[_type == "news" && title == $title][0]',
      { title: article.title }
    );

    if (existing) {
      console.log(`ℹ️ Duplicate skipped: ${article.title.slice(0, 50)}...`);
      return;
    }

    // Prepare content - use description or create from title
    const content = article.description || article.content || `${article.title}\n\nRead more at the source.`;
    
    // Create new document
    const newDoc = await client.create({
      _type: "news",
      title: article.title,
      content: content,
      category: forcedCategory,
      categoryClass: getCategoryClass(forcedCategory),
      image: article.image_url || "https://via.placeholder.com/800x450?text=No+Image",
      source: article.source_name || article.source_id || "Unknown Source",
      link: article.link || "",
      author: article.creator?.[0] || "Trendzlib Editorial",
      publishedAt: article.pubDate || new Date().toISOString(),
    });

    console.log(`✅ Saved [${forcedCategory}]: ${article.title.slice(0, 60)}...`);
    return newDoc;
  } catch (err) {
    console.error(`❌ Error saving article:`, err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

// 🔁 Main update process
async function updateNews() {
  console.log("\n🚀 Starting news update...");
  console.log(`⏰ Time: ${new Date().toLocaleString()}`);
  
  try {
    // Test Sanity connection first
    const testQuery = await client.fetch('count(*[_type == "news"])');
    console.log(`📊 Current articles in Sanity: ${testQuery}`);
  } catch (error) {
    console.error("❌ Cannot connect to Sanity:", error.message);
    return;
  }

  let entertainmentCount = 0;
  let sportsCount = 0;

  // 🇳🇬 Nigerian celebrity entertainment
  console.log("\n📺 Fetching Nigerian Entertainment News...");
  const entertainmentNews = await fetchNews("entertainment", "ng");
  
  for (const article of entertainmentNews.slice(0, 10)) { // Limit to 10 per run
    const saved = await saveToSanity(article, "entertainment");
    if (saved) entertainmentCount++;
  }

  // 🌐 Global sports → filter to football & basketball
  console.log("\n⚽ Fetching Sports News...");
  const sportsNews = await fetchNews("sports");
  const filteredSports = filterSportsNews(sportsNews);

  for (const article of filteredSports.slice(0, 10)) { // Limit to 10 per run
    const saved = await saveToSanity(article, "sport");
    if (saved) sportsCount++;
  }

  console.log("\n✅ News update completed!");
  console.log(`📊 Stats: ${entertainmentCount} entertainment, ${sportsCount} sports articles added`);
  console.log(`⏰ Next update: ${new Date(Date.now() + 4 * 60 * 60 * 1000).toLocaleString()}\n`);
}

// 🕓 Run every 4 hours
cron.schedule("0 */4 * * *", () => {
  console.log("\n⏰ Scheduled update triggered");
  updateNews();
});

// ▶️ Run once on start
console.log("🎬 News fetcher initialized");
updateNews();

// Keep process alive
process.on('SIGINT', () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});