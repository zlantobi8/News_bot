import dotenv from "dotenv";
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
dotenv.config();

// --- CONFIGURE TWITTER CLIENT ---
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

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
  try {
    const res = await axios.post(
      "https://api.tinyurl.com/create",
      { url: longUrl },
      {
        headers: {
          Authorization: `Bearer ${process.env.TINYURL_API_TOKEN}`
        },
        timeout: 10000
      }
    );
    return res.data.data.tiny_url;
  } catch (error) {
    console.warn(`   ⚠️ URL shortening failed, using original: ${error.message}`);
    return longUrl;
  }
}

// --- COMPREHENSIVE IMAGE VALIDATION ---
async function validateAndTestImage(url) {
  try {
    console.log(`   🔍 Validating image: ${url.substring(0, 80)}...`);
    
    // 1. Check if URL is valid
    try {
      new URL(url);
    } catch (e) {
      console.error(`   ❌ Invalid URL format`);
      return { valid: false, reason: 'Invalid URL format' };
    }
    
    // 2. Check URL pattern (avoid common problematic patterns)
    const problematicPatterns = [
      /example\.com/i,
      /placeholder/i,
      /dummy/i,
      /test\.jpg/i,
      /\.(svg)$/i
    ];
    
    for (const pattern of problematicPatterns) {
      if (pattern.test(url)) {
        console.error(`   ❌ URL matches problematic pattern: ${pattern}`);
        return { valid: false, reason: `Problematic URL pattern` };
      }
    }
    
    // 3. Try HEAD request first
    let contentType, contentLength;
    try {
      const headResponse = await axios.head(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        }
      });
      
      contentType = headResponse.headers['content-type'];
      contentLength = parseInt(headResponse.headers['content-length']) || 0;
      
    } catch (headError) {
      console.warn(`   ⚠️ HEAD request failed, trying GET: ${headError.message}`);
    }
    
    // 4. Validate content type
    if (contentType) {
      if (!contentType.startsWith('image/')) {
        console.error(`   ❌ Invalid content type: ${contentType}`);
        return { valid: false, reason: `Invalid content type: ${contentType}` };
      }
      console.log(`   ✓ Content type: ${contentType}`);
    }
    
    // 5. Check content length
    if (contentLength > 0) {
      const sizeMB = (contentLength / (1024 * 1024)).toFixed(2);
      console.log(`   ✓ Content length: ${sizeMB} MB`);
      
      if (contentLength < 1000) {
        console.error(`   ❌ Image too small (${contentLength} bytes)`);
        return { valid: false, reason: 'Image too small (likely broken)' };
      }
      
      if (contentLength > 5 * 1024 * 1024) {
        console.error(`   ❌ Image too large (${sizeMB} MB)`);
        return { valid: false, reason: `Image too large: ${sizeMB} MB` };
      }
    }
    
    // 6. Download and verify image
    console.log(`   📥 Downloading image to verify...`);
    const getResponse = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });
    
    const buffer = Buffer.from(getResponse.data, 'binary');
    
    if (buffer.length === 0) {
      console.error(`   ❌ Downloaded image is empty`);
      return { valid: false, reason: 'Downloaded image is empty' };
    }
    
    // 7. Check magic bytes
    const magicBytes = buffer.slice(0, 12);
    const isValidImage = 
      (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF) || // JPEG
      (magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47) || // PNG
      (magicBytes[0] === 0x47 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46) || // GIF
      (magicBytes[8] === 0x57 && magicBytes[9] === 0x45 && magicBytes[10] === 0x42 && magicBytes[11] === 0x50); // WebP
    
    if (!isValidImage) {
      console.error(`   ❌ File is not a valid image (magic bytes check failed)`);
      return { valid: false, reason: 'Not a valid image file' };
    }
    
    const sizeKB = (buffer.length / 1024).toFixed(2);
    console.log(`   ✅ Image validated: ${sizeKB} KB, valid image file`);
    
    return { 
      valid: true, 
      buffer,
      size: buffer.length,
      contentType: getResponse.headers['content-type']
    };
    
  } catch (error) {
    console.error(`   ❌ Image validation failed: ${error.message}`);
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
    }
    return { 
      valid: false, 
      reason: error.message,
      httpStatus: error.response?.status
    };
  }
}

