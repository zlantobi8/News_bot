import axios from "axios";
import * as cheerio from "cheerio";

// ========================
// SPORTS SCRAPERS ONLY
// (Entertainment uses NewsAPI)
// ========================

// ------------------------
// Complete Sports Nigeria Scraper
// ------------------------
async function fetchSportsNigeria() {
  console.log("⚽ Fetching Nigerian Sports News from Complete Sports...");
  const baseUrl = "https://completeports.com/category/football/";
  const articles = [];

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // Extract article links from Complete Sports
    $("article h2.entry-title a, article h3.entry-title a").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();
      if (link && title && link.startsWith("http")) {
        articles.push({ 
          title, 
          link, 
          image: null, 
          detail: null, 
          source: "Complete Sports",
          publishedAt: new Date().toISOString()
        });
      }
    });

    console.log(`   Found ${articles.length} article links, fetching details...`);

    // Visit each article URL to get image + full content
    const fetchPromises = articles.slice(0, 30).map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeout: 10000
        });
        const $a = cheerio.load(html);

        // Get main image - try multiple selectors
        let img = $a("article img.wp-post-image").first().attr("src") ||
                  $a("div.entry-content img").first().attr("src") ||
                  $a("figure.featured-image img").first().attr("src") ||
                  $a("meta[property='og:image']").attr("content") ||
                  null;

        // Ensure image URL is absolute
        if (img && !img.startsWith("http")) {
          img = new URL(img, art.link).href;
        }
        art.image = img;

        // Get article paragraphs
        const content = [];
        $a("div.entry-content p, article.post-content p").each((i, el) => {
          const text = $a(el).text().trim();
          // Filter out empty paragraphs and common footer text
          if (text && 
              text.length > 30 && 
              !text.includes("Copyright") &&
              !text.includes("All rights reserved")) {
            content.push(text);
          }
        });
        art.detail = content.slice(0, 8).join("\n\n"); // Limit to first 8 paragraphs

        // Try to get published date
        const dateStr = $a("time.entry-date").attr("datetime") || 
                       $a("meta[property='article:published_time']").attr("content");
        if (dateStr) {
          art.publishedAt = dateStr;
        }

        return art;
      } catch (err) {
        console.warn(`   ⚠️ Failed to fetch: ${art.title.slice(0, 40)}...`);
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const validArticles = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value)
      .filter(a => a.image && a.detail && a.detail.length > 100);

    console.log(`   ✅ Complete Sports: fetched ${validArticles.length} valid sports articles`);
    return validArticles;

  } catch (err) {
    console.error("   ❌ Complete Sports scrape failed:", err.message);
    return [];
  }
}

// ------------------------
// Alternative: Punch Sports Scraper
// ------------------------
async function fetchSportsPunch() {
  console.log("⚽ Fetching Sports News from Punch Nigeria...");
  const baseUrl = "https://punchng.com/topics/sports/";
  const articles = [];

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // Extract articles from Punch
    $("article h3 a, article h2 a").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();
      if (link && title && link.startsWith("http")) {
        articles.push({ 
          title, 
          link, 
          image: null, 
          detail: null, 
          source: "Punch Nigeria",
          publishedAt: new Date().toISOString()
        });
      }
    });

    console.log(`   Found ${articles.length} article links from Punch`);

    // Fetch article details
    const fetchPromises = articles.slice(0, 30).map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000
        });
        const $a = cheerio.load(html);

        // Get image
        let img = $a("figure.wp-block-image img").first().attr("src") ||
                  $a("meta[property='og:image']").attr("content") ||
                  null;

        if (img && !img.startsWith("http")) {
          img = new URL(img, art.link).href;
        }
        art.image = img;

        // Get content
        const content = [];
        $a("div.post-content p, article p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text && text.length > 30) {
            content.push(text);
          }
        });
        art.detail = content.slice(0, 8).join("\n\n");

        return art;
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const validArticles = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value)
      .filter(a => a.image && a.detail && a.detail.length > 100);

    console.log(`   ✅ Punch: fetched ${validArticles.length} valid sports articles`);
    return validArticles;

  } catch (err) {
    console.error("   ❌ Punch scrape failed:", err.message);
    return [];
  }
}

