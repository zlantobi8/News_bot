// api/update-news.js
import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@sanity/client";
import dotenv from "dotenv";
import { postToX, validateAndTestImage } from "./twitter_bot.js";

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
async function scrapeLegit(limit = 2) {
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

async function scrapeSkyNews(limit =2) {
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
// SIMPLIFIED SAVE TO SANITY (ALWAYS SAVE, TWITTER OPTIONAL)
// ------------------------
async function saveArticleToSanity(article, category, attemptTwitter = false) {
  try {
    console.log(`\n📝 Processing: "${article.title}"`);
    
    // 1. CHECK FOR DUPLICATES
    const existing = await client.fetch(
      '*[_type=="news" && title==$title][0]',
      { title: article.title }
    );
    
    if (existing) {
      console.log(`   ⏭️  DUPLICATE - Skipping`);
      return { skipped: true, reason: 'duplicate', title: article.title };
    }

    // 2. EXTRACT CONTENT
    let content = '';
    try {
      if (article.source === "Legit NG") {
        content = await extractLegitContent(article.link);
      } else if (article.source === "SkySports") {
        content = await extractSkyContent(article.link);
      }
      console.log(`   ✅ Content extracted: ${content.length} chars`);
      await delay(500);
    } catch (contentError) {
      console.error(`   ⚠️  Content extraction failed: ${contentError.message}`);
      content = 'Content not available. Please visit the source link.';
    }

    // 3. PREPARE IMAGE URL (use original or Cloudinary)
    let imageUrl = article.image;
    
    // Only use Cloudinary if image exists and is valid HTTP URL
    if (imageUrl && imageUrl.startsWith('http')) {
      try {
        imageUrl = `https://res.cloudinary.com/dwgzccy1i/image/fetch/w_800,h_450,c_fill,q_auto,f_auto/${encodeURIComponent(article.image)}`;
        console.log(`   📸 Using Cloudinary proxy`);
      } catch (e) {
        console.log(`   ⚠️  Using original image URL`);
        imageUrl = article.image;
      }
    } else {
      console.log(`   ⚠️  No valid image, using placeholder`);
      imageUrl = "https://via.placeholder.com/800x450?text=No+Image";
    }

    // 4. TWITTER INTEGRATION (OPTIONAL - DOESN'T BLOCK SAVE)
    let twitterData = {
      postedToTwitter: false,
      twitterPostDate: null,
      tweetId: null,
      tweetUrl: null
    };

    if (attemptTwitter) {
      console.log(`   🐦 Attempting Twitter post...`);
      
      try {
        // Quick validation - less strict
        const validation = await validateAndTestImage(imageUrl);
        
        if (validation.valid) {
          const articleForTwitter = {
            title: article.title,
            content: content,
            urlToImage: imageUrl,
            category: category,
            source: article.source,
            _validatedImage: validation
          };

          const twitterResult = await postToX(articleForTwitter);
          
          if (twitterResult.success) {
            console.log(`   ✅ Posted to Twitter: ${twitterResult.tweetUrl}`);
            twitterData = {
              postedToTwitter: true,
              twitterPostDate: new Date().toISOString(),
              tweetId: twitterResult.tweetId,
              tweetUrl: twitterResult.tweetUrl
            };
          } else {
            console.log(`   ⚠️  Twitter post failed: ${twitterResult.error}`);
          }
        } else {
          console.log(`   ⚠️  Image validation failed for Twitter: ${validation.reason}`);
        }
      } catch (twitterError) {
        console.log(`   ⚠️  Twitter error (continuing anyway): ${twitterError.message}`);
      }
    }

    // 5. SAVE TO SANITY (ALWAYS HAPPENS)
    console.log(`   💾 Saving to Sanity...`);
    
    const sanityDoc = {
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
      aiGenerated: false,
      ...twitterData
    };

    const result = await client.create(sanityDoc);
    
    console.log(`   ✅ SAVED to Sanity (ID: ${result._id})`);
    
    return { 
      success: true,
      skipped: false,
      _id: result._id,
      title: article.title,
      contentLength: content.length,
      twitter: twitterData
    };
    
  } catch (error) {
    console.error(`   ❌ SAVE FAILED: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return { 
      skipped: true, 
      reason: 'error', 
      error: error.message,
      title: article.title 
    };
  }
}

// ------------------------
// HANDLER (Vercel Serverless Function)
// ------------------------
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
    console.log("\n🚀 ========== STARTING NEWS SCRAPING ==========\n");

    // Validate environment variables
    if (!process.env.SANITY_PROJECT_ID || !process.env.SANITY_DATASET || !process.env.SANITY_TOKEN) {
      throw new Error("Missing Sanity configuration in environment variables");
    }

    console.log("✅ Sanity config validated");
    console.log(`   Project: ${process.env.SANITY_PROJECT_ID}`);
    console.log(`   Dataset: ${process.env.SANITY_DATASET}`);

    // Check Twitter credentials
    const twitterEnabled = !!(
      process.env.TWITTER_APP_KEY &&
      process.env.TWITTER_APP_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_SECRET
    );

    console.log(`\n🐦 Twitter: ${twitterEnabled ? '✅ ENABLED' : '⚠️  DISABLED'}\n`);

    // Scrape articles
    console.log("📰 SCRAPING ARTICLES...\n");
    
    let entertainment = [];
    let sports = [];

    try {
      entertainment = await scrapeLegit(2);
      console.log(`✅ Entertainment: ${entertainment.length} articles found`);
      await delay(1000);
    } catch (error) {
      console.error(`❌ Entertainment scraping failed: ${error.message}`);
    }

    try {
      sports = await scrapeSkyNews(2);
      console.log(`✅ Sports: ${sports.length} articles found`);
      await delay(1000);
    } catch (error) {
      console.error(`❌ Sports scraping failed: ${error.message}`);
    }

    const savedArticles = [];
    const skippedArticles = [];

    // Process ENTERTAINMENT articles (no Twitter)
    console.log("\n\n📺 ========== PROCESSING ENTERTAINMENT ==========");
    for (const article of entertainment) {
      const result = await saveArticleToSanity(article, "entertainment", false);
      
      if (result.skipped) {
        skippedArticles.push(result);
      } else {
        savedArticles.push(result);
      }
      
      await delay(500);
    }

    // Process SPORTS articles (with Twitter for best one)
    console.log("\n\n⚽ ========== PROCESSING SPORTS ==========");
    
    // Save all sports articles first
    for (const article of sports) {
      const result = await saveArticleToSanity(article, "sport", false);
      
      if (result.skipped) {
        skippedArticles.push(result);
      } else {
        savedArticles.push(result);
      }
      
      await delay(500);
    }

    // If Twitter enabled, post the BEST saved sports article
    if (twitterEnabled && savedArticles.some(a => a.twitter && !a.twitter.postedToTwitter)) {
      console.log("\n\n🐦 ========== TWITTER: POSTING BEST ARTICLE ==========");
      
      const sportArticles = savedArticles.filter(a => 
        sports.some(s => s.title === a.title) && !a.twitter.postedToTwitter
      );
      
      if (sportArticles.length > 0) {
        // Just post the first one for simplicity
        const bestArticle = sportArticles[0];
        console.log(`\n🎯 Selected: "${bestArticle.title}"`);
        
        // Fetch full article from Sanity
        const fullArticle = await client.fetch(
          '*[_type=="news" && _id==$id][0]',
          { id: bestArticle._id }
        );
        
        try {
          const twitterResult = await postToX({
            title: fullArticle.title,
            content: fullArticle.content,
            urlToImage: fullArticle.image,
            category: 'sport'
          });
          
          if (twitterResult.success) {
            // Update Sanity with Twitter info
            await client.patch(bestArticle._id).set({
              postedToTwitter: true,
              twitterPostDate: new Date().toISOString(),
              tweetId: twitterResult.tweetId,
              tweetUrl: twitterResult.tweetUrl
            }).commit();
            
            console.log(`✅ Posted to Twitter: ${twitterResult.tweetUrl}`);
          }
        } catch (twitterError) {
          console.error(`⚠️  Twitter posting failed: ${twitterError.message}`);
        }
      }
    }

    // Final summary
    console.log("\n\n📊 ========== FINAL SUMMARY ==========");
    console.log(`✅ Saved: ${savedArticles.length} articles`);
    console.log(`⏭️  Skipped: ${skippedArticles.length} articles`);
    console.log(`🐦 Twitter posts: ${savedArticles.filter(a => a.twitter?.postedToTwitter).length}`);

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
        totalSaved: savedArticles.length,
        totalSkipped: skippedArticles.length,
        twitterPosts: savedArticles.filter(a => a.twitter?.postedToTwitter).length
      },
      saved: savedArticles.map(a => ({ 
        title: a.title, 
        id: a._id,
        contentLength: a.contentLength,
        postedToTwitter: a.twitter?.postedToTwitter || false
      })),
      skipped: skippedArticles.map(s => ({
        title: s.title,
        reason: s.reason
      })),
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("\n❌ HANDLER ERROR:", err.message);
    console.error("Stack:", err.stack);
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

// -----------------------------------------
// LOCAL MODE: run as Express server
// -----------------------------------
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