// --- PICK BEST ARTICLE WITH IMAGE VALIDATION ---
async function pickBestArticle(articles) {
  if (!articles || articles.length === 0) {
    console.log(`\n⚠️ No articles provided to pickBestArticle`);
    return null;
  }
  
  console.log(`\n📊 Evaluating ${articles.length} articles for best candidate...`);
  
  // Filter articles with basic requirements
  const candidates = articles.filter(a => {
    if (!a) {
      console.log(`   ⚠️ Skipping null/undefined article`);
      return false;
    }
    
    const hasTitle = a.title && typeof a.title === 'string' && a.title.trim().length > 0;
    const hasContent = a.content || a.description;
    const hasImage = (a.urlToImage || a.image) && 
                     typeof (a.urlToImage || a.image) === 'string' && 
                     (a.urlToImage || a.image).startsWith('http');
    
    if (!hasTitle) {
      console.log(`   ⚠️ Skipping article: missing title`);
      return false;
    }
    if (!hasContent) {
      console.log(`   ⚠️ Skipping article "${a.title?.substring(0, 40)}...": missing content`);
      return false;
    }
    if (!hasImage) {
      console.log(`   ⚠️ Skipping article "${a.title?.substring(0, 40)}...": missing/invalid image URL`);
      return false;
    }
    
    return true;
  });
  
  console.log(`   ✓ ${candidates.length} articles have title, content, and image URL`);
  
  if (candidates.length === 0) {
    console.log(`   ❌ No valid candidates found`);
    return null;
  }
  
  // Sort by content length
  const sorted = candidates.sort((a, b) => {
    const aLength = (a.content || a.description || '').length;
    const bLength = (b.content || b.description || '').length;
    return bLength - aLength;
  });
  
  // Try to find an article with a valid image
  console.log(`\n🔍 Checking images for top candidates...`);
  
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const article = sorted[i];
    console.log(`\n   Testing article ${i + 1}: "${article.title.substring(0, 50)}..."`);
    
    // Use the image field (from Sanity) or urlToImage (from news API)
    const imageUrl = article.image || article.urlToImage;
    const validation = await validateAndTestImage(imageUrl);
    
    if (validation.valid) {
      console.log(`   ✅ Found article with valid image!`);
      // Cache the validated buffer and normalize the structure
      article._validatedImage = {
        buffer: validation.buffer,
        size: validation.size,
        contentType: validation.contentType
      };
      // Ensure urlToImage is set for postToX
      article.urlToImage = imageUrl;
      return article;
    } else {
      console.log(`   ⚠️ Image invalid: ${validation.reason}`);
    }
  }
  
  console.log(`\n⚠️ No articles found with valid images in top ${Math.min(5, sorted.length)} candidates`);
  return null;
}

// --- DOWNLOAD IMAGE (with cached validation) ---
async function downloadImageBuffer(url, cachedValidation = null) {
  if (cachedValidation && cachedValidation.buffer) {
    console.log(`   ♻️ Using cached image buffer (${(cachedValidation.size / 1024).toFixed(2)} KB)`);
    return cachedValidation.buffer;
  }
  
  const validation = await validateAndTestImage(url);
  
  if (!validation.valid) {
    throw new Error(`Image validation failed: ${validation.reason}`);
  }
  
  return validation.buffer;
}

