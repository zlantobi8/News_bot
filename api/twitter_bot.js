import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import fs from "fs";

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
  const encoded = encodeURI(url);
  try {
    await twitterClient.v2.tweet({ text: `Testing ${encoded}` });
    console.log("✅ Domain allowed by Twitter.");
    return encoded;
  } catch (err) {
    const isInvalid = err?.data?.errors?.some(e =>
      e.message?.toLowerCase().includes("invalid url")
    );
    if (isInvalid) {
      console.log("⚠️ Domain blocked — shortening via TinyURL...");
      try {
        const res = await axios.get(
          `https://tinyurl.com/api-create.php?url=${encodeURIComponent(encoded)}`
        );
        console.log(`🔗 Shortened URL: ${res.data}`);
        return res.data;
      } catch (shortErr) {
        console.error("❌ TinyURL shortening failed:", shortErr.message);
        return encoded;
      }
    } else {
      console.error("❌ Unknown tweet test error:", err.message);
      return encoded;
    }
  }
}

// --- PICK BEST ARTICLE ---
function pickBestArticle(articles) {
  return articles
    .filter(a => a.title && (a.content || a.description) && a.urlToImage)
    .sort((a, b) => ((b.content || b.description || "").length -
                     (a.content || a.description || "").length))[0];
}

// --- DOWNLOAD IMAGE BUFFER ---
async function downloadImageBuffer(url) {
  try {
    console.log(`   Image URL: ${url}`);
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: 5 * 1024 * 1024,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const buf = Buffer.from(res.data, "binary");
    console.log(`   Image size: ${(buf.length / 1024).toFixed(2)} KB`);
    return buf;
  } catch (err) {
    console.error(`⚠️ Failed to download image: ${err.message}`);
    return null;
  }
}

// --- CREATE TWEET TEXT ---
function createTweetText(article, postUrl) {
  const title = sanitizeText(article.title);
  const source = sanitizeText(article.content || article.description || "");
  const snippet = source.split(" ").slice(0, 50).join(" ") +
    (source.split(" ").length > 50 ? "..." : "");
  const readMore = `\n\nRead more 🔗 ${postUrl}`;
  let tweet = `${title}\n\n${snippet}${readMore}`;
  if (tweet.length > 280) {
    const maxSnippet = 280 - title.length - readMore.length - 5;
    tweet = `${title}\n\n${snippet.substring(0, maxSnippet)}...${readMore}`;
  }
  return tweet;
}

// --- POST TO X ---
async function postToX(article) {
  try {
    console.log(`\n🐦 Preparing to post: "${article.title.slice(0, 60)}..."`);
    if (!article.title) throw new Error("❌ Missing article title");

    // Create & verify link
    let postUrl = createPostUrl(article);
    postUrl = await shortenUrlIfBlocked(postUrl);

    // Build tweet text
    const tweetText = createTweetText(article, postUrl);
    console.log(`   Tweet length: ${tweetText.length}`);
    console.log(`   Preview: ${tweetText.slice(0, 120)}...`);

    // Try image upload
    let mediaId = null;
    if (article.urlToImage) {
      console.log("   Downloading image...");
      const imgBuffer = await downloadImageBuffer(article.urlToImage);
      if (imgBuffer) {
        try {
          mediaId = await twitterClient.v1.uploadMedia(imgBuffer, { mimeType: "image/jpeg" });
          console.log(`   ✅ Uploaded image (Media ID: ${mediaId})`);
        } catch (uploadErr) {
          console.error(`⚠️ Image upload failed: ${uploadErr.message}`);
        }
      }
    }

    // Prepare tweet payload
    const payload = mediaId
      ? { text: tweetText, media: { media_ids: [mediaId] } }
      : { text: tweetText };

    // Try up to 3 times if network fails
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`   Posting tweet (attempt ${attempt})...`);
        const tweet = await twitterClient.v2.tweet(payload);
        console.log("✅ Posted successfully!");
        console.log(`   Tweet ID: ${tweet.data.id}`);
        console.log(`   View: https://twitter.com/i/web/status/${tweet.data.id}`);
        return tweet.data;
      } catch (err) {
        if (attempt === 3) throw err;
        console.log(`⚠️ Post failed (${attempt}/3) — retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (error) {
    console.error("\n❌ Error posting to X:");
    console.error("   Message:", error.message);
    if (error.data) console.error("   Data:", JSON.stringify(error.data, null, 2));
    if (error.errors) console.error("   Errors:", JSON.stringify(error.errors, null, 2));
  }
}

export { postToX, pickBestArticle };
