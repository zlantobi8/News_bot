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
    console.log(`   Image URL: ${url}`);
    
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: 5 * 1024 * 1024, // 5MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    console.log(`   Image size: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    return buffer;
  } catch (error) {
    console.error(`   ❌ Image download failed: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
    }
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
    // Clean up the content first (remove extra whitespace, newlines)
    const cleanContent = source.replace(/\s+/g, ' ').trim();
    
    // Split into proper sentences (accounting for abbreviations)
    const sentences = cleanContent
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .filter(s => s.trim().length > 10); // Filter out very short fragments
    
    // Calculate available space for snippet
    const readMore = `\n\nRead more: ${postUrl}`;
    const baseLength = title.length + readMore.length + 4; // 4 for \n\n spacing
    const availableLength = 280 - baseLength;
    
    // Aim to use 85% of available space for maximum content
    const targetLength = Math.floor(availableLength * 0.85);
    
    // Build snippet sentence by sentence
    let currentSnippet = '';
    
    for (let i = 0; i < sentences.length && i < 8; i++) { // Cap at 8 sentences max
      const sentence = sentences[i].trim();
      const testSnippet = currentSnippet 
        ? `${currentSnippet} ${sentence}` 
        : sentence;
      
      if (testSnippet.length <= targetLength) {
        currentSnippet = testSnippet;
      } else {
        // If we haven't added any sentences yet, truncate this one
        if (!currentSnippet && targetLength > 100) {
          currentSnippet = sentence.substring(0, targetLength - 3) + '...';
        }
        break;
      }
    }
    
    // Fallback: if snippet is too short, take first chunk of content
    if (currentSnippet.length < 100 && targetLength > 100) {
      currentSnippet = cleanContent.substring(0, targetLength - 3) + '...';
    }
    
    snippet = currentSnippet;
  }
  
  // Build final tweet
  const readMore = `\n\nRead more: ${postUrl}`;
  const tweetText = snippet 
    ? `${title}\n\n${snippet}${readMore}`
    : `${title}${readMore}`;
  
  // Final safety check - ensure we're under 280 chars
  if (tweetText.length > 280) {
    const maxSnippetLength = 280 - title.length - readMore.length - 4;
    
    if (maxSnippetLength > 80) {
      const truncatedSnippet = snippet.substring(0, maxSnippetLength - 3) + '...';
      return `${title}\n\n${truncatedSnippet}${readMore}`;
    } else {
      // Title is too long, truncate it
      const maxTitleLength = 280 - readMore.length - 10;
      const truncatedTitle = title.substring(0, maxTitleLength - 3) + '...';
      return `${truncatedTitle}${readMore}`;
    }
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
    
    // Debug: Show content info
    const contentLength = (article.content || article.description || '').length;
    console.log(`   Content available: ${contentLength} characters`);
    
    const tweetText = createTweetText(article, postUrl);
    
    console.log(`   Tweet length: ${tweetText.length} characters`);
    console.log(`   Tweet preview: ${tweetText.substring(0, 150)}...`);
    
    // Download and upload image
    console.log(`   Downloading image...`);
    const imageBuffer = await downloadImageBuffer(article.urlToImage);
    
    console.log(`   Uploading image to Twitter...`);
    let mediaId;
    try {
      mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { 
        mimeType: "image/jpeg"
      });
      console.log(`   Media ID: ${mediaId}`);
    } catch (uploadError) {
      console.error(`   ❌ Image upload failed:`, uploadError);
      throw uploadError;
    }
    
    // Post tweet with image
    console.log(`   Posting tweet...`);
    let tweet;
    try {
      tweet = await twitterClient.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] },
      });
    } catch (tweetError) {
      console.error(`   ❌ Tweet post failed:`, tweetError);
      
      // Log detailed error info
      if (tweetError.data) {
        console.error(`   Error details:`, JSON.stringify(tweetError.data, null, 2));
      }
      if (tweetError.errors) {
        console.error(`   API errors:`, tweetError.errors);
      }
      
      throw tweetError;
    }

    console.log(`✅ Posted to X successfully!`);
    console.log(`   Tweet ID: ${tweet.data.id}`);
    console.log(`   View at: https://twitter.com/i/web/status/${tweet.data.id}`);
    
    return tweet.data;

  } catch (error) {
    console.error("\n❌ Error posting to X:");
    console.error(`   Error: ${error.message}`);
    
    // More detailed error info
    if (error.code) console.error(`   Code: ${error.code}`);
    if (error.data) console.error(`   Data:`, JSON.stringify(error.data, null, 2));
    if (error.errors) console.error(`   Errors:`, error.errors);
    if (error.stack) console.error(`   Stack trace:`, error.stack);
    
    throw error; // Re-throw so caller knows it failed
  }
}

export { postToX, pickBestArticle };