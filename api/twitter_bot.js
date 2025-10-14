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
  return `https://www.trendzlib.com/${year}/${month}/${day}/${slug}`;
}

// --- PICK BEST ARTICLE ---
function pickBestArticle(articles) {
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
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024 // 5MB max
    });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.error(`Failed to download image from ${url}:`, error.message);
    throw new Error(`Image download failed: ${error.message}`);
  }
}

// --- CREATE TWEET TEXT WITH LENGTH VALIDATION ---
function createTweetText(article, postUrl) {
  const title = article.title;
  
  // Get snippet from content or description
  let snippet = '';
  const source = article.content || article.description || '';
  
  if (source) {
    const sentences = source.split(/[.!?]+/).filter(s => s.trim().length > 0);
    snippet = sentences.slice(0, 2).join('. ');
    if (snippet && !snippet.endsWith('.')) snippet += '.';
  }
  
  // Build tweet with link
  const readMore = `\n\nRead more: ${postUrl}`;
  const maxSnippetLength = 280 - title.length - readMore.length - 2; // 2 for \n\n
  
  // Truncate snippet if needed
  if (snippet.length > maxSnippetLength) {
    snippet = snippet.substring(0, maxSnippetLength - 3) + '...';
  }
  
  const tweetText = snippet 
    ? `${title}\n\n${snippet}${readMore}`
    : `${title}${readMore}`;
  
  // Final safety check
  if (tweetText.length > 280) {
    const truncatedTitle = title.substring(0, 280 - readMore.length - 3) + '...';
    return `${truncatedTitle}${readMore}`;
  }
  
  return tweetText;
}

// --- POST TO X ---
async function postToX(article) {
  try {
    console.log(`\n🐦 Preparing to post: "${article.title.slice(0, 50)}..."`);
    
    // Validate article data
    if (!article.title) {
      throw new Error("Article missing title");
    }
    if (!article.urlToImage) {
      throw new Error("Article missing image");
    }
    
    // Create post URL and tweet text
    const postUrl = createPostUrl(article);
    const tweetText = createTweetText(article, postUrl);
    
    console.log(`   Tweet length: ${tweetText.length} characters`);
    
    // Download and upload image
    console.log(`   Downloading image...`);
    const imageBuffer = await downloadImageBuffer(article.urlToImage);
    
    console.log(`   Uploading image to Twitter...`);
    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { 
      mimeType: "image/jpeg" 
    });
    
    // Post tweet with image
    console.log(`   Posting tweet...`);
    const tweet = await twitterClient.v2.tweet({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });

    console.log(`✅ Posted to X successfully!`);
    console.log(`   Tweet ID: ${tweet.data.id}`);
    console.log(`   View at: https://twitter.com/i/web/status/${tweet.data.id}`);
    
    return tweet.data;

  } catch (error) {
    console.error("\n❌ Error posting to X:");
    console.error(`   Error: ${error.message}`);
    
    // More detailed error info
    if (error.code) console.error(`   Code: ${error.code}`);
    if (error.data) console.error(`   Data:`, error.data);
    
    throw error; // Re-throw so caller knows it failed
  }
}

export { postToX, pickBestArticle };