// ------------------------
// BBC Sport Football Scraper (International)
// ------------------------
async function fetchBBCSportFootball() {
  console.log("⚽ Fetching International Football News from BBC Sport...");
  const baseUrl = "https://www.bbc.com/sport/football";
  const articles = [];

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // BBC Sport uses various article formats
    $("a[data-testid='internal-link']").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).find("h2, h3").text().trim() || $(el).text().trim();
      
      if (link && title && title.length > 10) {
        const fullLink = link.startsWith("http") ? link : `https://www.bbc.com${link}`;
        
        // Only football-related articles
        if (fullLink.includes("/sport/football/") || 
            fullLink.includes("/sport/articles/")) {
          articles.push({ 
            title, 
            link: fullLink, 
            image: null, 
            detail: null, 
            source: "BBC Sport",
            publishedAt: new Date().toISOString()
          });
        }
      }
    });

    console.log(`   Found ${articles.length} BBC Sport links, fetching details...`);

    // Fetch article details
    const fetchPromises = articles.slice(0, 20).map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000
        });
        const $a = cheerio.load(html);

        // Get image
        let img = $a("meta[property='og:image']").attr("content") ||
                  $a("img[data-testid='lead-image']").first().attr("src") ||
                  null;
        
        if (img && !img.startsWith("http")) {
          img = `https://www.bbc.com${img}`;
        }
        art.image = img;

        // Get content
        const content = [];
        $a("article p, div[data-component='text-block'] p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text && text.length > 30) {
            content.push(text);
          }
        });
        art.detail = content.slice(0, 8).join("\n\n");

        return art;
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const validArticles = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value)
      .filter(a => a.image && a.detail && a.detail.length > 100);

    console.log(`   ✅ BBC Sport: fetched ${validArticles.length} valid football articles`);
    return validArticles;

  } catch (err) {
    console.error("   ❌ BBC Sport scrape failed:", err.message);
    return [];
  }
}

// ------------------------
// Sky Sports Football Scraper (International)
// ------------------------
async function fetchSkySportsFootball() {
  console.log("⚽ Fetching International Football News from Sky Sports...");
  const baseUrl = "https://www.skysports.com/football/news";
  const articles = [];

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // Sky Sports article structure
    $("div.news-list__item a.news-list__headline-link, h4.news-list__headline a").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();
      
      if (link && title && title.length > 10) {
        const fullLink = link.startsWith("http") ? link : `https://www.skysports.com${link}`;
        articles.push({ 
          title, 
          link: fullLink, 
          image: null, 
          detail: null, 
          source: "Sky Sports",
          publishedAt: new Date().toISOString()
        });
      }
    });

    console.log(`   Found ${articles.length} Sky Sports links, fetching details...`);

    // Fetch article details
    const fetchPromises = articles.slice(0, 20).map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000
        });
        const $a = cheerio.load(html);

        // Get image
        let img = $a("meta[property='og:image']").attr("content") ||
                  $a("img.sdc-article-image__item").first().attr("src") ||
                  null;
        art.image = img;

        // Get content
        const content = [];
        $a("div.sdc-article-body p, article p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text && text.length > 30 && !text.includes("Sky Sports")) {
            content.push(text);
          }
        });
        art.detail = content.slice(0, 8).join("\n\n");

        return art;
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const validArticles = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value)
      .filter(a => a.image && a.detail && a.detail.length > 100);

    console.log(`   ✅ Sky Sports: fetched ${validArticles.length} valid football articles`);
    return validArticles;

  } catch (err) {
    console.error("   ❌ Sky Sports scrape failed:", err.message);
    return [];
  }
}