// --- CREATE TWEET TEXT ---
function createTweetText(article, postUrl) {
  const title = article.title || '';
  const maxTweetLength = 280;
  
  let snippet = '';
  const source = article.content || article.description || '';
  
  if (source) {
    const cleanContent = source
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const sentences = cleanContent.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length > 0) {
      snippet = sentences.slice(0, 2).join('. ').trim();
      if (!snippet.endsWith('.') && !snippet.endsWith('!') && !snippet.endsWith('?')) {
        snippet += '.';
      }
    } else {
      const words = cleanContent.split(' ');
      snippet = words.slice(0, 50).join(' ');
      if (words.length > 50) snippet += '...';
    }
  }
  
  const readMore = `\n\nRead more: ${postUrl}`;
  const titleSpace = title.length;
  const readMoreSpace = readMore.length;
  const separatorSpace = 4;
  const availableForSnippet = maxTweetLength - titleSpace - readMoreSpace - separatorSpace;
  
  let tweetText;
  
  if (snippet && availableForSnippet > 50) {
    if (snippet.length > availableForSnippet) {
      snippet = snippet.substring(0, availableForSnippet - 3).trim() + '...';
    }
    tweetText = `${title}\n\n${snippet}${readMore}`;
  } else if (availableForSnippet > 0) {
    tweetText = `${title}${readMore}`;
  } else {
    const maxTitleLength = maxTweetLength - readMore.length - 3;
    const truncatedTitle = title.substring(0, maxTitleLength).trim() + '...';
    tweetText = `${truncatedTitle}${readMore}`;
  }
  
  if (tweetText.length > maxTweetLength) {
    console.warn(`   ⚠️ Tweet still too long (${tweetText.length} chars), truncating...`);
    const maxLength = maxTweetLength - readMore.length - 3;
    tweetText = title.substring(0, maxLength).trim() + '...' + readMore;
  }
  
  return tweetText;
}

// --- POST TO X ---
async function postToX(article) {
  try {
    console.log(`\n🐦 Preparing to post to X (Twitter)...`);
    
    // Validate article object first
    if (!article) {
      throw new Error("No article provided");
    }
    
    if (!article.title || typeof article.title !== 'string' || article.title.trim().length === 0) {
      throw new Error("Article missing valid title");
    }
    
    console.log(`   Title: "${article.title.slice(0, 60)}..."`);
    
    // Check for image URL (could be 'image' from Sanity or 'urlToImage' from API)
    const imageUrl = article.urlToImage || article.image;
    if (!imageUrl || !imageUrl.startsWith('http')) {
      throw new Error("Article missing valid image URL");
    }
    
    const postUrl = createPostUrl(article);
    const safeUrl = await shortenUrl(postUrl);
    const contentLength = (article.content || article.description || '').length;
    console.log(`   📝 Content available: ${contentLength} characters`);
    
    const tweetText = createTweetText(article, safeUrl);
    console.log(`   📏 Tweet length: ${tweetText.length}/280 characters`);
    console.log(`   📄 Tweet preview:\n      "${tweetText.substring(0, 120)}..."`);
    
    if (tweetText.length > 280) {
      throw new Error(`Tweet too long: ${tweetText.length} characters`);
    }
    
    // Use cached validated image if available, otherwise download and validate
    console.log(`\n   📥 Getting image...`);
    const imageBuffer = await downloadImageBuffer(imageUrl, article._validatedImage);
    
    console.log(`   📤 Uploading image to Twitter...`);
    let mediaId;
    try {
      mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { 
        mimeType: "image/jpeg",
        target: 'tweet'
      });
      console.log(`   ✅ Media uploaded successfully (ID: ${mediaId})`);
    } catch (uploadError) {
      console.error(`   ❌ Image upload failed: ${uploadError.message}`);
      if (uploadError.data) {
        console.error(`      Details:`, JSON.stringify(uploadError.data, null, 2));
      }
      throw uploadError;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`\n   🚀 Posting tweet...`);
    let tweet;
    try {
      tweet = await rwClient.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] },
      });
      
      console.log(`\n✅ Successfully posted to X!`);
      console.log(`   🆔 Tweet ID: ${tweet.data.id}`);
      console.log(`   🔗 View at: https://twitter.com/i/web/status/${tweet.data.id}`);
      
    } catch (tweetError) {
      console.error(`\n❌ Tweet posting failed: ${tweetError.message}`);
      if (tweetError.code) console.error(`   Error code: ${tweetError.code}`);
      if (tweetError.data) console.error(`   Error data:`, JSON.stringify(tweetError.data, null, 2));
      throw tweetError;
    }

    return {
      success: true,
      tweetId: tweet.data.id,
      tweetUrl: `https://twitter.com/i/web/status/${tweet.data.id}`,
      data: tweet.data
    };

  } catch (error) {
    console.error("\n❌ Error posting to X:", error.message);
    if (error.code) console.error(`   Code: ${error.code}`);
    if (error.data) console.error(`   Data:`, JSON.stringify(error.data, null, 2));
    
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

export { postToX, pickBestArticle, testConnection, validateAndTestImage };