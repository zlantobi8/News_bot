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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- CREATE POST URL ---
function createPostUrl(post) {
  const date = new Date(post.publishedAt || new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const slug = generateSlug(post.title);
  return encodeURI(`https://www.trendzlib.com.ng/${year}/${month}/${day}/${slug}`);
}

// --- SANITIZE TEXT ---
function sanitizeText(text) {
  return text
    .replace(/[“”‘’]/g, "'")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- SHORTEN URL IF BLOCKED ---
async function shortenUrlIfBlocked(url) {
  try {
    // Test if domain is allowed
    await twitterClient.v2.tweet({
      text: `Testing ${url}`,
    });
    console.log("✅ Domain allowed by Twitter.");
    return url;
  } catch (err) {
    const isInvalid = err?.data?.errors?.some((e) =>
      e.message?.includes("invalid URL")
    );

    if (isInvalid) {
      console.log("⚠️ Domain blocked — shortening via TinyURL...");
      try {
        const response = await axios.get(
          `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`
        );
        console.log(`🔗 Shortened URL: ${response.data}`);
        return response.data;
      } catch (shortErr) {
        console.error("❌ TinyURL shortening failed:", shortErr.message);
        return url;
      }
    } else {
      console.error("❌ Unknown error testing URL:", err.message);
      return url;
    }
  }
}

// --- PICK BEST ARTICLE ---
function pickBestArticle(articles) {
  return articles
    .filter((a) => a.title && (a.content || a.description) && a.urlToImage)
    .sort((a, b) => {
      const aLength = (a.content || a.description || "").length;
      const bLength = (b.content || b.description || "").length;
      return bLength - aLength;
    })[0];
}

// --- DOWNLOAD IMAGE ---
async function downloadImageBuffer(url) {
  console.log(`   Image URL: ${url}`);
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
  });
  const buffer = Buffer.from(response.data, "binary");
  console.log(`   Image size: ${(buffer.length / 1024).toFixed(2)} KB`);
  return buffer;
}

// --- CREATE TWEET TEXT ---
function createTweetText(article, postUrl) {
  const title = sanitizeText(article.title);
  const source = sanitizeText(article.content || article.description || "");
  const words = source.split(" ");
  const snippet = words.slice(0, 50).join(" ") + (words.length > 50 ? "..." : "");
  const readMore = `\n\nRead more 🔗 ${postUrl}`;
  let tweetText = `${title}\n\n${snippet}${readMore}`;

  // Trim to 280 chars max
  if (tweetText.length > 280) {
    const maxSnippetLength = 280 - title.length - readMore.length - 5;
    const truncatedSnippet = snippet.substring(0, maxSnippetLength) + "...";
    tweetText = `${title}\n\n${truncatedSnippet}${readMore}`;
  }

  return tweetText;
}

// --- POST TO X ---
async function postToX(article) {
  try {
    console.log(`\n🐦 Preparing to post: "${article.title.slice(0, 60)}..."`);

    if (!article.title || !article.urlToImage) {
      throw new Error("❌ Missing title or image in article");
    }

    // Create and verify post URL
    let postUrl = createPostUrl(article);
    postUrl = await shortenUrlIfBlocked(postUrl);

    // Create tweet text
    const tweetText = createTweetText(article, postUrl);
    console.log(`   Tweet length: ${tweetText.length}`);
    console.log(`   Tweet preview: ${tweetText.slice(0, 150)}...`);

    // Download image
    console.log(`   Downloading image...`);
    const imageBuffer = await downloadImageBuffer(article.urlToImage);

    // Upload image
    console.log(`   Uploading image...`);
    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
      mimeType: "image/jpeg",
    });
    console.log(`   Media ID: ${mediaId}`);

    // Post tweet
    console.log(`   Posting tweet...`);
    const tweet = await twitterClient.v2.tweet({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });

    console.log(`✅ Posted to X successfully!`);
    console.log(`   Tweet ID: ${tweet.data.id}`);
    console.log(`   View: https://twitter.com/i/web/status/${tweet.data.id}`);
    return tweet.data;

  } catch (error) {
    console.error("\n❌ Error posting to X:");
    console.error(`   Message: ${error.message}`);
    if (error.data) console.error(`   Data: ${JSON.stringify(error.data, null, 2)}`);
    if (error.errors) console.error(`   Errors: ${JSON.stringify(error.errors, null, 2)}`);
    throw error;
  }
}

export { postToX, pickBestArticle };