// ------------------------
// Goal.com Football Scraper (International)
// ------------------------
async function fetchGoalFootball() {
  console.log("⚽ Fetching International Football News from Goal.com...");
  const baseUrl = "https://www.goal.com/en/news";
  const articles = [];

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // Goal.com article structure
    $("article a, div.widget-story-card a").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).find("h3, h2, span.widget-story-card__title").text().trim() || 
                    $(el).text().trim();
      
      if (link && title && title.length > 10) {
        const fullLink = link.startsWith("http") ? link : `https://www.goal.com${link}`;
        
        if (fullLink.includes("/news/") || fullLink.includes("/en/")) {
          articles.push({ 
            title, 
            link: fullLink, 
            image: null, 
            detail: null, 
            source: "Goal.com",
            publishedAt: new Date().toISOString()
          });
        }
      }
    });

    console.log(`   Found ${articles.length} Goal.com links, fetching details...`);

    // Fetch article details
    const fetchPromises = articles.slice(0, 20).map(async (art) => {
      try {
        const { data: html } = await axios.get(art.link, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000
        });
        const $a = cheerio.load(html);

        // Get image
        let img = $a("meta[property='og:image']").attr("content") ||
                  $a("figure.widget-story-body__featured-image img").first().attr("src") ||
                  null;
        art.image = img;

        // Get content
        const content = [];
        $a("div.widget-story-body__content p, article p").each((i, el) => {
          const text = $a(el).text().trim();
          if (text && text.length > 30) {
            content.push(text);
          }
        });
        art.detail = content.slice(0, 8).join("\n\n");

        return art;
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const validArticles = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value)
      .filter(a => a.image && a.detail && a.detail.length > 100);

    console.log(`   ✅ Goal.com: fetched ${validArticles.length} valid football articles`);
    return validArticles;

  } catch (err) {
    console.error("   ❌ Goal.com scrape failed:", err.message);
    return [];
  }
}

// ------------------------
// Combined Sports Fetcher (Nigerian + International)
// ------------------------
export async function fetchSportsScraped() {
  console.log("\n⚽ Fetching Sports News from MULTIPLE sources (Nigerian + International)...");
  
  try {
    // Fetch from all sources in parallel
    const [
      nigerianArticles,
      punchArticles,
      bbcArticles,
      skyArticles,
      goalArticles
    ] = await Promise.all([
      fetchSportsNigeria(),
      fetchSportsPunch(),
      fetchBBCSportFootball(),
      fetchSkySportsFootball(),
      fetchGoalFootball()
    ]);
    
    // Combine all articles
    const allArticles = [
      ...nigerianArticles,
      ...punchArticles,
      ...bbcArticles,
      ...skyArticles,
      ...goalArticles
    ];
    
    // Remove duplicates based on title similarity
    const unique = allArticles.filter(
      (a, i, self) => i === self.findIndex((b) => {
        // Consider articles with similar titles as duplicates
        const titleA = a.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const titleB = b.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        return titleA === titleB;
      })
    );
    
    console.log(`\n   📊 FINAL SPORTS STATS:`);
    console.log(`   - Nigerian sources: ${nigerianArticles.length + punchArticles.length}`);
    console.log(`   - International sources: ${bbcArticles.length + skyArticles.length + goalArticles.length}`);
    console.log(`   - Total unique articles: ${unique.length}`);
    
    return unique;
    
  } catch (err) {
    console.error("❌ Sports scraping failed:", err.message);
    return [];
  }
}

// Test function
export async function testSportsScraper() {
  console.log("🧪 Testing Sports Scraper...\n");
  const articles = await fetchSportsScraped();
  
  if (articles.length > 0) {
    console.log("\n📋 Sample Article:");
    console.log("Title:", articles[0].title);
    console.log("Link:", articles[0].link);
    console.log("Image:", articles[0].image ? "✅" : "❌");
    console.log("Content length:", articles[0].detail?.length || 0, "chars");
    console.log("\nFirst 200 chars of content:");
    console.log(articles[0].detail?.substring(0, 200) + "...");
  }
  
  return articles;
}

export default fetchSportsScraped;