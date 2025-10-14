import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
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
    .filter(a => a.title && a.content && a.urlToImage)
    .sort((a, b) => b.content.length - a.content.length)[0];
}

// --- DOWNLOAD IMAGE AS BUFFER ---
async function downloadImageBuffer(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary');
}

// --- POST TO X ---
async function postToX(article) {
  try {
    const postUrl = createPostUrl(article);
   const tweetText = `${article.title}\n\n${article.content.split('. ').slice(0, 2).join('. ')}.\n\nRead more: ${postUrl}`;


    // Download and upload image
    const imageBuffer = await downloadImageBuffer(article.urlToImage);
    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { type: "image" });

    // Post tweet with image
    const tweet = await twitterClient.v2.tweet({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });

    console.log(`🐦 Posted to X successfully: ${tweet.data.id}`);
    return tweet.data;

  } catch (error) {
    console.error("❌ Error posting to X:", error.message);
  }
}
export { postToX, pickBestArticle };
