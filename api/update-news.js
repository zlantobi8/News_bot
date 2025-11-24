// api/update-news.js
import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@sanity/client";
import dotenv from "dotenv";
dotenv.config();
// ------------------------
// SANITY CONFIG
// ------------------------
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

// ------------------------
// HELPERS
// ------------------------
async function fetchHtml(url, timeout = 8000) {
  try {
    const { data } = await axios.get(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout,
      maxRedirects: 5,
    });
    return data;
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error.message);
    throw error;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

// ------------------------
// CONTENT EXTRACTORS
// ------------------------
async function extractLegitContent(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, .advertisement, .ad, .social-share').remove();

    let content = '';
    const contentSelectors = [
      'article .article-body',
      'article .content',
      '.article-content',
      '.post-content',
      '[itemprop="articleBody"]',
      'article p',
      '.entry-content p'
    ];

    for (const selector of contentSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 50) {
            content += text + '\n\n';
          }
        });
        
        if (content.length > 200) break;
      }
    }

    if (content.length < 200) {
      $('article').find('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) {
          content += text + '\n\n';
        }
      });
    }

    content = cleanText(content);
    
    if (content.length > 3000) {
      content = content.substring(0, 3000) + '...';
    }

    return content || 'Content not available. Please visit the source link for full article.';
  } catch (error) {
    console.error(`Failed to extract Legit content:`, error.message);
    return 'Content extraction failed. Please visit the source link for full article.';
  }
}

async function extractSkyContent(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, .advertisement, .ad, .related-content').remove();

    let content = '';
    const contentSelectors = [
      '.sdc-article-body',
      'article .article__body',
      '.article-body__content',
      '[data-component="article-body"]',
      'article p'
    ];

    for (const selector of contentSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 50) {
            content += text + '\n\n';
          }
        });
        
        if (content.length > 200) break;
      }
    }

    if (content.length < 200) {
      $('article').find('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) {
          content += text + '\n\n';
        }
      });
    }

    content = cleanText(content);
    
    if (content.length > 3000) {
      content = content.substring(0, 3000) + '...';
    }

    return content || 'Content not available. Please visit the source link for full article.';
  } catch (error) {
    console.error(`Failed to extract Sky content:`, error.message);
    return 'Content extraction failed. Please visit the source link for full article.';
  }
}

// ------------------------
// SCRAPERS
// ------------------------
async function scrapeLegit(limit = 3) {
  const url = "https://www.legit.ng/entertainment/";
  const results = [];

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $("article, div.story-card, .story-card__content, .news-item, .article-item").each((i, el) => {
      if (results.length >= limit) return false;
      const el$ = $(el);

      let title =
        el$.find(".story-card__title a").text().trim() ||
        el$.find("h2 a, h3 a, h4 a").text().trim() ||
        el$.find("a[href*='/entertainment/']").first().text().trim();

      let link =
        el$.find(".story-card__title a").attr("href") ||
        el$.find("h2 a, h3 a, h4 a").attr("href") ||
        el$.find("a[href*='/entertainment/']").first().attr("href");

      if (link && !link.startsWith("http")) {
        link = link.startsWith("/") ? `https://www.legit.ng${link}` : `https://www.legit.ng/${link}`;
      }

      let image = 
        el$.find("img").attr("src") || 
        el$.find("img").attr("data-src") || 
        el$.find("img").attr("data-lazy-src") ||
        null;

      if (image && !image.startsWith("http")) {
        if (image.startsWith("//")) {
          image = "https:" + image;
        } else if (image.startsWith("/")) {
          image = "https://www.legit.ng" + image;
        }
      }

      if (title && link && image && !link.includes("/video/")) {
        results.push({ title, link, image, source: "Legit NG" });
      }
    });

    console.log(`Legit NG scraped: ${results.length} articles`);
  } catch (err) {
    console.error("Legit scrape failed:", err.message);
  }

  return results;
}

