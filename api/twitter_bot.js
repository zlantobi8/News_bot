import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";

// --- CONFIGURE TWITTER CLIENT ---
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Use read-write client
const rwClient = twitterClient.readWrite;

// --- SLUG GENERATOR ---
function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- CREATE LINK ---
function createPostUrl(post) {
  const date = new Date(post.publishedAt || new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const slug = generateSlug(post.title);
  return `https://www.trendzlib.com.ng/${year}/${month}/${day}/${slug}`;
}


async function shortenUrl(longUrl) {
  const res = await axios.post(
    "https://api.tinyurl.com/create",
    { url: longUrl },
    {
      headers: {
        Authorization: `Bearer ${process.env.TINYURL_API_TOKEN}`
      }
    }
  );
  return res.data.data.tiny_url;
}
// --- PICK BEST ARTICLE ---
function pickBestArticle(articles) {
  if (!articles || articles.length === 0) return null;
  
  return articles
    .filter(a => a.title && (a.content || a.description) && a.urlToImage)
    .sort((a, b) => {
      const aLength = (a.content || a.description || '').length;
      const bLength = (b.content || b.description || '').length;
      return bLength - aLength;
    })[0];
}

// --- DOWNLOAD IMAGE AS BUFFER ---
async function downloadImageBuffer(url) {
  try {
    console.log(`   📥 Downloading image from: ${url.substring(0, 80)}...`);
    
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 30000, // Increased timeout
      maxContentLength: 5 * 1024 * 1024, // 5MB max
      maxRedirects: 5, // Handle redirects
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    const sizeKB = (buffer.length / 1024).toFixed(2);
    console.log(`   ✅ Image downloaded: ${sizeKB} KB`);
    
    // Validate buffer is not empty
    if (buffer.length === 0) {
      throw new Error('Downloaded image is empty');
    }
    
    return buffer;
  } catch (error) {
    console.error(`   ❌ Image download failed: ${error.message}`);
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response headers:`, error.response.headers);
    }
    throw new Error(`Image download failed: ${error.message}`);
  }
}

// --- CREATE TWEET TEXT WITH LENGTH VALIDATION ---
function createTweetText(article, postUrl) {
  const title = article.title || '';
  const maxTweetLength = 280;
  
  // Get snippet from content or description
  let snippet = '';
  const source = article.content || article.description || '';
  
  if (source) {
    // Clean up the content - remove URLs, extra spaces, special chars
    const cleanContent = source
      .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
      .replace(/\[.*?\]/g, '') // Remove [+xxxx chars]
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
    
    // Split into sentences or words
    const sentences = cleanContent.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length > 0) {
      // Take first 2-3 sentences
      snippet = sentences.slice(0, 2).join('. ').trim();
      if (!snippet.endsWith('.') && !snippet.endsWith('!') && !snippet.endsWith('?')) {
        snippet += '.';
      }
    } else {
      // Fallback to word count
      const words = cleanContent.split(' ');
      snippet = words.slice(0, 50).join(' ');
      if (words.length > 50) snippet += '...';
    }
  }
  
  // Build final tweet with proper structure
  const readMore = `\n\nRead more: ${postUrl}`;
  
  // Calculate available space
  const titleSpace = title.length;
  const readMoreSpace = readMore.length;
  const separatorSpace = 4; // for \n\n between title and snippet
  const availableForSnippet = maxTweetLength - titleSpace - readMoreSpace - separatorSpace;
  
  // Build tweet based on available space
  let tweetText;
  
  if (snippet && availableForSnippet > 50) {
    // We have room for snippet
    if (snippet.length > availableForSnippet) {
      snippet = snippet.substring(0, availableForSnippet - 3).trim() + '...';
    }
    tweetText = `${title}\n\n${snippet}${readMore}`;
  } else if (availableForSnippet > 0) {
    // Just title and read more
    tweetText = `${title}${readMore}`;
  } else {
    // Title is too long, need to truncate it
    const maxTitleLength = maxTweetLength - readMore.length - 3;
    const truncatedTitle = title.substring(0, maxTitleLength).trim() + '...';
    tweetText = `${truncatedTitle}${readMore}`;
  }
  
  // Final safety check
  if (tweetText.length > maxTweetLength) {
    console.warn(`   ⚠️ Tweet still too long (${tweetText.length} chars), truncating...`);
    const maxLength = maxTweetLength - readMore.length - 3;
    tweetText = title.substring(0, maxLength).trim() + '...' + readMore;
  }
  
  return tweetText;
}

// --- VALIDATE IMAGE URL ---
async function validateImageUrl(url) {
  try {
    // Check if URL is valid
    new URL(url);
    
    // Try HEAD request first to check if image exists
    const headResponse = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const contentType = headResponse.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }
    
    return true;
  } catch (error) {
    console.error(`   ⚠️ Image validation failed: ${error.message}`);
    return false;
  }
}

// --- POST TO X ---
async function postToX(article) {
  try {
    console.log(`\n🐦 Preparing to post to X (Twitter)...`);
    console.log(`   Title: "${article.title.slice(0, 60)}..."`);
    
    // Validate article data
    if (!article.title || article.title.trim().length === 0) {
      throw new Error("Article missing title");
    }
    if (!article.urlToImage) {
      throw new Error("Article missing image URL");
    }
    
    // Validate image URL
    console.log(`   🔍 Validating image URL...`);
    const isValidImage = await validateImageUrl(article.urlToImage);
    if (!isValidImage) {
      throw new Error("Image URL is invalid or inaccessible");
    }
    
    // Create post URL and tweet text
    const postUrl = createPostUrl(article);
    const safeUrl = await shortenUrl(postUrl);
    const contentLength = (article.content || article.description || '').length;
    console.log(`   📝 Content available: ${contentLength} characters`);
    
    const tweetText = createTweetText(article, safeUrl);
    console.log(`   📏 Tweet length: ${tweetText.length}/280 characters`);
    console.log(`   📄 Tweet preview:\n      "${tweetText.substring(0, 120)}..."`);
    
    // Validate tweet length
    if (tweetText.length > 280) {
      throw new Error(`Tweet too long: ${tweetText.length} characters`);
    }
    
    // Download image
    console.log(`\n   📥 Downloading image...`);
    const imageBuffer = await downloadImageBuffer(article.urlToImage);
    
    // Upload image to Twitter (v1.1 endpoint)
    console.log(`   📤 Uploading image to Twitter...`);
    let mediaId;
    try {
      // Use v1 client for media upload
      mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { 
        mimeType: "image/jpeg",
        target: 'tweet'
      });
      console.log(`   ✅ Media uploaded successfully`);
      console.log(`   🆔 Media ID: ${mediaId}`);
    } catch (uploadError) {
      console.error(`   ❌ Image upload failed:`);
      console.error(`      Error: ${uploadError.message}`);
      if (uploadError.data) {
        console.error(`      Details:`, JSON.stringify(uploadError.data, null, 2));
      }
      throw uploadError;
    }
    
    // Small delay to ensure media is processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Post tweet with image (v2 endpoint)
    console.log(`\n   🚀 Posting tweet...`);
    let tweet;
    try {
      tweet = await rwClient.v2.tweet({
        text: tweetText,
        media: { 
          media_ids: [mediaId] 
        },
      });
      
      console.log(`\n✅ Successfully posted to X!`);
      console.log(`   🆔 Tweet ID: ${tweet.data.id}`);
      console.log(`   🔗 View at: https://twitter.com/i/web/status/${tweet.data.id}`);
      
    } catch (tweetError) {
      console.error(`\n❌ Tweet posting failed:`);
      console.error(`   Error message: ${tweetError.message}`);
      
      // Log detailed error info
      if (tweetError.code) {
        console.error(`   Error code: ${tweetError.code}`);
      }
      if (tweetError.data) {
        console.error(`   Error data:`, JSON.stringify(tweetError.data, null, 2));
      }
      if (tweetError.errors) {
        console.error(`   API errors:`, JSON.stringify(tweetError.errors, null, 2));
      }
      if (tweetError.rateLimit) {
        console.error(`   Rate limit info:`, tweetError.rateLimit);
      }
      
      throw tweetError;
    }

    return {
      success: true,
      tweetId: tweet.data.id,
      tweetUrl: `https://twitter.com/i/web/status/${tweet.data.id}`,
      data: tweet.data
    };

  } catch (error) {
    console.error("\n❌ Error posting to X:");
    console.error(`   ${error.message}`);
    
    // Comprehensive error logging
    if (error.code) console.error(`   Code: ${error.code}`);
    if (error.data) {
      console.error(`   Data:`, JSON.stringify(error.data, null, 2));
    }
    if (error.errors) {
      console.error(`   Errors:`, JSON.stringify(error.errors, null, 2));
    }
    
    // Return error object instead of throwing to allow graceful handling
    return {
      success: false,
      error: error.message,
      details: {
        code: error.code,
        data: error.data,
        errors: error.errors
      }
    };
  }
}

// --- TEST CONNECTION ---
async function testConnection() {
  try {
    console.log("🔍 Testing Twitter API connection...");
    const me = await twitterClient.v2.me();
    console.log(`✅ Connected as: @${me.data.username} (${me.data.name})`);
    console.log(`   User ID: ${me.data.id}`);
    return true;
  } catch (error) {
    console.error("❌ Twitter connection failed:", error.message);
    return false;
  }
}

export { postToX, pickBestArticle, testConnection };