async function scrapeSkyNews(limit = 3) {
  const url = "https://www.skysports.com/football/news";
  const results = [];

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    $(".news-list__item, article.news-item, .sdc-site-tile").each((i, el) => {
      if (results.length >= limit) return false;
      
      const el$ = $(el);
      const title = el$.find("h2, h3, h4, .news-list__headline").first().text().trim();
      
      let link = 
        el$.find("a.news-list__link").attr("href") ||
        el$.find("a[href*='/football/news/']").attr("href") ||
        el$.closest("a").attr("href");
      
      if (!title || !link) return;
      if (link.includes("/video/") || link.includes("/live-blog/")) return;
      
      if (!link.startsWith("http")) {
        link = link.startsWith("/") ? `https://www.skysports.com${link}` : `https://www.skysports.com/${link}`;
      }

      let image = el$.find("img").attr("src") || el$.find("img").attr("data-src") || null;
      
      if (image && !image.startsWith("http")) {
        if (image.startsWith("//")) {
          image = "https:" + image;
        }
      }

      results.push({ title, link, image, source: "SkySports" });
    });

    console.log(`SkySports scraped: ${results.length} articles`);
  } catch (err) {
    console.error("SkySports scrape failed:", err.message);
  }

  return results;
}

// ------------------------
// SAVE WITH CONTENT TO SANITY
async function saveArticleToSanity(article, category) {
  try {
    const existing = await client.fetch(
      '*[_type=="news" && title==$title][0]',
      { title: article.title }
    );
    
    if (existing) {
      console.log(`Skipping duplicate: ${article.title}`);
      return null;
    }

    // Extract content
    let content = '';
    if (article.source === "Legit NG") {
      content = await extractLegitContent(article.link);
      await delay(800);
    } else if (article.source === "SkySports") {
      content = await extractSkyContent(article.link);
      await delay(800);
    }

    const imageUrl = article.image 
      ? `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.image)}`
      : "https://via.placeholder.com/800x450?text=No+Image";

    const result = await client.create({
      _type: "news",
      title: article.title,
      content: content,
      category,
      categoryClass: category === "entertainment" ? "tag-base-sm" : "tag-base-sm bg-primary",
      image: imageUrl,
      source: article.source || "Unknown Source",
      link: article.link,
      author: article.source || "Trendzlib Editorial",
      publishedAt: new Date().toISOString(),
      aiGenerated: false
    });

    console.log(`Saved: ${article.title} (${content.length} chars)`);
    return { ...article, _id: result._id, image: imageUrl, contentLength: content.length };
  } catch (error) {
    console.error(`Failed to save article:`, error.message);
    return null;
  }
}

// ------------------------
// HANDLER (Vercel Serverless Function)
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log("Starting news scraping with content extraction...");

    // Validate environment variables
    if (!process.env.SANITY_PROJECT_ID || !process.env.SANITY_DATASET || !process.env.SANITY_TOKEN) {
      throw new Error("Missing Sanity configuration in environment variables");
    }

    // Scrape article listings
    let entertainment = [];
    let sports = [];

    try {
      entertainment = await scrapeLegit(4); // Reduced to 2 for faster execution
      await delay(1000);
    } catch (error) {
      console.error("Entertainment scraping failed:", error.message);
    }

    try {
      sports = await scrapeSkyNews(4); // Reduced to 2 for faster execution
      await delay(1000);
    } catch (error) {
      console.error("Sports scraping failed:", error.message);
    }

    const savedArticles = [];

    // Save entertainment articles with content
    for (const article of entertainment) {
      try {
        const saved = await saveArticleToSanity(article, "entertainment");
        if (saved) savedArticles.push(saved);
        await delay(500);
      } catch (error) {
        console.error(`Failed to save entertainment article:`, error.message);
      }
    }

    // Save sports articles with content
    for (const article of sports) {
      try {
        const saved = await saveArticleToSanity(article, "sport");
        if (saved) savedArticles.push(saved);
        await delay(500);
      } catch (error) {
        console.error(`Failed to save sports article:`, error.message);
      }
    }

    console.log(`Successfully saved ${savedArticles.length} articles with content`);

    res.status(200).json({
      success: true,
      stats: {
        entertainment: { 
          fetched: entertainment.length, 
          saved: savedArticles.filter(a => entertainment.some(e => e.title === a.title)).length 
        },
        sports: { 
          fetched: sports.length, 
          saved: savedArticles.filter(a => sports.some(s => s.title === a.title)).length 
        },
        totalSaved: savedArticles.length
      },
      articles: savedArticles.map(a => ({ 
        title: a.title, 
        source: a.source,
        contentLength: a.contentLength 
      })),
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

// -----------------------------------------
// LOCAL MODE: run as Express server
// -----------------------------------------
if (process.env.LOCAL_SERVER === "true") {
  import("express").then(({ default: express }) => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));

    app.all("/api/update-news", (req, res) => handler(req, res));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Local server running at http://localhost:${PORT}/api/update-news`);
    });
  }).catch(err => {
    console.error("Failed to start local server:", err);
  });
}
